#!/bin/bash
# Claudelike Bar — Claude Code hook script
# Handles all 4 hook events: PreToolUse, UserPromptSubmit, Stop, Notification
# Stop/Notification → "ready", PreToolUse/UserPromptSubmit → "working"

PROJECT=$(basename "$PWD")
EVENT="$CLAUDE_HOOK_EVENT_NAME"

STATUS="working"
if [ "$EVENT" = "Stop" ] || [ "$EVENT" = "Notification" ]; then
  STATUS="ready"
fi

mkdir -p /tmp/claude-dashboard
echo "{\"project\":\"$PROJECT\",\"status\":\"$STATUS\",\"timestamp\":$(date +%s),\"event\":\"$EVENT\"}" \
  > "/tmp/claude-dashboard/${PROJECT}.json"

exit 0
