import { readFileSync } from "node:fs";

const REGISTRY_PATH = new URL("../data/registry.json", import.meta.url);

let registryCache;

export function getRegistry() {
  if (!registryCache) {
    registryCache = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  }

  return registryCache;
}
