# opencode-hooks-api

An OpenCode plugin that runs your Claude Code hooks inside OpenCode. Same config format, same execution contract, different runtime. Because apparently one place to define your hooks wasn't ambitious enough.

## What it does

Reads hook definitions from `.claude/settings.json` and fires them in response to OpenCode lifecycle events. If you already have Claude Code hooks set up, they'll work here without any changes.

Supports all four hook types: `command` (bash), `http` (POST), `prompt` (LLM call), and `agent` (LLM call, but it gets to think longer).

## Local development setup

If you want to use the plugin directly from a local checkout — without publishing to npm — use OpenCode's local plugin directory instead of the `plugin` array in `opencode.json`.

**1. Clone the repo and build it**

```bash
git clone https://github.com/your-org/opencode-hooks-api
cd opencode-hooks-api
bun install
bun run build      # compiles src/ → dist/
```

**2. Symlink (or copy) the compiled entry point into your project's plugin directory**

```bash
# From the root of the project where you want to use the plugin:
mkdir -p .opencode/plugins
ln -s /path/to/opencode-hooks-api/dist/index.js .opencode/plugins/opencode-hooks-api.js
```

Alternatively, copy the file if you don't want a symlink:

```bash
cp /path/to/opencode-hooks-api/dist/index.js .opencode/plugins/opencode-hooks-api.js
```

OpenCode automatically loads every `.js` / `.ts` file found in `.opencode/plugins/` at startup — no entry in `opencode.json` needed.

**3. Define your hooks** in `.claude/settings.json` (same as usual — see [Setup](#setup) below).

**4. Rebuild after changes**

If you edit the source, recompile before restarting OpenCode:

```bash
# One-off rebuild
bun run build

# Or keep a watcher running while you develop
bun run dev
```

---

## Setup

**1. Register the plugin** in `opencode.json`:

```json
{
  "plugin": ["opencode-hooks-api"]
}
```

**2. Define your hooks** in `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "my-safety-check.sh",
            "timeout": 10
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "notify-send 'The LLM has finished. You may now breathe.'"
          }
        ]
      }
    ]
  }
}
```

**3. Run OpenCode** as normal. The plugin loads hooks at startup.

Settings are merged from three locations, in order (later wins):

| File | Scope |
|---|---|
| `~/.claude/settings.json` | Global |
| `.claude/settings.json` | Project (commit this) |
| `.claude/settings.local.json` | Project-local (gitignore this) |

To disable all hooks without deleting your config: set `"disableAllHooks": true` in any settings file.

## Event mapping

These fire automatically:

| Claude Code event | When it fires |
|---|---|
| `PreToolUse` | Before any tool runs |
| `PostToolUse` | After a tool succeeds |
| `PostToolUseFailure` | After a tool fails (best-effort detection) |
| `SessionStart` | When a session is created |
| `SessionEnd` | When a session is deleted |
| `Stop` | When the LLM finishes responding |

These have no native OpenCode equivalent, so they're exposed as slash commands you can trigger manually:

| Event | Command |
|---|---|
| `UserPromptSubmit` | `/hook-prompt` |
| `Notification` | `/hook-notify` |
| `PreCompact` | `/hook-precompact` |

## Unsupported events

The following Claude Code events are not supported and will log a warning at startup if configured. OpenCode simply doesn't expose the relevant lifecycle points to plugins.

`PermissionRequest`, `SubagentStart`, `SubagentStop`, `TeammateIdle`, `TaskCompleted`, `ConfigChange`, `WorktreeCreate`, `WorktreeRemove`, `InstructionsLoaded`

## Quick example: block dangerous commands

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'read input; cmd=$(echo \"$input\" | jq -r .tool_input.command); if echo \"$cmd\" | grep -qE \"rm -rf /\"; then echo \"Nice try\" >&2; exit 2; fi'"
          }
        ]
      }
    ]
  }
}
```

Exit code `2` = blocked. Exit code `0` = allow. Anything else = non-blocking error (logged, continues anyway).

## Local testing

### Prerequisites

- [Bun](https://bun.sh) v1.x
- Node.js v20+

### Install dependencies

```bash
bun install
```

### Run the test suite

```bash
bun test
```

Bun auto-discovers all `*.test.ts` files under `src/`. No separate config is needed.

### Run a specific test file

```bash
bun test src/config.test.ts
bun test src/executor.test.ts
bun test src/events.test.ts
bun test src/matcher.test.ts
```

### Filter by test name

```bash
bun test --test-name-pattern "command"
```

### Verbose output

```bash
bun test --verbose
```

### Build before testing (optional)

Tests run against the TypeScript source directly. If you want to verify the compiled output:

```bash
bun run build   # compiles src/ → dist/
bun test
```

### What the tests cover

| File | What it tests |
|---|---|
| `src/config.test.ts` | Settings loading and merging (global → project → local), `disableAllHooks` precedence, malformed JSON handling |
| `src/events.test.ts` | Event mapping, `detectToolFailure`, `buildToolHookInput`, `buildSessionHookInput` |
| `src/executor.test.ts` | All four handler types (`command`, `http`, `prompt`, `agent`), timeouts, stdin injection, env var interpolation |
| `src/matcher.test.ts` | Wildcard, exact, regex, case-sensitivity, and invalid-regex safety |

### Isolation notes

- `config.test.ts` creates isolated temporary directories per test and passes a fake `homeDir`, so your real `~/.claude/settings.json` never leaks into results.
- `executor.test.ts` mocks `globalThis.fetch` for HTTP tests and passes a fake SDK client for prompt/agent tests. Command tests spawn real bash subprocesses.

