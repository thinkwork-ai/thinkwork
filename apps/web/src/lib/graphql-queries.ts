import { gql } from "@urql/core";

/**
 * Plain `gql` template literals — apps/web Phase 1 deliberately skips
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
        lifecycleStatus
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
        user {
          id
          name
          image
        }
        participants {
          participantType
          userId
          user {
            id
            name
            image
          }
        }
        checkoutRunId
        channel
        costSummary
        lastActivityAt
        lastTurnCompletedAt
        lastReadAt
        viewerNotificationPreference
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
        lifecycleStatus
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
        viewerNotificationPreference
        archivedAt
        createdAt
        updatedAt
      }
    }
  }
`;

export const MarkThreadsReadMutation = gql`
  mutation MarkThreadsRead($input: MarkThreadsReadInput!) {
    markThreadsRead(input: $input) {
      updated
    }
  }
`;

export const MyApprovedModelCatalogQuery = gql`
  query MyApprovedModelCatalog {
    myApprovedModelCatalog {
      id
      modelId
      displayName
      provider
      inputCostPerMillion
      outputCostPerMillion
    }
  }
`;

export const UserModelCatalogQuery = gql`
  query UserModelCatalog($userId: ID!) {
    userModelCatalog(userId: $userId) {
      id
      modelId
      displayName
      provider
      inputCostPerMillion
      outputCostPerMillion
      approved
    }
  }
`;

export const SetUserModelApprovalMutation = gql`
  mutation SetUserModelApproval(
    $userId: ID!
    $modelId: String!
    $approved: Boolean!
  ) {
    setUserModelApproval(
      userId: $userId
      modelId: $modelId
      approved: $approved
    ) {
      id
      modelId
      displayName
      provider
      inputCostPerMillion
      outputCostPerMillion
      approved
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

export const SettingsWorkflowsQuery = gql`
  query SettingsWorkflows(
    $tenantId: ID!
    $lifecycleStatus: WorkflowLifecycleStatus
    $readinessState: WorkflowReadinessState
    $limit: Int
    $cursor: String
  ) {
    workflows(
      tenantId: $tenantId
      lifecycleStatus: $lifecycleStatus
      readinessState: $readinessState
      limit: $limit
      cursor: $cursor
    ) {
      id
      tenantId
      name
      slug
      description
      lifecycleStatus
      visibility
      primaryTriggerFamily
      currentVersionNumber
      currentVersion {
        id
        definitionSnapshot
      }
      capabilityFlags
      readinessState
      readinessReasons
      lastRunAt
      bindings {
        id
        bindingType
        bindingStatus
        readinessState
        readinessReasons
        externalWorkflowId
        externalWorkflowName
        routineId
      }
      triggers {
        id
        triggerFamily
        sourceSystem
        triggerConfig
        enabled
        readinessState
      }
      lastRun {
        id
        status
        triggerFamily
        triggerSource
        startedAt
        finishedAt
        lastEventAt
        errorCode
        errorMessage
      }
      updatedAt
    }
  }
`;

export const SettingsWorkflowQuery = gql`
  query SettingsWorkflow($id: ID!, $runLimit: Int) {
    workflow(id: $id) {
      id
      tenantId
      name
      slug
      description
      lifecycleStatus
      visibility
      ownerUserId
      ownerAgentId
      primaryTriggerFamily
      currentVersionNumber
      capabilityFlags
      readinessState
      readinessReasons
      currentVersion {
        id
        versionNumber
        versionStatus
        sourceKind
        sourceMetadata
        definitionSnapshot
        capabilitySnapshot
        routineAslVersionId
        publishedAt
        createdAt
      }
      triggers {
        id
        triggerFamily
        sourceSystem
        enabled
        idempotencyRequired
        triggerConfig
        actorContract
        readinessState
        readinessReasons
      }
      bindings {
        id
        bindingType
        bindingStatus
        routineId
        routineAslVersionId
        pluginInstallId
        managedApplicationId
        externalWorkflowId
        externalWorkflowName
        externalVersionId
        connectionRef
        capabilityFlags
        readinessState
        readinessReasons
      }
      runs(limit: $runLimit) {
        id
        status
        triggerFamily
        triggerSource
        actorType
        actorId
        idempotencyKey
        correlationId
        backendExecutionId
        startedAt
        finishedAt
        lastEventAt
        errorCode
        errorMessage
        totalCostUsdCents
        createdAt
      }
      createdAt
      updatedAt
    }
  }
`;

export const SettingsWorkflowSourceAutomationQuery = gql`
  query SettingsWorkflowSourceAutomation($id: ID!, $runLimit: Int) {
    workflow(id: $id) {
      id
      sourceAutomation {
        id
        tenantId
        name
        slug
        description
        lifecycleStatus
        enabled
        ownerUserId
        ownerAgentId
        runAsUserId
        spaceId
        primaryTriggerFamily
        currentVersionId
        currentVersionNumber
        lastRunId
        lastRunStatus
        lastRunAt
        lastRunSummary
        currentVersion {
          id
          versionNumber
          versionStatus
          triggerSpec
          routineActionsSpec
          targetSpec
          sourceMetadata
          publishedAt
          createdAt
        }
        runs(limit: $runLimit) {
          id
          threadId
          status
          triggerFamily
          triggerSource
          scheduledJobId
          actorType
          actorId
          idempotencyKey
          correlationId
          currentIteration
          terminalReason
          inputSummary
          outputSummary
          startedAt
          finishedAt
          lastEventAt
          errorCode
          errorMessage
          totalCostUsdCents
          createdAt
        }
        createdAt
        updatedAt
      }
    }
  }
`;

export const DeleteWorkflowMutation = gql`
  mutation DeleteWorkflow($id: ID!) {
    deleteWorkflow(id: $id)
  }
`;

export const SettingsWorkflowRunsQuery = gql`
  query SettingsWorkflowRuns(
    $tenantId: ID!
    $workflowId: ID
    $status: WorkflowRunStatus
    $limit: Int
    $cursor: String
  ) {
    workflowRuns(
      tenantId: $tenantId
      workflowId: $workflowId
      status: $status
      limit: $limit
      cursor: $cursor
    ) {
      id
      workflowId
      workflow {
        id
        name
        slug
        primaryTriggerFamily
      }
      status
      triggerFamily
      triggerSource
      actorType
      correlationId
      backendExecutionId
      backendExecutionRef
      startedAt
      finishedAt
      lastEventAt
      errorCode
      errorMessage
      totalCostUsdCents
      createdAt
    }
  }
`;

export const SettingsWorkflowRunQuery = gql`
  query SettingsWorkflowRun($id: ID!) {
    workflowRun(id: $id) {
      id
      tenantId
      workflowId
      workflow {
        id
        name
        slug
      }
      workflowVersion {
        id
        versionNumber
        versionStatus
        sourceKind
        routineAslVersionId
      }
      engineBinding {
        id
        bindingType
        bindingStatus
        routineId
        externalWorkflowId
        externalWorkflowName
        readinessState
        readinessReasons
      }
      status
      triggerFamily
      triggerSource
      actorType
      actorId
      idempotencyKey
      correlationId
      backendExecutionId
      backendExecutionRef
      capabilitySnapshot
      readinessSnapshot
      inputSummary
      outputSummary
      startedAt
      finishedAt
      lastEventAt
      errorCode
      errorMessage
      totalCostUsdCents
      events {
        id
        eventType
        eventStatus
        provenance
        occurredAt
        message
        payloadSummary
        evidenceRef
      }
      evidence {
        id
        evidenceType
        sourceSystem
        sourceId
        uri
        summary
        redactionState
        sensitivity
        retentionExpiresAt
      }
      createdAt
      updatedAt
    }
  }
`;

export const SaveWorkflowMutation = gql`
  mutation SaveWorkflow($input: SaveWorkflowInput!) {
    saveWorkflow(input: $input) {
      workflow {
        id
        name
        slug
        description
        lifecycleStatus
        primaryTriggerFamily
        currentVersionNumber
        updatedAt
      }
      errors {
        stepId
        field
        reason
      }
      webhookToken
    }
  }
`;

export const ResolveWorkflowApprovalMutation = gql`
  mutation ResolveWorkflowApproval(
    $runId: ID!
    $approve: Boolean!
    $note: String
    $override: WorkflowApprovalOverrideInput
  ) {
    resolveWorkflowApproval(
      runId: $runId
      approve: $approve
      note: $note
      override: $override
    ) {
      id
      status
      updatedAt
    }
  }
`;

// THINK-193 U3: the signed-in user's managed Personal Memory Automation.
// Lazily provisioned server-side on read.
export const PersonalMemoryAutomationQuery = gql`
  query PersonalMemoryAutomation {
    personalMemoryAutomation {
      processor {
        id
        mode
        targetScope
        enabled
        status
      }
      workflow {
        id
        name
        slug
        primaryTriggerFamily
        lastRunId
        lastRunAt
        lastRun {
          id
          status
        }
      }
      sources {
        id
        sourceFamily
        sourceBindingKey
        enabled
        boundary
      }
      readiness
      readinessReasons
    }
  }
`;

export const SetPersonalMemoryAutomationScheduleMutation = gql`
  mutation SetPersonalMemoryAutomationSchedule(
    $scheduleExpression: String
    $timezone: String
    $enabled: Boolean!
  ) {
    setPersonalMemoryAutomationSchedule(
      scheduleExpression: $scheduleExpression
      timezone: $timezone
      enabled: $enabled
    ) {
      processor {
        id
      }
      workflow {
        id
        primaryTriggerFamily
      }
      readiness
      readinessReasons
    }
  }
`;

/**
 * THINK-264: the built-in memory Automation's pipeline — the stage list the
 * Definition tab renders, plus the sources and readiness behind it.
 */
