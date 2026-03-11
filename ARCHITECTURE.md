# opencode-hooks-api

An OpenCode plugin that executes Claude Code hooks inside OpenCode. Same configuration format, same execution contract, different runtime.

## What it does

Reads hook definitions from `.claude/settings.json` files and runs them in response to OpenCode lifecycle events. If you already have Claude Code hooks configured, this plugin makes them work in OpenCode with no config changes.

## Configuration

### Source files

Hooks are read from Claude Code settings files. Three levels, merged in order (later wins):

| File | Scope | Shareable |
|---|---|---|
| `~/.claude/settings.json` | Global — all projects | No |
| `.claude/settings.json` | Project — checked into git | Yes |
| `.claude/settings.local.json` | Project-local — gitignored | No |

### Format

The exact Claude Code hooks format. No new syntax, no wrapper.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "my-linter.sh",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

### Disabling hooks

Set `"disableAllHooks": true` in any settings file.

## Setup

### 1. Install the plugin

Add to `opencode.json`:

```json
{
  "plugin": ["opencode-hooks-api"]
}
```

Or install locally:

```bash
# Project-level
mkdir -p .opencode/plugins
# copy/link the plugin into .opencode/plugins/opencode-hooks-api/

# Global
mkdir -p ~/.config/opencode/plugins
# copy/link the plugin into ~/.config/opencode/plugins/opencode-hooks-api/
```

### 2. Define hooks

