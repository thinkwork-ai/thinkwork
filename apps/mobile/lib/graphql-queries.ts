import { graphql } from "@/lib/gql";
import { gql } from "urql";

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export const AgentsQuery = graphql(`
  query Agents($tenantId: ID!, $status: AgentStatus, $type: AgentType) {
    agents(tenantId: $tenantId, status: $status, type: $type) {
      id
      tenantId
      name
      role
      type
      status
      templateId
      systemPrompt
      adapterType
      adapterConfig
      runtimeConfig
      lastHeartbeatAt
      avatarUrl
      reportsToId
      humanPairId
      version
      createdAt
      updatedAt
    }
  }
`);

export const AgentQuery = graphql(`
  query Agent($id: ID!) {
    agent(id: $id) {
      id
      tenantId
      name
      slug
      role
      type
      status
      templateId
      systemPrompt
      adapterType
      adapterConfig
      runtimeConfig
      lastHeartbeatAt
      avatarUrl
      reportsToId
      humanPairId
      version
      capabilities {
        id
        capability
        config
        enabled
      }
      skills {
        id
        skillId
        config
        permissions
        rateLimitRpm
        enabled
      }
      budgetPolicy {
        id
        period
        limitUsd
        actionOnExceed
      }
      createdAt
      updatedAt
    }
  }
`);

export const CreateAgentMutation = graphql(`
  mutation CreateAgent($input: CreateAgentInput!) {
    createAgent(input: $input) {
      id
      tenantId
      name
      type
      status
      createdAt
    }
  }
`);

export const UpdateAgentMutation = graphql(`
  mutation UpdateAgent($id: ID!, $input: UpdateAgentInput!) {
    updateAgent(id: $id, input: $input) {
      id
      name
      role
      type
      status
      templateId
      systemPrompt
      updatedAt
    }
  }
`);

export const DeleteAgentMutation = graphql(`
  mutation DeleteAgent($id: ID!) {
    deleteAgent(id: $id)
  }
`);

export const UpdateAgentStatusMutation = graphql(`
  mutation UpdateAgentStatus($id: ID!, $status: AgentStatus!) {
    updateAgentStatus(id: $id, status: $status) {
      id
      status
      lastHeartbeatAt
      updatedAt
    }
  }
`);

export const SetAgentCapabilitiesMutation = graphql(`
  mutation SetAgentCapabilities(
    $agentId: ID!
    $capabilities: [AgentCapabilityInput!]!
  ) {
    setAgentCapabilities(agentId: $agentId, capabilities: $capabilities) {
      id
      capability
      config
      enabled
    }
  }
`);

export const SetAgentSkillsMutation = graphql(`
  mutation SetAgentSkills($agentId: ID!, $skills: [AgentSkillInput!]!) {
    setAgentSkills(agentId: $agentId, skills: $skills) {
      id
      skillId
      config
      enabled
    }
  }
`);

export const SetAgentBudgetPolicyMutation = graphql(`
  mutation SetAgentBudgetPolicy(
    $agentId: ID!
    $input: AgentBudgetPolicyInput!
  ) {
    setAgentBudgetPolicy(agentId: $agentId, input: $input) {
      id
      period
      limitUsd
      actionOnExceed
    }
  }
`);

// ---------------------------------------------------------------------------
// Messages (belong directly to threads now — PRD-15)
// ---------------------------------------------------------------------------

export const SendMessageMutation = graphql(`
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
`);

export const DeleteMessageMutation = graphql(`
  mutation DeleteMessage($id: ID!) {
    deleteMessage(id: $id)
  }
`);

// ---------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------

export const MySlackLinksQuery = graphql(`
  query MySlackLinks($tenantId: ID!) {
    mySlackLinks(tenantId: $tenantId) {
      id
      tenantId
      slackTeamId
      slackTeamName
      slackUserId
      slackUserName
      slackUserEmail
      userId
      status
      linkedAt
      unlinkedAt
    }
  }
`);