export const MemoryPipelineFragment = gql`
  fragment MemoryPipelineFields on MemoryPipeline {
    processorConfigId
    mode
    workflowId
    enabled
    readiness
    readinessReasons
    scheduleExpression
    scheduleTimezone
    scheduleEnabled
    sources {
      id
      sourceFamily
      sourceBindingKey
      enabled
      boundary
    }
    stages {
      id
      stage
      label
      description
      enabled
      toggleable
      lastResult
    }
  }
`;

export const SetMemoryPipelineStageEnabledMutation = gql`
  ${MemoryPipelineFragment}
  mutation SetMemoryPipelineStageEnabled(
    $agentLoopId: ID!
    $stage: String!
    $enabled: Boolean!
  ) {
    setMemoryPipelineStageEnabled(
      agentLoopId: $agentLoopId
      stage: $stage
      enabled: $enabled
    ) {
      ...MemoryPipelineFields
    }
  }
`;

export const SettingsAgentLoopsQuery = gql`
  query SettingsAgentLoops(
    $tenantId: ID!
    $lifecycleStatus: AgentLoopLifecycleStatus
    $enabled: Boolean
    $limit: Int
    $cursor: String
  ) {
    agentLoops(
      tenantId: $tenantId
      lifecycleStatus: $lifecycleStatus
      enabled: $enabled
      limit: $limit
      cursor: $cursor
    ) {
      id
      tenantId
      name
      slug
      description
      lifecycleStatus
      enabled
      kind
      systemKey
      ownerUserId
      ownerAgentId
      runAsUserId
      spaceId
      primaryTriggerFamily
      currentVersionId
      currentVersionNumber
      lastRunId
      lastRunStatus
      lastRunAt
      lastRunSummary
      currentVersion {
        id
        versionNumber
        versionStatus
        triggerSpec
        routineActionsSpec
        targetSpec
        sourceMetadata
        publishedAt
        createdAt
      }
      webhookEndpoint {
        webhookId
        token
        path
        enabled
      }
      runs(limit: 1) {
        id
        status
        triggerFamily
        triggerSource
        currentIteration
        terminalReason
        startedAt
        finishedAt
        lastEventAt
        errorCode
        errorMessage
        totalCostUsdCents
        createdAt
      }
      createdAt
      updatedAt
    }
  }
`;

