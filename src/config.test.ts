import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  loadConfig,
  warnUnsupportedEvents,
  SUPPORTED_EVENTS,
  UNSUPPORTED_EVENTS,
} from "./config.js"
import type { HookMatcher, ClaudeSettings } from "./types.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeSettings(dir: string, filename: string, settings: ClaudeSettings): void {
  const claudeDir = join(dir, ".claude")
  mkdirSync(claudeDir, { recursive: true })
  writeFileSync(join(claudeDir, filename), JSON.stringify(settings), "utf-8")
}

/**
 * Thin wrapper that always passes an isolated fake homeDir (a sub-directory of
 * the temp dir that has NO settings files in it) so the real
 * ~/.claude/settings.json on the host machine never leaks into tests.
 *
 * The `fakeHome` sub-directory is created by each `beforeEach` alongside
 * `tmpDir` (the project cwd).
 */
let fakeHome: string

function cfg(cwd: string) {
  return loadConfig(cwd, { homeDir: fakeHome })
}

function makeMatcher(matcher?: string): HookMatcher {
  return {
    ...(matcher !== undefined ? { matcher } : {}),
    hooks: [{ type: "command", command: "echo hook" }],
  }
}

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------

describe("loadConfig", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "opencode-hooks-test-"))
    // Dedicated empty home dir – keeps the real ~/.claude out of all tests
    fakeHome = mkdtempSync(join(tmpdir(), "opencode-hooks-home-"))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    rmSync(fakeHome, { recursive: true, force: true })
  })

  test("returns empty hooks and disableAllHooks=false when no files exist", () => {
    const result = cfg(tmpDir)
    expect(result.hooks).toEqual({})
    expect(result.disableAllHooks).toBe(false)
  })

  test("reads project settings.json correctly", () => {
    const matcher = makeMatcher("Bash")
    writeSettings(tmpDir, "settings.json", {
      hooks: { PreToolUse: [matcher] },
    })

    const result = cfg(tmpDir)
    expect(result.hooks.PreToolUse).toEqual([matcher])
    expect(result.disableAllHooks).toBe(false)
  })

  test("reads project settings.local.json correctly", () => {
    const matcher = makeMatcher("Write")
    writeSettings(tmpDir, "settings.local.json", {
      hooks: { PostToolUse: [matcher] },
    })

    const result = cfg(tmpDir)
    expect(result.hooks.PostToolUse).toEqual([matcher])
  })

  test("accumulates hooks from project and local files (both kept)", () => {
    const projectMatcher = makeMatcher("Bash")
    const localMatcher = makeMatcher("Write")

    writeSettings(tmpDir, "settings.json", {
      hooks: { PreToolUse: [projectMatcher] },
    })
    writeSettings(tmpDir, "settings.local.json", {
      hooks: { PreToolUse: [localMatcher] },
    })

    const result = cfg(tmpDir)
    // Both matchers should be present; project comes first, then local
    expect(result.hooks.PreToolUse).toHaveLength(2)
    expect(result.hooks.PreToolUse![0]).toEqual(projectMatcher)
    expect(result.hooks.PreToolUse![1]).toEqual(localMatcher)
  })

  test("merges hooks from different events across all three files (global via homeDir)", () => {
    // Write a global settings file using fakeHome as the fake home directory.
    // We use a separate projectDir so global and project paths don't collide.
    const projectDir = mkdtempSync(join(tmpdir(), "opencode-hooks-project-"))
    try {
      const m1 = makeMatcher("Bash")
      const m2 = makeMatcher("Write")
      const m3 = makeMatcher("Read")

      // "global" file lives under fakeHome
      writeSettings(fakeHome, "settings.json", {
        hooks: { PreToolUse: [m1] },
      })
      // project file
      writeSettings(projectDir, "settings.json", {
        hooks: { PreToolUse: [m2], SessionStart: [m2] },
      })
      // local file
      writeSettings(projectDir, "settings.local.json", {
        hooks: { PostToolUse: [m3], SessionStart: [m3] },
      })

      const result = loadConfig(projectDir, { homeDir: fakeHome })

      // global + project matchers for PreToolUse
      expect(result.hooks.PreToolUse).toHaveLength(2)
      expect(result.hooks.PreToolUse![0]).toEqual(m1)
      expect(result.hooks.PreToolUse![1]).toEqual(m2)

      // project + local matchers for SessionStart
      expect(result.hooks.SessionStart).toHaveLength(2)
      expect(result.hooks.SessionStart![0]).toEqual(m2)
      expect(result.hooks.SessionStart![1]).toEqual(m3)

      // only local matcher for PostToolUse
      expect(result.hooks.PostToolUse).toEqual([m3])
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
    }
  })

  test("disableAllHooks=true when set in project settings.json", () => {
    writeSettings(tmpDir, "settings.json", { disableAllHooks: true })

    const result = cfg(tmpDir)
    expect(result.disableAllHooks).toBe(true)
  })

  test("disableAllHooks=true when set in settings.local.json", () => {
    writeSettings(tmpDir, "settings.local.json", { disableAllHooks: true })

    const result = cfg(tmpDir)
    expect(result.disableAllHooks).toBe(true)
  })

  test("local disableAllHooks=false overrides project disableAllHooks=true", () => {
    writeSettings(tmpDir, "settings.json", { disableAllHooks: true })
    writeSettings(tmpDir, "settings.local.json", { disableAllHooks: false })

    const result = cfg(tmpDir)
    // local (false) takes precedence over project (true)
    expect(result.disableAllHooks).toBe(false)
  })

  test("local disableAllHooks=true overrides project disableAllHooks=false", () => {
    writeSettings(tmpDir, "settings.json", { disableAllHooks: false })
    writeSettings(tmpDir, "settings.local.json", { disableAllHooks: true })

    const result = cfg(tmpDir)
    expect(result.disableAllHooks).toBe(true)
  })

  test("global disableAllHooks=true is used when project files are absent", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "opencode-hooks-project-"))
    try {
      writeSettings(fakeHome, "settings.json", { disableAllHooks: true })
      const result = loadConfig(projectDir, { homeDir: fakeHome })
      expect(result.disableAllHooks).toBe(true)
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
    }
  })

  test("silently ignores malformed JSON in settings files", () => {
    const claudeDir = join(tmpDir, ".claude")
    mkdirSync(claudeDir, { recursive: true })
    writeFileSync(join(claudeDir, "settings.json"), "{ invalid json }", "utf-8")

    const result = cfg(tmpDir)
    expect(result.hooks).toEqual({})
    expect(result.disableAllHooks).toBe(false)
  })

  test("silently ignores missing settings files", () => {
    // tmpDir has no .claude directory at all
    expect(() => cfg(tmpDir)).not.toThrow()
  })

  test("hooks from project file are returned even when local file is absent", () => {
    const matcher = makeMatcher()
    writeSettings(tmpDir, "settings.json", {
      hooks: { Stop: [matcher] },
    })

    const result = cfg(tmpDir)
    expect(result.hooks.Stop).toEqual([matcher])
  })

  test("hooks from multiple supported events coexist independently", () => {
    const m = makeMatcher()
    writeSettings(tmpDir, "settings.json", {
      hooks: {
        PreToolUse: [m],
        PostToolUse: [m],
        SessionStart: [m],
        SessionEnd: [m],
      },
    })

    const result = cfg(tmpDir)
    expect(Object.keys(result.hooks)).toHaveLength(4)
    for (const key of ["PreToolUse", "PostToolUse", "SessionStart", "SessionEnd"]) {
      expect(result.hooks[key as keyof typeof result.hooks]).toEqual([m])
    }
  })
})

