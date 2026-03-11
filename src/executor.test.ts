import { test, expect, describe, beforeEach, afterEach, mock, spyOn } from "bun:test"
import { executeHook, parseHookOutput, outputToResult, interpolateEnvVars } from "./executor.js"
import type { HookInput, CommandHandler, HttpHandler, PromptHandler, AgentHandler } from "./types.js"

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

const baseInput: HookInput = {
  session_id: "ses_test123",
  cwd: "/home/user/project",
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_input: { command: "ls" },
}

// ---------------------------------------------------------------------------
// Unit: parseHookOutput
// ---------------------------------------------------------------------------

describe("parseHookOutput", () => {
  test("returns null for empty string", () => {
    expect(parseHookOutput("")).toBeNull()
  })

  test("returns null for whitespace-only string", () => {
    expect(parseHookOutput("   \n  ")).toBeNull()
  })

  test("returns null for invalid JSON", () => {
    expect(parseHookOutput("not json")).toBeNull()
  })

  test("parses valid JSON object", () => {
    expect(parseHookOutput('{"continue":false,"stopReason":"nope"}')).toEqual({
      continue: false,
      stopReason: "nope",
    })
  })
})

// ---------------------------------------------------------------------------
// Unit: outputToResult
// ---------------------------------------------------------------------------

describe("outputToResult", () => {
  test("null output → allow", () => {
    expect(outputToResult(null)).toEqual({ action: "allow" })
  })

  test("continue=false → block with stopReason", () => {
    expect(outputToResult({ continue: false, stopReason: "nope" })).toEqual({
      action: "block",
      reason: "nope",
      updatedInput: undefined,
      additionalContext: undefined,
    })
  })

  test("continue=false with no stopReason → fallback reason", () => {
    const result = outputToResult({ continue: false })
    expect(result.action).toBe("block")
    expect(result.reason).toBeTruthy()
  })

  test("decision=block → block", () => {
    expect(outputToResult({ decision: "block", reason: "dangerous" })).toEqual({
      action: "block",
      reason: "dangerous",
      updatedInput: undefined,
      additionalContext: undefined,
    })
  })

  test("ok=false → block with reason", () => {
    expect(outputToResult({ ok: false, reason: "nope" })).toEqual({
      action: "block",
      reason: "nope",
      updatedInput: undefined,
      additionalContext: undefined,
    })
  })

  test("ok=true → allow", () => {
    expect(outputToResult({ ok: true })).toEqual({
      action: "allow",
      updatedInput: undefined,
      additionalContext: undefined,
    })
  })

  test("continue=true → allow", () => {
    expect(outputToResult({ continue: true })).toEqual({
      action: "allow",
      updatedInput: undefined,
      additionalContext: undefined,
    })
  })

  test("hookSpecificOutput fields are propagated", () => {
    const result = outputToResult({
      continue: false,
      hookSpecificOutput: {
        updatedInput: { command: "safe-cmd" },
        additionalContext: "was modified",
      },
    })
    expect(result.action).toBe("block")
    expect(result.updatedInput).toEqual({ command: "safe-cmd" })
    expect(result.additionalContext).toBe("was modified")
  })

  test("hookSpecificOutput fields propagated on allow", () => {
    const result = outputToResult({
      continue: true,
      hookSpecificOutput: {
        updatedInput: { command: "safe-cmd" },
        additionalContext: "extra",
      },
    })
    expect(result.action).toBe("allow")
    expect(result.updatedInput).toEqual({ command: "safe-cmd" })
    expect(result.additionalContext).toBe("extra")
  })
})

// ---------------------------------------------------------------------------
// Unit: interpolateEnvVars
// ---------------------------------------------------------------------------

describe("interpolateEnvVars", () => {
  test("replaces known env vars", () => {
    process.env.MY_TEST_TOKEN = "secret-abc"
    expect(interpolateEnvVars("Bearer $MY_TEST_TOKEN")).toBe("Bearer secret-abc")
    delete process.env.MY_TEST_TOKEN
  })

  test("replaces missing env vars with empty string", () => {
    delete process.env.MISSING_VAR_XYZ
    expect(interpolateEnvVars("Bearer $MISSING_VAR_XYZ")).toBe("Bearer ")
  })

  test("does not replace lowercase vars (pattern is uppercase only)", () => {
    expect(interpolateEnvVars("$lower")).toBe("$lower")
  })

  test("replaces multiple vars in one string", () => {
    process.env.A_TOKEN = "aaa"
    process.env.B_TOKEN = "bbb"
    const result = interpolateEnvVars("$A_TOKEN:$B_TOKEN")
    expect(result).toBe("aaa:bbb")
    delete process.env.A_TOKEN
    delete process.env.B_TOKEN
  })
})