export const UnlinkSlackIdentityMutation = graphql(`
  mutation UnlinkSlackIdentity($id: ID!) {
    unlinkSlackIdentity(id: $id) {
      id
      status
      unlinkedAt
    }
  }
`);

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const MessagesQuery = graphql(`
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
          toolCalls
          toolResults
          metadata
          tokenCount
          durableArtifact {
            id
            title
            type
            status
            content
            summary
          }
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
`);

// ---------------------------------------------------------------------------
// Computers
// ---------------------------------------------------------------------------

export const AssignedComputersQuery = graphql(`
  query AssignedComputers {
    assignedComputers {
      id
      name
      slug
      status
      runtimeStatus
      tenantId
    }
  }
`);

export const ComputersQuery = graphql(`
  query Computers($tenantId: ID!) {
    computers(tenantId: $tenantId) {
      id
      name
      slug
      status
      runtimeStatus
    }
  }
`);

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export const TeamsQuery = graphql(`
  query Teams($tenantId: ID!) {
    teams(tenantId: $tenantId) {
      id
      tenantId
      name
      description
      type
      status
      budgetMonthlyCents
      metadata
      createdAt
      updatedAt
    }
  }
`);

export const TeamQuery = graphql(`
  query Team($id: ID!) {
    team(id: $id) {
      id
      tenantId
      name
      description
      type
      status
      budgetMonthlyCents
      metadata
      agents {
        id
        agentId
        role
        joinedAt
        agent {
          id
          name
          type
          status
          avatarUrl
        }
      }
      users {
        id
        userId
        role
        joinedAt
        user {
          id
          name
          email
          image
        }
      }
      createdAt
      updatedAt
    }
  }
`);

export const CreateTeamMutation = graphql(`
  mutation CreateTeam($input: CreateTeamInput!) {
    createTeam(input: $input) {
      id
      tenantId
      name
      type
      status
      createdAt
    }
  }
`);

export const UpdateTeamMutation = graphql(`
  mutation UpdateTeam($id: ID!, $input: UpdateTeamInput!) {
    updateTeam(id: $id, input: $input) {
      id
      name
      description
      status
      updatedAt
    }
  }
`);

export const DeleteTeamMutation = graphql(`
  mutation DeleteTeam($id: ID!) {
    deleteTeam(id: $id)
  }
`);

export const AddTeamAgentMutation = graphql(`
  mutation AddTeamAgent($teamId: ID!, $input: AddTeamAgentInput!) {
    addTeamAgent(teamId: $teamId, input: $input) {
      id
      teamId
      agentId
      role
      joinedAt
    }
  }
`);

export const RemoveTeamAgentMutation = graphql(`
  mutation RemoveTeamAgent($teamId: ID!, $agentId: ID!) {
    removeTeamAgent(teamId: $teamId, agentId: $agentId)
  }
`);

export const AddTeamUserMutation = graphql(`
  mutation AddTeamUser($teamId: ID!, $input: AddTeamUserInput!) {
    addTeamUser(teamId: $teamId, input: $input) {
      id
      teamId
      userId
      role
      joinedAt
    }
  }
`);

export const RemoveTeamUserMutation = graphql(`
  mutation RemoveTeamUser($teamId: ID!, $userId: ID!) {
    removeTeamUser(teamId: $teamId, userId: $userId)
  }
`);

// ---------------------------------------------------------------------------
// Routines
// ---------------------------------------------------------------------------

export const RoutinesQuery = graphql(`
  query Routines(
    $tenantId: ID!
    $teamId: ID
    $agentId: ID
    $status: RoutineStatus
  ) {
    routines(
      tenantId: $tenantId
      teamId: $teamId
      agentId: $agentId
      status: $status
    ) {
      id
      tenantId
      teamId
      agentId
      name
      description
      type
      status
      schedule
      config
      lastRunAt
      nextRunAt
      createdAt
      updatedAt
    }
  }
`);

