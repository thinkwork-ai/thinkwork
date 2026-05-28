import { gql } from "@urql/core";

/**
 * Plain `gql` template literals — apps/spaces Phase 1 deliberately skips
 * the full graphql-codegen pipeline that admin uses. With only three
 * operations there's no benefit to typed document nodes yet; codegen lands
 * in a future slice when query count grows.
 */

export const ThreadsPagedQuery = gql`
  query ThreadsPaged(
    $tenantId: ID!
    $search: String
    $showArchived: Boolean
    $sortField: String
    $sortDir: String
    $limit: Int
    $offset: Int
    $unreadOnly: Boolean
  ) {
    threadsPaged(
      tenantId: $tenantId
      search: $search
      showArchived: $showArchived
      sortField: $sortField
      sortDir: $sortDir
      limit: $limit
      offset: $offset
      unreadOnly: $unreadOnly
    ) {
      items {
        id
        userId
        number
        identifier
        spaceId
        title
        status
        assigneeType
        assigneeId
        agentId
        space {
          id
          slug
          name
          kind
        }
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

export const PinnedThreadsQuery = gql`
  query PinnedThreads($tenantId: ID!, $limit: Int) {
    pinnedThreads(tenantId: $tenantId, limit: $limit) {
      pinnedAt
      pinOrder
      thread {
        id
        userId
        number
        identifier
        spaceId
        title
        status
        assigneeType
        assigneeId
        agentId
        space {
          id
          slug
          name
          kind
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
    }
  }
`;

export const PinThreadMutation = gql`
  mutation PinThread($tenantId: ID!, $threadId: ID!) {
    pinThread(tenantId: $tenantId, threadId: $threadId) {
      pinnedAt
      pinOrder
      thread {
        id
      }
    }
  }
`;

export const UnpinThreadMutation = gql`
  mutation UnpinThread($tenantId: ID!, $threadId: ID!) {
    unpinThread(tenantId: $tenantId, threadId: $threadId)
  }
`;

export const ReorderPinnedThreadsMutation = gql`
  mutation ReorderPinnedThreads($tenantId: ID!, $threadIds: [ID!]!) {
    reorderPinnedThreads(tenantId: $tenantId, threadIds: $threadIds) {
      pinnedAt
      pinOrder
      thread {
        id
      }
    }
  }
`;

export const SpacesQuery = gql`
  query Spaces($tenantId: ID!) {
    spaces(tenantId: $tenantId, status: ACTIVE) {
      id
      slug
      name
      description
      kind
      accessMode
      templateKey
      status
      unreadThreadCount
      lastActivityAt
      updatedAt
    }
  }
`;

export const NewThreadMentionTargetsQuery = gql`
  query NewThreadMentionTargets($tenantId: ID!) {
    tenantMentionTargets(tenantId: $tenantId) {
      id
      targetType
      targetId
      displayName
      aliases
      isDefaultAgent
      avatarUrl
      role
    }
  }
`;

export const ChatGlobalInboxQuery = gql`
  query ChatGlobalInbox($tenantId: ID!, $limit: Int) {
    threadsPaged(
      tenantId: $tenantId
      showArchived: false
      sortField: "updated"
      sortDir: "desc"
      unreadOnly: true
      limit: $limit
    ) {
      items {
        id
        number
        identifier
        title
        status
        channel
        spaceId
        space {
          id
          slug
          name
          kind
        }
        lastReadAt
        lastActivityAt
        lastTurnCompletedAt
        archivedAt
        createdAt
        updatedAt
      }
      totalCount
    }
  }
`;

export const SpaceQuery = gql`
  query Space($id: ID!) {
    space(id: $id) {
      id
      tenantId
      slug
      name
      description
      prompt
      kind
      accessMode
      status
      checklistTemplates {
        id
        key
        name
        description
        items {
          id
          key
          title
          description
          roleKey
          required
          sortOrder
        }
      }
      integrations {
        id
        provider
        status
        writebackPolicy
      }
    }
  }
`;

export const SpaceThreadsQuery = gql`
  query SpaceThreads(
    $tenantId: ID!
    $spaceId: ID!
    $search: String
    $limit: Int
    $offset: Int
  ) {
    threadsPaged(
      tenantId: $tenantId
      spaceId: $spaceId
      search: $search
      showArchived: false
      sortField: "updated"
      sortDir: "desc"
      limit: $limit
      offset: $offset
    ) {
      items {
        id
        number
        identifier
        title
        status
        channel
        spaceId
        metadata
        lastReadAt
        lastActivityAt
        lastTurnCompletedAt
        archivedAt
        createdAt
        updatedAt
      }
      totalCount
    }
  }
`;

export const SpaceThreadContextQuery = gql`
  query SpaceThreadContext($id: ID!) {
    thread(id: $id) {
      id
      title
      status
      channel
      spaceId
      metadata
      archivedAt
      createdAt
      updatedAt
      participants {
        id
        participantType
        role
        notificationPreference
        user {
          id
          name
          email
        }
        agent {
          id
          name
          slug
        }
      }
    }
  }
`;

export const ThreadLinkedTasksQuery = gql`
  query ThreadLinkedTasks($tenantId: ID!, $threadId: ID!) {
    threadLinkedTasks(tenantId: $tenantId, threadId: $threadId) {
      id
      checklistItemId
      provider
      title
      required
      roleKey
      assigneeDisplay
      externalTaskId
      externalTaskUrl
      status
      blocked
      syncStatus
      lastSyncedAt
      metadata
      updatedAt
    }
  }
`;

export const ThreadProgressMarkdownQuery = gql`
  query ThreadProgressMarkdown($tenantId: ID!, $threadId: ID!) {
    threadProgressMarkdown(tenantId: $tenantId, threadId: $threadId) {
      threadId
      key
      content
    }
  }
`;

export const ThreadGoalFilesQuery = gql`
  query ThreadGoalFiles($tenantId: ID!, $threadId: ID!) {
    threadGoalFiles(tenantId: $tenantId, threadId: $threadId) {
      goal {
        id
        tenantId
        spaceId
        threadId
        templateKey
        outcome
        ownerType
        ownerId
        mode
        status
        progressModel
        completionRule
        reviewPolicy
        reviewerType
        reviewerId
        startedAt
        reviewedAt
        completedAt
        cancelledAt
        metadata
        updatedAt
      }
      files {
        file
        key
        content
      }
    }
  }
`;

export const UpdateLinkedTaskMutation = gql`
  mutation UpdateLinkedTask($input: UpdateLinkedTaskInput!) {
    updateLinkedTask(input: $input) {
      id
      checklistItemId
      provider
      title
      required
      roleKey
      assigneeDisplay
      externalTaskId
      externalTaskUrl
      status
      blocked
      syncStatus
      lastSyncedAt
      metadata
      updatedAt
    }
  }
`;

export const ReviewGoalMutation = gql`
  mutation ReviewGoal($input: ReviewGoalInput!) {
    reviewGoal(input: $input) {
      goal {
        id
        status
        reviewerType
        reviewerId
        reviewedAt
        completedAt
        cancelledAt
        metadata
        updatedAt
      }
      thread {
        id
        status
        completedAt
        cancelledAt
        closedAt
        updatedAt
      }
    }
  }
`;

export const StartCustomerOnboardingMutation = gql`
  mutation StartCustomerOnboarding($input: StartCustomerOnboardingInput!) {
    startCustomerOnboarding(input: $input) {
      threadId
      idempotent
      missingFields
      thread {
        id
        title
        spaceId
      }
      linkedTasks {
        checklistItemId
        title
        externalTaskId
        externalTaskUrl
        status
        blocked
        syncStatus
      }
    }
  }
`;

export const ComputerThreadQuery = gql`
  query ComputerThread($id: ID!, $messageLimit: Int) {
    thread(id: $id) {
      id
      agentId
      userId
      number
      identifier
      title
      status
      spaceId
      channel
      lifecycleStatus
      metadata
      lastResponsePreview
      costSummary
      createdAt
      updatedAt
      attachments {
        id
        name
        mimeType
        sizeBytes
        uploadedBy
        createdAt
      }
      messages(limit: $messageLimit) {
        edges {
          node {
            id
            role
            content
            parts
            metadata
            toolCalls
            toolResults
            createdAt
            sender {
              type
              id
              displayName
              avatarUrl
            }
            mentions {
              id
              targetType
              targetId
              displayName
            }
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

export const SpaceThreadCollaborationQuery = gql`
  query SpaceThreadCollaboration($id: ID!, $messageLimit: Int) {
    thread(id: $id) {
      id
      spaceId
      title
      status
      channel
      archivedAt
      metadata
      attachments {
        id
        name
        mimeType
        sizeBytes
        uploadedBy
        createdAt
      }
      participants {
        id
        participantType
        role
        user {
          id
          name
          email
          image
        }
        agent {
          id
          name
          slug
          avatarUrl
        }
      }
      messages(limit: $messageLimit) {
        edges {
          node {
            id
            role
            content
            parts
            metadata
            createdAt
            sender {
              type
              id
              displayName
              avatarUrl
            }
            mentions {
              id
              targetType
              targetId
              displayName
            }
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

export const ThreadMentionTargetsQuery = gql`
  query ThreadMentionTargets($threadId: ID!) {
    threadMentionTargets(threadId: $threadId) {
      id
      targetType
      targetId
      displayName
      aliases
      isDefaultAgent
      avatarUrl
      role
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

const AppletPreviewFields = gql`
  fragment AppletPreviewFields on Applet {
    appId
    name
    version
    tenantId
    threadId
    prompt
    agentVersion
    modelId
    generatedAt
    stdlibVersionAtGeneration
    # Surface the underlying Artifact id + favoritedAt so the artifact
    # detail page can wire favorite/delete actions without a second
    # round-trip to fetch the artifact by appId.
    artifact {
      id
      favoritedAt
    }
  }
`;

export const AppletQuery = gql`
  query Applet($appId: ID!) {
    applet(appId: $appId) {
      source
      files
      metadata
      themeCss
      applet {
        ...AppletPreviewFields
      }
    }
  }
  ${AppletPreviewFields}
`;

export const AppletsQuery = gql`
  query Applets {
    applets {
      nodes {
        ...AppletPreviewFields
      }
      nextCursor
    }
  }
  ${AppletPreviewFields}
`;

export const PromoteDraftAppletMutation = gql`
  mutation PromoteDraftApplet($input: PromoteDraftAppletInput!) {
    promoteDraftApplet(input: $input) {
      ok
      appId
      version
      validated
      persisted
      errors
    }
  }
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
    $userId: ID
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
      strategyId
      strategy
      userSlug
      agentSlug
      factType
      confidence
      eventDate
      occurredStart
      occurredEnd
      mentionedAt
      tags
      accessCount
      proofCount
      context
      threadId
    }
  }
`;

export const DeleteComputerMemoryRecordMutation = gql`
  mutation DeleteComputerMemoryRecord(
    $tenantId: ID!
    $userId: ID
    $memoryRecordId: ID!
  ) {
    deleteMemoryRecord(
      tenantId: $tenantId
      userId: $userId
      memoryRecordId: $memoryRecordId
    )
  }
`;

export const ComputerMemorySearchQuery = gql`
  query ComputerMemorySearch(
    $tenantId: ID
    $userId: ID
    $query: String!
    $strategy: MemoryStrategy
    $limit: Int
  ) {
    memorySearch(
      tenantId: $tenantId
      userId: $userId
      query: $query
      strategy: $strategy
      limit: $limit
    ) {
      records {
        memoryRecordId
        content {
          text
        }
        score
        namespace
        strategy
        createdAt
        threadId
      }
      totalCount
    }
  }
`;

export const ComputerMemorySystemConfigQuery = gql`
  query ComputerMemorySystemConfig {
    memorySystemConfig {
      managedMemoryEnabled
      hindsightEnabled
    }
  }
`;

export const ComputerRecentWikiPagesQuery = gql`
  query ComputerRecentWikiPages($tenantId: ID, $userId: ID, $limit: Int) {
    recentWikiPages(tenantId: $tenantId, userId: $userId, limit: $limit) {
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

export const ComputerWikiSearchQuery = gql`
  query ComputerWikiSearch(
    $tenantId: ID!
    $userId: ID
    $query: String!
    $limit: Int
  ) {
    wikiSearch(
      tenantId: $tenantId
      userId: $userId
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
        lastCompiledAt
        updatedAt
      }
    }
  }
`;

export const ComputerWikiPageQuery = gql`
  query ComputerWikiPage(
    $tenantId: ID!
    $userId: ID
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
    }
  }
`;

export const ComputerWikiBacklinksQuery = gql`
  query ComputerWikiBacklinks($pageId: ID!) {
    wikiBacklinks(pageId: $pageId) {
      id
      type
      slug
      title
      summary
    }
  }
`;

export const ComputerKnowledgeBasesQuery = gql`
  query ComputerKnowledgeBases($tenantId: ID!) {
    knowledgeBases(tenantId: $tenantId) {
      id
      tenantId
      name
      slug
      description
      status
      documentCount
      lastSyncAt
      lastSyncStatus
      errorMessage
      createdAt
      updatedAt
    }
  }
`;

export const ComputerKnowledgeBaseDetailQuery = gql`
  query ComputerKnowledgeBaseDetail($id: ID!) {
    knowledgeBase(id: $id) {
      id
      tenantId
      name
      slug
      description
      embeddingModel
      chunkingStrategy
      chunkSizeTokens
      chunkOverlapPercent
      status
      awsKbId
      lastSyncAt
      lastSyncStatus
      documentCount
      errorMessage
      createdAt
      updatedAt
    }
  }
`;

// ─── Customize page (apps/spaces Customize) ─────────────────────────────

export const SkillCatalogQuery = gql`
  query SkillCatalog {
    skillCatalog {
      id
      skillId
      displayName
      description
      category
      icon
      source
      enabled
    }
  }
`;

export const WorkflowCatalogQuery = gql`
  query WorkflowCatalog {
    workflowCatalog {
      id
      slug
      displayName
      description
      category
      icon
      defaultSchedule
      status
      enabled
    }
  }
`;

export const CustomizeBindingsQuery = gql`
  query CustomizeBindings {
    customizeBindings {
      agentId
      connectedSkillIds
      connectedWorkflowSlugs
    }
  }
`;

export const EnableSkillMutation = gql`
  mutation EnableSkill($input: EnableSkillInput!) {
    enableSkill(input: $input) {
      id
      tenantId
      agentId
      skillId
      enabled
    }
  }
`;

export const DisableSkillMutation = gql`
  mutation DisableSkill($input: DisableSkillInput!) {
    disableSkill(input: $input)
  }
`;

export const EnableWorkflowMutation = gql`
  mutation EnableWorkflow($input: EnableWorkflowInput!) {
    enableWorkflow(input: $input) {
      id
      tenantId
      agentId
      catalogSlug
      status
      enabled
      updatedAt
    }
  }
`;

export const DisableWorkflowMutation = gql`
  mutation DisableWorkflow($input: DisableWorkflowInput!) {
    disableWorkflow(input: $input)
  }
`;

// --- Thread + Artifact destructive / favorite mutations ------------------

export const UpdateThreadMutation = gql`
  mutation UpdateThread($id: ID!, $input: UpdateThreadInput!) {
    updateThread(id: $id, input: $input) {
      id
      title
      status
      archivedAt
      updatedAt
    }
  }
`;

export const DeleteThreadMutation = gql`
  mutation DeleteThread($id: ID!) {
    deleteThread(id: $id)
  }
`;

export const ThreadArtifactsQuery = gql`
  query ThreadArtifacts($tenantId: ID!, $threadId: ID!) {
    artifacts(tenantId: $tenantId, threadId: $threadId) {
      id
      title
      type
    }
  }
`;

export const UpdateArtifactMutation = gql`
  mutation UpdateArtifact($id: ID!, $input: UpdateArtifactInput!) {
    updateArtifact(id: $id, input: $input) {
      id
      title
      favoritedAt
      updatedAt
    }
  }
`;

export const DeleteArtifactMutation = gql`
  mutation DeleteArtifact($id: ID!) {
    deleteArtifact(id: $id)
  }
`;

export const FavoriteArtifactsQuery = gql`
  query FavoriteArtifacts($tenantId: ID!, $limit: Int) {
    artifacts(tenantId: $tenantId, favoritedOnly: true, limit: $limit) {
      id
      title
      type
      favoritedAt
    }
  }
`;

// ----- inert stubs after Computer/Runbook kill -----
// These exports exist so consumers that haven't been refactored yet can
// still type-check. Each operation is a harmless tenant query that returns
// minimal data — the runtime payload no longer carries Computer/Runbook
// fields, and the consuming UI hides cleanly when the arrays are empty.

export const ComputerEventsQuery = gql`
  query ComputerEvents($computerId: ID!, $limit: Int) {
    __typename
  }
`;

export const ComputerThreadTasksQuery = gql`
  query ComputerThreadTasks($computerId: ID!, $threadId: ID!, $limit: Int) {
    __typename
  }
`;

export const RunbookRunsQuery = gql`
  query RunbookRuns($computerId: ID!, $threadId: ID, $limit: Int) {
    __typename
  }
`;

export const ComputerThreadChunkSubscription = gql`
  subscription ComputerThreadChunk($threadId: ID!) {
    __typename
  }
`;

export const ConfirmRunbookRunMutation = gql`
  mutation ConfirmRunbookRun($id: ID!) {
    __typename
  }
`;

export const RejectRunbookRunMutation = gql`
  mutation RejectRunbookRun($id: ID!) {
    __typename
  }
`;