export const SettingsAgentLoopQuery = gql`
  ${MemoryPipelineFragment}
  query SettingsAgentLoop($id: ID!, $runLimit: Int) {
    agentLoop(id: $id) {
      id
      tenantId
      name
      slug
      description
      lifecycleStatus
      enabled
      kind
      systemKey
      memoryPipeline {
        ...MemoryPipelineFields
      }
      ownerUserId
      ownerAgentId
      runAsUserId
      spaceId
      primaryTriggerFamily
      currentVersionId
      currentVersionNumber
      lastRunId
      lastRunStatus
      lastRunAt
      lastRunSummary
      webhookEndpoint {
        webhookId
        token
        path
        enabled
      }
      webhookDeliveries(limit: 25) {
        id
        receivedAt
        resolutionStatus
        signatureStatus
        statusCode
        providerName
        providerEventId
        normalizedKind
        threadId
        threadCreated
        isReplay
        retryCount
        durationMs
        errorMessage
      }
      currentVersion {
        id
        versionNumber
        versionStatus
        triggerSpec
        routineActionsSpec
        targetSpec
        sourceMetadata
        publishedAt
        createdAt
      }
      runs(limit: $runLimit) {
        id
        threadId
        status
        triggerFamily
        triggerSource
        scheduledJobId
        actorType
        actorId
        idempotencyKey
        correlationId
        currentIteration
        terminalReason
        inputSummary
        outputSummary
        startedAt
        finishedAt
        lastEventAt
        errorCode
        errorMessage
        totalCostUsdCents
        createdAt
      }
      createdAt
      updatedAt
    }
  }
`;

export const SettingsAgentLoopLinkedWorkflowQuery = gql`
  query SettingsAgentLoopLinkedWorkflow($id: ID!, $runLimit: Int) {
    agentLoop(id: $id) {
      id
      linkedWorkflow {
        id
        name
        readinessState
        currentVersionNumber
        currentVersion {
          id
          versionNumber
          definitionSnapshot
        }
        runs(limit: $runLimit) {
          id
          status
          triggerFamily
          triggerSource
          actorType
          actorId
          idempotencyKey
          correlationId
          backendExecutionId
          startedAt
          finishedAt
          lastEventAt
          errorCode
          errorMessage
          totalCostUsdCents
          createdAt
        }
      }
    }
  }
`;

export const SettingsAgentLoopRunQuery = gql`
  query SettingsAgentLoopRun($id: ID!) {
    agentLoopRun(id: $id) {
      id
      tenantId
      agentLoopId
      agentLoop {
        id
        name
        slug
      }
      agentLoopVersionId
      threadId
      agentLoopVersion {
        id
        versionNumber
        versionStatus
        triggerSpec
        routineActionsSpec
        targetSpec
        sourceMetadata
      }
      status
      triggerFamily
      triggerSource
      scheduledJobId
      actorType
      actorId
      idempotencyKey
      correlationId
      currentIteration
      terminalReason
      policySnapshot
      inputSummary
      outputSummary
      startedAt
      finishedAt
      lastEventAt
      errorCode
      errorMessage
      totalCostUsdCents
      iterations {
        id
        iterationNumber
        status
        goalModeAction
        agentWakeupRequestId
        threadTurnId
        threadId
        inputSummary
        outputSummary
        startedAt
        finishedAt
        errorCode
        errorMessage
        totalCostUsdCents
        createdAt
        updatedAt
      }
      createdAt
      updatedAt
    }
  }
`;

export const TriggerWorkflowRunMutation = gql`
  mutation TriggerWorkflowRun($input: TriggerWorkflowRunInput!) {
    triggerWorkflowRun(input: $input) {
      id
      workflowId
      status
      triggerFamily
      triggerSource
      startedAt
      createdAt
    }
  }
`;

// Deterministic routines picker (plan 2026-07-03-004 U5): git_python
// routines attachable to an Automation as token-free actions.
export const SettingsGitRoutinesQuery = gql`
  query SettingsGitRoutines($tenantId: ID!) {
    routines(tenantId: $tenantId) {
      id
      name
      description
      engine
      status
      modulePath
      fixturePaths
      credentialRefs
      validatedSha
      disabledReason
      lastRunAt
    }
  }
`;

// Routine summary for the Workflow Definition step card (THINK-218): shows
// what the routine IS (description, module path, validated commit) instead
// of the raw step JSON.
export const WorkflowRoutineSummaryQuery = gql`
  query WorkflowRoutineSummary($id: ID!) {
    routine(id: $id) {
      id
      name
      description
      engine
      status
      modulePath
      validatedSha
    }
  }
`;

export const SettingsSaveAgentLoopMutation = gql`
  mutation SettingsSaveAgentLoop($input: SaveAgentLoopInput!) {
    saveAgentLoop(input: $input) {
      id
      tenantId
      name
      slug
      description
      lifecycleStatus
      enabled
      primaryTriggerFamily
      currentVersionNumber
      currentVersion {
        id
        versionNumber
        triggerSpec
        routineActionsSpec
        targetSpec
        sourceMetadata
      }
      updatedAt
    }
  }
`;

export const SettingsStartAutomationBuilderMutation = gql`
  mutation SettingsStartAutomationBuilder(
    $input: StartAutomationBuilderInput!
  ) {
    startAutomationBuilder(input: $input) {
      threadCreated
      setupPrompt
      draft
      thread {
        id
        title
        status
        channel
        createdAt
      }
    }
  }
`;

export const SettingsConfirmAutomationDraftMutation = gql`
  mutation SettingsConfirmAutomationDraft(
    $input: ConfirmAutomationDraftInput!
  ) {
    confirmAutomationDraft(input: $input) {
      id
      tenantId
      name
      slug
      description
      lifecycleStatus
      enabled
      primaryTriggerFamily
      currentVersionNumber
      currentVersion {
        id
        versionNumber
        triggerSpec
        routineActionsSpec
        targetSpec
        sourceMetadata
      }
      updatedAt
    }
  }
`;

export const SettingsDeleteAgentLoopMutation = gql`
  mutation SettingsDeleteAgentLoop($id: ID!) {
    deleteAgentLoop(id: $id) {
      id
      ok
    }
  }
`;

