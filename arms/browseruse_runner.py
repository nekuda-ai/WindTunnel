#!/usr/bin/env python3
"""browser-use 0.12.7 runner; task text arrives on stdin."""

import asyncio
import importlib.metadata
import json
import os
import sys
import time


# browser-use's macOS display probe aborts in non-GUI processes; this runner is headless.
if sys.platform == "darwin":
    sys.modules["AppKit"] = None


def value(source, *names):
    for name in names:
        item = source.get(name) if isinstance(source, dict) else getattr(source, name, None)
        if item is not None:
            return int(item or 0)
    return 0


def token_usage(history):
    usage = getattr(history, "usage", None)
    input_tokens = value(usage, "total_prompt_tokens", "total_input_tokens", "input_tokens")
    output_tokens = value(usage, "total_completion_tokens", "total_output_tokens", "output_tokens")
    if input_tokens or output_tokens:
        return input_tokens, output_tokens
    for step in getattr(history, "history", []) or []:
        metadata = getattr(step, "metadata", None)
        step_usage = getattr(metadata, "usage", None) or metadata
        input_tokens += value(step_usage, "input_tokens", "prompt_tokens")
        output_tokens += value(step_usage, "output_tokens", "completion_tokens")
    return input_tokens, output_tokens


async def main():
    started = time.perf_counter()
    from browser_use import Agent, BrowserProfile, ChatAnthropic

    if sys.argv[1:] == ["--selfcheck"]:
        print("BU_SELFCHECK " + json.dumps({
            "ok": True,
            "version": importlib.metadata.version("browser-use"),
            "python": sys.version.split()[0],
        }))
        return

    base_url = sys.argv[1]
    max_steps = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    model = sys.argv[3] if len(sys.argv) > 3 else "claude-sonnet-4-6"
    system = sys.argv[4] if len(sys.argv) > 4 else None
    prompt = sys.stdin.read().strip()
    agent = Agent(
        task=f"Start at {base_url}\n\n{prompt}",
        llm=ChatAnthropic(model=model, temperature=0),
        browser_profile=BrowserProfile(headless=True, executable_path=(os.environ.get("WT_CHROME") or None)),
        extend_system_message=system,
    )
    result = {"ok": False, "final_text": "", "input_tokens": 0, "output_tokens": 0, "steps": 0, "setup_s": time.perf_counter() - started}
    try:
        history = await agent.run(max_steps=max_steps)
        result["final_text"] = history.final_result() or ""
        result["steps"] = len(getattr(history, "history", []) or [])
        result["input_tokens"], result["output_tokens"] = token_usage(history)
        result["ok"] = True
    except Exception as error:
        result["error"] = f"{type(error).__name__}: {error}"[:500]
    print("BU_RESULT " + json.dumps(result))


asyncio.run(main())
