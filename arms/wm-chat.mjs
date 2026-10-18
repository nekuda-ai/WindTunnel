import { startUrl, stepBudget, withToday } from "../harness/tasks.mjs";
import { costFor } from "../harness/lib.mjs";
import { requestOpenRouter, routerAccounting, modelSpec } from "../harness/openrouter.mjs";
import { prepareWebMCPPage, listLiveTools, executeBridgeTool } from "./wm-claude.mjs";
import { BASE_SYSTEM, MECHANICS } from "./prompts.mjs";

export const TOOL_VERSION = "openrouter-chat-completions";

export async function run({ task, capsule, page, model, receipts = [], progress = {} }) {
  const started = performance.now();
  await prepareWebMCPPage(page, startUrl(task, capsule));
  const setupMs = performance.now() - started;
  const deadline = performance.now() + 600_000;
  const limit = stepBudget(task, "webmcp", 12);
  const messages = [{ role: "system", content: withToday(`${BASE_SYSTEM} ${MECHANICS.webmcp}`) }, { role: "user", content: task.prompt }];
  const usage = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_tokens: 0 };
  const transcript = [];
  let turns = 0, finalText = "", failure = "", truncated = false, model_snapshot = "", retries = 0, retry_wait_ms = 0;
  while (turns < limit) {
    if (performance.now() >= deadline) { failure = "attempt timeout: 600s agent budget"; break; }
    const live = await listLiveTools(page);
    if (!live.length) { failure = "no live WebMCP tools registered"; break; }
    const tools = live.map(({ name, description, inputSchema }) => ({ type: "function", function: { name, description: description ?? "", parameters: inputSchema ?? { type: "object", properties: {} } } }));
    turns++;
    let outcome;
    try { outcome = await requestOpenRouter("chat/completions", { model, messages, tools, tool_choice: "auto", max_tokens: 16384 }, receipts); }
    catch (error) { failure = error.message; break; }
    const response = outcome.response, details = response.usage?.prompt_tokens_details ?? {};
    retries += outcome.retries; retry_wait_ms += outcome.retry_wait_ms;
    const cached = details.cached_tokens ?? 0, written = details.cache_write_tokens ?? 0;
    usage.input_tokens += (response.usage?.prompt_tokens ?? 0) - cached - written;
    usage.cached_input_tokens += cached; usage.cache_creation_tokens += written;
    usage.output_tokens += response.usage?.completion_tokens ?? 0;
    model_snapshot = response.model ?? model_snapshot;
    const choice = response.choices?.[0];
    if (!choice?.message) { failure = "provider-accounting: empty chat completion"; break; }
    truncated ||= choice.finish_reason === "length";
    messages.push(choice.message);
    transcript.push({ turn: turns, role: "assistant", content: choice.message, usage: response.usage });
    finalText = choice.message.content || finalText;
    const calls = choice.message.tool_calls ?? [];
    if (!calls.length) break;
    for (const call of calls) {
      let result;
      try { result = await executeBridgeTool(page, call.function.name, JSON.parse(call.function.arguments || "{}")); }
      catch (error) { result = { error: error.message }; }
      transcript.push({ turn: turns, tool: call.function.name, input: call.function.arguments, result });
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 20_000) });
    }
    await page.waitForTimeout(300);
  }
  const accounting = routerAccounting(receipts, costFor(model, usage));
  return { finalText, usage, transcript, turns, setupMs, model_snapshot, retries, retry_wait_ms, ...accounting,
    failure: failure || accounting.failure, budget_exhausted: turns === limit, truncated, temperature: "default", effort: modelSpec(model).reasoning?.effort ?? "api-default", caching: "provider-managed" };
}