export const SettingsTriggerAgentLoopRunMutation = gql`
  mutation SettingsTriggerAgentLoopRun($input: TriggerAgentLoopRunInput!) {
    triggerAgentLoopRun(input: $input) {
      id
      agentLoopId
      threadId
      status
      triggerFamily
      triggerSource
      currentIteration
      createdAt
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
      email
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
        lifecycleStatus
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
        lifecycleStatus
        channel
        spaceId
        metadata
        lastReadAt
        viewerNotificationPreference
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

export const SetThreadNotificationPreferenceMutation = gql`
  mutation SetThreadNotificationPreference(
    $tenantId: ID!
    $threadId: ID!
    $preference: ThreadParticipantNotificationPreference!
  ) {
    setThreadNotificationPreference(
      tenantId: $tenantId
      threadId: $threadId
      preference: $preference
    ) {
      id
      threadId
      notificationPreference
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

const WorkItemFieldsFragment = gql`
  fragment WorkItemFields on WorkItem {
    id
    tenantId
    spaceId
    statusId
    title
    notes
    priority
    ownerUserId
    ownerAgentId
    dueAt
    required
    applicable
    blocked
    openEngineEnabled
    openEngineQueueKey
    openEngineClaimedByAgentId
    openEngineClaimedAt
    openEngineClaimExpiresAt
    openEngineHumanHold
    openEngineHumanHoldReason
    openEngineScheduledAt
    openEngineDependencyState
    openEngineRouting
    completedAt
    completedByUserId
    completedByAgentId
    createdByUserId
    createdByAgentId
    templateSourceId
    metadata
    createdAt
    updatedAt
    archivedAt
    status {
      id
      name
      color
      icon
      category
      isActive
      isFinal
      isDefault
      displayOrder
    }
    labels {
      id
      tenantId
      name
      slug
      color
      description
      archivedAt
    }
    threadLinks {
      id
      threadId
      relationship
      createdAt
    }
    externalRefs {
      id
      provider
      externalId
      externalUrl
      metadata
    }
  }
`;

const WorkItemDocumentFieldsFragment = gql`
  fragment WorkItemDocumentFields on WorkItemDocument {
    id
    tenantId
    workItemId
    kind
    title
    content
    contentType
    sizeBytes
    checksumSha256
    metadata
    createdByUserId
    createdByAgentId
    createdAt
    updatedAt
    archivedAt
  }
`;

const WorkItemCommentFieldsFragment = gql`
  fragment WorkItemCommentFields on WorkItemComment {
    id
    tenantId
    spaceId
    workItemId
    threadId
    authorUserId
    authorAgentId
    body
    metadata
    createdAt
    updatedAt
    archivedAt
  }
`;

export const WorkItemsQuery = gql`
  query WorkItems($input: WorkItemsInput) {
    workItems(input: $input) {
      ...WorkItemFields
    }
  }
  ${WorkItemFieldsFragment}
`;

export const WorkItemQuery = gql`
  query WorkItem($tenantId: ID, $id: ID!) {
    workItem(tenantId: $tenantId, id: $id) {
      ...WorkItemFields
      events {
        id
        tenantId
        spaceId
        workItemId
        threadId
        actorUserId
        actorAgentId
        eventType
        previousStatusId
        newStatusId
        message
        metadata
        createdAt
      }
    }
  }
  ${WorkItemFieldsFragment}
`;

export const WorkItemDocumentsQuery = gql`
  query WorkItemDocuments($input: WorkItemDocumentsInput!) {
    workItemDocuments(input: $input) {
      ...WorkItemDocumentFields
    }
  }
  ${WorkItemDocumentFieldsFragment}
`;

export const WorkItemCommentsQuery = gql`
  query WorkItemComments($input: WorkItemCommentsInput!) {
    workItemComments(input: $input) {
      ...WorkItemCommentFields
    }
  }
  ${WorkItemCommentFieldsFragment}
`;

export const WorkItemDocumentQuery = gql`
  query WorkItemDocument($input: WorkItemDocumentInput!) {
    workItemDocument(input: $input) {
      ...WorkItemDocumentFields
    }
  }
  ${WorkItemDocumentFieldsFragment}
`;

export const CreateWorkItemDocumentMutation = gql`
  mutation CreateWorkItemDocument($input: CreateWorkItemDocumentInput!) {
    createWorkItemDocument(input: $input) {
      ...WorkItemDocumentFields
    }
  }
  ${WorkItemDocumentFieldsFragment}
`;

export const UpdateWorkItemDocumentMutation = gql`
  mutation UpdateWorkItemDocument($input: UpdateWorkItemDocumentInput!) {
    updateWorkItemDocument(input: $input) {
      ...WorkItemDocumentFields
    }
  }
  ${WorkItemDocumentFieldsFragment}
`;

export const CreateWorkItemCommentMutation = gql`
  mutation CreateWorkItemComment($input: CreateWorkItemCommentInput!) {
    createWorkItemComment(input: $input) {
      ...WorkItemCommentFields
    }
  }
  ${WorkItemCommentFieldsFragment}
`;

export const CreateWorkItemMutation = gql`
  mutation CreateWorkItem($input: CreateWorkItemInput!) {
    createWorkItem(input: $input) {
      ...WorkItemFields
    }
  }
  ${WorkItemFieldsFragment}
`;

export const ThreadWorkItemsQuery = gql`
  query ThreadWorkItems($tenantId: ID!, $threadId: ID!) {
    threadWorkItems(tenantId: $tenantId, threadId: $threadId) {
      ...WorkItemFields
    }
  }
  ${WorkItemFieldsFragment}
`;

export const WorkItemLabelsQuery = gql`
  query WorkItemLabels($input: WorkItemLabelsInput) {
    workItemLabels(input: $input) {
      id
      tenantId
      name
      slug
      color
      description
      archivedAt
    }
  }
`;

export const WorkItemStatusesQuery = gql`
  query WorkItemStatuses($tenantId: ID!, $spaceId: ID!) {
    workItemStatuses(tenantId: $tenantId, spaceId: $spaceId) {
      id
      tenantId
      spaceId
      name
      description
      color
      icon
      category
      isActive
      isFinal
      isDefault
      displayOrder
      createdAt
      updatedAt
    }
  }
`;

export const WorkItemSavedViewsQuery = gql`
  query WorkItemSavedViews($tenantId: ID!, $spaceId: ID) {
    workItemSavedViews(tenantId: $tenantId, spaceId: $spaceId) {
      id
      tenantId
      userId
      spaceId
      name
      viewType
      filters
      grouping
      sorting
      viewConfig
      isPrivate
      isDefault
      isFavorite
      createdAt
      updatedAt
    }
  }
`;

export const UpdateWorkItemStatusMutation = gql`
  mutation UpdateWorkItemStatus($input: UpdateWorkItemStatusInput!) {
    updateWorkItemStatus(input: $input) {
      ...WorkItemFields
    }
  }
  ${WorkItemFieldsFragment}
`;

export const UpdateWorkItemMutation = gql`
  mutation UpdateWorkItem($input: UpdateWorkItemInput!) {
    updateWorkItem(input: $input) {
      ...WorkItemFields
    }
  }
  ${WorkItemFieldsFragment}
`;

export const RecordOpenEngineHumanActionMutation = gql`
  mutation RecordOpenEngineHumanAction(
    $input: RecordOpenEngineHumanActionInput!
  ) {
    recordOpenEngineHumanAction(input: $input) {
      id
      tenantId
      spaceId
      workItemId
      threadId
      actorUserId
      actorAgentId
      eventType
      previousStatusId
      newStatusId
      message
      metadata
      createdAt
    }
  }
`;

export const SaveWorkItemViewMutation = gql`
  mutation SaveWorkItemView($input: SaveWorkItemViewInput!) {
    saveWorkItemView(input: $input) {
      id
      tenantId
      userId
      spaceId
      name
      viewType
      filters
      grouping
      sorting
      viewConfig
      isPrivate
      isDefault
      isFavorite
      createdAt
      updatedAt
    }
  }
`;

export const DeleteWorkItemViewMutation = gql`
  mutation DeleteWorkItemView($input: DeleteWorkItemViewInput!) {
    deleteWorkItemView(input: $input)
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

export const RefreshThreadProgressMutation = gql`
  mutation RefreshThreadProgress($input: RefreshThreadProgressInput!) {
    refreshThreadProgress(input: $input) {
      threadGoalFiles {
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

export const StartTwentyCustomerOnboardingMutation = gql`
  mutation StartTwentyCustomerOnboarding(
    $input: StartTwentyCustomerOnboardingInput!
  ) {
    startTwentyCustomerOnboarding(input: $input) {
      action
      threadId
      goalId
      idempotent
      pluginActivationRequired
      statusWritebackState
      missingFields
      thread {
        id
        title
        spaceId
      }
      link {
        id
        objectId
        objectUrl
        workflowKey
        outcomeKey
        state
        statusHandleState
        statusHandleUrl
        statusHandleAction
        lastWritebackState
        failureCode
        failureMessage
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
      space {
        id
        name
        slug
      }
      channel
      mode
      modeOverride
      participants {
        id
        participantType
        userId
      }
      lifecycleStatus
      metadata
      lastModel
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
            tokenCount
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
            userQuestion {
              id
              status
              answers
              answeredVia
              answeredBy
              answeredAt
            }
            durableArtifact {
              id
              title
              type
              status
              headVersion
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

export const SettingsActivityThreadTurnsQuery = gql`
  query SettingsActivityThreadTurns(
    $tenantId: ID!
    $threadId: ID!
    $limit: Int
  ) {
    threadTurns(tenantId: $tenantId, threadId: $threadId, limit: $limit) {
      id
      tenantId
      agentId
      invocationSource
      triggerDetail
      triggerName
      threadId
      turnNumber
      runtimeType
      triggeringMessageId
      status
      startedAt
      finishedAt
      error
      errorCode
      resultJson
      usageJson
      totalCost
      contextSnapshot
      retryAttempt
      originTurnId
      systemPrompt
      createdAt
    }
  }
`;

// THINK-136 U6 (R7/AE5): retry a user message's failed agent dispatch.
// Original-sender-only (server-enforced); returns the updated Message with
// metadata.dispatch stamped to { status: "pending", attempt, route }.
export const RetryAgentDispatchMutation = gql`
  mutation RetryAgentDispatch($messageId: ID!) {
    retryAgentDispatch(messageId: $messageId) {
      id
      threadId
      tenantId
      role
      content
      metadata
      createdAt
    }
  }
`;

export const ThreadTurnEventsQuery = gql`
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
`;

export const TurnInvocationLogsQuery = gql`
  query TurnInvocationLogs($tenantId: ID!, $turnId: ID!) {
    turnInvocationLogs(tenantId: $tenantId, turnId: $turnId) {
      requestId
      modelId
      timestamp
      inputTokenCount
      outputTokenCount
      cacheReadTokenCount
      cacheWriteTokenCount
      inputPreview
      outputPreview
      toolCount
      costUsd
      toolUses
      hasToolResult
      branch
      reconciliationState
      reconciliationReason
      reconciliationConfidence
      reconciliationRuntimeRequestId
      reconciliationDiagnostic
    }
  }
`;

export const SettingsActivityThreadTracesQuery = gql`
  query SettingsActivityThreadTraces($threadId: ID!, $tenantId: ID!) {
    threadTraces(threadId: $threadId, tenantId: $tenantId) {
      traceId
      threadId
      agentId
      agentName
      runtimeType
      model
      inputTokens
      outputTokens
      durationMs
      costUsd
      estimated
      source
      parentRequestId
      toolCallId
      toolName
      profileRunId
      profileId
      profileSlug
      profileName
      laneKey
      profileStatus
      loopId
      loopOwnerType
      loopOwnerSlug
      loopPhase
      loopStatus
      loopVerdict
      reviewerRole
      loopEvidence
      modelRoutingStatus
      reconciliationState
      reconciliationSource
      sourceEvidence {
        sourceType
        sourceSystem
        sourceId
        uri
        observedAt
      }
      ruleSource
      match
      metadata
      createdAt
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
      pinnedAt
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
            userQuestion {
              id
              status
              answers
              answeredVia
              answeredBy
              answeredAt
            }
            durableArtifact {
              id
              title
              type
              status
              headVersion
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
      email
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

// THINK-263 U6/U7 — open an "ask" turn for a palette query. Creates a HIDDEN,
// owner-restricted thread + triggering user message and dispatches the agent in
// ask mode; only the hidden thread id crosses the wire. The answer streams back
// via onNewMessage (assistant message) and onThreadTurnStep (live activity).
// Can reject with extensions.code === "BUDGET_EXCEEDED" before any writes.
export const SearchAskMutation = gql`
  mutation SearchAsk($tenantId: ID!, $query: String!) {
    searchAsk(tenantId: $tenantId, query: $query) {
      threadId
    }
  }
`;

// THINK-263 U9 — enqueue a "Research this" BACKGROUND run for a palette query.
// Creates a VISIBLE thread (or posts into $threadId when supplied and writable)
// and dispatches the agent in NORMAL mode; the answer arrives asynchronously as
// a reply on the returned thread. Only the thread id crosses the wire. Can
// reject with extensions.code "FORBIDDEN" or "BUDGET_EXCEEDED".
export const SearchResearchMutation = gql`
  mutation SearchResearch($tenantId: ID!, $query: String!, $threadId: ID) {
    searchResearch(tenantId: $tenantId, query: $query, threadId: $threadId) {
      threadId
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

// Live mid-turn activity steps (tool/skill/phase in Phase 1, coalesced text
// deltas in Phase 2). The full payload rides in the event so the client can
// reduce it into the running turn's events[] without a refetch (urql here is
// a document cache, not graphcache). Ordered by seq; replayed on reconnect via
// the threadTurnEvents(runId, afterSeq) query.
export const ThreadTurnStepSubscription = gql`
  subscription ThreadTurnStep($threadId: ID!) {
    onThreadTurnStep(threadId: $threadId) {
      runId
      threadId
      tenantId
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
    # User who generated the artifact (resolved through the source thread),
    # shown in the Artifacts list "User" column. The Applet.userId/userName
    # resolver fields are deployed (verified live on dev) — safe to query.
    userId
    userName
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
      agentId
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
      metadata
      createdAt
    }
  }
`;

export const HandleJsonRenderActionMutation = gql`
  mutation HandleJsonRenderAction($input: HandleJsonRenderActionInput!) {
    handleJsonRenderAction(input: $input) {
      id
      threadId
      tenantId
      role
      content
      metadata
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

/**
 * THINK-199: lightweight source-thread context for the Memory Detail sheet —
 * title + a short transcript head so a memory's provenance is readable in
 * place instead of only via the thread link.
 */
export const MemorySourceThreadQuery = gql`
  query MemorySourceThread($id: ID!) {
    thread(id: $id) {
      id
      title
      createdAt
      messages(limit: 3) {
        edges {
          node {
            id
            role
            content
            createdAt
          }
        }
      }
    }
  }
`;

export const ComputerMemoryRecordsQuery = gql`
  query ComputerMemoryRecords(
    $tenantId: ID!
    $userId: ID
    $namespace: String!
    $scope: MemoryRecordScope
    $query: String
    $limit: Int
  ) {
    memoryRecords(
      tenantId: $tenantId
      userId: $userId
      namespace: $namespace
      scope: $scope
      query: $query
      limit: $limit
    ) {
      memoryRecordId
      content {
        text
      }
      createdAt
      updatedAt
      namespace
      bankId
      ownerType
      ownerId
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

export const ComputerMemoryRetainAttemptsQuery = gql`
  query ComputerMemoryRetainAttempts($tenantId: ID!, $limit: Int) {
    memoryRetainAttempts(tenantId: $tenantId, limit: $limit) {
      id
      threadId
      userId
      spaceId
      status
      attemptCount
      maxAttempts
      nextRetryAt
      errorClass
      errorMessage
      createdAt
      updatedAt
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
      activeEngine
      managedMemoryEnabled
      hindsightEnabled
      userMemoryEnabled
      spaceMemoryEnabled
      legacyHindsightAvailable
      companyDistillationEnabled
      wikiProjectionEnabled
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

/**
 * THINK-263 U4 — unified fan-out search broker as a palette rail query. Fired
 * once per source rail (Threads / Wiki / Entities) so each rail hydrates and
 * renders its own pending / empty / timeout / error state independently. The
 * memory leg is intentionally never requested on keystrokes (find rung).
 */
export const SearchQuery = gql`
  query Search(
    $tenantId: ID!
    $query: String!
    $sources: [SearchSource!]
    $limit: Int
    $queryId: ID
  ) {
    search(
      tenantId: $tenantId
      query: $query
      sources: $sources
      limit: $limit
      queryId: $queryId
    ) {
      queryId
      legs {
        source
        status
        error
        threadHits {
          id
          identifier
          title
          spaceId
          updatedAt
        }
        wikiHits {
          score
          matchedAlias
          page {
            id
            type
            slug
            title
            displayType
          }
        }
        entityHits {
          entityId
          label
          summary
          ontologyTypeSlug
          aliases
          evidenceCount
        }
      }
    }
  }
`;

/**
 * THINK-263 U5 — the entity dossier: everything the tenant brain knows about
 * one grounded knowledge-graph entity. `match` is the assembled dossier (null
 * when ambiguous / no grounded match); `disambiguation` lists candidates when
 * more than one grounded entity matched and no `entityId` selector was given.
 */
export const EntityDossierQuery = gql`
  query EntityDossier($tenantId: ID!, $query: String!, $entityId: ID) {
    entityDossier(tenantId: $tenantId, query: $query, entityId: $entityId) {
      match {
        entityId
        label
        ontologyTypeSlug
        summary
        aliases
        wikiPage {
          id
          type
          slug
          title
          displayType
        }
        memories {
          memoryRecordId
          text
          score
          threadId
          createdAt
        }
        threads {
          id
          identifier
          title
          spaceId
          updatedAt
        }
        artifacts {
          id
          title
          type
          threadId
        }
      }
      disambiguation {
        entityId
        label
        ontologyTypeSlug
        summary
        aliases
        evidenceCount
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

// ─── Customize page (apps/web Customize) ─────────────────────────────
// The Skills tab (SkillCatalogQuery + enableSkill documents) was
// removed in Composer plan U3 — skill wiring lives in Settings→Composer.
// The `disableSkill` mutation was retired from the schema in Composer plan U8.

export const WorkflowTemplateCatalogQuery = gql`
  query WorkflowTemplateCatalog {
    workflowTemplateCatalog {
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
      connectedWorkflowTemplateSlugs
    }
  }
`;

export const EnableWorkflowTemplateMutation = gql`
  mutation EnableWorkflowTemplate($input: EnableWorkflowTemplateInput!) {
    enableWorkflowTemplate(input: $input) {
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

export const DisableWorkflowTemplateMutation = gql`
  mutation DisableWorkflowTemplate($input: DisableWorkflowTemplateInput!) {
    disableWorkflowTemplate(input: $input)
  }
`;

// --- Thread + Artifact destructive / favorite mutations ------------------

export const UpdateThreadMutation = gql`
  mutation UpdateThread($id: ID!, $input: UpdateThreadInput!) {
    updateThread(id: $id, input: $input) {
      id
      title
      status
      mode
      modeOverride
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

// THINK-166 U3: saved canvases visible to a thread, keyed by stablePartId —
// resolves checked-out canvas emissions (THINK-145 R13; the artifact row
// lives in the HOME thread) to their original artifact so the transcript can
// collapse the inline emission to a compact ArtifactCard.
export const ThreadCanvasContextQuery = gql`
  query ThreadCanvasContextForTranscript($threadId: ID!) {
    threadCanvasContext(threadId: $threadId) {
      threadId
      savedCanvases {
        artifactId
        title
        status
        headVersion
        stablePartId
        updatedAt
      }
    }
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

// Living Artifacts (THINK-145 U10): the canvas detail query carries the
// version chain (history UI) and the per-widget data-source bindings (freshness
// badges + provenance). `versions` intentionally omits `content` — the snapshot
// payload is hydrated on demand by `ArtifactVersionContentQuery` when a version
// is opened, so the detail read stays light.
const CanvasBindingFields = gql`
  fragment CanvasBindingFields on ArtifactDataBinding {
    id
    partId
    elementId
    mcpServerRef
    serverName
    toolName
    redactedArgs
    resultShapeHash
    authContext
    ownerUserId
    quality
    lastFetchedAt
    lastGoodAt
  }
`;

export const ArtifactDetailForRouteQuery = gql`
  query ArtifactDetailForRoute($id: ID!) {
    artifact(id: $id) {
      id
      tenantId
      threadId
      spaceId
      headVersion
      title
      type
      status
      content
      renderHtml
      summary
      sourceMessageId
      metadata
      favoritedAt
      lastRefreshAt
      refreshFailedAt
      createdAt
      updatedAt
      versions {
        id
        version
        contentHash
        createdBy
        createdByName
        createdAt
      }
      bindings {
        ...CanvasBindingFields
      }
    }
  }
  ${CanvasBindingFields}
`;

// Card self-heal (THINK-155 follow-up): resolve the LIVING document by its
// logical documentId when a thread card's recorded artifactId no longer
// resolves (a fork cleaned up, a re-homed document). Same selection as
// ArtifactDetailForRoute so the panel renders it identically.
export const DocumentArtifactForPanelQuery = gql`
  query DocumentArtifactForPanel($documentId: ID!) {
    documentArtifact(documentId: $documentId) {
      id
      tenantId
      threadId
      spaceId
      headVersion
      title
      type
      status
      content
      renderHtml
      summary
      sourceMessageId
      metadata
      favoritedAt
      lastRefreshAt
      refreshFailedAt
      createdAt
      updatedAt
      versions {
        id
        version
        contentHash
        createdBy
        createdByName
        createdAt
      }
      bindings {
        ...CanvasBindingFields
      }
    }
  }
  ${CanvasBindingFields}
`;

// Document change log (THINK-155 follow-up): one pinned version's rendered
// HTML — precise single-version fetch when a history entry is clicked, never
// a hydrate-all sweep.
export const DocumentVersionRenderQuery = gql`
  query DocumentVersionRender($artifactId: ID!, $version: Int!) {
    documentVersionRender(artifactId: $artifactId, version: $version)
  }
`;

// On-demand read of a single snapshot version's canvas payload (viewing history
// read-only). Fetches all versions' content in one round-trip — canvas parts
// are small and v1 chains are short — and the caller picks the clicked version.
export const ArtifactVersionContentQuery = gql`
  query ArtifactVersionContent($id: ID!) {
    artifact(id: $id) {
      id
      versions {
        id
        version
        content
      }
    }
  }
`;

// Living Artifacts (THINK-145 U10, R14): save a draft canvas — status flip +
// naming + space assignment. Re-saving a saved canvas auto-pins the prior head.
export const SaveCanvasMutation = gql`
  mutation SaveCanvas($artifactId: ID!, $title: String!, $spaceId: ID!) {
    saveCanvas(artifactId: $artifactId, title: $title, spaceId: $spaceId) {
      id
      title
      status
      spaceId
      headVersion
    }
  }
`;

// Snapshot the current canvas head as a write-once, content-addressed version (R11).
export const SnapshotArtifactMutation = gql`
  mutation SnapshotArtifact($artifactId: ID!) {
    snapshotArtifact(artifactId: $artifactId) {
      id
      headVersion
      versions {
        id
        version
        contentHash
        createdAt
      }
    }
  }
`;

// Living Artifacts (THINK-145 U10, R6): headless data-refresh trigger.
// ownerUserId/viewerIsOwner (THINK-167) let the client self-dispatch an
// agent-mediated refresh when the viewer owns a NEEDS_USER binding.
export const RefreshCanvasDataMutation = gql`
  mutation RefreshCanvasData($artifactId: ID!, $partId: String) {
    refreshCanvasData(artifactId: $artifactId, partId: $partId) {
      artifactId
      dispatched
      errorMessage
      bindings {
        bindingId
        partId
        elementId
        outcome
        quality
        reason
        ownerUserId
        viewerIsOwner
      }
    }
  }
`;

// THINK-167: freshness poll while an owner-dispatched agent-mediated refresh
// runs in the background — the view flips from "Refreshing via your
// connection…" to done when the stale bindings read GOOD again.
export const CanvasBindingFreshnessQuery = gql`
  query CanvasBindingFreshness($id: ID!) {
    artifact(id: $id) {
      id
      bindings {
        id
        quality
        lastFetchedAt
      }
    }
  }
`;

// THINK-145/THINK-147: tenant-wide artifact rows for the Artifacts list — EVERY
// kind (living canvases, HTML document artifacts, and any plugin-minted type),
// not just DATA_VIEW canvases. Applet rows are excluded client-side (they come
// from the applets query). Draft canvases stay hidden (`includeDrafts`
// defaults false server-side). `type` drives the Type badge; `userName` is the
// generating user resolved via the source thread.
export const TenantArtifactsListQuery = gql`
  query TenantArtifactsList($tenantId: ID!) {
    artifacts(tenantId: $tenantId, limit: 100) {
      id
      title
      type
      status
      headVersion
      updatedAt
      userName
      metadata
    }
  }
`;

// Living Artifacts (THINK-145 U10, R15): the minimal space entry point — saved
// canvases belonging to one space. `includeDrafts` stays false (default) so
// only saved canvases surface.
export const SpaceCanvasesQuery = gql`
  query SpaceCanvases($tenantId: ID!, $spaceId: ID!) {
    artifacts(
      tenantId: $tenantId
      spaceId: $spaceId
      type: "DATA_VIEW"
      limit: 100
    ) {
      id
      title
      status
      spaceId
      headVersion
      updatedAt
      metadata
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

// THINK-227 U6 (AE5): the automation detail's bound-document card — title,
// current version, refresh state. Deliberately slim (no content/renderHtml).
export const BoundDocumentCardQuery = gql`
  query BoundDocumentCard($id: ID!) {
    artifact(id: $id) {
      id
      title
      type
      status
      headVersion
      lastRefreshAt
      refreshFailedAt
      updatedAt
    }
  }
`;

// Public artifact share links (THINK-208). Mint is get-or-create: re-sharing
// returns the existing active link's URL. Queries never carry a signed token.
export const MintArtifactShareLinkMutation = gql`
  mutation MintArtifactShareLink($artifactId: ID!) {
    mintArtifactShareLink(artifactId: $artifactId) {
      url
      share {
        id
        artifactId
        artifactTitle
        createdBy
        createdByName
        createdAt
      }
    }
  }
`;

export const RevokeArtifactShareLinkMutation = gql`
  mutation RevokeArtifactShareLink($shareId: ID!) {
    revokeArtifactShareLink(shareId: $shareId)
  }
`;

export const ArtifactSharesQuery = gql`
  query ArtifactShares($artifactId: ID!) {
    artifactShares(artifactId: $artifactId) {
      id
      artifactId
      artifactTitle
      createdBy
      createdByName
      createdAt
    }
  }
`;

export const TenantArtifactSharesQuery = gql`
  query TenantArtifactShares($tenantId: ID!) {
    tenantArtifactShares(tenantId: $tenantId) {
      id
      artifactId
      artifactTitle
      createdBy
      createdByName
      createdAt
    }
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

// ─── Document plates (THINK-153 U6+U7) ────────────────────────────────────
// Tenant-scoped genre plates: platform library + tenant deltas/creations.
// AWSJSON fields (tokensLight/tokensDark/overrides, palette*, preview draft
// config) are JSON-encoded strings on the wire — JSON.parse on read,
// JSON.stringify on write.

export const DocumentPlatesListQuery = gql`
  query DocumentPlatesList($tenantId: ID) {
    documentPlates(tenantId: $tenantId) {
      slug
      displayName
      useFor
      eyebrow
      titleSuffix
      tokensLight
      tokensDark
      allowedDirectives
      origin
      hidden
      customized
      overrides
      sections
      analyses
    }
  }
`;

export const DocumentPlatePreviewQuery = gql`
  query DocumentPlatePreview(
    $tenantId: ID
    $slug: String!
    $draftConfig: DocumentPlateDraftConfigInput
  ) {
    documentPlatePreview(
      tenantId: $tenantId
      slug: $slug
      draftConfig: $draftConfig
    ) {
      html
      diagnostics {
        code
        message
      }
    }
  }
`;

// THINK-189: per-plate conformance aggregates (sections/analyses are AWSJSON).
export const PlateConformanceQuery = gql`
  query PlateConformance($tenantId: ID, $slug: String!) {
    plateConformance(tenantId: $tenantId, slug: $slug) {
      plateSlug
      reportCount
      judgedReportCount
      pendingCount
      errorCount
      skippedCount
      sections
      analyses
    }
  }
`;

export const TenantDocumentPaletteQuery = gql`
  query TenantDocumentPalette($tenantId: ID) {
    tenantDocumentPalette(tenantId: $tenantId) {
      light
      dark
    }
  }
`;

export const SaveDocumentPlateMutation = gql`
  mutation SaveDocumentPlate($input: SaveDocumentPlateInput!) {
    saveDocumentPlate(input: $input) {
      slug
      displayName
      useFor
      eyebrow
      titleSuffix
      tokensLight
      tokensDark
      allowedDirectives
      origin
      hidden
      customized
      overrides
      sections
      analyses
    }
  }
`;

export const DeleteDocumentPlateMutation = gql`
  mutation DeleteDocumentPlate($tenantId: ID, $slug: String!) {
    deleteDocumentPlate(tenantId: $tenantId, slug: $slug) {
      ok
      error
    }
  }
`;

export const UpdateTenantDocumentPaletteMutation = gql`
  mutation UpdateTenantDocumentPalette(
    $input: UpdateTenantDocumentPaletteInput!
  ) {
    updateTenantDocumentPalette(input: $input) {
      light
      dark
    }
  }
`;
