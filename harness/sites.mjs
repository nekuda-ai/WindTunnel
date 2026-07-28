import fs from "node:fs";
import path from "node:path";
import { load } from "js-yaml";

const REGISTRY = path.resolve(import.meta.dirname, "../sites/sites.yaml");

export function loadRegistry(file = REGISTRY) {
  return load(fs.readFileSync(file, "utf8"));
}

export function loadSites(file = REGISTRY) {
  return loadRegistry(file).sites;
}

export function resolveProfile(name, registry = loadRegistry()) {
  const all = registry.sites.map(({ id }) => id);
  if (name === "*") return all;
  const selected = registry.profiles?.[name];
  if (!selected) throw new Error(`unknown site profile: ${name}`);
  return selected.flatMap((id) => id === "*" ? all : id);
}