export const RoutineQuery = graphql(`
  query Routine($id: ID!) {
    routine(id: $id) {
      id
      tenantId
      teamId
      agentId
      name
      description
      type
      status
      schedule
      config
      engine
      currentVersion
      documentationMd
      lastRunAt
      nextRunAt
      triggers {
        id
        triggerType
        config
        enabled
      }
      createdAt
      updatedAt
    }
  }
`);

// Phase D U13/U14 mobile parity: pull routine_executions + step_events
// (the substrate that replaced the deprecated RoutineRun/RoutineStep
// types). Mirrors admin's RoutineExecutionsListQuery /
// RoutineExecutionDetailQuery so a future shared package is easy.
export const RoutineExecutionsListQuery = graphql(`
  query MobileRoutineExecutionsList(
    $routineId: ID!
    $status: RoutineExecutionStatus
    $limit: Int
    $cursor: String
  ) {
    routineExecutions(
      routineId: $routineId
      status: $status
      limit: $limit
      cursor: $cursor
    ) {
      id
      status
      triggerSource
      startedAt
      finishedAt
      totalLlmCostUsdCents
      errorCode
      createdAt
    }
  }
`);

export const RoutineExecutionDetailQuery = graphql(`
  query MobileRoutineExecutionDetail($id: ID!) {
    routineExecution(id: $id) {
      id
      tenantId
      routineId
      sfnExecutionArn
      triggerSource
      inputJson
      outputJson
      status
      startedAt
      finishedAt
      errorCode
      errorMessage
      totalLlmCostUsdCents
      stepEvents {
        id
        nodeId
        recipeType
        status
        startedAt
        finishedAt
        inputJson
        outputJson
        errorJson
        llmCostUsdCents
        retryCount
        stdoutS3Uri
        stderrS3Uri
        stdoutPreview
        truncated
        createdAt
      }
      routine {
        id
        name
        description
        currentVersion
        documentationMd
      }
      aslVersion {
        id
        versionNumber
        markdownSummary
        stepManifestJson
      }
      createdAt
    }
  }
`);

export const CreateRoutineMutation = graphql(`
  mutation CreateRoutine($input: CreateRoutineInput!) {
    createRoutine(input: $input) {
      id
      tenantId
      name
      type
      status
      createdAt
    }
  }
`);

export const UpdateRoutineMutation = graphql(`
  mutation UpdateRoutine($id: ID!, $input: UpdateRoutineInput!) {
    updateRoutine(id: $id, input: $input) {
      id
      name
      description
      status
      schedule
      updatedAt
    }
  }
`);

export const DeleteRoutineMutation = graphql(`
  mutation DeleteRoutine($id: ID!) {
    deleteRoutine(id: $id)
  }
`);

export const TriggerRoutineRunMutation = graphql(`
  mutation TriggerRoutineRun($routineId: ID!, $input: AWSJSON) {
    triggerRoutineRun(routineId: $routineId, input: $input) {
      id
      routineId
      status
      sfnExecutionArn
      startedAt
      createdAt
    }
  }
`);

export const SetRoutineTriggerMutation = graphql(`
  mutation SetRoutineTrigger($routineId: ID!, $input: RoutineTriggerInput!) {
    setRoutineTrigger(routineId: $routineId, input: $input) {
      id
      triggerType
      config
      enabled
    }
  }
`);

export const DeleteRoutineTriggerMutation = graphql(`
  mutation DeleteRoutineTrigger($id: ID!) {
    deleteRoutineTrigger(id: $id)
  }
`);

// ---------------------------------------------------------------------------
// Thread Turns
// ---------------------------------------------------------------------------

export const ThreadTurnsQuery = graphql(`
  query ThreadTurns(
    $tenantId: ID!
    $agentId: ID
    $status: String
    $limit: Int
  ) {
    threadTurns(
      tenantId: $tenantId
      agentId: $agentId
      status: $status
      limit: $limit
    ) {
      id
      tenantId
      triggerId
      agentId
      routineId
      invocationSource
      triggerDetail
      status
      startedAt
      finishedAt
      error
      errorCode
      usageJson
      resultJson
      createdAt
    }
  }
`);

