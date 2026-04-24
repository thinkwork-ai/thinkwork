# GraphQL Mutation Examples

All operations use the Thinkwork GraphQL API. Every curl follows this pattern:

```bash
curl -s -X POST "${THINKWORK_API_URL}" \
  -H "x-api-key: ${THINKWORK_API_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{ "query": "...", "variables": { ... } }'
```

## 1. Create a Sub-Thread

```bash
curl -s -X POST "${THINKWORK_API_URL}" \
  -H "x-api-key: ${THINKWORK_API_SECRET}" \
  -H "Content-Type: application/json" \
  -d "$(cat <<EOF
{
  "query": "mutation CreateThread(\$input: CreateThreadInput!) { createThread(input: \$input) { id number identifier title status } }",
  "variables": {
    "input": {
      "tenantId": "${TENANT_ID}",
      "agentId": "${AGENT_ID}",
      "title": "Sub-task title here",
      "description": "Detailed description",
      "parentId": "${CURRENT_THREAD_ID}",
      "createdByType": "agent",
      "createdById": "${AGENT_ID}"
    }
  }
}
EOF
)"
```

## 2. Add a Dependency

Block a thread until another thread is completed:

```bash
curl -s -X POST "${THINKWORK_API_URL}" \
  -H "x-api-key: ${THINKWORK_API_SECRET}" \
  -H "Content-Type: application/json" \
  -d "$(cat <<EOF
{
  "query": "mutation AddDep(\$threadId: ID!, \$blockedByThreadId: ID!) { addThreadDependency(threadId: \$threadId, blockedByThreadId: \$blockedByThreadId) { id threadId blockedByThreadId } }",
  "variables": {
    "threadId": "THREAD_TO_BLOCK",
    "blockedByThreadId": "BLOCKER_THREAD_ID"
  }
}
EOF
)"
```

## 3. Update Thread Status

```bash
curl -s -X POST "${THINKWORK_API_URL}" \
  -H "x-api-key: ${THINKWORK_API_SECRET}" \
  -H "Content-Type: application/json" \
  -d "$(cat <<EOF
{
  "query": "mutation UpdateThread(\$id: ID!, \$input: UpdateThreadInput!) { updateThread(id: \$id, input: \$input) { id status } }",
  "variables": {
    "id": "THREAD_ID",
    "input": {
      "status": "DONE"
    }
  }
}
EOF
)"
```

## 4. Add a Comment

```bash
curl -s -X POST "${THINKWORK_API_URL}" \
  -H "x-api-key: ${THINKWORK_API_SECRET}" \
  -H "Content-Type: application/json" \
  -d "$(cat <<EOF
{
  "query": "mutation AddComment(\$input: AddThreadCommentInput!) { addThreadComment(input: \$input) { id content createdAt } }",
  "variables": {
    "input": {
      "threadId": "THREAD_ID",
      "content": "Your comment here",
      "authorType": "agent",
      "authorId": "${AGENT_ID}"
    }
  }
}
EOF
)"
```

## 5. List Sub-Threads

```bash
curl -s -X POST "${THINKWORK_API_URL}" \
  -H "x-api-key: ${THINKWORK_API_SECRET}" \
  -H "Content-Type: application/json" \
  -d "$(cat <<EOF
{
  "query": "query ListSubThreads(\$tenantId: ID!, \$parentId: ID) { threads(tenantId: \$tenantId, parentId: \$parentId) { id number identifier title status assigneeId } }",
  "variables": {
    "tenantId": "${TENANT_ID}",
    "parentId": "${CURRENT_THREAD_ID}"
  }
}
EOF
)"
```

## 6. Get Thread Details

```bash
curl -s -X POST "${THINKWORK_API_URL}" \
  -H "x-api-key: ${THINKWORK_API_SECRET}" \
  -H "Content-Type: application/json" \
  -d "$(cat <<EOF
{
  "query": "query GetThread(\$id: ID!) { thread(id: \$id) { id number identifier title description status assigneeType assigneeId blockedBy { id blockedByThreadId } blocks { id threadId } isBlocked } }",
  "variables": {
    "id": "THREAD_ID"
  }
}
EOF
)"
```
