import { test, expect, describe } from "bun:test"
import {
  buildToolHookInput,
  buildSessionHookInput,
  detectToolFailure,
  mapToolAfterEvent,
  type OpenCodeToolBeforeEvent,
  type OpenCodeToolAfterEvent,
  type OpenCodeSessionEvent,
} from "./events.js"

// ---------------------------------------------------------------------------
// buildToolHookInput
// ---------------------------------------------------------------------------

describe("buildToolHookInput", () => {
  const baseEvent: OpenCodeToolBeforeEvent = {
    sessionId: "sess-abc",
    tool: "read_file",
    args: { path: "/tmp/foo.txt" },
  }

  test("PreToolUse: maps all fields correctly", () => {
    const result = buildToolHookInput("PreToolUse", baseEvent, "/workspace")
    expect(result).toEqual({
      session_id: "sess-abc",
      cwd: "/workspace",
      hook_event_name: "PreToolUse",
      tool_name: "read_file",
      tool_input: { path: "/tmp/foo.txt" },
    })
  })

  test("PostToolUse: maps all fields correctly", () => {
    const afterEvent: OpenCodeToolAfterEvent = {
      sessionId: "sess-xyz",
      tool: "write_file",
      args: { path: "/tmp/bar.txt", content: "hello" },
      output: "file written",
    }
    const result = buildToolHookInput("PostToolUse", afterEvent, "/home/user")
    expect(result).toEqual({
      session_id: "sess-xyz",
      cwd: "/home/user",
      hook_event_name: "PostToolUse",
      tool_name: "write_file",
      tool_input: { path: "/tmp/bar.txt", content: "hello" },
    })
  })

  test("does not include tool_name or tool_input as undefined keys when args is empty", () => {
    const event: OpenCodeToolBeforeEvent = {
      sessionId: "s1",
      tool: "list_dir",
      args: {},
    }
    const result = buildToolHookInput("PreToolUse", event, "/tmp")
    expect(result.tool_name).toBe("list_dir")
    expect(result.tool_input).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// buildSessionHookInput
// ---------------------------------------------------------------------------

describe("buildSessionHookInput", () => {
  const sessionEvent: OpenCodeSessionEvent = { sessionId: "session-001" }

  test("SessionStart: maps fields and omits tool fields", () => {
    const result = buildSessionHookInput("SessionStart", sessionEvent, "/projects/app")
    expect(result).toEqual({
      session_id: "session-001",
      cwd: "/projects/app",
      hook_event_name: "SessionStart",
    })
    expect(result.tool_name).toBeUndefined()
    expect(result.tool_input).toBeUndefined()
  })

  test("SessionEnd: maps fields correctly", () => {
    const result = buildSessionHookInput("SessionEnd", sessionEvent, "/projects/app")
    expect(result.hook_event_name).toBe("SessionEnd")
    expect(result.session_id).toBe("session-001")
  })

  test("Stop: maps fields correctly", () => {
    const result = buildSessionHookInput("Stop", sessionEvent, "/projects/app")
    expect(result.hook_event_name).toBe("Stop")
    expect(result.cwd).toBe("/projects/app")
  })
})

// ---------------------------------------------------------------------------
// detectToolFailure
// ---------------------------------------------------------------------------

describe("detectToolFailure", () => {
  function makeEvent(
    overrides: Partial<OpenCodeToolAfterEvent>
  ): OpenCodeToolAfterEvent {
    return {
      sessionId: "s",
      tool: "bash",
      args: {},
      ...overrides,
    }
  }

  // --- explicit error flag ---

  test("event.error=true → true", () => {
    expect(detectToolFailure(makeEvent({ error: true }))).toBe(true)
  })

  test('event.error="some error" → true', () => {
    expect(detectToolFailure(makeEvent({ error: "some error" }))).toBe(true)
  })

  test('event.error="" (empty string) → false', () => {
    expect(detectToolFailure(makeEvent({ error: "" }))).toBe(false)
  })

  test("event.error=false → false (falls through to output check)", () => {
    // No output, bash tool → no patterns match → false
    expect(detectToolFailure(makeEvent({ error: false, output: "all good" }))).toBe(false)
  })

  // --- bash tool output patterns ---

  test('bash: output contains "exit code 1" → true', () => {
    expect(detectToolFailure(makeEvent({ output: "Process exited with exit code 1" }))).toBe(true)
  })

  test('bash: output contains "exit code 2" → true', () => {
    expect(detectToolFailure(makeEvent({ output: "exit code 2" }))).toBe(true)
  })

  test('bash: output contains "Error: something" → true', () => {
    expect(detectToolFailure(makeEvent({ output: "Error: file not found" }))).toBe(true)
  })

  test('bash: output contains "command failed" → true', () => {
    expect(detectToolFailure(makeEvent({ output: "command failed to execute" }))).toBe(true)
  })

  test('bash: output contains "FAILED" (uppercase) → true', () => {
    expect(detectToolFailure(makeEvent({ output: "Build FAILED" }))).toBe(true)
  })

  test("bash: clean output → false", () => {
    expect(detectToolFailure(makeEvent({ output: "hello world\nall good" }))).toBe(false)
  })

  test("bash: no output → false", () => {
    expect(detectToolFailure(makeEvent({ output: undefined }))).toBe(false)
  })

  test("bash: empty string output → false", () => {
    expect(detectToolFailure(makeEvent({ output: "" }))).toBe(false)
  })

  // --- other tools ---

  test('other tool: output contains "Error occurred" → true', () => {
    expect(
      detectToolFailure(makeEvent({ tool: "read_file", output: "Error occurred reading file" }))
    ).toBe(true)
  })

  test("other tool: output contains \"exception\" → true", () => {
    expect(
      detectToolFailure(makeEvent({ tool: "write_file", output: "Unhandled exception in writer" }))
    ).toBe(true)
  })

  test("other tool: output contains \"failed\" → true", () => {
    expect(
      detectToolFailure(makeEvent({ tool: "list_dir", output: "operation failed" }))
    ).toBe(true)
  })

  test("other tool: clean output → false", () => {
    expect(
      detectToolFailure(makeEvent({ tool: "read_file", output: "file contents here" }))
    ).toBe(false)
  })

  test("other tool: no output → false", () => {
    expect(
      detectToolFailure(makeEvent({ tool: "read_file", output: undefined }))
    ).toBe(false)
  })

  // --- object output ---

  test("object output with error key (bash) → true via JSON serialisation", () => {
    expect(
      detectToolFailure(makeEvent({ output: { message: "exit code 1", code: 1 } }))
    ).toBe(true)
  })

  test("object output without error indicators → false (bash)", () => {
    expect(
      detectToolFailure(makeEvent({ output: { result: "ok", count: 3 } }))
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// mapToolAfterEvent
// ---------------------------------------------------------------------------

describe("mapToolAfterEvent", () => {
  function makeAfter(
    overrides: Partial<OpenCodeToolAfterEvent>
  ): OpenCodeToolAfterEvent {
    return { sessionId: "s", tool: "bash", args: {}, ...overrides }
  }

  test("clean bash output → PostToolUse", () => {
    expect(mapToolAfterEvent(makeAfter({ output: "stdout: hello world" }))).toBe("PostToolUse")
  })

  test("bash output with error → PostToolUseFailure", () => {
    expect(
      mapToolAfterEvent(makeAfter({ output: "Process exited with exit code 127" }))
    ).toBe("PostToolUseFailure")
  })

  test("explicit error flag true → PostToolUseFailure", () => {
    expect(mapToolAfterEvent(makeAfter({ error: true, output: "some output" }))).toBe(
      "PostToolUseFailure"
    )
  })

  test("explicit error string → PostToolUseFailure", () => {
    expect(mapToolAfterEvent(makeAfter({ error: "timeout", output: "" }))).toBe(
      "PostToolUseFailure"
    )
  })

  test("no output, no error → PostToolUse", () => {
    expect(mapToolAfterEvent(makeAfter({}))).toBe("PostToolUse")
  })

  test("other tool, clean output → PostToolUse", () => {
    expect(
      mapToolAfterEvent(makeAfter({ tool: "read_file", output: "file content" }))
    ).toBe("PostToolUse")
  })

  test("other tool, error in output → PostToolUseFailure", () => {
    expect(
      mapToolAfterEvent(makeAfter({ tool: "write_file", output: "failed to write" }))
    ).toBe("PostToolUseFailure")
  })
})