export const ThreadTurnDetailQuery = graphql(`
  query ThreadTurnDetail($id: ID!) {
    threadTurn(id: $id) {
      id
      tenantId
      triggerId
      agentId
      routineId
      invocationSource
      triggerDetail
      wakeupRequestId
      status
      startedAt
      finishedAt
      error
      errorCode
      usageJson
      resultJson
      sessionIdBefore
      sessionIdAfter
      externalRunId
      contextSnapshot
      createdAt
    }
  }
`);

export const ThreadTurnEventsQuery = graphql(`
  query ThreadTurnEvents($runId: ID!, $afterSeq: Int, $limit: Int) {
    threadTurnEvents(runId: $runId, afterSeq: $afterSeq, limit: $limit) {
      id
      runId
      agentId
      seq
      eventType
      stream
      level
      color
      message
      payload
      createdAt
    }
  }
`);

export const TurnInvocationLogsQuery = graphql(`
  query TurnInvocationLogs($tenantId: ID!, $turnId: ID!) {
    turnInvocationLogs(tenantId: $tenantId, turnId: $turnId) {
      requestId
      modelId
      timestamp
      inputTokenCount
      outputTokenCount
      cacheReadTokenCount
      inputPreview
      outputPreview
      toolCount
      costUsd
      toolUses
      hasToolResult
      branch
    }
  }
`);

export const CancelThreadTurnMutation = graphql(`
  mutation CancelThreadTurn($id: ID!) {
    cancelThreadTurn(id: $id) {
      id
      status
      finishedAt
    }
  }
`);

export const CreateWakeupRequestMutation = graphql(`
  mutation CreateWakeupRequest($input: CreateWakeupRequestInput!) {
    createWakeupRequest(input: $input) {
      id
      tenantId
      agentId
      source
      status
      createdAt
    }
  }
`);

// ---------------------------------------------------------------------------
// Scheduled Jobs (formerly Triggers)
// ---------------------------------------------------------------------------

export const ScheduledJobsQuery = graphql(`
  query ScheduledJobs(
    $tenantId: ID!
    $agentId: ID
    $routineId: ID
    $triggerType: String
    $enabled: Boolean
    $limit: Int
  ) {
    scheduledJobs(
      tenantId: $tenantId
      agentId: $agentId
      routineId: $routineId
      triggerType: $triggerType
      enabled: $enabled
      limit: $limit
    ) {
      id
      tenantId
      triggerType
      agentId
      routineId
      teamId
      name
      description
      scheduleType
      scheduleExpression
      timezone
      enabled
      lastRunAt
      nextRunAt
      createdAt
      updatedAt
    }
  }
`);

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

export const TenantQuery = graphql(`
  query Tenant($id: ID!) {
    tenant(id: $id) {
      id
      name
      slug
      plan
      issuePrefix
      issueCounter
      createdAt
      updatedAt
    }
  }
`);

export const TenantBySlugQuery = graphql(`
  query TenantBySlug($slug: String!) {
    tenantBySlug(slug: $slug) {
      id
      name
      slug
      plan
      issuePrefix
      issueCounter
      createdAt
      updatedAt
    }
  }
`);

export const TenantMembersQuery = graphql(`
  query TenantMembers($tenantId: ID!) {
    tenantMembers(tenantId: $tenantId) {
      id
      tenantId
      principalType
      principalId
      role
      status
      createdAt
      updatedAt
    }
  }
`);

export const UpdateTenantMutation = graphql(`
  mutation UpdateTenant($id: ID!, $input: UpdateTenantInput!) {
    updateTenant(id: $id, input: $input) {
      id
      name
      plan
      issuePrefix
      updatedAt
    }
  }
`);

export const UpdateTenantSettingsMutation = graphql(`
  mutation UpdateTenantSettings(
    $tenantId: ID!
    $input: UpdateTenantSettingsInput!
  ) {
    updateTenantSettings(tenantId: $tenantId, input: $input) {
      id
      defaultModel
      budgetMonthlyCents
      autoCloseThreadMinutes
      maxAgents
      features
      updatedAt
    }
  }
`);