// ---------------------------------------------------------------------------
// executeHook — command type
// ---------------------------------------------------------------------------

describe("executeHook: command", () => {
  test("exit 0, no stdout → action=allow", async () => {
    const handler: CommandHandler = { type: "command", command: "exit 0" }
    const result = await executeHook(handler, baseInput)
    expect(result.action).toBe("allow")
  })

  test("exit 0, stdout continue=true → action=allow", async () => {
    const handler: CommandHandler = {
      type: "command",
      command: `echo '{"continue":true}'`,
    }
    const result = await executeHook(handler, baseInput)
    expect(result.action).toBe("allow")
  })

  test("exit 0, stdout continue=false + stopReason → action=block", async () => {
    const handler: CommandHandler = {
      type: "command",
      command: `echo '{"continue":false,"stopReason":"nope"}'`,
    }
    const result = await executeHook(handler, baseInput)
    expect(result.action).toBe("block")
    expect(result.reason).toBe("nope")
  })

  test("exit 0, stdout decision=block → action=block", async () => {
    const handler: CommandHandler = {
      type: "command",
      command: `echo '{"decision":"block","reason":"dangerous"}'`,
    }
    const result = await executeHook(handler, baseInput)
    expect(result.action).toBe("block")
    expect(result.reason).toBe("dangerous")
  })

  test("exit 2 → action=block, reason from stderr", async () => {
    const handler: CommandHandler = {
      type: "command",
      command: `echo 'blocked' >&2; exit 2`,
    }
    const result = await executeHook(handler, baseInput)
    expect(result.action).toBe("block")
    expect(result.reason).toBe("blocked")
  })

  test("exit 1 → action=error", async () => {
    const handler: CommandHandler = { type: "command", command: "exit 1" }
    const result = await executeHook(handler, baseInput)
    expect(result.action).toBe("error")
  })

  test("non-zero exit 3 → action=error", async () => {
    const handler: CommandHandler = { type: "command", command: "exit 3" }
    const result = await executeHook(handler, baseInput)
    expect(result.action).toBe("error")
  })

  test("stdin content is the serialised HookInput", async () => {
    // The command reads stdin and echoes it back; we verify the parsed JSON
    const handler: CommandHandler = {
      type: "command",
      command: `cat; echo ''`,  // cat reads stdin, then newline to flush
    }
    // We can't easily inspect what was written in a unit test without a helper,
    // so we use a command that reads stdin and checks a field, exiting 2 if wrong
    const handler2: CommandHandler = {
      type: "command",
      command: `read -r line; event=$(echo "$line" | grep -o '"hook_event_name":"PreToolUse"'); [ -n "$event" ] || exit 1`,
    }
    const result = await executeHook(handler2, baseInput)
    expect(result.action).toBe("allow")
  })

  test("env vars are set: OPENCODE_HOOK_EVENT", async () => {
    const handler: CommandHandler = {
      type: "command",
      command: `[ "$OPENCODE_HOOK_EVENT" = "PreToolUse" ] || exit 1`,
    }
    const result = await executeHook(handler, baseInput)
    expect(result.action).toBe("allow")
  })

  test("env vars are set: OPENCODE_PROJECT_DIR", async () => {
    const handler: CommandHandler = {
      type: "command",
      command: `[ "$OPENCODE_PROJECT_DIR" = "/home/user/project" ] || exit 1`,
    }
    const result = await executeHook(handler, baseInput)
    expect(result.action).toBe("allow")
  })

  test("env vars are set: OPENCODE_SESSION_ID", async () => {
    const handler: CommandHandler = {
      type: "command",
      command: `[ "$OPENCODE_SESSION_ID" = "ses_test123" ] || exit 1`,
    }
    const result = await executeHook(handler, baseInput)
    expect(result.action).toBe("allow")
  })

  test("timeout kills the process and returns error", async () => {
    const handler: CommandHandler = {
      type: "command",
      command: "sleep 10",
      timeout: 1,  // 1 second
    }
    const start = Date.now()
    const result = await executeHook(handler, baseInput)
    const elapsed = Date.now() - start
    expect(result.action).toBe("error")
    expect(result.reason).toMatch(/timed out/i)
    // Should resolve well before the full sleep duration
    expect(elapsed).toBeLessThan(5000)
  }, 10_000)

  test("exit 0 with hookSpecificOutput propagates fields", async () => {
    const output = JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        updatedInput: { command: "safe-ls" },
        additionalContext: "modified by hook",
      },
    })
    const handler: CommandHandler = {
      type: "command",
      command: `echo '${output}'`,
    }
    const result = await executeHook(handler, baseInput)
    expect(result.action).toBe("allow")
    expect(result.updatedInput).toEqual({ command: "safe-ls" })
    expect(result.additionalContext).toBe("modified by hook")
  })
})

