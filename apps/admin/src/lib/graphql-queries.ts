import { graphql } from "@/gql";
import { gql } from "@urql/core";

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export const AgentsListQuery = graphql(`
  query AgentsList($tenantId: ID!) {
    agents: allTenantAgents(tenantId: $tenantId) {
      id
      name
      slug
      role
      type
      status
      runtime
      templateId
      agentTemplate {
        id
        name
        slug
        model
      }
      avatarUrl
      lastHeartbeatAt
      adapterType
      humanPairId
      humanPair {
        id
        name
        email
      }
      budgetPolicy {
        id
        limitUsd
        actionOnExceed
      }
      createdAt
    }
    modelCatalog {
      modelId
      displayName
    }
  }
`);

export const AgentDetailQuery = gql`
  query AgentProfileDetail($id: ID!) {
    agent(id: $id) {
      id
      tenantId
      name
      slug
      role
      type
      status
      runtime
      templateId
      agentTemplate {
        id
        name
        slug
        model
        runtime
        guardrailId
        blockedTools
        skills
        browser
      }
      systemPrompt
      avatarUrl
      lastHeartbeatAt
      runtimeConfig
      adapterType
      adapterConfig
      humanPairId
      humanPair {
        id
        name
        email
      }
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
        enabled
        config
        permissions
      }
      budgetPolicy {
        id
        limitUsd
        actionOnExceed
        enabled
      }
      parentAgentId
      subAgents {
        id
        name
        slug
        role
        status
      }
      createdAt
      updatedAt
    }
  }
`;

export const CreateAgentMutation = graphql(`
  mutation CreateAgent($input: CreateAgentInput!) {
    createAgent(input: $input) {
      id
      name
      role
      type
      status
      runtime
      templateId
      createdAt
    }
  }
`);

// Agent knowledge bases — uses gql (not codegen) since the schema types are new
export const AgentKnowledgeBasesQuery = gql`
  query AgentKnowledgeBases($id: ID!) {
    agent(id: $id) {
      knowledgeBases {
        id
        knowledgeBaseId
        enabled
        knowledgeBase {
          id
          name
          description
          status
        }
      }
    }
  }
`;

export const UpdateAgentMutation = graphql(`
  mutation UpdateAgent($id: ID!, $input: UpdateAgentInput!) {
    updateAgent(id: $id, input: $input) {
      id
      name
      role
      type
      templateId
      runtime
      systemPrompt
      adapterType
      updatedAt
    }
  }
`);

export const UpdateAgentRuntimeMutation = graphql(`
  mutation UpdateAgentRuntime($id: ID!, $runtime: AgentRuntime!) {
    updateAgentRuntime(id: $id, runtime: $runtime) {
      id
      runtime
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
      limitUsd
      actionOnExceed
      enabled
    }
  }
`);

export const DeleteAgentBudgetPolicyMutation = graphql(`
  mutation DeleteAgentBudgetPolicy($agentId: ID!) {
    deleteAgentBudgetPolicy(agentId: $agentId)
  }
`);

// ---------------------------------------------------------------------------
// Computers
// ---------------------------------------------------------------------------

export const ComputersListQuery = graphql(`
  query ComputersList($tenantId: ID!) {
    computers(tenantId: $tenantId) {
      id
      tenantId
      ownerUserId
      owner {
        id
        name
        email
      }
      templateId
      template {
        id
        name
        slug
        templateKind
        model
      }
      sourceAgent {
        id
        name
        slug
      }
      name
      slug
      status
      desiredRuntimeStatus
      runtimeStatus
      liveWorkspaceRoot
      efsAccessPointId
      ecsServiceName
      lastHeartbeatAt
      lastActiveAt
      budgetMonthlyCents
      spentMonthlyCents
      budgetPausedAt
      budgetPausedReason
      migratedFromAgentId
      migrationMetadata
      createdAt
      updatedAt
    }
  }
`);

export const ComputerDetailQuery = graphql(`
  query ComputerDetail($id: ID!) {
    computer(id: $id) {
      id
      tenantId
      ownerUserId
      owner {
        id
        name
        email
      }
      templateId
      template {
        id
        name
        slug
        templateKind
        model
      }
      sourceAgent {
        id
        name
        slug
      }
      name
      slug
      status
      desiredRuntimeStatus
      runtimeStatus
      runtimeConfig
      liveWorkspaceRoot
      efsAccessPointId
      ecsServiceName
      lastHeartbeatAt
      lastActiveAt
      budgetMonthlyCents
      spentMonthlyCents
      budgetPausedAt
      budgetPausedReason
      migratedFromAgentId
      migrationMetadata
      createdBy
      createdAt
      updatedAt
    }
  }
`);

export const MyComputerQuery = graphql(`
  query MyComputer {
    myComputer {
      id
      name
      slug
      status
      desiredRuntimeStatus
      runtimeStatus
      liveWorkspaceRoot
      lastHeartbeatAt
      lastActiveAt
    }
  }
`);

export const CreateComputerMutation = graphql(`
  mutation CreateComputer($input: CreateComputerInput!) {
    createComputer(input: $input) {
      id
      name
      slug
      status
      desiredRuntimeStatus
      runtimeStatus
      tenantId
      ownerUserId
      templateId
      budgetMonthlyCents
      createdAt
      updatedAt
    }
  }
`);

export const UpdateComputerMutation = graphql(`
  mutation UpdateComputer($id: ID!, $input: UpdateComputerInput!) {
    updateComputer(id: $id, input: $input) {
      id
      name
      status
      desiredRuntimeStatus
      runtimeStatus
      liveWorkspaceRoot
      efsAccessPointId
      ecsServiceName
      lastHeartbeatAt
      lastActiveAt
      budgetMonthlyCents
      spentMonthlyCents
      budgetPausedReason
      updatedAt
    }
  }
`);

export const ComputerTasksQuery = graphql(`
  query ComputerTasks($computerId: ID!, $limit: Int) {
    computerTasks(computerId: $computerId, limit: $limit) {
      id
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
  }
`);

