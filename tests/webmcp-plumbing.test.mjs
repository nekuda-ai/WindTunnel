import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { bootCapsule } from "../harness/capsule.mjs";
import { runBenchmark } from "../harness/cli.mjs";

async function runArm(armId, webmcp) {
  const root = await mkdtemp(path.join(os.tmpdir(), "windtunnel-webmcp-"));
  const bin = path.join(root, "harness/bin");
  const log = path.join(root, "env.log");
  await mkdir(bin, { recursive: true });
  await writeFile(path.join(bin, "capsule"), `#!/bin/sh
printf '%s:%s\\n' "$2" "\${WT_WEBMCP-unset}" >> "$WT_ENV_LOG"
case "$2" in
  up) printf '{"baseUrl":"http://localhost:3215"}\\n' ;;
  status) printf '{"healthy":true}\\n' ;;
  *) printf '{}\\n' ;;
esac
`);
  await writeFile(path.join(bin, "observe"), `#!/bin/sh
printf '{"results":[{"category":"developer-tools"}],"signedOut":true}\\n'
`);
  await chmod(path.join(bin, "capsule"), 0o755);
  await chmod(path.join(bin, "observe"), 0o755);

  await runBenchmark(["--sites", "directory-9d8", "--arms", armId, "--n", "1"], {
    env: { ...process.env, WT_FAKE_LIFECYCLE: "1", WT_ENV_LOG: log, WT_WEBMCP: "caller-value" },
    outputRoot: path.join(root, "reports"),
    log: () => {},
    methods: { [armId]: { id: armId, model: "none", paid: false, webmcp, async run() { return {}; } } },
    boot: (siteId, options) => bootCapsule(siteId, {
      ...options,
      toolingRoot: root,
      env: { ...options.env, WT_FAKE_LIFECYCLE: "0" },
    }),
  });
  return readFile(log, "utf8");
}

test("only WebMCP arms forward WT_WEBMCP=1 to capsule commands", async () => {
  const webmcp = await runArm("wm-gpt", true);
  assert.match(webmcp, /^prepare:1$/m);
  assert.doesNotMatch(webmcp, /caller-value|unset/);

  const vanilla = await runArm("cu-openai", false);
  assert.match(vanilla, /^prepare:unset$/m);
  assert.doesNotMatch(vanilla, /:1$|caller-value/m);
});
