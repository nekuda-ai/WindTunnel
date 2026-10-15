import { costFor } from "./lib.mjs";
import { openRouterFetch } from "./openrouter.mjs";

let remaining = 0, spent = 0, blocked = false;
export function setRequestBudget(usd) {
  if (!Number.isFinite(usd) || usd <= 0) throw new Error("Positive request budget required");
  remaining = usd; spent = 0; blocked = false;
}
export const requestSpend = () => spent;

export const geminiGeneration = model => model === "gemini-4-argon"
  ? { max_output_tokens: 32768, thinking_level: "medium" }
  : { max_output_tokens: 4096 };

// ponytail: sequential flight shares one meter; parallel flights need separate meters.
// Input reservation is an engineering bound, not a provider-certified token count.
export async function boundedRequest(body, transport = "direct", receipts = []) {
  if (blocked) throw new Error("provider-accounting: previous request is uncertain; meter blocked");
  const google = body.model === "gemini-4-argon";
  if (!google && body.model !== "muse-wonder-1.0") throw new Error("Unsupported bounded model");
  if (google && Date.now() >= Date.parse("2026-12-01T00:00:00Z")) throw new Error("provider-accounting: refresh expired Argon introductory prices");
  const key = google ? "GEMINI_API_KEY" : transport === "openrouter" ? "OPENROUTER_API_KEY" : "MODEL_API_KEY";
  if (!process.env[key]) throw new Error(`${key} is not set`);
  body = google ? { ...body, generation_config: geminiGeneration(body.model) }
    : { ...body, store: false, max_output_tokens: 16384, include: ["reasoning.encrypted_content"] };
  const text = JSON.stringify(body);
  const images = (text.match(/"type":"(?:input_image|computer_screenshot|image)"/g) ?? []).length;
  const reserved = costFor(body.model, {
    input_tokens: Buffer.byteLength(text) + 16384 * (images + 1),
    output_tokens: google ? body.generation_config.max_output_tokens : body.max_output_tokens,
  });
  if (reserved > remaining) throw new Error("provider-accounting: request budget would be exceeded before inference");
  remaining -= reserved;
  try {
    const init = { method: "POST", body: text, signal: AbortSignal.timeout(600_000) };
    const response = transport === "openrouter"
      ? await openRouterFetch(body.model, receipts)("https://openrouter.ai/api/v1/responses", init)
      : await fetch(google ? "https://generativelanguage.googleapis.com/v1beta/interactions" : "https://api.meta.ai/v1/responses", {
        ...init, headers: google ? { "content-type": "application/json", "x-goog-api-key": process.env[key] }
          : { "content-type": "application/json", authorization: `Bearer ${process.env[key]}` },
      });
    if (!response.ok) throw new Error(`${transport === "openrouter" ? "OpenRouter" : google ? "Gemini" : "Meta"} ${response.status}: ${(await response.text()).slice(0, 500)}`);
    const result = await response.json(), u = result.usage ?? {};
    if (!google) for (const item of result.output ?? []) if (item.type === "reasoning" && item.summary == null) item.summary = [];
    const input = google ? u.total_input_tokens : u.input_tokens;
    const output = google ? u.total_output_tokens : u.output_tokens;
    const cached = google ? u.total_cached_tokens ?? 0 : u.input_tokens_details?.cached_tokens ?? 0;
    const thought = google ? u.total_thought_tokens ?? 0 : 0;
    const tools = google ? u.total_tool_use_tokens ?? 0 : 0;
    if (![input, output, cached, thought, tools].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0) || cached > input + tools || input + output + thought <= 0) throw new Error("provider-accounting: invalid or missing token usage");
    const receipt = receipts.at(-1);
    if (transport === "openrouter" && (!receipt || receipt.problems.length)) throw new Error(`provider-accounting: ${receipt?.problems.join("; ") ?? "missing receipt"}`);
    const cost = transport === "openrouter" ? receipt.cost : costFor(body.model, { input_tokens: input + tools - cached, output_tokens: output + thought, cached_input_tokens: cached });
    if (!Number.isFinite(cost) || cost < 0 || cost > reserved) throw new Error("provider-accounting: receipt exceeds request reservation");
    spent += cost; remaining += reserved - cost;
    return { response: result, retries: 0, retry_wait_ms: 0 };
  } catch (error) {
    blocked = true; // Do not retry a possibly billed request or release its reservation.
    throw new Error(`provider-accounting: uncertain request; ${error.message}`);
  }
}