export const ComputerThreadsQuery = graphql(`
  query ComputerThreads($tenantId: ID!, $computerId: ID!, $limit: Int) {
    threads(tenantId: $tenantId, computerId: $computerId, limit: $limit) {
      id
      number
      identifier
      title
      status
      channel
      costSummary
      lastResponsePreview
      createdAt
      updatedAt
    }
  }
`);

export const ComputerEventsQuery = graphql(`
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
`);

export const EnqueueComputerTaskMutation = graphql(`
  mutation EnqueueComputerTask($input: EnqueueComputerTaskInput!) {
    enqueueComputerTask(input: $input) {
      id
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
  }
`);

// ---------------------------------------------------------------------------
// Workspace orchestration reviews — admin GraphQL bindings retired in U5
// of the workspace-reviews routing refactor. System-agent reviews now
// surface in Inbox; paired-human reviews live on mobile. Mobile retains
// its own copies of the agentWorkspaceReviews query and review mutations.
// See docs/plans/2026-04-28-004-...
// ---------------------------------------------------------------------------

export const ModelCatalogQuery = graphql(`
  query ModelCatalog {
    modelCatalog {
      id
      modelId
      displayName
      provider
      inputCostPerMillion
      outputCostPerMillion
    }
  }
`);

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

export const ConnectorsListQuery = graphql(`
  query ConnectorsList($filter: ConnectorFilter, $limit: Int, $cursor: String) {
    connectors(filter: $filter, limit: $limit, cursor: $cursor) {
      id
      tenantId
      type
      name
      description
      status
      connectionId
      config
      dispatchTargetType
      dispatchTargetId
      lastPollAt
      nextPollAt
      enabled
      createdByType
      createdById
      createdAt
      updatedAt
    }
  }
`);

export const CreateConnectorMutation = graphql(`
  mutation CreateConnector($input: CreateConnectorInput!) {
    createConnector(input: $input) {
      id
      status
      updatedAt
    }
  }
`);

export const UpdateConnectorMutation = graphql(`
  mutation UpdateConnector($id: ID!, $input: UpdateConnectorInput!) {
    updateConnector(id: $id, input: $input) {
      id
      status
      updatedAt
    }
  }
`);

export const PauseConnectorMutation = graphql(`
  mutation PauseConnector($id: ID!) {
    pauseConnector(id: $id) {
      id
      status
      updatedAt
    }
  }
`);

export const ResumeConnectorMutation = graphql(`
  mutation ResumeConnector($id: ID!) {
    resumeConnector(id: $id) {
      id
      status
      updatedAt
    }
  }
`);

export const ArchiveConnectorMutation = graphql(`
  mutation ArchiveConnector($id: ID!) {
    archiveConnector(id: $id) {
      id
      status
      updatedAt
    }
  }
`);

export const RunConnectorNowMutation = graphql(`
  mutation RunConnectorNow($id: ID!) {
    runConnectorNow(id: $id) {
      connectorId
      results {
        status
        connectorId
        executionId
        externalRef
        threadId
        messageId
        computerId
        computerTaskId
        targetType
        reason
        error
      }
    }
  }
`);

export const ConnectorExecutionsListQuery = graphql(`
  query ConnectorExecutionsList(
    $connectorId: ID
    $status: ConnectorExecutionState
    $limit: Int
    $cursor: String
  ) {
    connectorExecutions(
      connectorId: $connectorId
      status: $status
      limit: $limit
      cursor: $cursor
    ) {
      id
      tenantId
      connectorId
      externalRef
      currentState
      startedAt
      finishedAt
      errorClass
      outcomePayload
      retryAttempt
      createdAt
    }
  }
`);

export const ConnectorRunLifecyclesQuery = gql`
  query ConnectorRunLifecycles($connectorId: ID, $limit: Int, $cursor: String) {
    connectorRunLifecycles(
      connectorId: $connectorId
      limit: $limit
      cursor: $cursor
    ) {
      execution {
        id
        tenantId
        connectorId
        externalRef
        currentState
        startedAt
        finishedAt
        errorClass
        outcomePayload
        retryAttempt
        createdAt
      }
      connector {
        id
        type
        name
        status
      }
      computerTask {
        id
        status
        output
        error
        completedAt
        createdAt
      }
      delegation {
        id
        status
        agentId
        outputArtifacts
        result
        error
        completedAt
        createdAt
      }
      threadTurn {
        id
        threadId
        agentId
        status
        resultJson
        error
        errorCode
        startedAt
        finishedAt
        createdAt
      }
      threadId
      messageId
      computerId
    }
  }
`;

// ---------------------------------------------------------------------------
// Email Channel (PRD-14)
// ---------------------------------------------------------------------------

export const AgentEmailCapabilityQuery = gql`
  query AgentEmailCapability($agentId: ID!) {
    agentEmailCapability(agentId: $agentId) {
      id
      agentId
      enabled
      emailAddress
      vanityAddress
      allowedSenders
    }
  }
`;

export const UpdateAgentEmailAllowlistMutation = gql`
  mutation UpdateAgentEmailAllowlist(
    $agentId: ID!
    $allowedSenders: [String!]!
  ) {
    updateAgentEmailAllowlist(
      agentId: $agentId
      allowedSenders: $allowedSenders
    ) {
      id
      config
      enabled
    }
  }
`;

export const ToggleAgentEmailChannelMutation = gql`
  mutation ToggleAgentEmailChannel($agentId: ID!, $enabled: Boolean!) {
    toggleAgentEmailChannel(agentId: $agentId, enabled: $enabled) {
      id
      enabled
    }
  }
`;

export const ClaimVanityEmailAddressMutation = gql`
  mutation ClaimVanityEmailAddress($agentId: ID!, $localPart: String!) {
    claimVanityEmailAddress(agentId: $agentId, localPart: $localPart) {
      id
      config
    }
  }
`;

