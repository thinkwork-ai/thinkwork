import { gql } from "@urql/core";

/**
 * Plain `gql` template literals — apps/computer Phase 1 deliberately skips
 * the full graphql-codegen pipeline that admin uses. With only three
 * operations there's no benefit to typed document nodes yet; codegen lands
 * in a future slice when query count grows.
 */

export const MyComputerQuery = gql`
  query MyComputer {
    myComputer {
      id
      name
      tenantId
      ownerUserId
      sourceAgent {
        id
        name
      }
    }
  }
`;

export const ComputerThreadsQuery = gql`
  query ComputerThreads($tenantId: ID!, $computerId: ID!, $limit: Int) {
    threads(tenantId: $tenantId, computerId: $computerId, limit: $limit) {
      id
      number
      identifier
      title
      status
      channel
      lifecycleStatus
      lastResponsePreview
      createdAt
      updatedAt
    }
  }
`;

export const ThreadsPagedQuery = gql`
  query ThreadsPaged(
    $tenantId: ID!
    $search: String
    $showArchived: Boolean
    $sortField: String
    $sortDir: String
    $limit: Int
    $offset: Int
  ) {
    threadsPaged(
      tenantId: $tenantId
      search: $search
      showArchived: $showArchived
      sortField: $sortField
      sortDir: $sortDir
      limit: $limit
      offset: $offset
    ) {
      items {
        id
        number
        identifier
        title
        status
        assigneeType
        assigneeId
        agentId
        computerId
        agent {
          id
          name
          avatarUrl
        }
        checkoutRunId
        channel
        costSummary
        lastActivityAt
        lastTurnCompletedAt
        lastReadAt
        archivedAt
        createdAt
        updatedAt
      }
      totalCount
    }
  }
`;

export const ComputerThreadQuery = gql`
  query ComputerThread($id: ID!, $messageLimit: Int) {
    thread(id: $id) {
      id
      number
      identifier
      title
      status
      channel
      computerId
      lifecycleStatus
      lastResponsePreview
      costSummary
      createdAt
      updatedAt
      messages(limit: $messageLimit) {
        edges {
          node {
            id
            role
            content
            metadata
            toolCalls
            toolResults
            createdAt
            durableArtifact {
              id
              title
              type
              status
              summary
              metadata
              createdAt
              updatedAt
            }
          }
        }
      }
    }
  }
`;

export const ComputerThreadTasksQuery = gql`
  query ComputerThreadTasks($computerId: ID!, $threadId: ID!, $limit: Int) {
    computerTasks(computerId: $computerId, threadId: $threadId, limit: $limit) {
      id
      taskType
      status
      input
      output
      error
      claimedAt
      completedAt
      createdAt
      updatedAt
    }
  }
`;

export const ComputerEventsQuery = gql`
  query ComputerEvents($computerId: ID!, $limit: Int) {
    computerEvents(computerId: $computerId, limit: $limit) {
      id
      taskId
      eventType
      level
      payload
      createdAt
    }
  }
`;

export const ComputerThreadChunkSubscription = gql`
  subscription ComputerThreadChunk($threadId: ID!) {
    onComputerThreadChunk(threadId: $threadId) {
      threadId
      chunk
      seq
      publishedAt
    }
  }
`;

export const ThreadTurnUpdatedSubscription = gql`
  subscription ThreadTurnUpdated($tenantId: ID!) {
    onThreadTurnUpdated(tenantId: $tenantId) {
      threadId
      tenantId
      status
      updatedAt
    }
  }
`;

export const NewMessageSubscription = gql`
  subscription NewMessage($threadId: ID!) {
    onNewMessage(threadId: $threadId) {
      messageId
      threadId
      role
      content
      createdAt
    }
  }
`;

export const ThreadUpdatedSubscription = gql`
  subscription ThreadUpdated($tenantId: ID!) {
    onThreadUpdated(tenantId: $tenantId) {
      threadId
      tenantId
      status
      title
      updatedAt
    }
  }
`;

