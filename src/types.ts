// Handler types
export type HookHandlerType = "command" | "http" | "prompt" | "agent"

export interface CommandHandler {
  type: "command"
  command: string
  timeout?: number  // default 600
}

export interface HttpHandler {
  type: "http"
  url: string
  headers?: Record<string, string>
  timeout?: number  // default 600
}

export interface PromptHandler {
  type: "prompt"
  prompt: string
  timeout?: number  // default 30
}

export interface AgentHandler {
  type: "agent"
  prompt: string
  timeout?: number  // default 60
}

export type HookHandler = CommandHandler | HttpHandler | PromptHandler | AgentHandler

// Claude Code hook event names
export type ClaudeHookEventName =
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "SessionStart"
  | "SessionEnd"
  | "Stop"
  | "UserPromptSubmit"
  | "Notification"
  | "PreCompact"
  // unsupported ones below
  | "PermissionRequest"
  | "SubagentStart"
  | "SubagentStop"
  | "TeammateIdle"
  | "TaskCompleted"
  | "ConfigChange"
  | "WorktreeCreate"
  | "WorktreeRemove"
  | "InstructionsLoaded"

// A matcher entry in the hooks array
export interface HookMatcher {
  matcher?: string
  hooks: HookHandler[]
}

// Top-level hooks config shape
export type HooksConfig = Partial<Record<ClaudeHookEventName, HookMatcher[]>>

// The full settings file shape
export interface ClaudeSettings {
  hooks?: HooksConfig
  disableAllHooks?: boolean
}

// Input JSON sent to hook handlers (stdin for commands, body for HTTP)
export interface HookInput {
  session_id: string
  cwd: string
  hook_event_name: string
  tool_name?: string
  tool_input?: Record<string, unknown>
}

// Structured output from hook handlers
export interface HookSpecificOutput {
  permissionDecision?: "allow" | "deny" | "ask"
  permissionDecisionReason?: string
  updatedInput?: Record<string, unknown>
  additionalContext?: string
}

export interface HookOutput {
  continue?: boolean
  stopReason?: string
  decision?: "block"
  reason?: string
  hookSpecificOutput?: HookSpecificOutput
  ok?: boolean
}

// Result returned by executor
export type HookResultAction = "allow" | "block" | "error" | "skip"

export interface HookResult {
  action: HookResultAction
  reason?: string
  updatedInput?: Record<string, unknown>
  additionalContext?: string
}
