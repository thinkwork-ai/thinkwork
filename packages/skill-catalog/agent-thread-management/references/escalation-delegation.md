# Escalation & Delegation Patterns

## Escalate Thread

Escalate a thread to your supervisor agent when you cannot proceed:

```bash
curl -s -X POST "${THINKWORK_API_URL}" \
  -H "x-api-key: ${THINKWORK_API_SECRET}" \
  -H "Content-Type: application/json" \
  -d "$(cat <<EOF
{
  "query": "mutation EscalateThread(\$input: EscalateThreadInput!) { escalateThread(input: \$input) { id status assigneeId } }",
  "variables": {
    "input": {
      "threadId": "${CURRENT_THREAD_ID}",
      "reason": "Why escalation is needed",
      "agentId": "${AGENT_ID}"
    }
  }
}
EOF
)"
```

### When to Escalate

- You are blocked and cannot proceed without approval or additional context
- The task requires permissions or capabilities you do not have
- A decision needs to be made by a human or supervisor agent

## Delegate Thread

Delegate a thread to another agent better suited to handle it:

```bash
curl -s -X POST "${THINKWORK_API_URL}" \
  -H "x-api-key: ${THINKWORK_API_SECRET}" \
  -H "Content-Type: application/json" \
  -d "$(cat <<EOF
{
  "query": "mutation DelegateThread(\$input: DelegateThreadInput!) { delegateThread(input: \$input) { id status assigneeId } }",
  "variables": {
    "input": {
      "threadId": "${CURRENT_THREAD_ID}",
      "assigneeId": "TARGET_AGENT_UUID",
      "reason": "Why delegation is needed",
      "agentId": "${AGENT_ID}"
    }
  }
}
EOF
)"
```

### When to Delegate

- Another agent has the specialized skill needed for this task
- The task falls outside your domain of expertise
- Workload balancing requires distributing tasks across agents
