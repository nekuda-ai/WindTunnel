import fs from "node:fs";
import path from "node:path";
import { load } from "js-yaml";

const root = path.resolve(import.meta.dirname, "..");
const allow = new Set(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "golden-leakage-allowlist.json"), "utf8")).map(({ file, literal }) => `${file}:${String(literal).toLowerCase()}`));
const literals = [];
for (const file of fs.readdirSync(path.join(root, "tasks")).filter((file) => file.endsWith(".yaml") && !file.startsWith("calibration-"))) {
  const doc = load(fs.readFileSync(path.join(root, "tasks", file), "utf8"));
  for (const task of doc.tasks ?? []) for (const value of [...(task.predicate?.contains ?? []), ...(task.predicate?.contains_any ?? [])]) if (String(value).length >= 6) literals.push(String(value).toLowerCase());
}
const hits = [];
for (const file of fs.readdirSync(path.join(root, "goldens")).filter((file) => file.endsWith(".patch"))) {
  const added = fs.readFileSync(path.join(root, "goldens", file), "utf8").split("\n").filter((line) => /^\+.*\b(description|title)\s*[:=]/.test(line));
  for (const literal of literals) for (const line of added) if (line.toLowerCase().includes(literal) && !allow.has(`${file}:${literal}`)) hits.push(`${file}:${literal}: ${line}`);
}
if (hits.length) { console.error(`golden answer leakage:\n${hits.join("\n")}`); process.exitCode = 1; }
