import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { ClaudeSettings, HooksConfig, ClaudeHookEventName } from "./types.js"

export const UNSUPPORTED_EVENTS: ClaudeHookEventName[] = [
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

export const SUPPORTED_EVENTS: ClaudeHookEventName[] = [
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

function readSettingsFile(filePath: string): ClaudeSettings | null {
  try {
    const content = readFileSync(filePath, "utf-8")
    return JSON.parse(content) as ClaudeSettings
  } catch {
    return null
  }
}

function mergeHooksConfig(base: HooksConfig, override: HooksConfig): HooksConfig {
  const result: HooksConfig = { ...base }
  for (const [event, matchers] of Object.entries(override)) {
    const key = event as ClaudeHookEventName
    const existing = result[key] ?? []
    result[key] = [...existing, ...(matchers ?? [])]
  }
  return result
}

export interface LoadedConfig {
  hooks: HooksConfig
  disableAllHooks: boolean
}

export interface LoadConfigOptions {
  /** Override the home directory used for the global settings file (useful in tests). */
  homeDir?: string
}

export function loadConfig(
  cwd: string = process.cwd(),
  { homeDir = homedir() }: LoadConfigOptions = {},
): LoadedConfig {
  const globalPath = join(homeDir, ".claude", "settings.json")
  const projectPath = join(cwd, ".claude", "settings.json")
  const localPath = join(cwd, ".claude", "settings.local.json")

  const globalSettings = readSettingsFile(globalPath)
  const projectSettings = readSettingsFile(projectPath)
  const localSettings = readSettingsFile(localPath)

  // Merge: global -> project -> local (later entries are appended / extend)
  let merged: HooksConfig = {}
  if (globalSettings?.hooks) merged = mergeHooksConfig(merged, globalSettings.hooks)
  if (projectSettings?.hooks) merged = mergeHooksConfig(merged, projectSettings.hooks)
  if (localSettings?.hooks) merged = mergeHooksConfig(merged, localSettings.hooks)

  // disableAllHooks: local takes precedence, then project, then global
  const disableAllHooks =
    localSettings?.disableAllHooks ??
    projectSettings?.disableAllHooks ??
    globalSettings?.disableAllHooks ??
    false

  return { hooks: merged, disableAllHooks }
}

export function warnUnsupportedEvents(
  hooks: HooksConfig,
  warn: (msg: string) => void = console.warn,
): void {
  for (const event of UNSUPPORTED_EVENTS) {
    if (hooks[event] && hooks[event]!.length > 0) {
      warn(
        `[opencode-hooks-api] Unsupported event "${event}" is configured but will not fire. Reason: no OpenCode equivalent.`,
      )
    }
  }
}
