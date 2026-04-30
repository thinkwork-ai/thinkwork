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

export const TenantEntityPageQuery = gql`
  query TenantEntityPage($tenantId: ID!, $pageId: ID!) {
    tenantEntityPage(tenantId: $tenantId, pageId: $pageId) {
      id
      tenantId
      type
      entitySubtype
      slug
      title
      summary
      bodyMd
      status
      updatedAt
      sections {
        id
        sectionSlug
        heading
        bodyMd
        position
        facetType
        lastSourceAt
      }
    }
  }
`;

export const TenantEntityFacetsQuery = gql`
  query TenantEntityFacets($pageId: ID!, $limit: Int, $cursor: String) {
    tenantEntityFacets(pageId: $pageId, limit: $limit, cursor: $cursor) {
      edges {
        node {
          id
          sectionSlug
          heading
          bodyMd
          facetType
          updatedAt
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

export const EditTenantEntityFactMutation = gql`
  mutation EditTenantEntityFact($factId: ID!, $content: String!) {
    editTenantEntityFact(factId: $factId, content: $content) {
      id
      bodyMd
      updatedAt
    }
  }
`;

export const RejectTenantEntityFactMutation = gql`
  mutation RejectTenantEntityFact($factId: ID!, $reason: String) {
    rejectTenantEntityFact(factId: $factId, reason: $reason) {
      id
      status
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

export const WikiPageQuery = gql`
  query WikiPage(
    $tenantId: ID!
    $userId: ID!
    $type: WikiPageType!
    $slug: String!
  ) {
    wikiPage(tenantId: $tenantId, userId: $userId, type: $type, slug: $slug) {
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
      # Detail-screen-only read surfaces (Unit 8). Each field fires its own
      # repository query — do NOT request these on list screens (search,
      # recentWikiPages) or you'll N+1 the server.
      sourceMemoryCount
      parent {
        id
        type
        slug
        title
      }
      promotedFromSection {
        parentPage {
          id
          type
          slug
          title
        }
        sectionSlug
        sectionHeading
      }
      children {
        id
        type
        slug
        title
        summary
      }
    }
  }
`;

export const WikiPageSourceMemoryIdsQuery = gql`
  query WikiPageSourceMemoryIds(
    $tenantId: ID!
    $userId: ID!
    $type: WikiPageType!
    $slug: String!
    $limit: Int
  ) {
    wikiPage(tenantId: $tenantId, userId: $userId, type: $type, slug: $slug) {
      id
      sourceMemoryIds(limit: $limit)
    }
  }
`;

export const WikiPageSectionChildrenQuery = gql`
  query WikiPageSectionChildren(
    $tenantId: ID!
    $userId: ID!
    $type: WikiPageType!
    $slug: String!
    $sectionSlug: String!
  ) {
    wikiPage(tenantId: $tenantId, userId: $userId, type: $type, slug: $slug) {
      id
      sectionChildren(sectionSlug: $sectionSlug) {
        id
        type
        slug
        title
        summary
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

export const WikiConnectedPagesQuery = gql`
  query WikiConnectedPages($pageId: ID!) {
    wikiConnectedPages(pageId: $pageId) {
      id
      type
      slug
      title
      summary
    }
  }
`;

export const WikiGraphQuery = gql`
  query WikiGraph($tenantId: ID!, $userId: ID!) {
    wikiGraph(tenantId: $tenantId, userId: $userId) {
      nodes {
        id
        label
        entityType
        slug
        edgeCount
      }
      edges {
        source
        target
        label
        weight
      }
    }
  }
`;

export const MobileMemorySearchQuery = gql`
  query MobileMemorySearch($userId: ID!, $query: String!, $limit: Int) {
    mobileWikiSearch(userId: $userId, query: $query, limit: $limit) {
      score
      matchingMemoryIds
      page {
        id
        type
        slug
        title
        summary
        lastCompiledAt
        updatedAt
      }
    }
  }
`;

export const RecentWikiPagesQuery = gql`
  query RecentWikiPages($userId: ID!, $limit: Int) {
    recentWikiPages(userId: $userId, limit: $limit) {
      id
      type
      slug
      title
      summary
      lastCompiledAt
      updatedAt
    }
  }
`;