const ComputerTaskFields = gql`
  fragment ComputerTaskFields on ComputerTask {
    id
    tenantId
    computerId
    taskType
    status
    input
    output
    error
    idempotencyKey
    claimedAt
    completedAt
    createdAt
    updatedAt
  }
`;

const ArtifactFields = gql`
  fragment ArtifactFields on Artifact {
    id
    tenantId
    agentId
    threadId
    title
    type
    status
    summary
    metadata
    createdAt
    updatedAt
  }
`;

export const DashboardArtifactQuery = gql`
  query DashboardArtifact($id: ID!) {
    dashboardArtifact(id: $id) {
      artifact {
        ...ArtifactFields
      }
      manifest
      latestRefreshTask {
        ...ComputerTaskFields
      }
      canRefresh
    }
  }
  ${ArtifactFields}
  ${ComputerTaskFields}
`;

export const RefreshDashboardArtifactMutation = gql`
  mutation RefreshDashboardArtifact($id: ID!) {
    refreshDashboardArtifact(id: $id) {
      artifact {
        ...ArtifactFields
      }
      task {
        ...ComputerTaskFields
      }
      idempotencyKey
    }
  }
  ${ArtifactFields}
  ${ComputerTaskFields}
`;

export const CreateThreadMutation = gql`
  mutation CreateThread($input: CreateThreadInput!) {
    createThread(input: $input) {
      id
      number
      identifier
      title
      status
      channel
      createdAt
    }
  }
`;

export const SendMessageMutation = gql`
  mutation SendMessage($input: SendMessageInput!) {
    sendMessage(input: $input) {
      id
      threadId
      tenantId
      role
      content
      createdAt
    }
  }
`;

const ComputerApprovalFields = gql`
  fragment ComputerApprovalFields on InboxItem {
    id
    tenantId
    type
    status
    title
    description
    entityType
    entityId
    config
    expiresAt
    createdAt
    updatedAt
  }
`;

export const ComputerApprovalsQuery = gql`
  query ComputerApprovals($tenantId: ID!) {
    inboxItems(tenantId: $tenantId, status: PENDING) {
      ...ComputerApprovalFields
    }
  }
  ${ComputerApprovalFields}
`;

export const ComputerApprovalQuery = gql`
  query ComputerApproval($id: ID!) {
    inboxItem(id: $id) {
      ...ComputerApprovalFields
    }
  }
  ${ComputerApprovalFields}
`;

export const ApproveComputerApprovalMutation = gql`
  mutation ApproveComputerApproval($id: ID!, $input: ApproveInboxItemInput) {
    approveInboxItem(id: $id, input: $input) {
      ...ComputerApprovalFields
    }
  }
  ${ComputerApprovalFields}
`;

export const RejectComputerApprovalMutation = gql`
  mutation RejectComputerApproval($id: ID!, $input: RejectInboxItemInput) {
    rejectInboxItem(id: $id, input: $input) {
      ...ComputerApprovalFields
    }
  }
  ${ComputerApprovalFields}
`;

export const ComputerMemoryRecordsQuery = gql`
  query ComputerMemoryRecords(
    $tenantId: ID!
    $userId: ID!
    $namespace: String!
  ) {
    memoryRecords(tenantId: $tenantId, userId: $userId, namespace: $namespace) {
      memoryRecordId
      content {
        text
      }
      createdAt
      updatedAt
      namespace
      factType
      confidence
      tags
      context
      threadId
    }
  }
`;

export const DeleteComputerMemoryRecordMutation = gql`
  mutation DeleteComputerMemoryRecord(
    $tenantId: ID!
    $userId: ID!
    $memoryRecordId: ID!
  ) {
    deleteMemoryRecord(
      tenantId: $tenantId
      userId: $userId
      memoryRecordId: $memoryRecordId
    )
  }
`;
