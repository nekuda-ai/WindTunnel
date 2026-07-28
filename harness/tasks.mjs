import fs from "node:fs";
import path from "node:path";
import { load } from "js-yaml";

const TASKS_DIR = path.resolve(import.meta.dirname, "../tasks");

export const taskFile = (siteId) => path.join(TASKS_DIR, `${siteId}.yaml`);

export function loadTasks(siteId, directory = TASKS_DIR) {
  const parsed = load(fs.readFileSync(path.join(directory, `${siteId}.yaml`), "utf8"));
  return (Array.isArray(parsed) ? parsed : parsed.tasks).filter((task) => !task.excluded);
}

export function loadTaskFile(file) {
  const parsed = load(fs.readFileSync(path.resolve(file), "utf8"));
  return (Array.isArray(parsed) ? parsed : parsed.tasks).filter((task) => !task.excluded);
}

function choose(value, seed) {
  if (Array.isArray(value)) return value[Math.abs(Number(seed)) % value.length];
  if (value && typeof value === "object") {
    if (Object.hasOwn(value, seed)) return value[seed];
    if (Object.hasOwn(value, "default")) return value.default;
    if (Array.isArray(value.values)) return choose(value.values, seed);
  }
  return value;
}

export function resolveTask(task, seed = 1) {
  const params = Object.fromEntries(Object.entries(task.params ?? {}).map(([key, value]) => [key, choose(value, seed)]));
  const replace = (value) => {
    if (typeof value === "string") {
      const exact = value.match(/^\{params\.([^}]+)\}$/);
      if (exact) return params[exact[1]];
      return value.replace(/\{params\.([^}]+)\}/g, (_, key) => String(params[key]));
    }
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
    return value;
  };
  return replace({ ...task, params });
}

// Where the agent's browser starts. A task may set start_path when the
// journey begins on a specific page (e.g. hi-events attendee tasks start on
// the public event page — the site root is the organizer login, which has no
// link to the event and registers no attendee tools). Default is the root.
export const startUrl = (task, capsule) => new URL(task?.start_path ?? "/", capsule.baseUrl).href;

// Every arm tells its model today's date. Without it, date-dependent tasks
// (booking "the earliest available slot") hinge on which year the model
// happens to assume — wm-claude scanned ten empty weeks of 2025 while wm-gpt
// guessed 2026 and passed. Real deployments inject the date; so do we, in
// every arm uniformly so no interface gets an information edge.
export const withToday = (text) => `${text} Today's date is ${new Date().toISOString().slice(0, 10)}.`;

// Per-interface turn budget. Task YAML may give max_steps as a number (same
// budget for every interface) or as an object keyed by interface class
// ({ webmcp: 8, cu: 20, structured: 15 }) — a screenshot agent needs ~3 model
// turns per journey step, a tool-calling agent ~1.
export function stepBudget(task, interfaceClass, fallback) {
  const ms = task?.max_steps;
  if (typeof ms === "number") return ms;
  if (ms && typeof ms === "object") return ms[interfaceClass] ?? fallback;
  return fallback;
}
