#!/usr/bin/env node
import { selfCheck as browserUse } from "../arms/browseruse.mjs";
import { selfCheck as stagehand } from "../arms/stagehand.mjs";
import { selfCheck as wmStagehand } from "../arms/wm-stagehand.mjs";

for (const [name, check] of [["dom-browseruse", browserUse], ["a11y-stagehand", stagehand], ["wm-stagehand", wmStagehand]]) {
  try {
    console.log(name, await check());
  } catch (error) {
    console.error(name, { ok: false, error: error.message });
    process.exitCode = 1;
  }
}