Create or edit `.claude/settings.json` in your project:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'About to run a bash command'",
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
            "command": "notify-send 'LLM finished'"
          }
        ]
      }
    ]
  }
}
```

### 3. Run OpenCode

Start OpenCode as usual. The plugin loads hooks at startup and fires them as events occur.

## Event Mapping

### Native events

These fire automatically through OpenCode's lifecycle. No extra action needed.

| Claude Code Event | OpenCode Trigger | What fires it | Matcher field |
|---|---|---|---|
| `PreToolUse` | `tool.execute.before` | Before any tool call runs | Tool name |
| `PostToolUse` | `tool.execute.after` (success) | After a tool call succeeds | Tool name |
| `PostToolUseFailure` | `tool.execute.after` (failure detected) | After a tool call fails (best-effort) | Tool name |
| `SessionStart` | `session.created` event | New session created | No |
| `SessionEnd` | `session.deleted` event | Session deleted | No |
| `Stop` | `session.idle` event | LLM finishes responding | No |

### Stub events (slash commands)

These don't have a direct OpenCode equivalent. The plugin registers slash commands to trigger them manually.

| Claude Code Event | Slash command | Usage |
|---|---|---|
| `UserPromptSubmit` | `/hook-prompt` | Trigger before submitting a prompt |
| `Notification` | `/hook-notify` | Trigger notification hooks |
| `PreCompact` | `/hook-precompact` | Trigger before compaction |

### Unsupported events

No OpenCode equivalent. Logged as warning at startup if configured.

| Claude Code Event | Why |
|---|---|
| `PermissionRequest` | OpenCode uses config-based permissions, not interactive dialogs |
| `SubagentStart` / `SubagentStop` | Subagent lifecycle not exposed to plugins |
| `TeammateIdle` / `TaskCompleted` | Team features not in OpenCode |
| `ConfigChange` | No config file watcher in plugin API |
| `WorktreeCreate` / `WorktreeRemove` | Git worktree management not exposed |
| `InstructionsLoaded` | CLAUDE.md loading not applicable |

## Hook Execution

### Handler types

All four Claude Code handler types are supported.

**Command** (`type: "command"`) — Spawns a bash process. JSON on stdin.

| Field | Required | Default | Description |
|---|---|---|---|
| `type` | yes | — | `"command"` |
| `command` | yes | — | Shell command to execute |
| `timeout` | no | `600` | Timeout in seconds |

**HTTP** (`type: "http"`) — POST request with JSON body.

| Field | Required | Default | Description |
|---|---|---|---|
| `type` | yes | — | `"http"` |
| `url` | yes | — | Endpoint URL |
| `headers` | no | — | Key-value pairs. `$VAR_NAME` interpolates env vars |
| `timeout` | no | `600` | Timeout in seconds |

**Prompt** (`type: "prompt"`) — Sends prompt to LLM via OpenCode SDK.

| Field | Required | Default | Description |
|---|---|---|---|
| `type` | yes | — | `"prompt"` |
| `prompt` | yes | — | Prompt text. `$ARGUMENTS` replaced with input JSON |
| `timeout` | no | `30` | Timeout in seconds |

**Agent** (`type: "agent"`) — Same as prompt, longer timeout.

| Field | Required | Default | Description |
|---|---|---|---|
| `type` | yes | — | `"agent"` |
| `prompt` | yes | — | Prompt text. `$ARGUMENTS` replaced with input JSON |
| `timeout` | no | `60` | Timeout in seconds |

### Execution contract (command hooks)

Identical to Claude Code.

**Input** — JSON written to stdin:

```json
{
  "session_id": "ses_abc123",
  "cwd": "/home/user/project",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": {
    "command": "npm test",
    "description": "Run tests"
  }
}
```

**Exit codes**:

| Exit code | Meaning |
|---|---|
| `0` | Success. stdout parsed as JSON if present |
| `2` | Block. stderr used as block reason. stdout ignored |
| Other | Non-blocking error. Logged, execution continues |

**Stdout JSON fields** (exit code 0):

| Field | Default | Description |
|---|---|---|
| `continue` | `true` | `false` stops the operation |
| `stopReason` | — | Message when `continue` is `false` |
| `decision` | — | `"block"` with `reason` to block |
| `hookSpecificOutput` | — | Event-specific output (see below) |

**PreToolUse specific output** (inside `hookSpecificOutput`):

| Field | Description |
|---|---|
| `permissionDecision` | `"allow"`, `"deny"`, or `"ask"` |
| `permissionDecisionReason` | Reason for the decision |
| `updatedInput` | Modified tool input to use instead |
| `additionalContext` | Extra context injected into conversation |

### Execution contract (HTTP hooks)

POST to URL with JSON body (same as stdin for commands).

- 2xx + empty body = success, no output
- 2xx + JSON body = parsed same as command stdout
- Non-2xx = non-blocking error, logged, continues

### Execution contract (prompt/agent hooks)

`$ARGUMENTS` in prompt text is replaced with input JSON. Response parsed as:

- `{ "ok": true }` = success
- `{ "ok": false, "reason": "..." }` = block or warning

### Environment variables

Available to command hooks:

| Variable | Description |
|---|---|
| `OPENCODE_PROJECT_DIR` | Project root (equivalent to `CLAUDE_PROJECT_DIR`) |
| `OPENCODE_SESSION_ID` | Current session ID |
| `OPENCODE_HOOK_EVENT` | Hook event name |

### Matcher

`matcher` is a regex string tested against the relevant field.

| Event | Tested against | Example |
|---|---|---|
| `PreToolUse` | Tool name | `"Bash"`, `"Edit\|Write"` |
| `PostToolUse` | Tool name | `"Bash"` |
| `PostToolUseFailure` | Tool name | `"Bash"` |
| Others | No matcher | Always fires |

Omitting `matcher`, or `""`, or `"*"` = matches everything.

### Parallel execution

All matching handlers for an event run in parallel. If multiple return blocking decisions, the first resolved one wins.

### PostToolUseFailure detection

Best-effort since OpenCode doesn't distinguish success/failure in `tool.execute.after`:

- `bash` tool: check output for error exit codes or error patterns
- Other tools: check output title/metadata for error indicators
- If failure detected: `PostToolUseFailure` hooks fire instead of `PostToolUse`

## Project Structure

```
opencode-hooks-api/
├── package.json
├── tsconfig.json
├── ARCHITECTURE.md
└── src/
    ├── index.ts        # Plugin entry — implements Plugin interface
    ├── config.ts        # Reads and merges .claude/settings.json files
    ├── events.ts        # Maps OpenCode events to Claude hook events
    ├── executor.ts      # Runs hooks (command, http, prompt, agent)
    ├── matcher.ts       # Regex matching for tool names
    └── types.ts         # TypeScript types for Claude hook config schema