export const ReleaseVanityEmailAddressMutation = gql`
  mutation ReleaseVanityEmailAddress($agentId: ID!) {
    releaseVanityEmailAddress(agentId: $agentId) {
      id
      config
    }
  }
`;

// ---------------------------------------------------------------------------
// Knowledge Bases (PRD-13)
// ---------------------------------------------------------------------------

export const KnowledgeBasesListQuery = gql`
  query KnowledgeBasesList($tenantId: ID!) {
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

export const KnowledgeBaseDetailQuery = gql`
  query KnowledgeBaseDetail($id: ID!) {
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

export const CreateKnowledgeBaseMutation = gql`
  mutation CreateKnowledgeBase($input: CreateKnowledgeBaseInput!) {
    createKnowledgeBase(input: $input) {
      id
      name
      slug
      status
      createdAt
    }
  }
`;

export const UpdateKnowledgeBaseMutation = gql`
  mutation UpdateKnowledgeBase($id: ID!, $input: UpdateKnowledgeBaseInput!) {
    updateKnowledgeBase(id: $id, input: $input) {
      id
      name
      description
      updatedAt
    }
  }
`;

export const DeleteKnowledgeBaseMutation = gql`
  mutation DeleteKnowledgeBase($id: ID!) {
    deleteKnowledgeBase(id: $id)
  }
`;

export const SyncKnowledgeBaseMutation = gql`
  mutation SyncKnowledgeBase($id: ID!) {
    syncKnowledgeBase(id: $id) {
      id
      status
      lastSyncStatus
      updatedAt
    }
  }
`;

export const SetAgentKnowledgeBasesMutation = gql`
  mutation SetAgentKnowledgeBases(
    $agentId: ID!
    $knowledgeBases: [AgentKnowledgeBaseInput!]!
  ) {
    setAgentKnowledgeBases(agentId: $agentId, knowledgeBases: $knowledgeBases) {
      id
      knowledgeBaseId
      enabled
      knowledgeBase {
        id
        name
        description
        status
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export const ThreadsListQuery = graphql(`
  query ThreadsList($tenantId: ID!, $status: ThreadStatus, $search: String) {
    threads(tenantId: $tenantId, status: $status, search: $search) {
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
  }
`);

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

export const ThreadDetailQuery = graphql(`
  query ThreadDetail($id: ID!) {
    thread(id: $id) {
      id
      tenantId
      number
      identifier
      title
      status
      lifecycleStatus
      assigneeType
      assigneeId
      agentId
      computerId
      agent {
        id
        name
        avatarUrl
      }
      channel
      messages(limit: 50) {
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
      costSummary
      checkoutRunId
      checkoutVersion
      billingCode
      labels
      metadata
      dueAt
      startedAt
      completedAt
      cancelledAt
      closedAt
      createdByType
      createdById
      attachments {
        id
        threadId
        name
        s3Key
        mimeType
        sizeBytes
        uploadedBy
        createdAt
      }
      createdAt
      updatedAt
    }
  }
`);

export const UpdateThreadMutation = graphql(`
  mutation UpdateThread($id: ID!, $input: UpdateThreadInput!) {
    updateThread(id: $id, input: $input) {
      id
      status
      title
      assigneeType
      assigneeId
      billingCode
      dueAt
      updatedAt
    }
  }
`);

export const DeleteThreadMutation = graphql(`
  mutation DeleteThread($id: ID!) {
    deleteThread(id: $id)
  }
`);

export const CheckoutThreadMutation = graphql(`
  mutation CheckoutThread($id: ID!, $input: CheckoutThreadInput!) {
    checkoutThread(id: $id, input: $input) {
      id
      checkoutRunId
      checkoutVersion
    }
  }
`);

export const ReleaseThreadMutation = graphql(`
  mutation ReleaseThread($id: ID!, $input: ReleaseThreadInput!) {
    releaseThread(id: $id, input: $input) {
      id
      checkoutRunId
      status
    }
  }
`);

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export const TeamsListQuery = graphql(`
  query TeamsList($tenantId: ID!) {
    teams(tenantId: $tenantId) {
      id
      name
      description
      type
      status
      budgetMonthlyCents
      agents {
        id
        agentId
        agent {
          id
          name
          status
          avatarUrl
        }
        role
      }
      users {
        id
        userId
        role
      }
      createdAt
    }
  }
`);

export const TeamDetailQuery = graphql(`
  query TeamDetail($id: ID!) {
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
        agent {
          id
          name
          role
          status
          avatarUrl
        }
        role
        createdAt
      }
      users {
        id
        userId
        user {
          id
          name
          email
        }
        role
        createdAt
      }
      createdAt
      updatedAt
    }
  }
`);

// ---------------------------------------------------------------------------
// Routines
// ---------------------------------------------------------------------------

export const RoutinesListQuery = graphql(`
  query RoutinesList($tenantId: ID!) {
    routines(tenantId: $tenantId) {
      id
      name
      description
      status
      lastRunAt
      engine
      createdAt
    }
  }
`);

export const RoutineDetailQuery = graphql(`
  query RoutineDetail($id: ID!) {
    routine(id: $id) {
      id
      tenantId
      name
      description
      type
      status
      schedule
      engine
      currentVersion
      config
      lastRunAt
      nextRunAt
      agentId
      agent {
        id
        name
        avatarUrl
      }
      teamId
      team {
        id
        name
      }
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

// Phase D U13: admin createRoutine mutation. Mirrors mobile's
// useCreateRoutine — same Phase B U7 input shape (asl + markdownSummary
// + stepManifest required since the publish flow went live).
export const CreateRoutineMutation = graphql(`
  mutation CreateRoutine($input: CreateRoutineInput!) {
    createRoutine(input: $input) {
      id
      name
      currentVersion
    }
  }
`);

export const PlanRoutineDraftMutation = graphql(`
  mutation PlanRoutineDraft($input: PlanRoutineDraftInput!) {
    planRoutineDraft(input: $input) {
      title
      description
      kind
      asl
      markdownSummary
      stepManifest
      steps {
        nodeId
        recipeId
        recipeName
        label
        args
        configFields {
          key
          label
          value
          inputType
          control
          required
          editable
          options
          placeholder
          helpText
          min
          max
          pattern
        }
      }
    }
  }
`);

export const RoutineRecipeCatalogQuery = graphql(`
  query RoutineRecipeCatalog($tenantId: ID!) {
    routineRecipeCatalog(tenantId: $tenantId) {
      id
      displayName
      description
      category
      hitlCapable
      defaultArgs
      configFields {
        key
        label
        value
        inputType
        control
        required
        editable
        options
        placeholder
        helpText
        min
        max
        pattern
      }
    }
  }
`);

// ---------------------------------------------------------------------------
// Tenant Credentials
// ---------------------------------------------------------------------------

export const TenantCredentialsQuery = graphql(`
  query TenantCredentials($tenantId: ID!, $status: TenantCredentialStatus) {
    tenantCredentials(tenantId: $tenantId, status: $status) {
      id
      tenantId
      displayName
      slug
      kind
      status
      metadataJson
      schemaJson
      eventbridgeConnectionArn
      lastUsedAt
      lastValidatedAt
      createdAt
      updatedAt
      deletedAt
    }
  }
`);

export const CredentialRoutineUsageQuery = graphql(`
  query CredentialRoutineUsage($tenantId: ID!) {
    routines(tenantId: $tenantId) {
      id
      name
      status
      config
      engine
      updatedAt
    }
  }
`);

export const CreateTenantCredentialMutation = graphql(`
  mutation CreateTenantCredential($input: CreateTenantCredentialInput!) {
    createTenantCredential(input: $input) {
      id
      displayName
      slug
      kind
      status
      metadataJson
      eventbridgeConnectionArn
      lastValidatedAt
      createdAt
      updatedAt
    }
  }
`);

export const UpdateTenantCredentialMutation = graphql(`
  mutation UpdateTenantCredential(
    $id: ID!
    $input: UpdateTenantCredentialInput!
  ) {
    updateTenantCredential(id: $id, input: $input) {
      id
      displayName
      slug
      status
      metadataJson
      updatedAt
    }
  }
`);

export const RotateTenantCredentialMutation = graphql(`
  mutation RotateTenantCredential($input: RotateTenantCredentialInput!) {
    rotateTenantCredential(input: $input) {
      id
      status
      lastValidatedAt
      updatedAt
    }
  }
`);

export const DeleteTenantCredentialMutation = graphql(`
  mutation DeleteTenantCredential($id: ID!) {
    deleteTenantCredential(id: $id)
  }
`);

export const TriggerRoutineRunMutation = graphql(`
  mutation TriggerRoutineRun($routineId: ID!, $input: AWSJSON) {
    triggerRoutineRun(routineId: $routineId, input: $input) {
      id
      status
      triggerSource
      startedAt
    }
  }
`);

export const RebuildRoutineVersionMutation = graphql(`
  mutation RebuildRoutineVersion($input: RebuildRoutineVersionInput!) {
    rebuildRoutineVersion(input: $input) {
      id
      versionNumber
    }
  }
`);

export const RoutineDefinitionQuery = graphql(`
  query RoutineDefinition($routineId: ID!) {
    routineDefinition(routineId: $routineId) {
      routineId
      currentVersion
      versionId
      title
      description
      kind
      steps {
        nodeId
        recipeId
        recipeName
        label
        args
        configFields {
          key
          label
          value
          inputType
          control
          required
          editable
          options
          placeholder
          helpText
          min
          max
          pattern
        }
      }
    }
  }
`);

export const RoutineDefinitionArtifactsQuery = graphql(`
  query RoutineDefinitionArtifacts($routineId: ID!) {
    routineDefinition(routineId: $routineId) {
      routineId
      versionId
      aslJson
      markdownSummary
      stepManifestJson
    }
  }
`);

export const UpdateRoutineDefinitionMutation = graphql(`
  mutation UpdateRoutineDefinition($input: UpdateRoutineDefinitionInput!) {
    updateRoutineDefinition(input: $input) {
      routineId
      currentVersion
      versionId
      description
      steps {
        nodeId
        args
        configFields {
          key
          value
          editable
        }
      }
    }
  }
`);

// Phase D U13: run-detail surface (plan
// docs/plans/2026-05-01-007-feat-routines-phase-d-ui-plan.md §U13).
// One round-trip pulls execution metadata + step events + the routine's
// latest ASL version (markdown + step manifest) so ExecutionGraph can
// render before any step events arrive.

// Phase D U14: paginated executions list for the routine detail page
// (plan docs/plans/2026-05-01-007-feat-routines-phase-d-ui-plan.md §U14).
// Status filter is optional; cursor + limit drive started_at-keyed paging.
export const RoutineExecutionsListQuery = graphql(`
  query RoutineExecutionsList(
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
  query RoutineExecutionDetail($id: ID!) {
    routineExecution(id: $id) {
      id
      tenantId
      routineId
      stateMachineArn
      aliasArn
      versionArn
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
        aslJson
        markdownSummary
        stepManifestJson
      }
      createdAt
    }
  }
`);

export const RoutineAslVersionDetailQuery = graphql(`
  query RoutineAslVersionDetail($id: ID!) {
    routineAslVersion(id: $id) {
      id
      versionNumber
      aslJson
      markdownSummary
      stepManifestJson
      createdAt
    }
  }
`);

// ---------------------------------------------------------------------------
// Inbox Items
// ---------------------------------------------------------------------------

export const InboxItemsListQuery = graphql(`
  query InboxItemsList($tenantId: ID!, $status: InboxItemStatus) {
    inboxItems(tenantId: $tenantId, status: $status) {
      id
      type
      status
      title
      description
      requesterType
      requesterId
      entityType
      entityId
      revision
      expiresAt
      createdAt
      updatedAt
    }
  }
`);

export const InboxItemDetailQuery = graphql(`
  query InboxItemDetail($id: ID!) {
    inboxItem(id: $id) {
      id
      tenantId
      type
      status
      title
      description
      requesterType
      requesterId
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
        authorType
        authorId
        content
        createdAt
      }
      links {
        id
        linkedType
        linkedId
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

export const ApproveInboxItemMutation = graphql(`
  mutation ApproveInboxItem($id: ID!, $input: ApproveInboxItemInput) {
    approveInboxItem(id: $id, input: $input) {
      id
      status
      reviewNotes
      decidedAt
      updatedAt
    }
  }
`);

export const RejectInboxItemMutation = graphql(`
  mutation RejectInboxItem($id: ID!, $input: RejectInboxItemInput) {
    rejectInboxItem(id: $id, input: $input) {
      id
      status
      reviewNotes
      decidedAt
      updatedAt
    }
  }
`);

export const RequestRevisionMutation = graphql(`
  mutation RequestRevision($id: ID!, $input: RequestRevisionInput!) {
    requestRevision(id: $id, input: $input) {
      id
      status
      reviewNotes
      updatedAt
    }
  }
`);

export const ResubmitInboxItemMutation = graphql(`
  mutation ResubmitInboxItem($id: ID!, $input: ResubmitInboxItemInput) {
    resubmitInboxItem(id: $id, input: $input) {
      id
      status
      revision
      updatedAt
    }
  }
`);

export const AddInboxItemCommentMutation = graphql(`
  mutation AddInboxItemComment($input: AddInboxItemCommentInput!) {
    addInboxItemComment(input: $input) {
      id
      authorType
      authorId
      content
      createdAt
    }
  }
`);

export const ActivityLogQuery = graphql(`
  query ActivityLog(
    $tenantId: ID!
    $entityType: String
    $entityId: ID
    $limit: Int
  ) {
    activityLog(
      tenantId: $tenantId
      entityType: $entityType
      entityId: $entityId
      limit: $limit
    ) {
      id
      actorType
      actorId
      action
      entityType
      entityId
      changes
      createdAt
    }
  }
`);

// ---------------------------------------------------------------------------
// Tenant
// ---------------------------------------------------------------------------

export const TenantDetailQuery = graphql(`
  query TenantDetail($id: ID!) {
    tenant(id: $id) {
      id
      name
      slug
      plan
      issuePrefix
      issueCounter
      settings {
        id
        defaultModel
        budgetMonthlyCents
        autoCloseThreadMinutes
        maxAgents
        features
      }
      createdAt
      updatedAt
    }
  }
`);

// ---------------------------------------------------------------------------
// Deployment Status
// ---------------------------------------------------------------------------

export const DeploymentStatusQuery = graphql(`
  query DeploymentStatus {
    deploymentStatus {
      stage
      source
      region
      accountId
      bucketName
      databaseEndpoint
      ecrUrl
      adminUrl
      docsUrl
      apiEndpoint
      appsyncUrl
      appsyncRealtimeUrl
      hindsightEndpoint
      agentcoreStatus
      hindsightEnabled
      managedMemoryEnabled
    }
  }
`);

// ---------------------------------------------------------------------------
// Tenant Members (Humans)
// ---------------------------------------------------------------------------

export const TenantMembersListQuery = graphql(`
  query TenantMembersList($tenantId: ID!) {
    tenantMembers(tenantId: $tenantId) {
      id
      tenantId
      principalType
      principalId
      role
      status
      user {
        id
        name
        email
        image
      }
      agent {
        id
        name
        status
        avatarUrl
      }
      createdAt
      updatedAt
    }
  }
`);

export const InviteMemberMutation = graphql(`
  mutation InviteMember($tenantId: ID!, $input: InviteMemberInput!) {
    inviteMember(tenantId: $tenantId, input: $input) {
      id
      tenantId
      principalType
      principalId
      role
      status
      user {
        id
        name
        email
      }
      createdAt
    }
  }
`);

export const UpdateUserMutation = graphql(`
  mutation UpdateUser($id: ID!, $input: UpdateUserInput!) {
    updateUser(id: $id, input: $input) {
      id
      tenantId
      email
      name
      image
      phone
      updatedAt
    }
  }
`);

export const UpdateTenantMemberMutation = graphql(`
  mutation UpdateTenantMember($id: ID!, $input: UpdateTenantMemberInput!) {
    updateTenantMember(id: $id, input: $input) {
      id
      tenantId
      principalType
      principalId
      role
      status
      updatedAt
    }
  }
`);

export const RemoveTenantMemberMutation = graphql(`
  mutation RemoveTenantMember($id: ID!) {
    removeTenantMember(id: $id)
  }
`);

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Agent API Keys (admin management, still via GraphQL)
// ---------------------------------------------------------------------------

export const AgentApiKeysQuery = graphql(`
  query AgentApiKeys($agentId: ID!) {
    agentApiKeys(agentId: $agentId) {
      id
      tenantId
      agentId
      name
      keyPrefix
      lastUsedAt
      revokedAt
      createdAt
    }
  }
`);

export const CreateAgentApiKeyMutation = graphql(`
  mutation CreateAgentApiKey($input: CreateAgentApiKeyInput!) {
    createAgentApiKey(input: $input) {
      apiKey {
        id
        agentId
        name
        keyPrefix
        createdAt
      }
      plainTextKey
    }
  }
`);

export const RevokeAgentApiKeyMutation = graphql(`
  mutation RevokeAgentApiKey($id: ID!) {
    revokeAgentApiKey(id: $id) {
      id
      revokedAt
    }
  }
`);

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Cost Management (PRD-02)
// ---------------------------------------------------------------------------

// Cost queries use `gql` directly (not codegen `graphql()`) because the
// AppSync schema types are new and codegen hasn't been regenerated yet.
// Once codegen runs with the deployed schema, these can switch to `graphql()`.

export const CostSummaryQuery = gql`
  query CostSummary($tenantId: ID!, $from: AWSDateTime, $to: AWSDateTime) {
    costSummary(tenantId: $tenantId, from: $from, to: $to) {
      totalUsd
      llmUsd
      computeUsd
      toolsUsd
      evalUsd
      totalInputTokens
      totalOutputTokens
      eventCount
      periodStart
      periodEnd
    }
  }
`;

export const CostByAgentQuery = gql`
  query CostByAgent($tenantId: ID!, $from: AWSDateTime, $to: AWSDateTime) {
    costByAgent(tenantId: $tenantId, from: $from, to: $to) {
      agentId
      agentName
      totalUsd
      eventCount
    }
  }
`;

export const CostByModelQuery = gql`
  query CostByModel($tenantId: ID!, $from: AWSDateTime, $to: AWSDateTime) {
    costByModel(tenantId: $tenantId, from: $from, to: $to) {
      model
      totalUsd
      inputTokens
      outputTokens
    }
  }
`;

export const CostTimeSeriesQuery = gql`
  query CostTimeSeries($tenantId: ID!, $days: Int) {
    costTimeSeries(tenantId: $tenantId, days: $days) {
      day
      totalUsd
      llmUsd
      computeUsd
      toolsUsd
      eventCount
    }
  }
`;

export const BudgetStatusQuery = gql`
  query BudgetStatus($tenantId: ID!) {
    budgetStatus(tenantId: $tenantId) {
      policy {
        id
        tenantId
        agentId
        scope
        period
        limitUsd
        actionOnExceed
        enabled
      }
      spentUsd
      remainingUsd
      percentUsed
      status
    }
  }
`;

export const UpsertBudgetPolicyMutation = gql`
  mutation UpsertBudgetPolicy(
    $tenantId: ID!
    $input: UpsertBudgetPolicyInput!
  ) {
    upsertBudgetPolicy(tenantId: $tenantId, input: $input) {
      id
      scope
      limitUsd
      actionOnExceed
      enabled
    }
  }
`;

export const DeleteBudgetPolicyMutation = gql`
  mutation DeleteBudgetPolicy($id: ID!) {
    deleteBudgetPolicy(id: $id)
  }
`;

export const UnpauseAgentMutation = gql`
  mutation UnpauseAgent($agentId: ID!) {
    unpauseAgent(agentId: $agentId) {
      id
      name
    }
  }
`;

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const NotifyAgentStatusMutation = graphql(`
  mutation NotifyAgentStatus(
    $agentId: ID!
    $tenantId: ID!
    $status: String!
    $name: String!
  ) {
    notifyAgentStatus(
      agentId: $agentId
      tenantId: $tenantId
      status: $status
      name: $name
    ) {
      agentId
      tenantId
      status
      name
      updatedAt
    }
  }
`);

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

export const ThreadTurnsQuery = graphql(`
  query ThreadTurns($tenantId: ID!, $limit: Int) {
    threadTurns(tenantId: $tenantId, limit: $limit) {
      id
      tenantId
      triggerId
      threadId
      agentId
      invocationSource
      triggerDetail
      status
      startedAt
      finishedAt
      error
      resultJson
      usageJson
      triggerName
      totalCost
      createdAt
    }
  }
`);

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

export const ThreadTurnEventsQuery = graphql(`
  query ThreadTurnEvents($runId: ID!, $limit: Int) {
    threadTurnEvents(runId: $runId, limit: $limit) {
      id
      runId
      agentId
      seq
      eventType
      stream
      level
      message
      payload
      createdAt
    }
  }
`);

export const OnThreadTurnUpdatedSubscription = graphql(`
  subscription OnThreadTurnUpdated($tenantId: ID!) {
    onThreadTurnUpdated(tenantId: $tenantId) {
      runId
      triggerId
      tenantId
      threadId
      agentId
      status
      triggerName
      updatedAt
    }
  }
`);

export const ActiveTurnsQuery = gql`
  query ActiveTurns($tenantId: ID!) {
    running: threadTurns(tenantId: $tenantId, status: "running") {
      id
      tenantId
      threadId
      agentId
      status
      startedAt
    }
    queued: threadTurns(tenantId: $tenantId, status: "queued") {
      id
      tenantId
      threadId
      agentId
      status
      startedAt
    }
    queuedWakeups(tenantId: $tenantId) {
      id
      tenantId
      agentId
      source
      triggerDetail
      status
    }
  }
`;

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

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

export const ArtifactsListQuery = gql`
  query ArtifactsList(
    $tenantId: ID!
    $threadId: ID
    $agentId: ID
    $type: ArtifactType
    $status: ArtifactStatus
    $limit: Int
  ) {
    artifacts(
      tenantId: $tenantId
      threadId: $threadId
      agentId: $agentId
      type: $type
      status: $status
      limit: $limit
    ) {
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
`;

export const ArtifactDetailQuery = gql`
  query ArtifactDetail($id: ID!) {
    artifact(id: $id) {
      id
      title
      type
      status
      content
      summary
      agentId
      threadId
      createdAt
      updatedAt
    }
  }
`;

export const AdminAppletsQuery = graphql(`
  query AdminApplets(
    $tenantId: ID!
    $userId: ID
    $cursor: String
    $limit: Int
  ) {
    adminApplets(
      tenantId: $tenantId
      userId: $userId
      cursor: $cursor
      limit: $limit
    ) {
      nodes {
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
        artifact {
          id
          agentId
          threadId
          createdAt
          updatedAt
        }
      }
      nextCursor
    }
  }
`);

export const AdminAppletQuery = graphql(`
  query AdminApplet($appId: ID!) {
    adminApplet(appId: $appId) {
      applet {
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
        artifact {
          id
          agentId
          threadId
          createdAt
          updatedAt
        }
      }
      source
      metadata
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

export const MemorySearchQuery = graphql(`
  query MemorySearch(
    $userId: ID!
    $query: String!
    $strategy: MemoryStrategy
    $limit: Int
  ) {
    memorySearch(
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
`);

export const MemorySystemConfigQuery = graphql(`
  query MemorySystemConfig {
    memorySystemConfig {
      managedMemoryEnabled
      hindsightEnabled
    }
  }
`);

// ---------------------------------------------------------------------------
// Agent Templates
// ---------------------------------------------------------------------------

export const AgentTemplatesListQuery = graphql(`
  query AgentTemplatesList($tenantId: ID!) {
    agentTemplates(tenantId: $tenantId) {
      id
      tenantId
      name
      slug
      description
      category
      icon
      templateKind
      source
      runtime
      model
      guardrailId
      blockedTools
      config
      skills
      knowledgeBaseIds
      isPublished
      createdAt
      updatedAt
    }
  }
`);

// Returns tenant-scoped + platform-shipped (tenant_id IS NULL) Computer
// templates so the admin Computer create-dialog can surface the platform
// default alongside any tenant-authored templates. Distinct from
// AgentTemplatesListQuery which filters strictly by tenant_id.
export const ComputerTemplatesListQuery = graphql(`
  query ComputerTemplatesList($tenantId: ID!) {
    computerTemplates(tenantId: $tenantId) {
      id
      tenantId
      name
      slug
      description
      category
      icon
      templateKind
      source
      runtime
      model
      isPublished
      createdAt
      updatedAt
    }
  }
`);

export const AgentTemplateDetailQuery = graphql(`
  query AgentTemplateDetail($id: ID!) {
    agentTemplate(id: $id) {
      id
      tenantId
      name
      slug
      description
      category
      icon
      templateKind
      source
      runtime
      model
      guardrailId
      blockedTools
      config
      skills
      sandbox
      browser
      webSearch
      sendEmail
      contextEngine
      knowledgeBaseIds
      isPublished
      createdAt
      updatedAt
    }
  }
`);

export const CreateAgentTemplateMutation = graphql(`
  mutation CreateAgentTemplate($input: CreateAgentTemplateInput!) {
    createAgentTemplate(input: $input) {
      id
      name
      slug
      templateKind
      runtime
    }
  }
`);

export const UpdateAgentTemplateMutation = graphql(`
  mutation UpdateAgentTemplate($id: ID!, $input: UpdateAgentTemplateInput!) {
    updateAgentTemplate(id: $id, input: $input) {
      id
      name
      slug
      templateKind
      runtime
      model
      guardrailId
      blockedTools
      config
      skills
      sandbox
      browser
      webSearch
      sendEmail
      contextEngine
      knowledgeBaseIds
      updatedAt
    }
  }
`);

export const DeleteAgentTemplateMutation = graphql(`
  mutation DeleteAgentTemplate($id: ID!) {
    deleteAgentTemplate(id: $id)
  }
`);

// Minimal tenant read for surfaces that need to show sandbox policy
// state (Built-in Tools page, policy audit panels). Not the full tenant
// — just the sandbox-adjacent fields.
export const TenantSandboxStatusQuery = graphql(`
  query TenantSandboxStatus($id: ID!) {
    tenant(id: $id) {
      id
      sandboxEnabled
      complianceTier
      sandboxInterpreterPublicId
      sandboxInterpreterInternalId
    }
  }
`);

export const CreateAgentFromTemplateMutation = graphql(`
  mutation CreateAgentFromTemplate($input: CreateAgentFromTemplateInput!) {
    createAgentFromTemplate(input: $input) {
      id
      name
      slug
    }
  }
`);

// ---------------------------------------------------------------------------
// Template → Agent sync + rollback
// ---------------------------------------------------------------------------

export const LinkedAgentsForTemplateQuery = graphql(`
  query LinkedAgentsForTemplate($templateId: ID!) {
    linkedAgentsForTemplate(templateId: $templateId) {
      id
      name
      slug
      role
      status
      updatedAt
    }
  }
`);

export const TemplateSyncDiffQuery = graphql(`
  query TemplateSyncDiff($templateId: ID!, $agentId: ID!) {
    templateSyncDiff(templateId: $templateId, agentId: $agentId) {
      roleChange {
        current
        target
      }
      skillsAdded
      skillsRemoved
      skillsChanged
      permissionsChanges {
        skillId
        added
        removed
      }
      kbsAdded
      kbsRemoved
      filesAdded
      filesModified
      filesSame
    }
  }
`);

export const AgentVersionsQuery = graphql(`
  query AgentVersionsList($agentId: ID!, $limit: Int) {
    agentVersions(agentId: $agentId, limit: $limit) {
      id
      agentId
      versionNumber
      label
      createdBy
      createdAt
    }
  }
`);

export const SyncTemplateToAgentMutation = graphql(`
  mutation SyncTemplateToAgent($templateId: ID!, $agentId: ID!) {
    syncTemplateToAgent(templateId: $templateId, agentId: $agentId) {
      id
      name
      role
      updatedAt
    }
  }
`);

export const SyncTemplateToAllAgentsMutation = graphql(`
  mutation SyncTemplateToAllAgents($templateId: ID!) {
    syncTemplateToAllAgents(templateId: $templateId) {
      agentsSynced
      agentsFailed
      errors
    }
  }
`);

export const RollbackAgentVersionMutation = graphql(`
  mutation RollbackAgentVersion($agentId: ID!, $versionId: ID!) {
    rollbackAgentVersion(agentId: $agentId, versionId: $versionId) {
      id
      name
      role
      updatedAt
    }
  }
`);

// MemoryGraphQuery + WikiGraphQuery now live in @thinkwork/graph as plain
// gql template literals; consumed directly by MemoryGraph/WikiGraph
// components. No admin code outside those components imports them.

export const WikiPageQuery = graphql(`
  query AdminWikiPage(
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
    }
  }
`);

export const WikiBacklinksQuery = graphql(`
  query AdminWikiBacklinks($pageId: ID!) {
    wikiBacklinks(pageId: $pageId) {
      id
      type
      slug
      title
      summary
    }
  }
`);

export const RecentWikiPagesQuery = graphql(`
  query AdminRecentWikiPages($userId: ID!, $limit: Int) {
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
`);

export const WikiSearchQuery = graphql(`
  query AdminWikiSearch(
    $tenantId: ID!
    $userId: ID!
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
`);

export const ThreadTracesQuery = graphql(`
  query ThreadTraces($threadId: ID!, $tenantId: ID!) {
    threadTraces(threadId: $threadId, tenantId: $tenantId) {
      traceId
      threadId
      agentId
      agentName
      model
      inputTokens
      outputTokens
      durationMs
      costUsd
      estimated
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

// ---------------------------------------------------------------------------
// Evaluations
// ---------------------------------------------------------------------------

export const EvalSummaryQuery = gql`
  query EvalSummary($tenantId: ID!) {
    evalSummary(tenantId: $tenantId) {
      totalRuns
      latestPassRate
      avgPassRate
      regressionCount
    }
  }
`;

export const EvalRunsQuery = gql`
  query EvalRuns($tenantId: ID!, $limit: Int, $offset: Int, $agentId: ID) {
    evalRuns(
      tenantId: $tenantId
      limit: $limit
      offset: $offset
      agentId: $agentId
    ) {
      items {
        id
        status
        model
        categories
        totalTests
        passed
        failed
        passRate
        regression
        costUsd
        agentId
        agentName
        agentTemplateId
        agentTemplateName
        startedAt
        completedAt
        createdAt
      }
      totalCount
    }
  }
`;

export const EvalRunQuery = gql`
  query EvalRun($id: ID!) {
    evalRun(id: $id) {
      id
      status
      model
      categories
      totalTests
      passed
      failed
      passRate
      regression
      costUsd
      errorMessage
      agentId
      agentName
      startedAt
      completedAt
      createdAt
    }
  }
`;

export const EvalRunResultsQuery = gql`
  query EvalRunResults($runId: ID!) {
    evalRunResults(runId: $runId) {
      id
      testCaseId
      testCaseName
      category
      status
      score
      durationMs
      input
      actualOutput
      evaluatorResults
      assertions
      errorMessage
      createdAt
    }
  }
`;

export const EvalTimeSeriesQuery = gql`
  query EvalTimeSeries($tenantId: ID!, $days: Int) {
    evalTimeSeries(tenantId: $tenantId, days: $days) {
      day
      passRate
      runCount
      passed
      failed
    }
  }
`;

// agentTemplateId/Name require a backend deploy of the new evaluations
// resolver (see follow-up PR). Until that lands, request only fields
// the v1 graphql-http already knows. The form's agent-template Select
// will still capture the value into local state and be persisted on
// save once the mutation goes through against the deployed backend.
export const EvalTestCasesQuery = gql`
  query EvalTestCases($tenantId: ID!, $category: String, $search: String) {
    evalTestCases(tenantId: $tenantId, category: $category, search: $search) {
      id
      name
      category
      query
      systemPrompt
      assertions
      agentcoreEvaluatorIds
      tags
      enabled
      source
      createdAt
      updatedAt
    }
  }
`;

export const EvalTestCaseQuery = gql`
  query EvalTestCase($id: ID!) {
    evalTestCase(id: $id) {
      id
      name
      category
      query
      systemPrompt
      assertions
      agentcoreEvaluatorIds
      tags
      enabled
      source
      createdAt
      updatedAt
    }
  }
`;

export const StartEvalRunMutation = gql`
  mutation StartEvalRun($tenantId: ID!, $input: StartEvalRunInput!) {
    startEvalRun(tenantId: $tenantId, input: $input) {
      id
      status
      categories
      createdAt
    }
  }
`;

export const CreateEvalTestCaseMutation = gql`
  mutation CreateEvalTestCase(
    $tenantId: ID!
    $input: CreateEvalTestCaseInput!
  ) {
    createEvalTestCase(tenantId: $tenantId, input: $input) {
      id
      name
      category
      query
      systemPrompt
      agentTemplateId
      assertions
      agentcoreEvaluatorIds
      enabled
      createdAt
    }
  }
`;

export const UpdateEvalTestCaseMutation = gql`
  mutation UpdateEvalTestCase($id: ID!, $input: UpdateEvalTestCaseInput!) {
    updateEvalTestCase(id: $id, input: $input) {
      id
      name
      category
      query
      systemPrompt
      agentTemplateId
      assertions
      agentcoreEvaluatorIds
      enabled
      updatedAt
    }
  }
`;

export const SeedEvalTestCasesMutation = gql`
  mutation SeedEvalTestCases($tenantId: ID!, $categories: [String!]) {
    seedEvalTestCases(tenantId: $tenantId, categories: $categories)
  }
`;

export const DeleteEvalTestCaseMutation = gql`
  mutation DeleteEvalTestCase($id: ID!) {
    deleteEvalTestCase(id: $id)
  }
`;

export const DeleteEvalRunMutation = gql`
  mutation DeleteEvalRun($id: ID!) {
    deleteEvalRun(id: $id)
  }
`;

export const CancelEvalRunMutation = gql`
  mutation CancelEvalRun($id: ID!) {
    cancelEvalRun(id: $id) {
      id
      status
      completedAt
    }
  }
`;

export const EvalTestCaseHistoryQuery = gql`
  query EvalTestCaseHistory($testCaseId: ID!, $limit: Int) {
    evalTestCaseHistory(testCaseId: $testCaseId, limit: $limit) {
      id
      runId
      testCaseName
      category
      status
      score
      durationMs
      input
      expected
      actualOutput
      assertions
      evaluatorResults
      errorMessage
      createdAt
    }
  }
`;

export const OnEvalRunUpdatedSubscription = gql`
  subscription OnEvalRunUpdated($tenantId: ID!) {
    onEvalRunUpdated(tenantId: $tenantId) {
      runId
      tenantId
      agentId
      status
      totalTests
      passed
      failed
      passRate
      errorMessage
      updatedAt
    }
  }
`;
