export const BASE_SYSTEM = "You are completing a task on a website. Work step by step. When the task is complete, end with a concise final answer that begins 'Final answer:' and states the result plainly.";
export const MECHANICS = { webmcp: "You operate the site exclusively through its exposed tools. Call ONE tool at a time and wait for its result before the next call.", cu: "You operate a web browser with screenshots, mouse, and keyboard.", structured: "You operate a web browser by reading the page structure and acting on elements." };

export const claudeSampling = (model) => model.startsWith("claude-opus-5")
  ? { temperature: "default", request: {} }
  : { temperature: "0", request: { temperature: 0 } };

// Moving cache breakpoint for Anthropic arms: marks the last content block of
// the final message so the whole conversation prefix caches, not just the
// system prompt — cu-claude re-sends ~90k tokens of screenshots per attempt
// and the system-only breakpoint saves almost none of that.
export const withCacheBreakpoint = (messages) => messages.map((message, i) => {
  if (i !== messages.length - 1 || !Array.isArray(message.content) || !message.content.length) return message;
  const content = message.content.map((block, j) =>
    j === message.content.length - 1 ? { ...block, cache_control: { type: "ephemeral" } } : block);
  return { ...message, content };
});