```

### Module responsibilities

**`index.ts`** — Plugin entry point. Exports the `Plugin` function. Wires OpenCode event handlers (`tool.execute.before`, `tool.execute.after`, `event`) to the hook pipeline. Registers slash commands for stub events.

**`config.ts`** — Reads `~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`. Merges them (local > project > global). Extracts `hooks` and `disableAllHooks`. Warns about unsupported events.

**`events.ts`** — Mapping table between Claude events and OpenCode triggers. Translates OpenCode event data into Claude hook input format. Handles `session.idle` to `Stop` mapping and failure detection.

**`executor.ts`** — Runs a single hook handler. Four paths: `command` (bash spawn), `http` (fetch POST), `prompt` (SDK client), `agent` (SDK client). Parses output per the Claude contract. Returns structured result.

**`matcher.ts`** — Takes matcher regex + test value. Returns whether the hook should fire. Handles `""`, `"*"`, `undefined` (all match everything).

**`types.ts`** — TypeScript interfaces matching Claude Code hook schema: `HookEvent`, `HookMatcher`, `HookHandler`, `HookConfig`, `HookOutput`, `HookSpecificOutput`.

## Data Flow

```
┌──────────────────────────────────────────────────────┐
│                     OpenCode                          │
│                                                       │
│  tool.execute.before ──┐                              │
│  tool.execute.after  ──┤                              │
│  session.created     ──┼──► opencode-hooks-api        │
│  session.deleted     ──┤        │                     │
│  session.idle        ──┘        │                     │
│                                 ▼                     │
│                          ┌─────────────┐              │
│                          │  config.ts   │              │
│                          │  reads from: │              │
│                          │  ~/.claude/  │              │
│                          │  .claude/    │              │
│                          │  settings    │              │
│                          └──────┬──────┘              │
│                                 │                     │
│                                 ▼                     │
│                          ┌─────────────┐              │
│                          │  events.ts   │              │
│                          │  map event   │              │
│                          │  build input │              │
│                          └──────┬──────┘              │
│                                 │                     │
│                                 ▼                     │
│                          ┌─────────────┐              │
│                          │  matcher.ts  │              │
│                          │  regex test  │              │
│                          └──────┬──────┘              │
│                                 │                     │
│                                 ▼                     │
│                          ┌─────────────┐              │
│                          │ executor.ts  │              │
│                          │  command ──► bash process   │
│                          │  http    ──► POST request   │
│                          │  prompt  ──► SDK client     │
│                          │  agent   ──► SDK client     │
│                          └──────┬──────┘              │
│                                 │                     │
│                                 ▼                     │
│                          block / allow /               │
│                          add context / modify args     │
└──────────────────────────────────────────────────────┘
```

## Examples

### Block dangerous bash commands

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'read input; cmd=$(echo \"$input\" | jq -r .tool_input.command); if echo \"$cmd\" | grep -qE \"rm -rf /|:(){ :|:& };:\"; then echo \"Dangerous command blocked\" >&2; exit 2; fi'"
          }
        ]
      }
    ]
  }
}
```

### Log all tool calls

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'cat >> /tmp/opencode-tool-log.jsonl'"
          }
        ]
      }
    ]
  }
}
```

### Webhook on session idle

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "https://hooks.slack.com/triggers/my-webhook",
            "headers": {
              "Authorization": "Bearer $SLACK_TOKEN"
            }
          }
        ]
      }
    ]
  }
}
```

### LLM code review on file writes

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Review this file change for bugs and security issues. Return {\"ok\": true} if acceptable or {\"ok\": false, \"reason\": \"...\"} if not: $ARGUMENTS"
          }
        ]
      }
    ]
  }
}
```