export const AddTenantMemberMutation = graphql(`
  mutation AddTenantMember($tenantId: ID!, $input: AddTenantMemberInput!) {
    addTenantMember(tenantId: $tenantId, input: $input) {
      id
      principalType
      principalId
      role
      status
    }
  }
`);

export const RemoveTenantMemberMutation = graphql(`
  mutation RemoveTenantMember($id: ID!) {
    removeTenantMember(id: $id)
  }
`);

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const MeQuery = graphql(`
  query Me {
    me {
      id
      tenantId
      email
      name
      image
      phone
      createdAt
      updatedAt
    }
  }
`);

export const UserQuery = graphql(`
  query User($id: ID!) {
    user(id: $id) {
      id
      tenantId
      email
      name
      image
      phone
      createdAt
      updatedAt
    }
  }
`);

export const UpdateUserMutation = graphql(`
  mutation UpdateUser($id: ID!, $input: UpdateUserInput!) {
    updateUser(id: $id, input: $input) {
      id
      name
      image
      phone
      updatedAt
    }
  }
`);

export const UpdateUserProfileMutation = graphql(`
  mutation UpdateUserProfile($userId: ID!, $input: UpdateUserProfileInput!) {
    updateUserProfile(userId: $userId, input: $input) {
      id
      displayName
      theme
      notificationPreferences
      updatedAt
    }
  }
`);

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export const ThreadsQuery = graphql(`
  query Threads(
    $tenantId: ID!
    $channel: ThreadChannel
    $agentId: ID
    $computerId: ID
    $assigneeId: ID
    $limit: Int
    $cursor: String
  ) {
    threads(
      tenantId: $tenantId
      channel: $channel
      agentId: $agentId
      computerId: $computerId
      assigneeId: $assigneeId
      limit: $limit
      cursor: $cursor
    ) {
      id
      tenantId
      agentId
      computerId
      number
      identifier
      title
      status
      lifecycleStatus
      channel
      assigneeType
      assigneeId
      assignee {
        id
        name
      }
      reporterId
      labels
      metadata
      dueAt
      closedAt
      archivedAt
      lastActivityAt
      lastTurnCompletedAt
      lastReadAt
      lastResponsePreview
      createdAt
      updatedAt
    }
  }
`);

export const ThreadQuery = graphql(`
  query Thread($id: ID!) {
    thread(id: $id) {
      id
      tenantId
      agentId
      computerId
      number
      identifier
      title
      status
      lifecycleStatus
      channel
      assigneeType
      assigneeId
      reporterId
      labels
      metadata
      dueAt
      closedAt
      messages(limit: 100) {
        edges {
          node {
            id
            role
            content
            senderType
            senderId
            createdAt
            durableArtifact {
              id
              title
              type
              status
            }
          }
        }
      }
      attachments {
        id
        name
        mimeType
        sizeBytes
        createdAt
      }
      createdAt
      updatedAt
    }
  }
`);

export const CreateThreadMutation = graphql(`
  mutation CreateThread($input: CreateThreadInput!) {
    createThread(input: $input) {
      id
      number
      title
      status
      computerId
      agentId
      createdAt
    }
  }
`);

export const UpdateThreadMutation = graphql(`
  mutation UpdateThread($id: ID!, $input: UpdateThreadInput!) {
    updateThread(id: $id, input: $input) {
      id
      title
      status
      updatedAt
    }
  }
`);

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export const OnAgentStatusChangedSubscription = graphql(`
  subscription OnAgentStatusChanged($tenantId: ID!) {
    onAgentStatusChanged(tenantId: $tenantId) {
      agentId
      tenantId
      status
      name
      updatedAt
    }
  }
`);

export const OnNewMessageSubscription = graphql(`
  subscription OnNewMessage($threadId: ID!) {
    onNewMessage(threadId: $threadId) {
      messageId
      threadId
      tenantId
      role
      content
      senderType
      senderId
      createdAt
    }
  }
`);

