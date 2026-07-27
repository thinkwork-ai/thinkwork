import { gql } from "urql";

export const MeQuery = gql`
  query Me {
    me {
      id
      email
      name
      tenantId
    }
  }
`;

export const AgentsQuery = gql`
  query Agents($tenantId: ID!) {
    agent: tenantAgent(tenantId: $tenantId) {
      id
      tenantId
      name
      slug
      role
      type
      status
      runtime
      avatarUrl
    }
  }
`;

export const TenantAgentSummaryQuery = gql`
  query TenantAgentSummary($tenantId: ID!) {
    agent: tenantAgentSummary(tenantId: $tenantId) {
      id
      tenantId
      name
      slug
      role
      type
      status
      runtime
      avatarUrl
    }
  }
`;

export const ThreadsQuery = gql`
  query Threads(
    $tenantId: ID!
    $agentId: ID
    $assigneeId: ID
    $status: ThreadStatus
    $channel: ThreadChannel
    $search: String
    $limit: Int
    $cursor: String
  ) {
    threads(
      tenantId: $tenantId
      agentId: $agentId
      assigneeId: $assigneeId
      status: $status
      channel: $channel
      search: $search
      limit: $limit
      cursor: $cursor
    ) {
      id
      tenantId
      agentId
      assigneeId
      number
      identifier
      title
      status
      channel
      lastActivityAt
      lastReadAt
      archivedAt
      lastResponsePreview
      createdAt
      updatedAt
    }
  }
`;

export const UnreadThreadCountQuery = gql`
  query UnreadThreadCount($tenantId: ID!, $agentId: ID) {
    unreadThreadCount(tenantId: $tenantId, agentId: $agentId)
  }
`;

export const ThreadQuery = gql`
  query Thread($id: ID!) {
    thread(id: $id) {
      id
      tenantId
      agentId
      assigneeId
      number
      identifier
      title
      status
      lifecycleStatus
      channel
      lastActivityAt
      lastReadAt
      archivedAt
      lastResponsePreview
      createdAt
      updatedAt
    }
  }
`;

export const MessagesQuery = gql`
  query Messages($threadId: ID!, $limit: Int, $cursor: String) {
    messages(threadId: $threadId, limit: $limit, cursor: $cursor) {
      edges {
        node {
          id
          threadId
          tenantId
          role
          content
          senderType
          senderId
          createdAt
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const CreateThreadMutation = gql`
  mutation CreateThread($input: CreateThreadInput!) {
    createThread(input: $input) {
      id
      tenantId
      agentId
      number
      title
      status
      channel
      createdAt
      updatedAt
    }
  }
`;

export const UpdateThreadMutation = gql`
  mutation UpdateThread($id: ID!, $input: UpdateThreadInput!) {
    updateThread(id: $id, input: $input) {
      id
      tenantId
      title
      status
      archivedAt
      lastReadAt
      updatedAt
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
      senderType
      senderId
      createdAt
    }
  }
`;

export const CaptureMobileMemoryMutation = gql`
  mutation CaptureMobileMemory(
    $agentId: ID!
    $userId: ID
    $content: String!
    $factType: MobileCaptureFactType
    $metadata: AWSJSON
    $clientCaptureId: ID
  ) {
    captureMobileMemory(
      agentId: $agentId
      userId: $userId
      content: $content
      factType: $factType
      metadata: $metadata
      clientCaptureId: $clientCaptureId
    ) {
      id
      tenantId
      agentId
      content
      factType
      capturedAt
      syncedAt
      metadata
    }
  }
`;

export const MobileMemoryCapturesQuery = gql`
  query MobileMemoryCaptures($agentId: ID!, $limit: Int) {
    mobileMemoryCaptures(agentId: $agentId, limit: $limit) {
      id
      tenantId
      agentId
      content
      factType
      capturedAt
      syncedAt
      metadata
    }
  }
`;

export const DeleteMobileMemoryCaptureMutation = gql`
  mutation DeleteMobileMemoryCapture($agentId: ID!, $captureId: ID!) {
    deleteMobileMemoryCapture(agentId: $agentId, captureId: $captureId)
  }
`;
