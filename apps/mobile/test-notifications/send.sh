#!/bin/bash
# Send a test push notification to the iOS Simulator.
#
# Usage:
#   ./send.sh                          # sends turn-completed.apns
#   ./send.sh job-completed            # sends job-completed.apns
#   ./send.sh custom "Title" "Body"    # sends a custom notification
#
# Prerequisites: iOS Simulator must be running with the Maniflow Manager app.

BUNDLE_ID="ai.maniflow.hive"
DIR="$(cd "$(dirname "$0")" && pwd)"

case "${1:-turn-completed}" in
  custom)
    TITLE="${2:-Agent}"
    BODY="${3:-Task completed successfully.}"
    THREAD_ID="${4:-test-thread-custom}"
    echo "{
  \"Simulator Target Bundle\": \"$BUNDLE_ID\",
  \"aps\": {
    \"alert\": { \"title\": \"$TITLE\", \"body\": \"$BODY\" },
    \"sound\": \"default\",
    \"badge\": 1
  },
  \"ticketId\": \"$THREAD_ID\",
  \"type\": \"turn_completed\"
}" | xcrun simctl push booted "$BUNDLE_ID" -
    ;;
  *)
    FILE="$DIR/${1}.apns"
    if [ ! -f "$FILE" ]; then
      echo "Error: $FILE not found"
      echo "Available payloads:"
      ls "$DIR"/*.apns 2>/dev/null | xargs -I{} basename {} .apns
      exit 1
    fi
    xcrun simctl push booted "$BUNDLE_ID" "$FILE"
    ;;
esac