// ---------------------------------------------------------------------------
// warnUnsupportedEvents
// ---------------------------------------------------------------------------

describe("warnUnsupportedEvents", () => {
  test("emits a warning for each configured unsupported event", () => {
    const warned: string[] = []
    const warn = (msg: string) => warned.push(msg)

    const hooks = Object.fromEntries(
      UNSUPPORTED_EVENTS.map((ev) => [ev, [makeMatcher()]]),
    )

    warnUnsupportedEvents(hooks, warn)

    expect(warned).toHaveLength(UNSUPPORTED_EVENTS.length)
    for (const event of UNSUPPORTED_EVENTS) {
      expect(warned.some((w) => w.includes(event))).toBe(true)
    }
  })

  test("does NOT warn for supported events", () => {
    const warned: string[] = []
    const warn = (msg: string) => warned.push(msg)

    const hooks = Object.fromEntries(
      SUPPORTED_EVENTS.map((ev) => [ev, [makeMatcher()]]),
    )

    warnUnsupportedEvents(hooks, warn)

    expect(warned).toHaveLength(0)
  })

  test("does NOT warn for an unsupported event with an empty matchers array", () => {
    const warned: string[] = []
    const warn = (msg: string) => warned.push(msg)

    warnUnsupportedEvents({ PermissionRequest: [] }, warn)

    expect(warned).toHaveLength(0)
  })

  test("does NOT warn when hooks config is empty", () => {
    const warned: string[] = []
    warnUnsupportedEvents({}, (msg) => warned.push(msg))
    expect(warned).toHaveLength(0)
  })

  test("warning message contains the event name and the plugin prefix", () => {
    const warned: string[] = []
    warnUnsupportedEvents({ SubagentStart: [makeMatcher()] }, (msg) => warned.push(msg))

    expect(warned).toHaveLength(1)
    expect(warned[0]).toContain("[opencode-hooks-api]")
    expect(warned[0]).toContain("SubagentStart")
  })

  test("uses console.warn by default (smoke test)", () => {
    const original = console.warn
    const captured: string[] = []
    console.warn = (msg: string) => captured.push(msg)

    try {
      warnUnsupportedEvents({ PermissionRequest: [makeMatcher()] })
      expect(captured).toHaveLength(1)
      expect(captured[0]).toContain("PermissionRequest")
    } finally {
      console.warn = original
    }
  })

  test("warns only for events that are present and non-empty", () => {
    const warned: string[] = []
    const warn = (msg: string) => warned.push(msg)

    warnUnsupportedEvents(
      {
        PermissionRequest: [makeMatcher()], // should warn
        SubagentStart: [],                  // empty – should NOT warn
        // all others absent
      },
      warn,
    )

    expect(warned).toHaveLength(1)
    expect(warned[0]).toContain("PermissionRequest")
  })
})

