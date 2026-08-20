import { isDeepStrictEqual } from "node:util";

function contains(actual, expected) {
  if (isDeepStrictEqual(actual, expected)) return true;
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    if (actual && typeof actual === "object" && Object.entries(expected).every(([key, value]) => contains(actual[key], value))) return true;
  }
  return actual && typeof actual === "object" && Object.values(actual).some((value) => contains(value, expected));
}

function check(actual, assertion = {}) {
  if (Object.hasOwn(assertion, "equals")) return isDeepStrictEqual(actual, assertion.equals);
  if (Object.hasOwn(assertion, "contains")) return contains(actual, assertion.contains);
  if (Object.hasOwn(assertion, "matches")) return new RegExp(assertion.matches).test(String(actual));
  if (Object.hasOwn(assertion, "truthy")) return Boolean(actual) === Boolean(assertion.truthy);
  throw new Error(`unknown assertion: ${Object.keys(assertion).join(",") || "empty"}`);
}

// Agents restate site text with typographic dashes ("3–5 business days") or
// prose ranges ("3 to 5 business days"); score the meaning, not the glyph.
export const normalizeAnswer = (value) => String(value).toLowerCase()
  .replace(/https?:\/\/\S+/g, " ")
  .replace(/[‐-―−]/g, "-")
  .replace(/[’‘`´]/g, "'")
  .replace(/(\d)\s+to\s+(\d)/g, "$1-$2")
  .replace(/[-_]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

export async function score(predicate, capsule, finalText = "") {
  try {
    if (predicate.type === "answer") {
      const text = normalizeAnswer(finalText);
      const all = predicate.contains ?? [];
      const any = predicate.contains_any ?? [];
      if (!all.length && !any.length && !predicate.matches) throw new Error("answer predicate has no expected text");
      const pass = all.every((value) => text.includes(normalizeAnswer(value)))
        && (!any.length || any.some((value) => text.includes(normalizeAnswer(value))) )
        && (!predicate.matches || new RegExp(predicate.matches, "i").test(finalText));
      if (!pass) return { pass, detail: `answer predicate failed: ${JSON.stringify(predicate)}` };
      const forbidden = (predicate.not_contains ?? []).find((value) => text.includes(normalizeAnswer(value)));
      if (forbidden) return { pass: false, detail: `answer predicate failed (negation): ${forbidden}` };
      return { pass, detail: pass ? "predicate passed" : `answer predicate failed: ${JSON.stringify(predicate)}` };
    }
    const { probe, query, args = {}, assert } = predicate;
    const observed = await capsule.observe(probe, { query, ...args });
    const pass = check(observed, assert);
    return { pass, detail: pass ? "predicate passed" : `predicate failed: ${JSON.stringify(assert)}` };
  } catch (error) {
    return { pass: false, detail: `probe-error: ${error.message}` };
  }
}
