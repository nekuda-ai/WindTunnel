import { startUrl, stepBudget, withToday } from "../harness/tasks.mjs";
import { costFor } from "../harness/lib.mjs";
import { respond, geminiUsage } from "./cu-gemini.mjs";
import { geminiTools } from "./wm-gemini.mjs";
import { openStagehand, waitForTools, invokeTool, TOOL_VERSION as STAGEHAND_VERSION } from "./wm-stagehand-v4.mjs";
import { BASE_SYSTEM, MECHANICS } from "./prompts.mjs";

export const TOOL_VERSION = `${STAGEHAND_VERSION}+gemini-rest`;
const MODEL = "gemini-3.6-flash";
const MAX_TURNS = 12;
const ATTEMPT_MS = 600_000;
const SYSTEM = `${BASE_SYSTEM} ${MECHANICS.webmcp}`;

const finalTextOf = (steps = []) => steps
  .filter(({ type }) => type === "model_output")
  .flatMap(({ content }) => content ?? [])
  .filter(({ type }) => type === "text")
  .map(({ text }) => text)
  .join("\n");

export async function invokeGeminiCall(tools, call) {
  const tool = tools.find(({ name }) => name === call.name);
  if (!tool) throw new Error(`tool "${call.name}" is not available`);
  return invokeTool(tool, call.arguments ?? {});
}

export async function run({ task, capsule, model = MODEL }) {
  const started = performance.now();
  const { browser, stagehand } = await openStagehand();
  try {
    const page = await browser.context.activePage();
    await page.goto(startUrl(task, capsule), { waitUntil: "domcontentloaded", timeout: 30_000 });

    const history = [{ type: "user_input", content: [{ type: "text", text: task.prompt }] }];
    const usage = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_tokens: 0 };
    const transcript = [];
    const limit = stepBudget(task, "webmcp", MAX_TURNS);
    const setupMs = performance.now() - started;
    const deadline = performance.now() + ATTEMPT_MS;
    let finalText = "", model_snapshot = "", turns = 0, previousTools = "", retries = 0, retry_wait_ms = 0;

    while (turns < limit) {
      if (performance.now() >= deadline) throw new Error("attempt timeout: 600s agent budget");
      const liveTools = await waitForTools(page);
      if (!liveTools.length) throw new Error("no live WebMCP tools registered");
      const toolNames = liveTools.map(({ name }) => name).join(",");
      if (toolNames !== previousTools) {
        transcript.push({ t: Math.round(performance.now() - started), harness: "discovery", tools: liveTools.map(({ name }) => name) });
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
      transcript.push({ t: Math.round(performance.now() - started), turn: turns, role: "assistant", content: interaction.steps, usage: interaction.usage });
      finalText = finalTextOf(interaction.steps) || finalText;

      const calls = (interaction.steps ?? []).filter(({ type }) => type === "function_call");
      if (!calls.length) break;
      for (const call of calls) {
        let result;
        try {
          result = await invokeGeminiCall(liveTools, call);
        } catch (error) {
          result = { error: error.message };
        }
        transcript.push({ t: Math.round(performance.now() - started), turn: turns, tool: call.name, input: call.arguments, result });
        history.push({
          type: "function_result",
          name: call.name,
          call_id: call.id,
          result: [{ type: "text", text: JSON.stringify(result ?? null).slice(0, 20_000) }],
        });
      }
      await page.waitForTimeout(300);
    }

    return {
      finalText, usage, transcript, cost: costFor(model, usage), turns, setupMs, model_snapshot,
      retries, retry_wait_ms, budget_exhausted: turns === limit, temperature: "default", caching: "provider-managed",
    };
  } finally {
    await stagehand.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
