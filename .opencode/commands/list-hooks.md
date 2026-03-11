---
description: List all configured hooks from Claude settings files
---

List all hooks currently configured in the Claude settings files for this project. Here is the raw data from each settings file:

**Global hooks** (`~/.claude/settings.json`):
!`[ -f ~/.claude/settings.json ] && jq '.hooks // {}' ~/.claude/settings.json || echo "(not found)"`

**Project hooks** (`.claude/settings.json`):
!`[ -f .claude/settings.json ] && jq '.hooks // {}' .claude/settings.json || echo "(not found)"`

**Local hooks** (`.claude/settings.local.json`):
!`[ -f .claude/settings.local.json ] && jq '.hooks // {}' .claude/settings.local.json || echo "(not found)"`

**disableAllHooks flags**:
!`echo "~/.claude/settings.json: $([ -f ~/.claude/settings.json ] && jq '.disableAllHooks // false' ~/.claude/settings.json || echo "(not found)")"`
!`echo ".claude/settings.json: $([ -f .claude/settings.json ] && jq '.disableAllHooks // false' .claude/settings.json || echo "(not found)")"`
!`echo ".claude/settings.local.json: $([ -f .claude/settings.local.json ] && jq '.disableAllHooks // false' .claude/settings.local.json || echo "(not found)")"`

Please present a clear, human-readable summary of all configured hooks grouped by event name. For each hook, show its type and key details (command, url, or prompt excerpt). Also indicate which file each hook comes from (global, project, or local). If no hooks are configured anywhere, say so clearly.