// ---------------------------------------------------------------------------
// SUPPORTED_EVENTS / UNSUPPORTED_EVENTS constants
// ---------------------------------------------------------------------------

describe("event lists", () => {
  test("SUPPORTED_EVENTS and UNSUPPORTED_EVENTS are disjoint", () => {
    const overlap = SUPPORTED_EVENTS.filter((e) => UNSUPPORTED_EVENTS.includes(e))
    expect(overlap).toHaveLength(0)
  })

  test("SUPPORTED_EVENTS contains the expected events", () => {
    const expected = [
      "PreToolUse",
      "PostToolUse",
      "PostToolUseFailure",
      "SessionStart",
      "SessionEnd",
      "Stop",
      "UserPromptSubmit",
      "Notification",
      "PreCompact",
    ]
    expect(SUPPORTED_EVENTS).toEqual(expect.arrayContaining(expected))
    expect(SUPPORTED_EVENTS).toHaveLength(expected.length)
  })

  test("UNSUPPORTED_EVENTS contains the expected events", () => {
    const expected = [
      "PermissionRequest",
      "SubagentStart",
      "SubagentStop",
      "TeammateIdle",
      "TaskCompleted",
      "ConfigChange",
      "WorktreeCreate",
      "WorktreeRemove",
      "InstructionsLoaded",
    ]
    expect(UNSUPPORTED_EVENTS).toEqual(expect.arrayContaining(expected))
    expect(UNSUPPORTED_EVENTS).toHaveLength(expected.length)
  })
})
