import { startUrl, stepBudget, withToday } from "../harness/tasks.mjs";
import { costFor } from "../harness/lib.mjs";
import { prepareWebMCPPage, listLiveTools, executeBridgeTool } from "./wm-claude.mjs";
import { respond, geminiUsage } from "./cu-gemini.mjs";
import { BASE_SYSTEM, MECHANICS } from "./prompts.mjs";

export const TOOL_VERSION = "gemini-rest";
const MODEL = "gemini-3.6-flash";
const MAX_TURNS = 12;
const ATTEMPT_MS = 600_000;
const SYSTEM = `${BASE_SYSTEM} ${MECHANICS.webmcp}`;

export function geminiTools(tools) {
  return tools.map((tool) => {
    let schema = tool.inputSchema ?? { type: "object", properties: {} };
    if (schema.oneOf || schema.allOf || schema.anyOf) schema = { type: "object", properties: {} };
    return { type: "function", name: tool.name, description: tool.description ?? "", parameters: schema };
  });
}

const finalTextOf = (steps = []) => steps
  .filter(({ type }) => type === "model_output")
  .flatMap(({ content }) => content ?? [])
  .filter(({ type }) => type === "text")
  .map(({ text }) => text)
  .join("\n");

export async function selfCheck(model = MODEL) {
  const tools = [{ type: "function", name: "noop", description: "Return a value.", parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"] } }];
  const { response } = await respond({ model, input: "Call noop with value OK.", tools });
  if (!response.steps?.some(({ type, name }) => type === "function_call" && name === "noop"))
    throw new Error("Gemini function calling returned no noop call");
  return { ok: true, model: response.model ?? model, version: TOOL_VERSION };
}

export async function run({ task, capsule, page, model = MODEL }) {
  const started = performance.now();
  await prepareWebMCPPage(page, startUrl(task, capsule));

  const history = [{ type: "user_input", content: [{ type: "text", text: task.prompt }] }];
  const usage = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_tokens: 0 };
  const transcript = [];
  const limit = stepBudget(task, "webmcp", MAX_TURNS);
  const setupMs = performance.now() - started;
  const deadline = performance.now() + ATTEMPT_MS;
  let finalText = "", model_snapshot = "", turns = 0, previousTools = "", retries = 0, retry_wait_ms = 0;

  while (turns < limit) {
    if (performance.now() >= deadline) throw new Error("attempt timeout: 600s agent budget");
    const liveTools = await listLiveTools(page);
    if (!liveTools.length) throw new Error("no live WebMCP tools registered");
    const toolNames = liveTools.map(({ name }) => name).join(",");
    if (toolNames !== previousTools) {
      transcript.push({ harness: "discovery", tools: liveTools.map(({ name }) => name) });
      previousTools = toolNames;
    }

    turns++;
    const outcome = await respond({
      model,
      store: false,
      system_instruction: withToday(SYSTEM),
      generation_config: { max_output_tokens: 4096 },
      input: history,
      tools: geminiTools(liveTools),
    });
    const interaction = outcome.response;
    model_snapshot = interaction.model ?? model_snapshot;
    retries += outcome.retries;
    retry_wait_ms += outcome.retry_wait_ms;
    const turnUsage = geminiUsage(interaction.usage);
    for (const key of Object.keys(usage)) usage[key] += turnUsage[key] ?? 0;
    history.push(...(interaction.steps ?? []));
    transcript.push({ turn: turns, role: "assistant", content: interaction.steps, usage: interaction.usage });
    finalText = finalTextOf(interaction.steps) || finalText;

    const calls = (interaction.steps ?? []).filter(({ type }) => type === "function_call");
    if (!calls.length) break;
    for (const call of calls) {
      let result;
      try {
        result = await executeBridgeTool(page, call.name, call.arguments ?? {});
      } catch (error) {
        result = { error: error.message };
      }
      transcript.push({ turn: turns, tool: call.name, input: call.arguments, result });
      history.push({
        type: "function_result",
        name: call.name,
        call_id: call.id,
        result: [{ type: "text", text: JSON.stringify(result).slice(0, 20_000) }],
      });
    }
    await page.waitForTimeout(300);
  }

  return {
    finalText, usage, transcript, cost: costFor(model, usage), turns, setupMs, model_snapshot,
    retries, retry_wait_ms, budget_exhausted: turns === limit, temperature: "default", caching: "provider-managed",
  };
}