// ---------------------------------------------------------------------------
// executeHook — http type
// ---------------------------------------------------------------------------

describe("executeHook: http", () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  function mockFetch(status: number, body: string) {
    globalThis.fetch = mock(async () => {
      return new Response(body, {
        status,
        headers: { "Content-Type": "application/json" },
      })
    })
  }

  test("200 + empty body → action=allow", async () => {
    mockFetch(200, "")
    const handler: HttpHandler = { type: "http", url: "https://example.com/hook" }
    const result = await executeHook(handler, baseInput)
    expect(result.action).toBe("allow")
  })

  test("200 + whitespace body → action=allow", async () => {
    mockFetch(200, "   ")
    const handler: HttpHandler = { type: "http", url: "https://example.com/hook" }
    const result = await executeHook(handler, baseInput)
    expect(result.action).toBe("allow")
  })

  test('200 + JSON {"continue":false} → action=block', async () => {
    mockFetch(200, '{"continue":false,"stopReason":"http-blocked"}')
    const handler: HttpHandler = { type: "http", url: "https://example.com/hook" }
    const result = await executeHook(handler, baseInput)
    expect(result.action).toBe("block")
    expect(result.reason).toBe("http-blocked")
  })

  test('200 + JSON {"continue":true} → action=allow', async () => {
    mockFetch(200, '{"continue":true}')
    const handler: HttpHandler = { type: "http", url: "https://example.com/hook" }
    const result = await executeHook(handler, baseInput)
    expect(result.action).toBe("allow")
  })

  test("500 → action=error", async () => {
    mockFetch(500, "Internal Server Error")
    const handler: HttpHandler = { type: "http", url: "https://example.com/hook" }
    const result = await executeHook(handler, baseInput)
    expect(result.action).toBe("error")
    expect(result.reason).toMatch(/500/)
  })

  test("404 → action=error", async () => {
    mockFetch(404, "Not Found")
    const handler: HttpHandler = { type: "http", url: "https://example.com/hook" }
    const result = await executeHook(handler, baseInput)
    expect(result.action).toBe("error")
  })

  test("header env var interpolation", async () => {
    process.env.MY_API_TOKEN = "tok-abc123"

    let capturedHeaders: Record<string, string> = {}
    globalThis.fetch = mock(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.headers) {
        capturedHeaders = Object.fromEntries(
          new Headers(init.headers as HeadersInit).entries(),
        )
      }
      return new Response("", { status: 200 })
    })

    const handler: HttpHandler = {
      type: "http",
      url: "https://example.com/hook",
      headers: {
        Authorization: "Bearer $MY_API_TOKEN",
      },
    }
    const result = await executeHook(handler, baseInput)
    expect(result.action).toBe("allow")
    expect(capturedHeaders["authorization"]).toBe("Bearer tok-abc123")

    delete process.env.MY_API_TOKEN
  })

  test("missing env var in header replaced with empty string", async () => {
    delete process.env.MISSING_HEADER_VAR

    let capturedHeaders: Record<string, string> = {}
    globalThis.fetch = mock(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.headers) {
        capturedHeaders = Object.fromEntries(
          new Headers(init.headers as HeadersInit).entries(),
        )
      }
      return new Response("", { status: 200 })
    })

    const handler: HttpHandler = {
      type: "http",
      url: "https://example.com/hook",
      headers: { "X-Token": "$MISSING_HEADER_VAR" },
    }
    await executeHook(handler, baseInput)
    expect(capturedHeaders["x-token"]).toBe("")
  })

  test("fetch network error → action=error", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("Network failure")
    })
    const handler: HttpHandler = { type: "http", url: "https://example.com/hook" }
    const result = await executeHook(handler, baseInput)
    expect(result.action).toBe("error")
    expect(result.reason).toBe("Network failure")
  })

  test("POST body is serialised HookInput", async () => {
    let capturedBody: unknown = null
    globalThis.fetch = mock(async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string)
      return new Response("", { status: 200 })
    })
    const handler: HttpHandler = { type: "http", url: "https://example.com/hook" }
    await executeHook(handler, baseInput)
    expect(capturedBody).toEqual(baseInput)
  })
})

