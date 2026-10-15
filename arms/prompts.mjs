export const BASE_SYSTEM = "You are completing a task on a website. Work step by step. When the task is complete, end with a concise final answer that begins 'Final answer:' and states the result plainly.";
export const MECHANICS = { webmcp: "You operate the site exclusively through its exposed tools. Call ONE tool at a time and wait for its result before the next call.", cu: "You operate a web browser with screenshots, mouse, and keyboard.", structured: "You operate a web browser by reading the page structure and acting on elements." };

// Claude 4.7+ (Opus 5, Sonnet 5, Fable 5, Opus 4.7/4.8) REJECT non-default
// temperature/top_p/top_k with a 400 — the whole request fails, so a flight
// would record 100% infrastructure failures rather than degraded scores.
// Allow-list the older models that still accept temperature and default
// everything else to provider defaults, so a model added later fails safe.
// Sonnet 5 runs adaptive thinking by default and `max_tokens` bounds thinking
// AND response text together, so the arms' historical 4096 truncates answers.
// Opus 5 also thinks by default, but its rows were already measured at 4096 and
// are retained in this refresh — changing it would alter a configuration
// mid-generation, so only Sonnet 5 moves.
export const maxTokensFor = (model) => /^claude-(?:sonnet-5|(?:opus|haiku)-5[.-]5)/.test(String(model).split("/").at(-1)) ? 16384 : 4096;

export const providerFor = (model) => /^muse-/.test(String(model)) ? "meta" : /^gpt-/.test(String(model)) ? "openai"
  : /^gemini/.test(String(model)) ? "google" : "anthropic";
export const apiKeyEnvFor = (model) =>
  ({ meta: "MODEL_API_KEY", openai: "OPENAI_API_KEY", google: "GEMINI_API_KEY", anthropic: "ANTHROPIC_API_KEY" })[providerFor(model)];

export const SAMPLING_LEGACY = /^claude-(sonnet-4-[0-6]|opus-4-[0-6]|haiku-4)/;
export const claudeSampling = (model) => SAMPLING_LEGACY.test(String(model))
  ? { temperature: "0", request: { temperature: 0 } }
  : { temperature: "default", request: {} };

// GPT-5.x reasoning models also reject temperature, and Gemini is driven at
// provider defaults, so only legacy Claude models send a sampling parameter.
export const samplingFor = (model) => providerFor(model) === "anthropic"
  ? claudeSampling(model)
  : { temperature: "default", request: {} };

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
