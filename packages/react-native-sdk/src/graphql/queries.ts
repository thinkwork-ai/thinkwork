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
    agents(tenantId: $tenantId) {
      id
      name
      slug
      role
      type
      status
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
    $priority: ThreadPriority
    $type: ThreadType
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
      priority: $priority
      type: $type
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
      priority
      type
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
      priority
      type
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
    $content: String!
    $factType: MobileCaptureFactType
    $metadata: AWSJSON
    $clientCaptureId: ID
  ) {
    captureMobileMemory(
      agentId: $agentId
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

export const WikiPageQuery = gql`
  query WikiPage(
    $tenantId: ID!
    $ownerId: ID!
    $type: WikiPageType!
    $slug: String!
  ) {
    wikiPage(tenantId: $tenantId, ownerId: $ownerId, type: $type, slug: $slug) {
      id
      type
      slug
      title
      summary
      bodyMd
      status
      lastCompiledAt
      updatedAt
      aliases
      sections {
        id
        sectionSlug
        heading
        bodyMd
        position
        lastSourceAt
      }
    }
  }
`;

export const WikiBacklinksQuery = gql`
  query WikiBacklinks($pageId: ID!) {
    wikiBacklinks(pageId: $pageId) {
      id
      type
      slug
      title
      summary
    }
  }
`;

export const MobileMemorySearchQuery = gql`
  query MobileMemorySearch(
    $tenantId: ID!
    $ownerId: ID!
    $query: String!
    $limit: Int
  ) {
    wikiSearch(
      tenantId: $tenantId
      ownerId: $ownerId
      query: $query
      limit: $limit
    ) {
      score
      matchedAlias
      page {
        id
        type
        slug
        title
        summary
        status
        lastCompiledAt
        updatedAt
      }
    }
  }
`;