// ---------------------------------------------------------------------------
// executeHook — prompt / agent type
// ---------------------------------------------------------------------------

describe("executeHook: prompt", () => {
  test("no client → action=error", async () => {
    const handler: PromptHandler = {
      type: "prompt",
      prompt: "Review this: $ARGUMENTS",
    }
    const result = await executeHook(handler, baseInput)
    expect(result.action).toBe("error")
    expect(result.reason).toMatch(/client/i)
  })

  test("client.session not object → action=error", async () => {
    const handler: PromptHandler = {
      type: "prompt",
      prompt: "Review this: $ARGUMENTS",
    }
    const result = await executeHook(handler, baseInput, { session: null })
    expect(result.action).toBe("error")
  })

  test('client returns {"ok":true} → action=allow', async () => {
    const client = {
      session: {
        prompt: mock(async () => ({ text: '{"ok":true}' })),
      },
    }
    const handler: PromptHandler = {
      type: "prompt",
      prompt: "Review: $ARGUMENTS",
    }
    const result = await executeHook(handler, baseInput, client)
    expect(result.action).toBe("allow")
    expect(client.session.prompt).toHaveBeenCalledTimes(1)
  })

  test('client returns {"ok":false,"reason":"bad"} → action=block', async () => {
    const client = {
      session: {
        prompt: mock(async () => ({ text: '{"ok":false,"reason":"bad"}' })),
      },
    }
    const handler: PromptHandler = {
      type: "prompt",
      prompt: "Review: $ARGUMENTS",
    }
    const result = await executeHook(handler, baseInput, client)
    expect(result.action).toBe("block")
    expect(result.reason).toBe("bad")
  })

  test("$ARGUMENTS is replaced with JSON.stringify(input)", async () => {
    let capturedPrompt = ""
    const client = {
      session: {
        prompt: mock(async (opts: { prompt: string }) => {
          capturedPrompt = opts.prompt
          return { text: '{"ok":true}' }
        }),
      },
    }
    const handler: PromptHandler = {
      type: "prompt",
      prompt: "Evaluate this input: $ARGUMENTS",
    }
    await executeHook(handler, baseInput, client)
    expect(capturedPrompt).toContain(JSON.stringify(baseInput))
    expect(capturedPrompt).toContain("Evaluate this input: ")
  })

  test("client.session.prompt throws → action=error", async () => {
    const client = {
      session: {
        prompt: mock(async () => {
          throw new Error("LLM unavailable")
        }),
      },
    }
    const handler: PromptHandler = {
      type: "prompt",
      prompt: "Review: $ARGUMENTS",
    }
    const result = await executeHook(handler, baseInput, client)
    expect(result.action).toBe("error")
    expect(result.reason).toBe("LLM unavailable")
  })
})

describe("executeHook: agent", () => {
  test('agent type with {"ok":true} → action=allow', async () => {
    const client = {
      session: {
        prompt: mock(async () => ({ text: '{"ok":true}' })),
      },
    }
    const handler: AgentHandler = {
      type: "agent",
      prompt: "Run agent task: $ARGUMENTS",
    }
    const result = await executeHook(handler, baseInput, client)
    expect(result.action).toBe("allow")
  })

  test("agent default timeout is 60s", async () => {
    let capturedTimeout: number | undefined
    const client = {
      session: {
        prompt: mock(async (opts: { prompt: string; timeout?: number }) => {
          capturedTimeout = opts.timeout
          return { text: '{"ok":true}' }
        }),
      },
    }
    const handler: AgentHandler = { type: "agent", prompt: "do it" }
    await executeHook(handler, baseInput, client)
    expect(capturedTimeout).toBe(60_000)
  })

  test("prompt default timeout is 30s", async () => {
    let capturedTimeout: number | undefined
    const client = {
      session: {
        prompt: mock(async (opts: { prompt: string; timeout?: number }) => {
          capturedTimeout = opts.timeout
          return { text: '{"ok":true}' }
        }),
      },
    }
    const handler: PromptHandler = { type: "prompt", prompt: "do it" }
    await executeHook(handler, baseInput, client)
    expect(capturedTimeout).toBe(30_000)
  })
})

// ---------------------------------------------------------------------------
// executeHook — unknown type
// ---------------------------------------------------------------------------

describe("executeHook: unknown type", () => {
  test("unknown handler type → action=skip", async () => {
    // Force an unknown type via a cast
    const handler = { type: "unknown" } as unknown as import("./types.js").HookHandler
    const result = await executeHook(handler, baseInput)
    expect(result.action).toBe("skip")
    expect(result.reason).toMatch(/unknown/i)
  })
})