export const OnHeartbeatActivitySubscription = graphql(`
  subscription OnHeartbeatActivity($tenantId: ID!) {
    onHeartbeatActivity(tenantId: $tenantId) {
      heartbeatId
      tenantId
      status
      message
      createdAt
    }
  }
`);

export const OnThreadUpdatedSubscription = graphql(`
  subscription OnThreadUpdated($tenantId: ID!) {
    onThreadUpdated(tenantId: $tenantId) {
      threadId
      tenantId
      status
      title
      updatedAt
    }
  }
`);

export const OnThreadTurnUpdatedSubscription = graphql(`
  subscription OnThreadTurnUpdated($tenantId: ID!) {
    onThreadTurnUpdated(tenantId: $tenantId) {
      runId
      triggerId
      threadId
      tenantId
      status
      triggerName
      updatedAt
    }
  }
`);

export const OnInboxItemStatusChangedSubscription = graphql(`
  subscription OnInboxItemStatusChanged($tenantId: ID!) {
    onInboxItemStatusChanged(tenantId: $tenantId) {
      inboxItemId
      tenantId
      status
      title
      updatedAt
    }
  }
`);

// ---------------------------------------------------------------------------
// Inbox Items
// ---------------------------------------------------------------------------

export const InboxItemsQuery = graphql(`
  query InboxItems(
    $tenantId: ID!
    $status: InboxItemStatus
    $entityType: String
    $entityId: ID
  ) {
    inboxItems(
      tenantId: $tenantId
      status: $status
      entityType: $entityType
      entityId: $entityId
    ) {
      id
      tenantId
      requesterType
      requesterId
      type
      status
      title
      description
      entityType
      entityId
      config
      revision
      reviewNotes
      decidedBy
      decidedAt
      expiresAt
      comments {
        id
        inboxItemId
        authorType
        authorId
        content
        createdAt
      }
      links {
        id
        linkedType
        linkedId
        createdAt
      }
      linkedThreads {
        id
        number
        identifier
        title
        status
      }
      createdAt
      updatedAt
    }
  }
`);

export const InboxItemQuery = graphql(`
  query InboxItem($id: ID!) {
    inboxItem(id: $id) {
      id
      tenantId
      requesterType
      requesterId
      type
      status
      title
      description
      entityType
      entityId
      config
      revision
      reviewNotes
      decidedBy
      decidedAt
      expiresAt
      comments {
        id
        inboxItemId
        authorType
        authorId
        content
        createdAt
      }
      links {
        id
        linkedType
        linkedId
        createdAt
      }
      linkedThreads {
        id
        number
        identifier
        title
        status
      }
      createdAt
      updatedAt
    }
  }
`);

export const DecideInboxItemMutation = graphql(`
  mutation DecideInboxItem($id: ID!, $input: InboxItemDecisionInput!) {
    decideInboxItem(id: $id, input: $input) {
      id
      status
      reviewNotes
      decidedBy
      decidedAt
      updatedAt
    }
  }
`);

export const AddInboxItemCommentMutation = graphql(`
  mutation AddInboxItemComment($input: AddInboxItemCommentInput!) {
    addInboxItemComment(input: $input) {
      id
      inboxItemId
      content
      authorType
      authorId
      createdAt
    }
  }
`);

export const OnOrgUpdatedSubscription = graphql(`
  subscription OnOrgUpdated($tenantId: ID!) {
    onOrgUpdated(tenantId: $tenantId) {
      tenantId
      changeType
      entityType
      entityId
      updatedAt
    }
  }
`);

// ---------------------------------------------------------------------------
// Thread Turns (per-thread) & Artifacts
// ---------------------------------------------------------------------------

export const ThreadTurnsForThreadQuery = graphql(`
  query ThreadTurnsForThread($tenantId: ID!, $threadId: ID!, $limit: Int) {
    threadTurns(tenantId: $tenantId, threadId: $threadId, limit: $limit) {
      id
      tenantId
      agentId
      invocationSource
      triggerDetail
      triggerName
      threadId
      turnNumber
      status
      startedAt
      finishedAt
      error
      resultJson
      usageJson
      totalCost
      retryAttempt
      originTurnId
      createdAt
    }
  }
`);

