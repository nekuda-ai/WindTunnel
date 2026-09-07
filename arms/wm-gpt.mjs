import { startUrl, stepBudget, withToday } from "../harness/tasks.mjs";
import { costFor } from "../harness/lib.mjs";
import { prepareWebMCPPage, listLiveTools, executeBridgeTool } from "./wm-claude.mjs";
import { BASE_SYSTEM, MECHANICS, samplingFor } from "./prompts.mjs";

const MODEL = "gpt-5.5";
const MAX_TURNS = 12;
const ATTEMPT_MS = 600_000;
const SYSTEM = `${BASE_SYSTEM} ${MECHANICS.webmcp}`;

// ponytail: raw fetch to the Responses API — the loop needs one endpoint, not the openai SDK.
export async function respond(body) {
  let retryWaitMs = 0;
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (attempt >= 6) throw error;
      const waitMs = Math.min(60_000, 2_000 * 2 ** attempt);
      retryWaitMs += waitMs;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }
    if (res.ok) return { response: await res.json(), retries: attempt, retry_wait_ms: retryWaitMs };
    const text = (await res.text()).slice(0, 300);
    // Rate limits (429) and transient 5xx are retried with exponential backoff
    // (honoring Retry-After); anything else fails fast. 56% of cu-openai runs
    // were lost to un-retried 429s in the first full flight.
    if (!/insufficient_quota/i.test(text) && (res.status === 429 || res.status >= 500) && attempt < 6) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(60_000, 2_000 * 2 ** attempt);
      retryWaitMs += waitMs;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }
    throw new Error(`OpenAI ${res.status}: ${text}`);
  }
}

function gptTools(tools) {
  return tools.map((tool) => {
    let schema = tool.inputSchema ?? { type: "object", properties: {} };
    if (schema.oneOf || schema.allOf || schema.anyOf) schema = { type: "object", properties: {} };
    return { type: "function", name: tool.name, description: tool.description ?? "", parameters: schema, strict: false };
  });
}

export async function run({ task, capsule, page, model = MODEL }) {
  const started = performance.now();
  await prepareWebMCPPage(page, startUrl(task, capsule));

  const input = [{ role: "user", content: task.prompt }];
  const usage = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_tokens: 0 };
  const transcript = [];
  // The task YAML's per-interface budget is authoritative; MAX_TURNS is only
  // the fallback when the task doesn't set one. Same rule in every arm.
  const limit = stepBudget(task, "webmcp", MAX_TURNS);
  let finalText = "";
  let failure = "";
  let model_snapshot = "";
  let turns = 0;
  let previousTools = "";
  let retries = 0, retry_wait_ms = 0, temperature = "default";
  let effort = "", truncated = false;
  const setupMs = performance.now() - started;
  const deadline = performance.now() + ATTEMPT_MS;

  while (turns < limit) {
    if (performance.now() >= deadline) { failure = `attempt timeout: ${ATTEMPT_MS / 1000}s agent budget`; break; }
    const tools = await listLiveTools(page);
    if (!tools.length) throw new Error("no live WebMCP tools registered");
    const toolNames = tools.map(({ name }) => name).join(",");
    if (toolNames !== previousTools) {
      transcript.push({ harness: "discovery", tools: tools.map(({ name }) => name) });
      previousTools = toolNames;
    }

    turns++;
    const sampling = samplingFor(model);
    const outcome = await respond({
      model,
      instructions: withToday(SYSTEM),
      max_output_tokens: 4096,
      input,
      parallel_tool_calls: false,
      tools: gptTools(tools),
      ...sampling.request,
    });
    const response = outcome.response;
    model_snapshot = response.model ?? model_snapshot;
    temperature = sampling.temperature;
    effort = response.reasoning?.effort ?? effort;
    if (response.status === "incomplete") truncated = true;
    retries += outcome.retries;
    retry_wait_ms += outcome.retry_wait_ms;
    const details = response.usage?.input_tokens_details ?? {};
    const cached = details.cached_tokens ?? 0, written = details.cache_write_tokens ?? 0;
    // OpenAI's input_tokens INCLUDES cache reads and cache writes; split them
    // so each is priced at its own rate (Astra: $1 read, $12.50 write, $10 fresh).
    usage.input_tokens += (response.usage?.input_tokens ?? 0) - cached - written;
    usage.cached_input_tokens += cached;
    usage.cache_creation_tokens += written;
    usage.output_tokens += response.usage?.output_tokens ?? 0;
    input.push(...response.output);
    transcript.push({ turn: turns, role: "assistant", content: response.output, usage: response.usage });
    const texts = response.output
      .filter(({ type }) => type === "message")
      .flatMap(({ content }) => content ?? [])
      .filter(({ type }) => type === "output_text")
      .map(({ text }) => text);
    finalText = texts.join("\n") || finalText;

    const calls = response.output.filter(({ type }) => type === "function_call");
    if (!calls.length) break;
    for (const call of calls) {
      let result;
      try {
        result = await executeBridgeTool(page, call.name, JSON.parse(call.arguments || "{}"));
      } catch (error) {
        result = { error: error.message };
      }
      transcript.push({ turn: turns, tool: call.name, input: call.arguments, result });
      input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result).slice(0, 20_000) });
    }
    await page.waitForTimeout(300);
  }

  return { finalText, usage, transcript, cost: costFor(model, usage), turns, setupMs, model_snapshot, retries, retry_wait_ms, failure, budget_exhausted: turns === limit, temperature, effort, truncated, caching: "provider-managed" };
}