export const ArtifactsForThreadQuery = graphql(`
  query ArtifactsForThread($tenantId: ID!, $threadId: ID!, $limit: Int) {
    artifacts(tenantId: $tenantId, threadId: $threadId, limit: $limit) {
      id
      tenantId
      agentId
      threadId
      title
      type
      status
      summary
      createdAt
      updatedAt
    }
  }
`);

export const ArtifactDetailQuery = graphql(`
  query ArtifactDetail($id: ID!) {
    artifact(id: $id) {
      id
      title
      type
      status
      content
      summary
      createdAt
    }
  }
`);

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export const MemoryRecordsQuery = graphql(`
  query MemoryRecords($userId: ID!, $namespace: String!) {
    memoryRecords(userId: $userId, namespace: $namespace) {
      memoryRecordId
      content {
        text
      }
      createdAt
      updatedAt
      expiresAt
      namespace
      strategyId
      # "Contributes to:" chips — Unit 8 / handoff #3. One nested resolver
      # call per record, capped at typical list size ≤50. DataLoader is a
      # future optimization if large result sets become the norm.
      wikiPages {
        id
        type
        slug
        title
      }
    }
  }
`);

export const DeleteMemoryRecordMutation = graphql(`
  mutation DeleteMemoryRecord($userId: ID!, $memoryRecordId: ID!) {
    deleteMemoryRecord(userId: $userId, memoryRecordId: $memoryRecordId)
  }
`);

export const UpdateMemoryRecordMutation = graphql(`
  mutation UpdateMemoryRecord(
    $userId: ID!
    $memoryRecordId: ID!
    $content: String!
  ) {
    updateMemoryRecord(
      userId: $userId
      memoryRecordId: $memoryRecordId
      content: $content
    )
  }
`);

// ---------------------------------------------------------------------------
// Workspace HITL Reviews
// ---------------------------------------------------------------------------

export const AgentWorkspaceReviewsQuery = graphql(`
  query AgentWorkspaceReviews(
    $tenantId: ID!
    $agentId: ID
    $responsibleUserId: ID
    $kind: WorkspaceReviewKind
    $status: String
    $limit: Int
  ) {
    agentWorkspaceReviews(
      tenantId: $tenantId
      agentId: $agentId
      responsibleUserId: $responsibleUserId
      kind: $kind
      status: $status
      limit: $limit
    ) {
      threadId
      reviewObjectKey
      targetPath
      requestedAt
      reason
      payload
      reviewEtag
      responsibleUserId
      kind
      run {
        id
        agentId
        targetPath
        status
        currentWakeupRequestId
        currentThreadTurnId
        lastEventAt
        createdAt
        updatedAt
      }
      latestEvent {
        id
        eventType
        reason
        sourceObjectKey
        payload
        createdAt
      }
    }
  }
`);

export const AgentWorkspaceReviewQuery = graphql(`
  query AgentWorkspaceReview($runId: ID!) {
    agentWorkspaceReview(runId: $runId) {
      threadId
      reviewObjectKey
      targetPath
      requestedAt
      reason
      payload
      reviewBody
      reviewEtag
      reviewMissing
      responsibleUserId
      kind
      proposedChanges {
        path
        kind
        summary
        diff
        before
        after
      }
      run {
        id
        tenantId
        agentId
        targetPath
        status
        currentWakeupRequestId
        currentThreadTurnId
        lastEventAt
        createdAt
        updatedAt
      }
      events {
        id
        eventType
        reason
        sourceObjectKey
        payload
        createdAt
      }
      decisionEvents {
        id
        eventType
        reason
        actorType
        actorId
        payload
        createdAt
      }
    }
  }
`);

export const AcceptAgentWorkspaceReviewMutation = graphql(`
  mutation AcceptAgentWorkspaceReview(
    $runId: ID!
    $input: AgentWorkspaceReviewDecisionInput
  ) {
    acceptAgentWorkspaceReview(runId: $runId, input: $input) {
      id
      status
      currentWakeupRequestId
      updatedAt
    }
  }
`);

export const CancelAgentWorkspaceReviewMutation = graphql(`
  mutation CancelAgentWorkspaceReview(
    $runId: ID!
    $input: AgentWorkspaceReviewDecisionInput
  ) {
    cancelAgentWorkspaceReview(runId: $runId, input: $input) {
      id
      status
      updatedAt
    }
  }
`);

export const ResumeAgentWorkspaceRunMutation = graphql(`
  mutation ResumeAgentWorkspaceRun(
    $runId: ID!
    $input: AgentWorkspaceReviewDecisionInput
  ) {
    resumeAgentWorkspaceRun(runId: $runId, input: $input) {
      id
      status
      currentWakeupRequestId
      updatedAt
    }
  }
`);

// ---------------------------------------------------------------------------
// Push Notifications (raw gql — no codegen needed)
// ---------------------------------------------------------------------------

export const RegisterPushTokenMutation = gql`
  mutation RegisterPushToken($input: RegisterPushTokenInput!) {
    registerPushToken(input: $input)
  }
`;

export const UnregisterPushTokenMutation = gql`
  mutation UnregisterPushToken($token: String!) {
    unregisterPushToken(token: $token)
  }
`;

// ---------------------------------------------------------------------------
// Agents with sub-agents (raw gql — avoids codegen recursive type issue)
// ---------------------------------------------------------------------------

export const AgentWorkspacesQuery = gql`
  query AgentWorkspaces($agentId: ID!) {
    agentWorkspaces(agentId: $agentId) {
      slug
      name
      purpose
    }
  }
`;

// ---------------------------------------------------------------------------
// Quick Actions (per-user saved prompts)
// ---------------------------------------------------------------------------

// NOTE: scope arg + field were added to these docs when PR #91 landed
// the backend work but removed locally until the graphql-http Lambda is
// deployed with the new schema. Put them back after deploy lands.
export const UserQuickActionsQuery = gql`
  query UserQuickActions($tenantId: ID!) {
    userQuickActions(tenantId: $tenantId) {
      id
      userId
      tenantId
      title
      prompt
      workspaceAgentId
      sortOrder
      createdAt
      updatedAt
    }
  }
`;

export const CreateQuickActionMutation = gql`
  mutation CreateQuickAction($input: CreateQuickActionInput!) {
    createQuickAction(input: $input) {
      id
      userId
      tenantId
      title
      prompt
      workspaceAgentId
      sortOrder
      createdAt
      updatedAt
    }
  }
`;

export const UpdateQuickActionMutation = gql`
  mutation UpdateQuickAction($id: ID!, $input: UpdateQuickActionInput!) {
    updateQuickAction(id: $id, input: $input) {
      id
      userId
      tenantId
      title
      prompt
      workspaceAgentId
      sortOrder
      createdAt
      updatedAt
    }
  }
`;

export const DeleteQuickActionMutation = gql`
  mutation DeleteQuickAction($id: ID!) {
    deleteQuickAction(id: $id)
  }
`;

export const ReorderQuickActionsMutation = gql`
  mutation ReorderQuickActions($input: ReorderQuickActionsInput!) {
    reorderQuickActions(input: $input) {
      id
      sortOrder
    }
  }
`;

// ---------------------------------------------------------------------------
// Recipes (PRD-26)
// ---------------------------------------------------------------------------

export const RefreshGenUIMutation = gql`
  mutation RefreshGenUI($messageId: ID!, $toolIndex: Int!) {
    refreshGenUI(messageId: $messageId, toolIndex: $toolIndex) {
      id
      toolResults
    }
  }
`;

export const CreateRecipeMutation = gql`
  mutation CreateRecipe($input: CreateRecipeInput!) {
    createRecipe(input: $input) {
      id
      title
      genuiType
    }
  }
`;
