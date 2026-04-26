/* eslint-disable */
import * as types from "./graphql";
import { TypedDocumentNode as DocumentNode } from "@graphql-typed-document-node/core";

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
  "\n  query TenantUsersForFormPicker($tenantId: ID!) {\n    tenantMembers(tenantId: $tenantId) {\n      principalType\n      principalId\n      user {\n        id\n        email\n        name\n      }\n    }\n  }\n": typeof types.TenantUsersForFormPickerDocument;
  "\n  query Agents($tenantId: ID!, $status: AgentStatus, $type: AgentType) {\n    agents(tenantId: $tenantId, status: $status, type: $type) {\n      id\n      tenantId\n      name\n      role\n      type\n      status\n      templateId\n      systemPrompt\n      adapterType\n      adapterConfig\n      runtimeConfig\n      lastHeartbeatAt\n      avatarUrl\n      reportsToId\n      humanPairId\n      version\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.AgentsDocument;
  "\n  query Agent($id: ID!) {\n    agent(id: $id) {\n      id\n      tenantId\n      name\n      slug\n      role\n      type\n      status\n      templateId\n      systemPrompt\n      adapterType\n      adapterConfig\n      runtimeConfig\n      lastHeartbeatAt\n      avatarUrl\n      reportsToId\n      humanPairId\n      version\n      capabilities {\n        id\n        capability\n        config\n        enabled\n      }\n      skills {\n        id\n        skillId\n        config\n        permissions\n        rateLimitRpm\n        enabled\n      }\n      budgetPolicy {\n        id\n        period\n        limitUsd\n        actionOnExceed\n      }\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.AgentDocument;
  "\n  mutation CreateAgent($input: CreateAgentInput!) {\n    createAgent(input: $input) {\n      id\n      tenantId\n      name\n      type\n      status\n      createdAt\n    }\n  }\n": typeof types.CreateAgentDocument;
  "\n  mutation UpdateAgent($id: ID!, $input: UpdateAgentInput!) {\n    updateAgent(id: $id, input: $input) {\n      id\n      name\n      role\n      type\n      status\n      templateId\n      systemPrompt\n      updatedAt\n    }\n  }\n": typeof types.UpdateAgentDocument;
  "\n  mutation DeleteAgent($id: ID!) {\n    deleteAgent(id: $id)\n  }\n": typeof types.DeleteAgentDocument;
  "\n  mutation UpdateAgentStatus($id: ID!, $status: AgentStatus!) {\n    updateAgentStatus(id: $id, status: $status) {\n      id\n      status\n      lastHeartbeatAt\n      updatedAt\n    }\n  }\n": typeof types.UpdateAgentStatusDocument;
  "\n  mutation SetAgentCapabilities(\n    $agentId: ID!\n    $capabilities: [AgentCapabilityInput!]!\n  ) {\n    setAgentCapabilities(agentId: $agentId, capabilities: $capabilities) {\n      id\n      capability\n      config\n      enabled\n    }\n  }\n": typeof types.SetAgentCapabilitiesDocument;
  "\n  mutation SetAgentSkills($agentId: ID!, $skills: [AgentSkillInput!]!) {\n    setAgentSkills(agentId: $agentId, skills: $skills) {\n      id\n      skillId\n      config\n      enabled\n    }\n  }\n": typeof types.SetAgentSkillsDocument;
  "\n  mutation SetAgentBudgetPolicy(\n    $agentId: ID!\n    $input: AgentBudgetPolicyInput!\n  ) {\n    setAgentBudgetPolicy(agentId: $agentId, input: $input) {\n      id\n      period\n      limitUsd\n      actionOnExceed\n    }\n  }\n": typeof types.SetAgentBudgetPolicyDocument;
  "\n  mutation SendMessage($input: SendMessageInput!) {\n    sendMessage(input: $input) {\n      id\n      threadId\n      tenantId\n      role\n      content\n      senderType\n      senderId\n      createdAt\n    }\n  }\n": typeof types.SendMessageDocument;
  "\n  mutation DeleteMessage($id: ID!) {\n    deleteMessage(id: $id)\n  }\n": typeof types.DeleteMessageDocument;
  "\n  query Messages($threadId: ID!, $limit: Int, $cursor: String) {\n    messages(threadId: $threadId, limit: $limit, cursor: $cursor) {\n      edges {\n        node {\n          id\n          threadId\n          tenantId\n          role\n          content\n          senderType\n          senderId\n          toolCalls\n          toolResults\n          metadata\n          tokenCount\n          durableArtifact {\n            id\n            title\n            type\n            status\n            content\n            summary\n          }\n          createdAt\n        }\n        cursor\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n": typeof types.MessagesDocument;
  "\n  query Teams($tenantId: ID!) {\n    teams(tenantId: $tenantId) {\n      id\n      tenantId\n      name\n      description\n      type\n      status\n      budgetMonthlyCents\n      metadata\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.TeamsDocument;
  "\n  query Team($id: ID!) {\n    team(id: $id) {\n      id\n      tenantId\n      name\n      description\n      type\n      status\n      budgetMonthlyCents\n      metadata\n      agents {\n        id\n        agentId\n        role\n        joinedAt\n        agent {\n          id\n          name\n          type\n          status\n          avatarUrl\n        }\n      }\n      users {\n        id\n        userId\n        role\n        joinedAt\n        user {\n          id\n          name\n          email\n          image\n        }\n      }\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.TeamDocument;
  "\n  mutation CreateTeam($input: CreateTeamInput!) {\n    createTeam(input: $input) {\n      id\n      tenantId\n      name\n      type\n      status\n      createdAt\n    }\n  }\n": typeof types.CreateTeamDocument;
  "\n  mutation UpdateTeam($id: ID!, $input: UpdateTeamInput!) {\n    updateTeam(id: $id, input: $input) {\n      id\n      name\n      description\n      status\n      updatedAt\n    }\n  }\n": typeof types.UpdateTeamDocument;
  "\n  mutation DeleteTeam($id: ID!) {\n    deleteTeam(id: $id)\n  }\n": typeof types.DeleteTeamDocument;
  "\n  mutation AddTeamAgent($teamId: ID!, $input: AddTeamAgentInput!) {\n    addTeamAgent(teamId: $teamId, input: $input) {\n      id\n      teamId\n      agentId\n      role\n      joinedAt\n    }\n  }\n": typeof types.AddTeamAgentDocument;
  "\n  mutation RemoveTeamAgent($teamId: ID!, $agentId: ID!) {\n    removeTeamAgent(teamId: $teamId, agentId: $agentId)\n  }\n": typeof types.RemoveTeamAgentDocument;
  "\n  mutation AddTeamUser($teamId: ID!, $input: AddTeamUserInput!) {\n    addTeamUser(teamId: $teamId, input: $input) {\n      id\n      teamId\n      userId\n      role\n      joinedAt\n    }\n  }\n": typeof types.AddTeamUserDocument;
  "\n  mutation RemoveTeamUser($teamId: ID!, $userId: ID!) {\n    removeTeamUser(teamId: $teamId, userId: $userId)\n  }\n": typeof types.RemoveTeamUserDocument;
  "\n  query Routines(\n    $tenantId: ID!\n    $teamId: ID\n    $agentId: ID\n    $status: RoutineStatus\n  ) {\n    routines(\n      tenantId: $tenantId\n      teamId: $teamId\n      agentId: $agentId\n      status: $status\n    ) {\n      id\n      tenantId\n      teamId\n      agentId\n      name\n      description\n      type\n      status\n      schedule\n      config\n      lastRunAt\n      nextRunAt\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.RoutinesDocument;
  "\n  query Routine($id: ID!) {\n    routine(id: $id) {\n      id\n      tenantId\n      teamId\n      agentId\n      name\n      description\n      type\n      status\n      schedule\n      config\n      lastRunAt\n      nextRunAt\n      triggers {\n        id\n        triggerType\n        config\n        enabled\n      }\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.RoutineDocument;
  "\n  query RoutineRuns($routineId: ID!, $limit: Int, $cursor: String) {\n    routineRuns(routineId: $routineId, limit: $limit, cursor: $cursor) {\n      id\n      routineId\n      status\n      startedAt\n      completedAt\n      error\n      metadata\n      createdAt\n    }\n  }\n": typeof types.RoutineRunsDocument;
  "\n  query RoutineRunDetail($id: ID!) {\n    routineRun(id: $id) {\n      id\n      routineId\n      status\n      startedAt\n      completedAt\n      error\n      metadata\n      steps {\n        id\n        stepIndex\n        name\n        status\n        input\n        output\n        startedAt\n        completedAt\n        error\n      }\n      createdAt\n    }\n  }\n": typeof types.RoutineRunDetailDocument;
  "\n  mutation CreateRoutine($input: CreateRoutineInput!) {\n    createRoutine(input: $input) {\n      id\n      tenantId\n      name\n      type\n      status\n      createdAt\n    }\n  }\n": typeof types.CreateRoutineDocument;
  "\n  mutation UpdateRoutine($id: ID!, $input: UpdateRoutineInput!) {\n    updateRoutine(id: $id, input: $input) {\n      id\n      name\n      description\n      status\n      schedule\n      updatedAt\n    }\n  }\n": typeof types.UpdateRoutineDocument;
  "\n  mutation DeleteRoutine($id: ID!) {\n    deleteRoutine(id: $id)\n  }\n": typeof types.DeleteRoutineDocument;
  "\n  mutation TriggerRoutineRun($routineId: ID!) {\n    triggerRoutineRun(routineId: $routineId) {\n      id\n      routineId\n      status\n      createdAt\n    }\n  }\n": typeof types.TriggerRoutineRunDocument;
  "\n  mutation SetRoutineTrigger($routineId: ID!, $input: RoutineTriggerInput!) {\n    setRoutineTrigger(routineId: $routineId, input: $input) {\n      id\n      triggerType\n      config\n      enabled\n    }\n  }\n": typeof types.SetRoutineTriggerDocument;
  "\n  mutation DeleteRoutineTrigger($id: ID!) {\n    deleteRoutineTrigger(id: $id)\n  }\n": typeof types.DeleteRoutineTriggerDocument;
  "\n  query ThreadTurns(\n    $tenantId: ID!\n    $agentId: ID\n    $status: String\n    $limit: Int\n  ) {\n    threadTurns(\n      tenantId: $tenantId\n      agentId: $agentId\n      status: $status\n      limit: $limit\n    ) {\n      id\n      tenantId\n      triggerId\n      agentId\n      routineId\n      invocationSource\n      triggerDetail\n      status\n      startedAt\n      finishedAt\n      error\n      errorCode\n      usageJson\n      resultJson\n      createdAt\n    }\n  }\n": typeof types.ThreadTurnsDocument;
  "\n  query ThreadTurnDetail($id: ID!) {\n    threadTurn(id: $id) {\n      id\n      tenantId\n      triggerId\n      agentId\n      routineId\n      invocationSource\n      triggerDetail\n      wakeupRequestId\n      status\n      startedAt\n      finishedAt\n      error\n      errorCode\n      usageJson\n      resultJson\n      sessionIdBefore\n      sessionIdAfter\n      externalRunId\n      contextSnapshot\n      createdAt\n    }\n  }\n": typeof types.ThreadTurnDetailDocument;
  "\n  query ThreadTurnEvents($runId: ID!, $afterSeq: Int, $limit: Int) {\n    threadTurnEvents(runId: $runId, afterSeq: $afterSeq, limit: $limit) {\n      id\n      runId\n      agentId\n      seq\n      eventType\n      stream\n      level\n      color\n      message\n      payload\n      createdAt\n    }\n  }\n": typeof types.ThreadTurnEventsDocument;
  "\n  query TurnInvocationLogs($tenantId: ID!, $turnId: ID!) {\n    turnInvocationLogs(tenantId: $tenantId, turnId: $turnId) {\n      requestId\n      modelId\n      timestamp\n      inputTokenCount\n      outputTokenCount\n      cacheReadTokenCount\n      inputPreview\n      outputPreview\n      toolCount\n      costUsd\n      toolUses\n      hasToolResult\n      branch\n    }\n  }\n": typeof types.TurnInvocationLogsDocument;
  "\n  mutation CancelThreadTurn($id: ID!) {\n    cancelThreadTurn(id: $id) {\n      id\n      status\n      finishedAt\n    }\n  }\n": typeof types.CancelThreadTurnDocument;
  "\n  mutation CreateWakeupRequest($input: CreateWakeupRequestInput!) {\n    createWakeupRequest(input: $input) {\n      id\n      tenantId\n      agentId\n      source\n      status\n      createdAt\n    }\n  }\n": typeof types.CreateWakeupRequestDocument;
  "\n  query ScheduledJobs(\n    $tenantId: ID!\n    $agentId: ID\n    $routineId: ID\n    $triggerType: String\n    $enabled: Boolean\n    $limit: Int\n  ) {\n    scheduledJobs(\n      tenantId: $tenantId\n      agentId: $agentId\n      routineId: $routineId\n      triggerType: $triggerType\n      enabled: $enabled\n      limit: $limit\n    ) {\n      id\n      tenantId\n      triggerType\n      agentId\n      routineId\n      teamId\n      name\n      description\n      scheduleType\n      scheduleExpression\n      timezone\n      enabled\n      lastRunAt\n      nextRunAt\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.ScheduledJobsDocument;
  "\n  query Tenant($id: ID!) {\n    tenant(id: $id) {\n      id\n      name\n      slug\n      plan\n      issuePrefix\n      issueCounter\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.TenantDocument;
  "\n  query TenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      name\n      slug\n      plan\n      issuePrefix\n      issueCounter\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.TenantBySlugDocument;
  "\n  query TenantMembers($tenantId: ID!) {\n    tenantMembers(tenantId: $tenantId) {\n      id\n      tenantId\n      principalType\n      principalId\n      role\n      status\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.TenantMembersDocument;
  "\n  mutation UpdateTenant($id: ID!, $input: UpdateTenantInput!) {\n    updateTenant(id: $id, input: $input) {\n      id\n      name\n      plan\n      issuePrefix\n      updatedAt\n    }\n  }\n": typeof types.UpdateTenantDocument;
  "\n  mutation UpdateTenantSettings(\n    $tenantId: ID!\n    $input: UpdateTenantSettingsInput!\n  ) {\n    updateTenantSettings(tenantId: $tenantId, input: $input) {\n      id\n      defaultModel\n      budgetMonthlyCents\n      autoCloseThreadMinutes\n      maxAgents\n      features\n      updatedAt\n    }\n  }\n": typeof types.UpdateTenantSettingsDocument;
  "\n  mutation AddTenantMember($tenantId: ID!, $input: AddTenantMemberInput!) {\n    addTenantMember(tenantId: $tenantId, input: $input) {\n      id\n      principalType\n      principalId\n      role\n      status\n    }\n  }\n": typeof types.AddTenantMemberDocument;
  "\n  mutation RemoveTenantMember($id: ID!) {\n    removeTenantMember(id: $id)\n  }\n": typeof types.RemoveTenantMemberDocument;
  "\n  query Me {\n    me {\n      id\n      tenantId\n      email\n      name\n      image\n      phone\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.MeDocument;
  "\n  query User($id: ID!) {\n    user(id: $id) {\n      id\n      tenantId\n      email\n      name\n      image\n      phone\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.UserDocument;
  "\n  mutation UpdateUser($id: ID!, $input: UpdateUserInput!) {\n    updateUser(id: $id, input: $input) {\n      id\n      name\n      image\n      phone\n      updatedAt\n    }\n  }\n": typeof types.UpdateUserDocument;
  "\n  mutation UpdateUserProfile($userId: ID!, $input: UpdateUserProfileInput!) {\n    updateUserProfile(userId: $userId, input: $input) {\n      id\n      displayName\n      theme\n      notificationPreferences\n      updatedAt\n    }\n  }\n": typeof types.UpdateUserProfileDocument;
  "\n  query ActivationSession($sessionId: ID!) {\n    activationSession(sessionId: $sessionId) {\n      id\n      userId\n      tenantId\n      mode\n      focusLayer\n      currentLayer\n      status\n      layerStates\n      lastAgentMessage\n      updatedAt\n    }\n  }\n": typeof types.ActivationSessionDocument;
  "\n  mutation StartActivation($input: StartActivationInput!) {\n    startActivation(input: $input) {\n      id\n      mode\n      focusLayer\n      currentLayer\n      status\n      layerStates\n      lastAgentMessage\n    }\n  }\n": typeof types.StartActivationDocument;
  "\n  mutation SubmitActivationTurn($input: SubmitActivationTurnInput!) {\n    submitActivationTurn(input: $input) {\n      id\n      currentLayer\n      status\n      layerStates\n      lastAgentMessage\n    }\n  }\n": typeof types.SubmitActivationTurnDocument;
  "\n  mutation CheckpointActivationLayer($input: CheckpointActivationLayerInput!) {\n    checkpointActivationLayer(input: $input) {\n      id\n      currentLayer\n      status\n      layerStates\n      lastAgentMessage\n    }\n  }\n": typeof types.CheckpointActivationLayerDocument;
  "\n  mutation ApplyActivationBundle($input: ApplyActivationBundleInput!) {\n    applyActivationBundle(input: $input) {\n      id\n      status\n      layerStates\n      completedAt\n    }\n  }\n": typeof types.ApplyActivationBundleDocument;
  "\n  mutation DismissActivationRecommendation($input: DismissActivationRecommendationInput!) {\n    dismissActivationRecommendation(input: $input) {\n      id\n      layerStates\n      updatedAt\n    }\n  }\n": typeof types.DismissActivationRecommendationDocument;
  "\n  query Threads(\n    $tenantId: ID!\n    $channel: ThreadChannel\n    $agentId: ID\n    $assigneeId: ID\n    $limit: Int\n    $cursor: String\n  ) {\n    threads(\n      tenantId: $tenantId\n      channel: $channel\n      agentId: $agentId\n      assigneeId: $assigneeId\n      limit: $limit\n      cursor: $cursor\n    ) {\n      id\n      tenantId\n      agentId\n      number\n      identifier\n      title\n      status\n      lifecycleStatus\n      channel\n      assigneeType\n      assigneeId\n      assignee {\n        id\n        name\n      }\n      reporterId\n      labels\n      metadata\n      dueAt\n      closedAt\n      archivedAt\n      lastActivityAt\n      lastTurnCompletedAt\n      lastReadAt\n      lastResponsePreview\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.ThreadsDocument;
  "\n  query Thread($id: ID!) {\n    thread(id: $id) {\n      id\n      tenantId\n      agentId\n      number\n      identifier\n      title\n      status\n      lifecycleStatus\n      channel\n      assigneeType\n      assigneeId\n      reporterId\n      labels\n      metadata\n      dueAt\n      closedAt\n      messages(limit: 100) {\n        edges {\n          node {\n            id\n            role\n            content\n            senderType\n            senderId\n            createdAt\n            durableArtifact {\n              id\n              title\n              type\n              status\n            }\n          }\n        }\n      }\n      attachments {\n        id\n        name\n        s3Key\n        mimeType\n        sizeBytes\n        createdAt\n      }\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.ThreadDocument;
  "\n  mutation CreateThread($input: CreateThreadInput!) {\n    createThread(input: $input) {\n      id\n      number\n      title\n      status\n      createdAt\n    }\n  }\n": typeof types.CreateThreadDocument;
  "\n  mutation UpdateThread($id: ID!, $input: UpdateThreadInput!) {\n    updateThread(id: $id, input: $input) {\n      id\n      title\n      status\n      updatedAt\n    }\n  }\n": typeof types.UpdateThreadDocument;
  "\n  subscription OnAgentStatusChanged($tenantId: ID!) {\n    onAgentStatusChanged(tenantId: $tenantId) {\n      agentId\n      tenantId\n      status\n      name\n      updatedAt\n    }\n  }\n": typeof types.OnAgentStatusChangedDocument;
  "\n  subscription OnNewMessage($threadId: ID!) {\n    onNewMessage(threadId: $threadId) {\n      messageId\n      threadId\n      tenantId\n      role\n      content\n      senderType\n      senderId\n      createdAt\n    }\n  }\n": typeof types.OnNewMessageDocument;
  "\n  subscription OnHeartbeatActivity($tenantId: ID!) {\n    onHeartbeatActivity(tenantId: $tenantId) {\n      heartbeatId\n      tenantId\n      status\n      message\n      createdAt\n    }\n  }\n": typeof types.OnHeartbeatActivityDocument;
  "\n  subscription OnThreadUpdated($tenantId: ID!) {\n    onThreadUpdated(tenantId: $tenantId) {\n      threadId\n      tenantId\n      status\n      title\n      updatedAt\n    }\n  }\n": typeof types.OnThreadUpdatedDocument;
  "\n  subscription OnThreadTurnUpdated($tenantId: ID!) {\n    onThreadTurnUpdated(tenantId: $tenantId) {\n      runId\n      triggerId\n      threadId\n      tenantId\n      status\n      triggerName\n      updatedAt\n    }\n  }\n": typeof types.OnThreadTurnUpdatedDocument;
  "\n  subscription OnInboxItemStatusChanged($tenantId: ID!) {\n    onInboxItemStatusChanged(tenantId: $tenantId) {\n      inboxItemId\n      tenantId\n      status\n      title\n      updatedAt\n    }\n  }\n": typeof types.OnInboxItemStatusChangedDocument;
  "\n  query InboxItems(\n    $tenantId: ID!\n    $status: InboxItemStatus\n    $entityType: String\n    $entityId: ID\n  ) {\n    inboxItems(\n      tenantId: $tenantId\n      status: $status\n      entityType: $entityType\n      entityId: $entityId\n    ) {\n      id\n      tenantId\n      requesterType\n      requesterId\n      type\n      status\n      title\n      description\n      entityType\n      entityId\n      config\n      revision\n      reviewNotes\n      decidedBy\n      decidedAt\n      expiresAt\n      comments {\n        id\n        inboxItemId\n        authorType\n        authorId\n        content\n        createdAt\n      }\n      links {\n        id\n        linkedType\n        linkedId\n        createdAt\n      }\n      linkedThreads {\n        id\n        number\n        identifier\n        title\n        status\n      }\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.InboxItemsDocument;
  "\n  query InboxItem($id: ID!) {\n    inboxItem(id: $id) {\n      id\n      tenantId\n      requesterType\n      requesterId\n      type\n      status\n      title\n      description\n      entityType\n      entityId\n      config\n      revision\n      reviewNotes\n      decidedBy\n      decidedAt\n      expiresAt\n      comments {\n        id\n        inboxItemId\n        authorType\n        authorId\n        content\n        createdAt\n      }\n      links {\n        id\n        linkedType\n        linkedId\n        createdAt\n      }\n      linkedThreads {\n        id\n        number\n        identifier\n        title\n        status\n      }\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.InboxItemDocument;
  "\n  mutation DecideInboxItem($id: ID!, $input: InboxItemDecisionInput!) {\n    decideInboxItem(id: $id, input: $input) {\n      id\n      status\n      reviewNotes\n      decidedBy\n      decidedAt\n      updatedAt\n    }\n  }\n": typeof types.DecideInboxItemDocument;
  "\n  mutation AddInboxItemComment($input: AddInboxItemCommentInput!) {\n    addInboxItemComment(input: $input) {\n      id\n      inboxItemId\n      content\n      authorType\n      authorId\n      createdAt\n    }\n  }\n": typeof types.AddInboxItemCommentDocument;
  "\n  subscription OnOrgUpdated($tenantId: ID!) {\n    onOrgUpdated(tenantId: $tenantId) {\n      tenantId\n      changeType\n      entityType\n      entityId\n      updatedAt\n    }\n  }\n": typeof types.OnOrgUpdatedDocument;
  "\n  query ThreadTurnsForThread($tenantId: ID!, $threadId: ID!, $limit: Int) {\n    threadTurns(tenantId: $tenantId, threadId: $threadId, limit: $limit) {\n      id\n      tenantId\n      agentId\n      invocationSource\n      triggerDetail\n      triggerName\n      threadId\n      turnNumber\n      status\n      startedAt\n      finishedAt\n      error\n      resultJson\n      usageJson\n      totalCost\n      retryAttempt\n      originTurnId\n      createdAt\n    }\n  }\n": typeof types.ThreadTurnsForThreadDocument;
  "\n  query ArtifactsForThread($tenantId: ID!, $threadId: ID!, $limit: Int) {\n    artifacts(tenantId: $tenantId, threadId: $threadId, limit: $limit) {\n      id\n      tenantId\n      agentId\n      threadId\n      title\n      type\n      status\n      summary\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.ArtifactsForThreadDocument;
  "\n  query ArtifactDetail($id: ID!) {\n    artifact(id: $id) {\n      id\n      title\n      type\n      status\n      content\n      summary\n      createdAt\n    }\n  }\n": typeof types.ArtifactDetailDocument;
  '\n  query MemoryRecords($assistantId: ID!, $namespace: String!) {\n    memoryRecords(assistantId: $assistantId, namespace: $namespace) {\n      memoryRecordId\n      content {\n        text\n      }\n      createdAt\n      updatedAt\n      expiresAt\n      namespace\n      strategyId\n      # "Contributes to:" chips — Unit 8 / handoff #3. One nested resolver\n      # call per record, capped at typical list size ≤50. DataLoader is a\n      # future optimization if large result sets become the norm.\n      wikiPages {\n        id\n        type\n        slug\n        title\n      }\n    }\n  }\n': typeof types.MemoryRecordsDocument;
  "\n  mutation DeleteMemoryRecord($memoryRecordId: ID!) {\n    deleteMemoryRecord(memoryRecordId: $memoryRecordId)\n  }\n": typeof types.DeleteMemoryRecordDocument;
  "\n  mutation UpdateMemoryRecord($memoryRecordId: ID!, $content: String!) {\n    updateMemoryRecord(memoryRecordId: $memoryRecordId, content: $content)\n  }\n": typeof types.UpdateMemoryRecordDocument;
  "\n  query AgentWorkspaceReviews(\n    $tenantId: ID!\n    $agentId: ID\n    $status: String\n    $limit: Int\n  ) {\n    agentWorkspaceReviews(\n      tenantId: $tenantId\n      agentId: $agentId\n      status: $status\n      limit: $limit\n    ) {\n      threadId\n      reviewObjectKey\n      targetPath\n      requestedAt\n      reason\n      payload\n      reviewEtag\n      run {\n        id\n        agentId\n        targetPath\n        status\n        currentWakeupRequestId\n        currentThreadTurnId\n        lastEventAt\n        createdAt\n        updatedAt\n      }\n      latestEvent {\n        id\n        eventType\n        reason\n        sourceObjectKey\n        payload\n        createdAt\n      }\n    }\n  }\n": typeof types.AgentWorkspaceReviewsDocument;
  "\n  query AgentWorkspaceReview($runId: ID!) {\n    agentWorkspaceReview(runId: $runId) {\n      threadId\n      reviewObjectKey\n      targetPath\n      requestedAt\n      reason\n      payload\n      reviewBody\n      reviewEtag\n      reviewMissing\n      proposedChanges {\n        path\n        kind\n        summary\n        diff\n        before\n        after\n      }\n      run {\n        id\n        tenantId\n        agentId\n        targetPath\n        status\n        currentWakeupRequestId\n        currentThreadTurnId\n        lastEventAt\n        createdAt\n        updatedAt\n      }\n      events {\n        id\n        eventType\n        reason\n        sourceObjectKey\n        payload\n        createdAt\n      }\n      decisionEvents {\n        id\n        eventType\n        reason\n        actorType\n        actorId\n        payload\n        createdAt\n      }\n    }\n  }\n": typeof types.AgentWorkspaceReviewDocument;
  "\n  mutation AcceptAgentWorkspaceReview(\n    $runId: ID!\n    $input: AgentWorkspaceReviewDecisionInput\n  ) {\n    acceptAgentWorkspaceReview(runId: $runId, input: $input) {\n      id\n      status\n      currentWakeupRequestId\n      updatedAt\n    }\n  }\n": typeof types.AcceptAgentWorkspaceReviewDocument;
  "\n  mutation CancelAgentWorkspaceReview(\n    $runId: ID!\n    $input: AgentWorkspaceReviewDecisionInput\n  ) {\n    cancelAgentWorkspaceReview(runId: $runId, input: $input) {\n      id\n      status\n      updatedAt\n    }\n  }\n": typeof types.CancelAgentWorkspaceReviewDocument;
  "\n  mutation ResumeAgentWorkspaceRun(\n    $runId: ID!\n    $input: AgentWorkspaceReviewDecisionInput\n  ) {\n    resumeAgentWorkspaceRun(runId: $runId, input: $input) {\n      id\n      status\n      currentWakeupRequestId\n      updatedAt\n    }\n  }\n": typeof types.ResumeAgentWorkspaceRunDocument;
  "\n  mutation RegisterPushToken($input: RegisterPushTokenInput!) {\n    registerPushToken(input: $input)\n  }\n": typeof types.RegisterPushTokenDocument;
  "\n  mutation UnregisterPushToken($token: String!) {\n    unregisterPushToken(token: $token)\n  }\n": typeof types.UnregisterPushTokenDocument;
  "\n  query AgentWorkspaces($agentId: ID!) {\n    agentWorkspaces(agentId: $agentId) {\n      slug\n      name\n      purpose\n    }\n  }\n": typeof types.AgentWorkspacesDocument;
  "\n  query UserQuickActions($tenantId: ID!) {\n    userQuickActions(tenantId: $tenantId) {\n      id\n      userId\n      tenantId\n      title\n      prompt\n      workspaceAgentId\n      sortOrder\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.UserQuickActionsDocument;
  "\n  mutation CreateQuickAction($input: CreateQuickActionInput!) {\n    createQuickAction(input: $input) {\n      id\n      userId\n      tenantId\n      title\n      prompt\n      workspaceAgentId\n      sortOrder\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.CreateQuickActionDocument;
  "\n  mutation UpdateQuickAction($id: ID!, $input: UpdateQuickActionInput!) {\n    updateQuickAction(id: $id, input: $input) {\n      id\n      userId\n      tenantId\n      title\n      prompt\n      workspaceAgentId\n      sortOrder\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.UpdateQuickActionDocument;
  "\n  mutation DeleteQuickAction($id: ID!) {\n    deleteQuickAction(id: $id)\n  }\n": typeof types.DeleteQuickActionDocument;
  "\n  mutation ReorderQuickActions($input: ReorderQuickActionsInput!) {\n    reorderQuickActions(input: $input) {\n      id\n      sortOrder\n    }\n  }\n": typeof types.ReorderQuickActionsDocument;
  "\n  mutation RefreshGenUI($messageId: ID!, $toolIndex: Int!) {\n    refreshGenUI(messageId: $messageId, toolIndex: $toolIndex) {\n      id\n      toolResults\n    }\n  }\n": typeof types.RefreshGenUiDocument;
  "\n  mutation CreateRecipe($input: CreateRecipeInput!) {\n    createRecipe(input: $input) {\n      id\n      title\n      genuiType\n    }\n  }\n": typeof types.CreateRecipeDocument;
};
const documents: Documents = {
  "\n  query TenantUsersForFormPicker($tenantId: ID!) {\n    tenantMembers(tenantId: $tenantId) {\n      principalType\n      principalId\n      user {\n        id\n        email\n        name\n      }\n    }\n  }\n":
    types.TenantUsersForFormPickerDocument,
  "\n  query Agents($tenantId: ID!, $status: AgentStatus, $type: AgentType) {\n    agents(tenantId: $tenantId, status: $status, type: $type) {\n      id\n      tenantId\n      name\n      role\n      type\n      status\n      templateId\n      systemPrompt\n      adapterType\n      adapterConfig\n      runtimeConfig\n      lastHeartbeatAt\n      avatarUrl\n      reportsToId\n      humanPairId\n      version\n      createdAt\n      updatedAt\n    }\n  }\n":
    types.AgentsDocument,
  "\n  query Agent($id: ID!) {\n    agent(id: $id) {\n      id\n      tenantId\n      name\n      slug\n      role\n      type\n      status\n      templateId\n      systemPrompt\n      adapterType\n      adapterConfig\n      runtimeConfig\n      lastHeartbeatAt\n      avatarUrl\n      reportsToId\n      humanPairId\n      version\n      capabilities {\n        id\n        capability\n        config\n        enabled\n      }\n      skills {\n        id\n        skillId\n        config\n        permissions\n        rateLimitRpm\n        enabled\n      }\n      budgetPolicy {\n        id\n        period\n        limitUsd\n        actionOnExceed\n      }\n      createdAt\n      updatedAt\n    }\n  }\n":
    types.AgentDocument,
  "\n  mutation CreateAgent($input: CreateAgentInput!) {\n    createAgent(input: $input) {\n      id\n      tenantId\n      name\n      type\n      status\n      createdAt\n    }\n  }\n":
    types.CreateAgentDocument,
  "\n  mutation UpdateAgent($id: ID!, $input: UpdateAgentInput!) {\n    updateAgent(id: $id, input: $input) {\n      id\n      name\n      role\n      type\n      status\n      templateId\n      systemPrompt\n      updatedAt\n    }\n  }\n":
    types.UpdateAgentDocument,
  "\n  mutation DeleteAgent($id: ID!) {\n    deleteAgent(id: $id)\n  }\n":
    types.DeleteAgentDocument,
  "\n  mutation UpdateAgentStatus($id: ID!, $status: AgentStatus!) {\n    updateAgentStatus(id: $id, status: $status) {\n      id\n      status\n      lastHeartbeatAt\n      updatedAt\n    }\n  }\n":
    types.UpdateAgentStatusDocument,
  "\n  mutation SetAgentCapabilities(\n    $agentId: ID!\n    $capabilities: [AgentCapabilityInput!]!\n  ) {\n    setAgentCapabilities(agentId: $agentId, capabilities: $capabilities) {\n      id\n      capability\n      config\n      enabled\n    }\n  }\n":
    types.SetAgentCapabilitiesDocument,
  "\n  mutation SetAgentSkills($agentId: ID!, $skills: [AgentSkillInput!]!) {\n    setAgentSkills(agentId: $agentId, skills: $skills) {\n      id\n      skillId\n      config\n      enabled\n    }\n  }\n":
    types.SetAgentSkillsDocument,
  "\n  mutation SetAgentBudgetPolicy(\n    $agentId: ID!\n    $input: AgentBudgetPolicyInput!\n  ) {\n    setAgentBudgetPolicy(agentId: $agentId, input: $input) {\n      id\n      period\n      limitUsd\n      actionOnExceed\n    }\n  }\n":
    types.SetAgentBudgetPolicyDocument,
  "\n  mutation SendMessage($input: SendMessageInput!) {\n    sendMessage(input: $input) {\n      id\n      threadId\n      tenantId\n      role\n      content\n      senderType\n      senderId\n      createdAt\n    }\n  }\n":
    types.SendMessageDocument,
  "\n  mutation DeleteMessage($id: ID!) {\n    deleteMessage(id: $id)\n  }\n":
    types.DeleteMessageDocument,
  "\n  query Messages($threadId: ID!, $limit: Int, $cursor: String) {\n    messages(threadId: $threadId, limit: $limit, cursor: $cursor) {\n      edges {\n        node {\n          id\n          threadId\n          tenantId\n          role\n          content\n          senderType\n          senderId\n          toolCalls\n          toolResults\n          metadata\n          tokenCount\n          durableArtifact {\n            id\n            title\n            type\n            status\n            content\n            summary\n          }\n          createdAt\n        }\n        cursor\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n":
    types.MessagesDocument,
  "\n  query Teams($tenantId: ID!) {\n    teams(tenantId: $tenantId) {\n      id\n      tenantId\n      name\n      description\n      type\n      status\n      budgetMonthlyCents\n      metadata\n      createdAt\n      updatedAt\n    }\n  }\n":
    types.TeamsDocument,
  "\n  query Team($id: ID!) {\n    team(id: $id) {\n      id\n      tenantId\n      name\n      description\n      type\n      status\n      budgetMonthlyCents\n      metadata\n      agents {\n        id\n        agentId\n        role\n        joinedAt\n        agent {\n          id\n          name\n          type\n          status\n          avatarUrl\n        }\n      }\n      users {\n        id\n        userId\n        role\n        joinedAt\n        user {\n          id\n          name\n          email\n          image\n        }\n      }\n      createdAt\n      updatedAt\n    }\n  }\n":
    types.TeamDocument,
  "\n  mutation CreateTeam($input: CreateTeamInput!) {\n    createTeam(input: $input) {\n      id\n      tenantId\n      name\n      type\n      status\n      createdAt\n    }\n  }\n":
    types.CreateTeamDocument,
  "\n  mutation UpdateTeam($id: ID!, $input: UpdateTeamInput!) {\n    updateTeam(id: $id, input: $input) {\n      id\n      name\n      description\n      status\n      updatedAt\n    }\n  }\n":
    types.UpdateTeamDocument,
  "\n  mutation DeleteTeam($id: ID!) {\n    deleteTeam(id: $id)\n  }\n":
    types.DeleteTeamDocument,
  "\n  mutation AddTeamAgent($teamId: ID!, $input: AddTeamAgentInput!) {\n    addTeamAgent(teamId: $teamId, input: $input) {\n      id\n      teamId\n      agentId\n      role\n      joinedAt\n    }\n  }\n":
    types.AddTeamAgentDocument,
  "\n  mutation RemoveTeamAgent($teamId: ID!, $agentId: ID!) {\n    removeTeamAgent(teamId: $teamId, agentId: $agentId)\n  }\n":
    types.RemoveTeamAgentDocument,
  "\n  mutation AddTeamUser($teamId: ID!, $input: AddTeamUserInput!) {\n    addTeamUser(teamId: $teamId, input: $input) {\n      id\n      teamId\n      userId\n      role\n      joinedAt\n    }\n  }\n":
    types.AddTeamUserDocument,
  "\n  mutation RemoveTeamUser($teamId: ID!, $userId: ID!) {\n    removeTeamUser(teamId: $teamId, userId: $userId)\n  }\n":
    types.RemoveTeamUserDocument,
  "\n  query Routines(\n    $tenantId: ID!\n    $teamId: ID\n    $agentId: ID\n    $status: RoutineStatus\n  ) {\n    routines(\n      tenantId: $tenantId\n      teamId: $teamId\n      agentId: $agentId\n      status: $status\n    ) {\n      id\n      tenantId\n      teamId\n      agentId\n      name\n      description\n      type\n      status\n      schedule\n      config\n      lastRunAt\n      nextRunAt\n      createdAt\n      updatedAt\n    }\n  }\n":
    types.RoutinesDocument,
  "\n  query Routine($id: ID!) {\n    routine(id: $id) {\n      id\n      tenantId\n      teamId\n      agentId\n      name\n      description\n      type\n      status\n      schedule\n      config\n      lastRunAt\n      nextRunAt\n      triggers {\n        id\n        triggerType\n        config\n        enabled\n      }\n      createdAt\n      updatedAt\n    }\n  }\n":
    types.RoutineDocument,
  "\n  query RoutineRuns($routineId: ID!, $limit: Int, $cursor: String) {\n    routineRuns(routineId: $routineId, limit: $limit, cursor: $cursor) {\n      id\n      routineId\n      status\n      startedAt\n      completedAt\n      error\n      metadata\n      createdAt\n    }\n  }\n":
    types.RoutineRunsDocument,
  "\n  query RoutineRunDetail($id: ID!) {\n    routineRun(id: $id) {\n      id\n      routineId\n      status\n      startedAt\n      completedAt\n      error\n      metadata\n      steps {\n        id\n        stepIndex\n        name\n        status\n        input\n        output\n        startedAt\n        completedAt\n        error\n      }\n      createdAt\n    }\n  }\n":
    types.RoutineRunDetailDocument,
  "\n  mutation CreateRoutine($input: CreateRoutineInput!) {\n    createRoutine(input: $input) {\n      id\n      tenantId\n      name\n      type\n      status\n      createdAt\n    }\n  }\n":
    types.CreateRoutineDocument,
  "\n  mutation UpdateRoutine($id: ID!, $input: UpdateRoutineInput!) {\n    updateRoutine(id: $id, input: $input) {\n      id\n      name\n      description\n      status\n      schedule\n      updatedAt\n    }\n  }\n":
    types.UpdateRoutineDocument,
  "\n  mutation DeleteRoutine($id: ID!) {\n    deleteRoutine(id: $id)\n  }\n":
    types.DeleteRoutineDocument,
  "\n  mutation TriggerRoutineRun($routineId: ID!) {\n    triggerRoutineRun(routineId: $routineId) {\n      id\n      routineId\n      status\n      createdAt\n    }\n  }\n":
    types.TriggerRoutineRunDocument,
  "\n  mutation SetRoutineTrigger($routineId: ID!, $input: RoutineTriggerInput!) {\n    setRoutineTrigger(routineId: $routineId, input: $input) {\n      id\n      triggerType\n      config\n      enabled\n    }\n  }\n":
    types.SetRoutineTriggerDocument,
  "\n  mutation DeleteRoutineTrigger($id: ID!) {\n    deleteRoutineTrigger(id: $id)\n  }\n":
    types.DeleteRoutineTriggerDocument,
  "\n  query ThreadTurns(\n    $tenantId: ID!\n    $agentId: ID\n    $status: String\n    $limit: Int\n  ) {\n    threadTurns(\n      tenantId: $tenantId\n      agentId: $agentId\n      status: $status\n      limit: $limit\n    ) {\n      id\n      tenantId\n      triggerId\n      agentId\n      routineId\n      invocationSource\n      triggerDetail\n      status\n      startedAt\n      finishedAt\n      error\n      errorCode\n      usageJson\n      resultJson\n      createdAt\n    }\n  }\n":
    types.ThreadTurnsDocument,
  "\n  query ThreadTurnDetail($id: ID!) {\n    threadTurn(id: $id) {\n      id\n      tenantId\n      triggerId\n      agentId\n      routineId\n      invocationSource\n      triggerDetail\n      wakeupRequestId\n      status\n      startedAt\n      finishedAt\n      error\n      errorCode\n      usageJson\n      resultJson\n      sessionIdBefore\n      sessionIdAfter\n      externalRunId\n      contextSnapshot\n      createdAt\n    }\n  }\n":
    types.ThreadTurnDetailDocument,
  "\n  query ThreadTurnEvents($runId: ID!, $afterSeq: Int, $limit: Int) {\n    threadTurnEvents(runId: $runId, afterSeq: $afterSeq, limit: $limit) {\n      id\n      runId\n      agentId\n      seq\n      eventType\n      stream\n      level\n      color\n      message\n      payload\n      createdAt\n    }\n  }\n":
    types.ThreadTurnEventsDocument,
  "\n  query TurnInvocationLogs($tenantId: ID!, $turnId: ID!) {\n    turnInvocationLogs(tenantId: $tenantId, turnId: $turnId) {\n      requestId\n      modelId\n      timestamp\n      inputTokenCount\n      outputTokenCount\n      cacheReadTokenCount\n      inputPreview\n      outputPreview\n      toolCount\n      costUsd\n      toolUses\n      hasToolResult\n      branch\n    }\n  }\n":
    types.TurnInvocationLogsDocument,
  "\n  mutation CancelThreadTurn($id: ID!) {\n    cancelThreadTurn(id: $id) {\n      id\n      status\n      finishedAt\n    }\n  }\n":
    types.CancelThreadTurnDocument,
  "\n  mutation CreateWakeupRequest($input: CreateWakeupRequestInput!) {\n    createWakeupRequest(input: $input) {\n      id\n      tenantId\n      agentId\n      source\n      status\n      createdAt\n    }\n  }\n":
    types.CreateWakeupRequestDocument,
  "\n  query ScheduledJobs(\n    $tenantId: ID!\n    $agentId: ID\n    $routineId: ID\n    $triggerType: String\n    $enabled: Boolean\n    $limit: Int\n  ) {\n    scheduledJobs(\n      tenantId: $tenantId\n      agentId: $agentId\n      routineId: $routineId\n      triggerType: $triggerType\n      enabled: $enabled\n      limit: $limit\n    ) {\n      id\n      tenantId\n      triggerType\n      agentId\n      routineId\n      teamId\n      name\n      description\n      scheduleType\n      scheduleExpression\n      timezone\n      enabled\n      lastRunAt\n      nextRunAt\n      createdAt\n      updatedAt\n    }\n  }\n":
    types.ScheduledJobsDocument,
  "\n  query Tenant($id: ID!) {\n    tenant(id: $id) {\n      id\n      name\n      slug\n      plan\n      issuePrefix\n      issueCounter\n      createdAt\n      updatedAt\n    }\n  }\n":
    types.TenantDocument,
  "\n  query TenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      name\n      slug\n      plan\n      issuePrefix\n      issueCounter\n      createdAt\n      updatedAt\n    }\n  }\n":
    types.TenantBySlugDocument,
  "\n  query TenantMembers($tenantId: ID!) {\n    tenantMembers(tenantId: $tenantId) {\n      id\n      tenantId\n      principalType\n      principalId\n      role\n      status\n      createdAt\n      updatedAt\n    }\n  }\n":
    types.TenantMembersDocument,
  "\n  mutation UpdateTenant($id: ID!, $input: UpdateTenantInput!) {\n    updateTenant(id: $id, input: $input) {\n      id\n      name\n      plan\n      issuePrefix\n      updatedAt\n    }\n  }\n":
    types.UpdateTenantDocument,
  "\n  mutation UpdateTenantSettings(\n    $tenantId: ID!\n    $input: UpdateTenantSettingsInput!\n  ) {\n    updateTenantSettings(tenantId: $tenantId, input: $input) {\n      id\n      defaultModel\n      budgetMonthlyCents\n      autoCloseThreadMinutes\n      maxAgents\n      features\n      updatedAt\n    }\n  }\n":
    types.UpdateTenantSettingsDocument,
  "\n  mutation AddTenantMember($tenantId: ID!, $input: AddTenantMemberInput!) {\n    addTenantMember(tenantId: $tenantId, input: $input) {\n      id\n      principalType\n      principalId\n      role\n      status\n    }\n  }\n":
    types.AddTenantMemberDocument,
  "\n  mutation RemoveTenantMember($id: ID!) {\n    removeTenantMember(id: $id)\n  }\n":
    types.RemoveTenantMemberDocument,
  "\n  query Me {\n    me {\n      id\n      tenantId\n      email\n      name\n      image\n      phone\n      createdAt\n      updatedAt\n    }\n  }\n":
    types.MeDocument,
  "\n  query User($id: ID!) {\n    user(id: $id) {\n      id\n      tenantId\n      email\n      name\n      image\n      phone\n      createdAt\n      updatedAt\n    }\n  }\n":
    types.UserDocument,
  "\n  mutation UpdateUser($id: ID!, $input: UpdateUserInput!) {\n    updateUser(id: $id, input: $input) {\n      id\n      name\n      image\n      phone\n      updatedAt\n    }\n  }\n":
    types.UpdateUserDocument,
  "\n  mutation UpdateUserProfile($userId: ID!, $input: UpdateUserProfileInput!) {\n    updateUserProfile(userId: $userId, input: $input) {\n      id\n      displayName\n      theme\n      notificationPreferences\n      updatedAt\n    }\n  }\n":
    types.UpdateUserProfileDocument,
  "\n  query ActivationSession($sessionId: ID!) {\n    activationSession(sessionId: $sessionId) {\n      id\n      userId\n      tenantId\n      mode\n      focusLayer\n      currentLayer\n      status\n      layerStates\n      lastAgentMessage\n      updatedAt\n    }\n  }\n":
    types.ActivationSessionDocument,
  "\n  mutation StartActivation($input: StartActivationInput!) {\n    startActivation(input: $input) {\n      id\n      mode\n      focusLayer\n      currentLayer\n      status\n      layerStates\n      lastAgentMessage\n    }\n  }\n":
    types.StartActivationDocument,
  "\n  mutation SubmitActivationTurn($input: SubmitActivationTurnInput!) {\n    submitActivationTurn(input: $input) {\n      id\n      currentLayer\n      status\n      layerStates\n      lastAgentMessage\n    }\n  }\n":
    types.SubmitActivationTurnDocument,
  "\n  mutation CheckpointActivationLayer($input: CheckpointActivationLayerInput!) {\n    checkpointActivationLayer(input: $input) {\n      id\n      currentLayer\n      status\n      layerStates\n      lastAgentMessage\n    }\n  }\n":
    types.CheckpointActivationLayerDocument,
  "\n  mutation ApplyActivationBundle($input: ApplyActivationBundleInput!) {\n    applyActivationBundle(input: $input) {\n      id\n      status\n      layerStates\n      completedAt\n    }\n  }\n":
    types.ApplyActivationBundleDocument,
  "\n  mutation DismissActivationRecommendation($input: DismissActivationRecommendationInput!) {\n    dismissActivationRecommendation(input: $input) {\n      id\n      layerStates\n      updatedAt\n    }\n  }\n":
    types.DismissActivationRecommendationDocument,
  "\n  query Threads(\n    $tenantId: ID!\n    $channel: ThreadChannel\n    $agentId: ID\n    $assigneeId: ID\n    $limit: Int\n    $cursor: String\n  ) {\n    threads(\n      tenantId: $tenantId\n      channel: $channel\n      agentId: $agentId\n      assigneeId: $assigneeId\n      limit: $limit\n      cursor: $cursor\n    ) {\n      id\n      tenantId\n      agentId\n      number\n      identifier\n      title\n      status\n      lifecycleStatus\n      channel\n      assigneeType\n      assigneeId\n      assignee {\n        id\n        name\n      }\n      reporterId\n      labels\n      metadata\n      dueAt\n      closedAt\n      archivedAt\n      lastActivityAt\n      lastTurnCompletedAt\n      lastReadAt\n      lastResponsePreview\n      createdAt\n      updatedAt\n    }\n  }\n":
    types.ThreadsDocument,
  "\n  query Thread($id: ID!) {\n    thread(id: $id) {\n      id\n      tenantId\n      agentId\n      number\n      identifier\n      title\n      status\n      lifecycleStatus\n      channel\n      assigneeType\n      assigneeId\n      reporterId\n      labels\n      metadata\n      dueAt\n      closedAt\n      messages(limit: 100) {\n        edges {\n          node {\n            id\n            role\n            content\n            senderType\n            senderId\n            createdAt\n            durableArtifact {\n              id\n              title\n              type\n              status\n            }\n          }\n        }\n      }\n      attachments {\n        id\n        name\n        s3Key\n        mimeType\n        sizeBytes\n        createdAt\n      }\n      createdAt\n      updatedAt\n    }\n  }\n":
    types.ThreadDocument,
  "\n  mutation CreateThread($input: CreateThreadInput!) {\n    createThread(input: $input) {\n      id\n      number\n      title\n      status\n      createdAt\n    }\n  }\n":
    types.CreateThreadDocument,
  "\n  mutation UpdateThread($id: ID!, $input: UpdateThreadInput!) {\n    updateThread(id: $id, input: $input) {\n      id\n      title\n      status\n      updatedAt\n    }\n  }\n":
    types.UpdateThreadDocument,
  "\n  subscription OnAgentStatusChanged($tenantId: ID!) {\n    onAgentStatusChanged(tenantId: $tenantId) {\n      agentId\n      tenantId\n      status\n      name\n      updatedAt\n    }\n  }\n":
    types.OnAgentStatusChangedDocument,
  "\n  subscription OnNewMessage($threadId: ID!) {\n    onNewMessage(threadId: $threadId) {\n      messageId\n      threadId\n      tenantId\n      role\n      content\n      senderType\n      senderId\n      createdAt\n    }\n  }\n":
    types.OnNewMessageDocument,
  "\n  subscription OnHeartbeatActivity($tenantId: ID!) {\n    onHeartbeatActivity(tenantId: $tenantId) {\n      heartbeatId\n      tenantId\n      status\n      message\n      createdAt\n    }\n  }\n":
    types.OnHeartbeatActivityDocument,
  "\n  subscription OnThreadUpdated($tenantId: ID!) {\n    onThreadUpdated(tenantId: $tenantId) {\n      threadId\n      tenantId\n      status\n      title\n      updatedAt\n    }\n  }\n":
    types.OnThreadUpdatedDocument,
  "\n  subscription OnThreadTurnUpdated($tenantId: ID!) {\n    onThreadTurnUpdated(tenantId: $tenantId) {\n      runId\n      triggerId\n      threadId\n      tenantId\n      status\n      triggerName\n      updatedAt\n    }\n  }\n":
    types.OnThreadTurnUpdatedDocument,
  "\n  subscription OnInboxItemStatusChanged($tenantId: ID!) {\n    onInboxItemStatusChanged(tenantId: $tenantId) {\n      inboxItemId\n      tenantId\n      status\n      title\n      updatedAt\n    }\n  }\n":
    types.OnInboxItemStatusChangedDocument,
  "\n  query InboxItems(\n    $tenantId: ID!\n    $status: InboxItemStatus\n    $entityType: String\n    $entityId: ID\n  ) {\n    inboxItems(\n      tenantId: $tenantId\n      status: $status\n      entityType: $entityType\n      entityId: $entityId\n    ) {\n      id\n      tenantId\n      requesterType\n      requesterId\n      type\n      status\n      title\n      description\n      entityType\n      entityId\n      config\n      revision\n      reviewNotes\n      decidedBy\n      decidedAt\n      expiresAt\n      comments {\n        id\n        inboxItemId\n        authorType\n        authorId\n        content\n        createdAt\n      }\n      links {\n        id\n        linkedType\n        linkedId\n        createdAt\n      }\n      linkedThreads {\n        id\n        number\n        identifier\n        title\n        status\n      }\n      createdAt\n      updatedAt\n    }\n  }\n":
    types.InboxItemsDocument,
  "\n  query InboxItem($id: ID!) {\n    inboxItem(id: $id) {\n      id\n      tenantId\n      requesterType\n      requesterId\n      type\n      status\n      title\n      description\n      entityType\n      entityId\n      config\n      revision\n      reviewNotes\n      decidedBy\n      decidedAt\n      expiresAt\n      comments {\n        id\n        inboxItemId\n        authorType\n        authorId\n        content\n        createdAt\n      }\n      links {\n        id\n        linkedType\n        linkedId\n        createdAt\n      }\n      linkedThreads {\n        id\n        number\n        identifier\n        title\n        status\n      }\n      createdAt\n      updatedAt\n    }\n  }\n":
    types.InboxItemDocument,
  "\n  mutation DecideInboxItem($id: ID!, $input: InboxItemDecisionInput!) {\n    decideInboxItem(id: $id, input: $input) {\n      id\n      status\n      reviewNotes\n      decidedBy\n      decidedAt\n      updatedAt\n    }\n  }\n":
    types.DecideInboxItemDocument,
  "\n  mutation AddInboxItemComment($input: AddInboxItemCommentInput!) {\n    addInboxItemComment(input: $input) {\n      id\n      inboxItemId\n      content\n      authorType\n      authorId\n      createdAt\n    }\n  }\n":
    types.AddInboxItemCommentDocument,
  "\n  subscription OnOrgUpdated($tenantId: ID!) {\n    onOrgUpdated(tenantId: $tenantId) {\n      tenantId\n      changeType\n      entityType\n      entityId\n      updatedAt\n    }\n  }\n":
    types.OnOrgUpdatedDocument,
  "\n  query ThreadTurnsForThread($tenantId: ID!, $threadId: ID!, $limit: Int) {\n    threadTurns(tenantId: $tenantId, threadId: $threadId, limit: $limit) {\n      id\n      tenantId\n      agentId\n      invocationSource\n      triggerDetail\n      triggerName\n      threadId\n      turnNumber\n      status\n      startedAt\n      finishedAt\n      error\n      resultJson\n      usageJson\n      totalCost\n      retryAttempt\n      originTurnId\n      createdAt\n    }\n  }\n":
    types.ThreadTurnsForThreadDocument,
  "\n  query ArtifactsForThread($tenantId: ID!, $threadId: ID!, $limit: Int) {\n    artifacts(tenantId: $tenantId, threadId: $threadId, limit: $limit) {\n      id\n      tenantId\n      agentId\n      threadId\n      title\n      type\n      status\n      summary\n      createdAt\n      updatedAt\n    }\n  }\n":
    types.ArtifactsForThreadDocument,
  "\n  query ArtifactDetail($id: ID!) {\n    artifact(id: $id) {\n      id\n      title\n      type\n      status\n      content\n      summary\n      createdAt\n    }\n  }\n":
    types.ArtifactDetailDocument,
  '\n  query MemoryRecords($assistantId: ID!, $namespace: String!) {\n    memoryRecords(assistantId: $assistantId, namespace: $namespace) {\n      memoryRecordId\n      content {\n        text\n      }\n      createdAt\n      updatedAt\n      expiresAt\n      namespace\n      strategyId\n      # "Contributes to:" chips — Unit 8 / handoff #3. One nested resolver\n      # call per record, capped at typical list size ≤50. DataLoader is a\n      # future optimization if large result sets become the norm.\n      wikiPages {\n        id\n        type\n        slug\n        title\n      }\n    }\n  }\n':
    types.MemoryRecordsDocument,
  "\n  mutation DeleteMemoryRecord($memoryRecordId: ID!) {\n    deleteMemoryRecord(memoryRecordId: $memoryRecordId)\n  }\n":
    types.DeleteMemoryRecordDocument,
  "\n  mutation UpdateMemoryRecord($memoryRecordId: ID!, $content: String!) {\n    updateMemoryRecord(memoryRecordId: $memoryRecordId, content: $content)\n  }\n":
    types.UpdateMemoryRecordDocument,
  "\n  query AgentWorkspaceReviews(\n    $tenantId: ID!\n    $agentId: ID\n    $status: String\n    $limit: Int\n  ) {\n    agentWorkspaceReviews(\n      tenantId: $tenantId\n      agentId: $agentId\n      status: $status\n      limit: $limit\n    ) {\n      threadId\n      reviewObjectKey\n      targetPath\n      requestedAt\n      reason\n      payload\n      reviewEtag\n      run {\n        id\n        agentId\n        targetPath\n        status\n        currentWakeupRequestId\n        currentThreadTurnId\n        lastEventAt\n        createdAt\n        updatedAt\n      }\n      latestEvent {\n        id\n        eventType\n        reason\n        sourceObjectKey\n        payload\n        createdAt\n      }\n    }\n  }\n":
    types.AgentWorkspaceReviewsDocument,
  "\n  query AgentWorkspaceReview($runId: ID!) {\n    agentWorkspaceReview(runId: $runId) {\n      threadId\n      reviewObjectKey\n      targetPath\n      requestedAt\n      reason\n      payload\n      reviewBody\n      reviewEtag\n      reviewMissing\n      proposedChanges {\n        path\n        kind\n        summary\n        diff\n        before\n        after\n      }\n      run {\n        id\n        tenantId\n        agentId\n        targetPath\n        status\n        currentWakeupRequestId\n        currentThreadTurnId\n        lastEventAt\n        createdAt\n        updatedAt\n      }\n      events {\n        id\n        eventType\n        reason\n        sourceObjectKey\n        payload\n        createdAt\n      }\n      decisionEvents {\n        id\n        eventType\n        reason\n        actorType\n        actorId\n        payload\n        createdAt\n      }\n    }\n  }\n":
    types.AgentWorkspaceReviewDocument,
  "\n  mutation AcceptAgentWorkspaceReview(\n    $runId: ID!\n    $input: AgentWorkspaceReviewDecisionInput\n  ) {\n    acceptAgentWorkspaceReview(runId: $runId, input: $input) {\n      id\n      status\n      currentWakeupRequestId\n      updatedAt\n    }\n  }\n":
    types.AcceptAgentWorkspaceReviewDocument,
  "\n  mutation CancelAgentWorkspaceReview(\n    $runId: ID!\n    $input: AgentWorkspaceReviewDecisionInput\n  ) {\n    cancelAgentWorkspaceReview(runId: $runId, input: $input) {\n      id\n      status\n      updatedAt\n    }\n  }\n":
    types.CancelAgentWorkspaceReviewDocument,
  "\n  mutation ResumeAgentWorkspaceRun(\n    $runId: ID!\n    $input: AgentWorkspaceReviewDecisionInput\n  ) {\n    resumeAgentWorkspaceRun(runId: $runId, input: $input) {\n      id\n      status\n      currentWakeupRequestId\n      updatedAt\n    }\n  }\n":
    types.ResumeAgentWorkspaceRunDocument,
  "\n  mutation RegisterPushToken($input: RegisterPushTokenInput!) {\n    registerPushToken(input: $input)\n  }\n":
    types.RegisterPushTokenDocument,
  "\n  mutation UnregisterPushToken($token: String!) {\n    unregisterPushToken(token: $token)\n  }\n":
    types.UnregisterPushTokenDocument,
  "\n  query AgentWorkspaces($agentId: ID!) {\n    agentWorkspaces(agentId: $agentId) {\n      slug\n      name\n      purpose\n    }\n  }\n":
    types.AgentWorkspacesDocument,
  "\n  query UserQuickActions($tenantId: ID!) {\n    userQuickActions(tenantId: $tenantId) {\n      id\n      userId\n      tenantId\n      title\n      prompt\n      workspaceAgentId\n      sortOrder\n      createdAt\n      updatedAt\n    }\n  }\n":
    types.UserQuickActionsDocument,
  "\n  mutation CreateQuickAction($input: CreateQuickActionInput!) {\n    createQuickAction(input: $input) {\n      id\n      userId\n      tenantId\n      title\n      prompt\n      workspaceAgentId\n      sortOrder\n      createdAt\n      updatedAt\n    }\n  }\n":
    types.CreateQuickActionDocument,
  "\n  mutation UpdateQuickAction($id: ID!, $input: UpdateQuickActionInput!) {\n    updateQuickAction(id: $id, input: $input) {\n      id\n      userId\n      tenantId\n      title\n      prompt\n      workspaceAgentId\n      sortOrder\n      createdAt\n      updatedAt\n    }\n  }\n":
    types.UpdateQuickActionDocument,
  "\n  mutation DeleteQuickAction($id: ID!) {\n    deleteQuickAction(id: $id)\n  }\n":
    types.DeleteQuickActionDocument,
  "\n  mutation ReorderQuickActions($input: ReorderQuickActionsInput!) {\n    reorderQuickActions(input: $input) {\n      id\n      sortOrder\n    }\n  }\n":
    types.ReorderQuickActionsDocument,
  "\n  mutation RefreshGenUI($messageId: ID!, $toolIndex: Int!) {\n    refreshGenUI(messageId: $messageId, toolIndex: $toolIndex) {\n      id\n      toolResults\n    }\n  }\n":
    types.RefreshGenUiDocument,
  "\n  mutation CreateRecipe($input: CreateRecipeInput!) {\n    createRecipe(input: $input) {\n      id\n      title\n      genuiType\n    }\n  }\n":
    types.CreateRecipeDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query TenantUsersForFormPicker($tenantId: ID!) {\n    tenantMembers(tenantId: $tenantId) {\n      principalType\n      principalId\n      user {\n        id\n        email\n        name\n      }\n    }\n  }\n",
): (typeof documents)["\n  query TenantUsersForFormPicker($tenantId: ID!) {\n    tenantMembers(tenantId: $tenantId) {\n      principalType\n      principalId\n      user {\n        id\n        email\n        name\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query Agents($tenantId: ID!, $status: AgentStatus, $type: AgentType) {\n    agents(tenantId: $tenantId, status: $status, type: $type) {\n      id\n      tenantId\n      name\n      role\n      type\n      status\n      templateId\n      systemPrompt\n      adapterType\n      adapterConfig\n      runtimeConfig\n      lastHeartbeatAt\n      avatarUrl\n      reportsToId\n      humanPairId\n      version\n      createdAt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  query Agents($tenantId: ID!, $status: AgentStatus, $type: AgentType) {\n    agents(tenantId: $tenantId, status: $status, type: $type) {\n      id\n      tenantId\n      name\n      role\n      type\n      status\n      templateId\n      systemPrompt\n      adapterType\n      adapterConfig\n      runtimeConfig\n      lastHeartbeatAt\n      avatarUrl\n      reportsToId\n      humanPairId\n      version\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query Agent($id: ID!) {\n    agent(id: $id) {\n      id\n      tenantId\n      name\n      slug\n      role\n      type\n      status\n      templateId\n      systemPrompt\n      adapterType\n      adapterConfig\n      runtimeConfig\n      lastHeartbeatAt\n      avatarUrl\n      reportsToId\n      humanPairId\n      version\n      capabilities {\n        id\n        capability\n        config\n        enabled\n      }\n      skills {\n        id\n        skillId\n        config\n        permissions\n        rateLimitRpm\n        enabled\n      }\n      budgetPolicy {\n        id\n        period\n        limitUsd\n        actionOnExceed\n      }\n      createdAt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  query Agent($id: ID!) {\n    agent(id: $id) {\n      id\n      tenantId\n      name\n      slug\n      role\n      type\n      status\n      templateId\n      systemPrompt\n      adapterType\n      adapterConfig\n      runtimeConfig\n      lastHeartbeatAt\n      avatarUrl\n      reportsToId\n      humanPairId\n      version\n      capabilities {\n        id\n        capability\n        config\n        enabled\n      }\n      skills {\n        id\n        skillId\n        config\n        permissions\n        rateLimitRpm\n        enabled\n      }\n      budgetPolicy {\n        id\n        period\n        limitUsd\n        actionOnExceed\n      }\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation CreateAgent($input: CreateAgentInput!) {\n    createAgent(input: $input) {\n      id\n      tenantId\n      name\n      type\n      status\n      createdAt\n    }\n  }\n",
): (typeof documents)["\n  mutation CreateAgent($input: CreateAgentInput!) {\n    createAgent(input: $input) {\n      id\n      tenantId\n      name\n      type\n      status\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation UpdateAgent($id: ID!, $input: UpdateAgentInput!) {\n    updateAgent(id: $id, input: $input) {\n      id\n      name\n      role\n      type\n      status\n      templateId\n      systemPrompt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation UpdateAgent($id: ID!, $input: UpdateAgentInput!) {\n    updateAgent(id: $id, input: $input) {\n      id\n      name\n      role\n      type\n      status\n      templateId\n      systemPrompt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation DeleteAgent($id: ID!) {\n    deleteAgent(id: $id)\n  }\n",
): (typeof documents)["\n  mutation DeleteAgent($id: ID!) {\n    deleteAgent(id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation UpdateAgentStatus($id: ID!, $status: AgentStatus!) {\n    updateAgentStatus(id: $id, status: $status) {\n      id\n      status\n      lastHeartbeatAt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation UpdateAgentStatus($id: ID!, $status: AgentStatus!) {\n    updateAgentStatus(id: $id, status: $status) {\n      id\n      status\n      lastHeartbeatAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SetAgentCapabilities(\n    $agentId: ID!\n    $capabilities: [AgentCapabilityInput!]!\n  ) {\n    setAgentCapabilities(agentId: $agentId, capabilities: $capabilities) {\n      id\n      capability\n      config\n      enabled\n    }\n  }\n",
): (typeof documents)["\n  mutation SetAgentCapabilities(\n    $agentId: ID!\n    $capabilities: [AgentCapabilityInput!]!\n  ) {\n    setAgentCapabilities(agentId: $agentId, capabilities: $capabilities) {\n      id\n      capability\n      config\n      enabled\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SetAgentSkills($agentId: ID!, $skills: [AgentSkillInput!]!) {\n    setAgentSkills(agentId: $agentId, skills: $skills) {\n      id\n      skillId\n      config\n      enabled\n    }\n  }\n",
): (typeof documents)["\n  mutation SetAgentSkills($agentId: ID!, $skills: [AgentSkillInput!]!) {\n    setAgentSkills(agentId: $agentId, skills: $skills) {\n      id\n      skillId\n      config\n      enabled\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SetAgentBudgetPolicy(\n    $agentId: ID!\n    $input: AgentBudgetPolicyInput!\n  ) {\n    setAgentBudgetPolicy(agentId: $agentId, input: $input) {\n      id\n      period\n      limitUsd\n      actionOnExceed\n    }\n  }\n",
): (typeof documents)["\n  mutation SetAgentBudgetPolicy(\n    $agentId: ID!\n    $input: AgentBudgetPolicyInput!\n  ) {\n    setAgentBudgetPolicy(agentId: $agentId, input: $input) {\n      id\n      period\n      limitUsd\n      actionOnExceed\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SendMessage($input: SendMessageInput!) {\n    sendMessage(input: $input) {\n      id\n      threadId\n      tenantId\n      role\n      content\n      senderType\n      senderId\n      createdAt\n    }\n  }\n",
): (typeof documents)["\n  mutation SendMessage($input: SendMessageInput!) {\n    sendMessage(input: $input) {\n      id\n      threadId\n      tenantId\n      role\n      content\n      senderType\n      senderId\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation DeleteMessage($id: ID!) {\n    deleteMessage(id: $id)\n  }\n",
): (typeof documents)["\n  mutation DeleteMessage($id: ID!) {\n    deleteMessage(id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query Messages($threadId: ID!, $limit: Int, $cursor: String) {\n    messages(threadId: $threadId, limit: $limit, cursor: $cursor) {\n      edges {\n        node {\n          id\n          threadId\n          tenantId\n          role\n          content\n          senderType\n          senderId\n          toolCalls\n          toolResults\n          metadata\n          tokenCount\n          durableArtifact {\n            id\n            title\n            type\n            status\n            content\n            summary\n          }\n          createdAt\n        }\n        cursor\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n",
): (typeof documents)["\n  query Messages($threadId: ID!, $limit: Int, $cursor: String) {\n    messages(threadId: $threadId, limit: $limit, cursor: $cursor) {\n      edges {\n        node {\n          id\n          threadId\n          tenantId\n          role\n          content\n          senderType\n          senderId\n          toolCalls\n          toolResults\n          metadata\n          tokenCount\n          durableArtifact {\n            id\n            title\n            type\n            status\n            content\n            summary\n          }\n          createdAt\n        }\n        cursor\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query Teams($tenantId: ID!) {\n    teams(tenantId: $tenantId) {\n      id\n      tenantId\n      name\n      description\n      type\n      status\n      budgetMonthlyCents\n      metadata\n      createdAt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  query Teams($tenantId: ID!) {\n    teams(tenantId: $tenantId) {\n      id\n      tenantId\n      name\n      description\n      type\n      status\n      budgetMonthlyCents\n      metadata\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query Team($id: ID!) {\n    team(id: $id) {\n      id\n      tenantId\n      name\n      description\n      type\n      status\n      budgetMonthlyCents\n      metadata\n      agents {\n        id\n        agentId\n        role\n        joinedAt\n        agent {\n          id\n          name\n          type\n          status\n          avatarUrl\n        }\n      }\n      users {\n        id\n        userId\n        role\n        joinedAt\n        user {\n          id\n          name\n          email\n          image\n        }\n      }\n      createdAt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  query Team($id: ID!) {\n    team(id: $id) {\n      id\n      tenantId\n      name\n      description\n      type\n      status\n      budgetMonthlyCents\n      metadata\n      agents {\n        id\n        agentId\n        role\n        joinedAt\n        agent {\n          id\n          name\n          type\n          status\n          avatarUrl\n        }\n      }\n      users {\n        id\n        userId\n        role\n        joinedAt\n        user {\n          id\n          name\n          email\n          image\n        }\n      }\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation CreateTeam($input: CreateTeamInput!) {\n    createTeam(input: $input) {\n      id\n      tenantId\n      name\n      type\n      status\n      createdAt\n    }\n  }\n",
): (typeof documents)["\n  mutation CreateTeam($input: CreateTeamInput!) {\n    createTeam(input: $input) {\n      id\n      tenantId\n      name\n      type\n      status\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation UpdateTeam($id: ID!, $input: UpdateTeamInput!) {\n    updateTeam(id: $id, input: $input) {\n      id\n      name\n      description\n      status\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation UpdateTeam($id: ID!, $input: UpdateTeamInput!) {\n    updateTeam(id: $id, input: $input) {\n      id\n      name\n      description\n      status\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation DeleteTeam($id: ID!) {\n    deleteTeam(id: $id)\n  }\n",
): (typeof documents)["\n  mutation DeleteTeam($id: ID!) {\n    deleteTeam(id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation AddTeamAgent($teamId: ID!, $input: AddTeamAgentInput!) {\n    addTeamAgent(teamId: $teamId, input: $input) {\n      id\n      teamId\n      agentId\n      role\n      joinedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation AddTeamAgent($teamId: ID!, $input: AddTeamAgentInput!) {\n    addTeamAgent(teamId: $teamId, input: $input) {\n      id\n      teamId\n      agentId\n      role\n      joinedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation RemoveTeamAgent($teamId: ID!, $agentId: ID!) {\n    removeTeamAgent(teamId: $teamId, agentId: $agentId)\n  }\n",
): (typeof documents)["\n  mutation RemoveTeamAgent($teamId: ID!, $agentId: ID!) {\n    removeTeamAgent(teamId: $teamId, agentId: $agentId)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation AddTeamUser($teamId: ID!, $input: AddTeamUserInput!) {\n    addTeamUser(teamId: $teamId, input: $input) {\n      id\n      teamId\n      userId\n      role\n      joinedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation AddTeamUser($teamId: ID!, $input: AddTeamUserInput!) {\n    addTeamUser(teamId: $teamId, input: $input) {\n      id\n      teamId\n      userId\n      role\n      joinedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation RemoveTeamUser($teamId: ID!, $userId: ID!) {\n    removeTeamUser(teamId: $teamId, userId: $userId)\n  }\n",
): (typeof documents)["\n  mutation RemoveTeamUser($teamId: ID!, $userId: ID!) {\n    removeTeamUser(teamId: $teamId, userId: $userId)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query Routines(\n    $tenantId: ID!\n    $teamId: ID\n    $agentId: ID\n    $status: RoutineStatus\n  ) {\n    routines(\n      tenantId: $tenantId\n      teamId: $teamId\n      agentId: $agentId\n      status: $status\n    ) {\n      id\n      tenantId\n      teamId\n      agentId\n      name\n      description\n      type\n      status\n      schedule\n      config\n      lastRunAt\n      nextRunAt\n      createdAt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  query Routines(\n    $tenantId: ID!\n    $teamId: ID\n    $agentId: ID\n    $status: RoutineStatus\n  ) {\n    routines(\n      tenantId: $tenantId\n      teamId: $teamId\n      agentId: $agentId\n      status: $status\n    ) {\n      id\n      tenantId\n      teamId\n      agentId\n      name\n      description\n      type\n      status\n      schedule\n      config\n      lastRunAt\n      nextRunAt\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query Routine($id: ID!) {\n    routine(id: $id) {\n      id\n      tenantId\n      teamId\n      agentId\n      name\n      description\n      type\n      status\n      schedule\n      config\n      lastRunAt\n      nextRunAt\n      triggers {\n        id\n        triggerType\n        config\n        enabled\n      }\n      createdAt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  query Routine($id: ID!) {\n    routine(id: $id) {\n      id\n      tenantId\n      teamId\n      agentId\n      name\n      description\n      type\n      status\n      schedule\n      config\n      lastRunAt\n      nextRunAt\n      triggers {\n        id\n        triggerType\n        config\n        enabled\n      }\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query RoutineRuns($routineId: ID!, $limit: Int, $cursor: String) {\n    routineRuns(routineId: $routineId, limit: $limit, cursor: $cursor) {\n      id\n      routineId\n      status\n      startedAt\n      completedAt\n      error\n      metadata\n      createdAt\n    }\n  }\n",
): (typeof documents)["\n  query RoutineRuns($routineId: ID!, $limit: Int, $cursor: String) {\n    routineRuns(routineId: $routineId, limit: $limit, cursor: $cursor) {\n      id\n      routineId\n      status\n      startedAt\n      completedAt\n      error\n      metadata\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query RoutineRunDetail($id: ID!) {\n    routineRun(id: $id) {\n      id\n      routineId\n      status\n      startedAt\n      completedAt\n      error\n      metadata\n      steps {\n        id\n        stepIndex\n        name\n        status\n        input\n        output\n        startedAt\n        completedAt\n        error\n      }\n      createdAt\n    }\n  }\n",
): (typeof documents)["\n  query RoutineRunDetail($id: ID!) {\n    routineRun(id: $id) {\n      id\n      routineId\n      status\n      startedAt\n      completedAt\n      error\n      metadata\n      steps {\n        id\n        stepIndex\n        name\n        status\n        input\n        output\n        startedAt\n        completedAt\n        error\n      }\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation CreateRoutine($input: CreateRoutineInput!) {\n    createRoutine(input: $input) {\n      id\n      tenantId\n      name\n      type\n      status\n      createdAt\n    }\n  }\n",
): (typeof documents)["\n  mutation CreateRoutine($input: CreateRoutineInput!) {\n    createRoutine(input: $input) {\n      id\n      tenantId\n      name\n      type\n      status\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation UpdateRoutine($id: ID!, $input: UpdateRoutineInput!) {\n    updateRoutine(id: $id, input: $input) {\n      id\n      name\n      description\n      status\n      schedule\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation UpdateRoutine($id: ID!, $input: UpdateRoutineInput!) {\n    updateRoutine(id: $id, input: $input) {\n      id\n      name\n      description\n      status\n      schedule\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation DeleteRoutine($id: ID!) {\n    deleteRoutine(id: $id)\n  }\n",
): (typeof documents)["\n  mutation DeleteRoutine($id: ID!) {\n    deleteRoutine(id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation TriggerRoutineRun($routineId: ID!) {\n    triggerRoutineRun(routineId: $routineId) {\n      id\n      routineId\n      status\n      createdAt\n    }\n  }\n",
): (typeof documents)["\n  mutation TriggerRoutineRun($routineId: ID!) {\n    triggerRoutineRun(routineId: $routineId) {\n      id\n      routineId\n      status\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SetRoutineTrigger($routineId: ID!, $input: RoutineTriggerInput!) {\n    setRoutineTrigger(routineId: $routineId, input: $input) {\n      id\n      triggerType\n      config\n      enabled\n    }\n  }\n",
): (typeof documents)["\n  mutation SetRoutineTrigger($routineId: ID!, $input: RoutineTriggerInput!) {\n    setRoutineTrigger(routineId: $routineId, input: $input) {\n      id\n      triggerType\n      config\n      enabled\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation DeleteRoutineTrigger($id: ID!) {\n    deleteRoutineTrigger(id: $id)\n  }\n",
): (typeof documents)["\n  mutation DeleteRoutineTrigger($id: ID!) {\n    deleteRoutineTrigger(id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query ThreadTurns(\n    $tenantId: ID!\n    $agentId: ID\n    $status: String\n    $limit: Int\n  ) {\n    threadTurns(\n      tenantId: $tenantId\n      agentId: $agentId\n      status: $status\n      limit: $limit\n    ) {\n      id\n      tenantId\n      triggerId\n      agentId\n      routineId\n      invocationSource\n      triggerDetail\n      status\n      startedAt\n      finishedAt\n      error\n      errorCode\n      usageJson\n      resultJson\n      createdAt\n    }\n  }\n",
): (typeof documents)["\n  query ThreadTurns(\n    $tenantId: ID!\n    $agentId: ID\n    $status: String\n    $limit: Int\n  ) {\n    threadTurns(\n      tenantId: $tenantId\n      agentId: $agentId\n      status: $status\n      limit: $limit\n    ) {\n      id\n      tenantId\n      triggerId\n      agentId\n      routineId\n      invocationSource\n      triggerDetail\n      status\n      startedAt\n      finishedAt\n      error\n      errorCode\n      usageJson\n      resultJson\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query ThreadTurnDetail($id: ID!) {\n    threadTurn(id: $id) {\n      id\n      tenantId\n      triggerId\n      agentId\n      routineId\n      invocationSource\n      triggerDetail\n      wakeupRequestId\n      status\n      startedAt\n      finishedAt\n      error\n      errorCode\n      usageJson\n      resultJson\n      sessionIdBefore\n      sessionIdAfter\n      externalRunId\n      contextSnapshot\n      createdAt\n    }\n  }\n",
): (typeof documents)["\n  query ThreadTurnDetail($id: ID!) {\n    threadTurn(id: $id) {\n      id\n      tenantId\n      triggerId\n      agentId\n      routineId\n      invocationSource\n      triggerDetail\n      wakeupRequestId\n      status\n      startedAt\n      finishedAt\n      error\n      errorCode\n      usageJson\n      resultJson\n      sessionIdBefore\n      sessionIdAfter\n      externalRunId\n      contextSnapshot\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query ThreadTurnEvents($runId: ID!, $afterSeq: Int, $limit: Int) {\n    threadTurnEvents(runId: $runId, afterSeq: $afterSeq, limit: $limit) {\n      id\n      runId\n      agentId\n      seq\n      eventType\n      stream\n      level\n      color\n      message\n      payload\n      createdAt\n    }\n  }\n",
): (typeof documents)["\n  query ThreadTurnEvents($runId: ID!, $afterSeq: Int, $limit: Int) {\n    threadTurnEvents(runId: $runId, afterSeq: $afterSeq, limit: $limit) {\n      id\n      runId\n      agentId\n      seq\n      eventType\n      stream\n      level\n      color\n      message\n      payload\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query TurnInvocationLogs($tenantId: ID!, $turnId: ID!) {\n    turnInvocationLogs(tenantId: $tenantId, turnId: $turnId) {\n      requestId\n      modelId\n      timestamp\n      inputTokenCount\n      outputTokenCount\n      cacheReadTokenCount\n      inputPreview\n      outputPreview\n      toolCount\n      costUsd\n      toolUses\n      hasToolResult\n      branch\n    }\n  }\n",
): (typeof documents)["\n  query TurnInvocationLogs($tenantId: ID!, $turnId: ID!) {\n    turnInvocationLogs(tenantId: $tenantId, turnId: $turnId) {\n      requestId\n      modelId\n      timestamp\n      inputTokenCount\n      outputTokenCount\n      cacheReadTokenCount\n      inputPreview\n      outputPreview\n      toolCount\n      costUsd\n      toolUses\n      hasToolResult\n      branch\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation CancelThreadTurn($id: ID!) {\n    cancelThreadTurn(id: $id) {\n      id\n      status\n      finishedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation CancelThreadTurn($id: ID!) {\n    cancelThreadTurn(id: $id) {\n      id\n      status\n      finishedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation CreateWakeupRequest($input: CreateWakeupRequestInput!) {\n    createWakeupRequest(input: $input) {\n      id\n      tenantId\n      agentId\n      source\n      status\n      createdAt\n    }\n  }\n",
): (typeof documents)["\n  mutation CreateWakeupRequest($input: CreateWakeupRequestInput!) {\n    createWakeupRequest(input: $input) {\n      id\n      tenantId\n      agentId\n      source\n      status\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query ScheduledJobs(\n    $tenantId: ID!\n    $agentId: ID\n    $routineId: ID\n    $triggerType: String\n    $enabled: Boolean\n    $limit: Int\n  ) {\n    scheduledJobs(\n      tenantId: $tenantId\n      agentId: $agentId\n      routineId: $routineId\n      triggerType: $triggerType\n      enabled: $enabled\n      limit: $limit\n    ) {\n      id\n      tenantId\n      triggerType\n      agentId\n      routineId\n      teamId\n      name\n      description\n      scheduleType\n      scheduleExpression\n      timezone\n      enabled\n      lastRunAt\n      nextRunAt\n      createdAt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  query ScheduledJobs(\n    $tenantId: ID!\n    $agentId: ID\n    $routineId: ID\n    $triggerType: String\n    $enabled: Boolean\n    $limit: Int\n  ) {\n    scheduledJobs(\n      tenantId: $tenantId\n      agentId: $agentId\n      routineId: $routineId\n      triggerType: $triggerType\n      enabled: $enabled\n      limit: $limit\n    ) {\n      id\n      tenantId\n      triggerType\n      agentId\n      routineId\n      teamId\n      name\n      description\n      scheduleType\n      scheduleExpression\n      timezone\n      enabled\n      lastRunAt\n      nextRunAt\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query Tenant($id: ID!) {\n    tenant(id: $id) {\n      id\n      name\n      slug\n      plan\n      issuePrefix\n      issueCounter\n      createdAt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  query Tenant($id: ID!) {\n    tenant(id: $id) {\n      id\n      name\n      slug\n      plan\n      issuePrefix\n      issueCounter\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query TenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      name\n      slug\n      plan\n      issuePrefix\n      issueCounter\n      createdAt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  query TenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      name\n      slug\n      plan\n      issuePrefix\n      issueCounter\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query TenantMembers($tenantId: ID!) {\n    tenantMembers(tenantId: $tenantId) {\n      id\n      tenantId\n      principalType\n      principalId\n      role\n      status\n      createdAt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  query TenantMembers($tenantId: ID!) {\n    tenantMembers(tenantId: $tenantId) {\n      id\n      tenantId\n      principalType\n      principalId\n      role\n      status\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation UpdateTenant($id: ID!, $input: UpdateTenantInput!) {\n    updateTenant(id: $id, input: $input) {\n      id\n      name\n      plan\n      issuePrefix\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation UpdateTenant($id: ID!, $input: UpdateTenantInput!) {\n    updateTenant(id: $id, input: $input) {\n      id\n      name\n      plan\n      issuePrefix\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation UpdateTenantSettings(\n    $tenantId: ID!\n    $input: UpdateTenantSettingsInput!\n  ) {\n    updateTenantSettings(tenantId: $tenantId, input: $input) {\n      id\n      defaultModel\n      budgetMonthlyCents\n      autoCloseThreadMinutes\n      maxAgents\n      features\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation UpdateTenantSettings(\n    $tenantId: ID!\n    $input: UpdateTenantSettingsInput!\n  ) {\n    updateTenantSettings(tenantId: $tenantId, input: $input) {\n      id\n      defaultModel\n      budgetMonthlyCents\n      autoCloseThreadMinutes\n      maxAgents\n      features\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation AddTenantMember($tenantId: ID!, $input: AddTenantMemberInput!) {\n    addTenantMember(tenantId: $tenantId, input: $input) {\n      id\n      principalType\n      principalId\n      role\n      status\n    }\n  }\n",
): (typeof documents)["\n  mutation AddTenantMember($tenantId: ID!, $input: AddTenantMemberInput!) {\n    addTenantMember(tenantId: $tenantId, input: $input) {\n      id\n      principalType\n      principalId\n      role\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation RemoveTenantMember($id: ID!) {\n    removeTenantMember(id: $id)\n  }\n",
): (typeof documents)["\n  mutation RemoveTenantMember($id: ID!) {\n    removeTenantMember(id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query Me {\n    me {\n      id\n      tenantId\n      email\n      name\n      image\n      phone\n      createdAt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  query Me {\n    me {\n      id\n      tenantId\n      email\n      name\n      image\n      phone\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query User($id: ID!) {\n    user(id: $id) {\n      id\n      tenantId\n      email\n      name\n      image\n      phone\n      createdAt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  query User($id: ID!) {\n    user(id: $id) {\n      id\n      tenantId\n      email\n      name\n      image\n      phone\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation UpdateUser($id: ID!, $input: UpdateUserInput!) {\n    updateUser(id: $id, input: $input) {\n      id\n      name\n      image\n      phone\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation UpdateUser($id: ID!, $input: UpdateUserInput!) {\n    updateUser(id: $id, input: $input) {\n      id\n      name\n      image\n      phone\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation UpdateUserProfile($userId: ID!, $input: UpdateUserProfileInput!) {\n    updateUserProfile(userId: $userId, input: $input) {\n      id\n      displayName\n      theme\n      notificationPreferences\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation UpdateUserProfile($userId: ID!, $input: UpdateUserProfileInput!) {\n    updateUserProfile(userId: $userId, input: $input) {\n      id\n      displayName\n      theme\n      notificationPreferences\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query ActivationSession($sessionId: ID!) {\n    activationSession(sessionId: $sessionId) {\n      id\n      userId\n      tenantId\n      mode\n      focusLayer\n      currentLayer\n      status\n      layerStates\n      lastAgentMessage\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  query ActivationSession($sessionId: ID!) {\n    activationSession(sessionId: $sessionId) {\n      id\n      userId\n      tenantId\n      mode\n      focusLayer\n      currentLayer\n      status\n      layerStates\n      lastAgentMessage\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation StartActivation($input: StartActivationInput!) {\n    startActivation(input: $input) {\n      id\n      mode\n      focusLayer\n      currentLayer\n      status\n      layerStates\n      lastAgentMessage\n    }\n  }\n",
): (typeof documents)["\n  mutation StartActivation($input: StartActivationInput!) {\n    startActivation(input: $input) {\n      id\n      mode\n      focusLayer\n      currentLayer\n      status\n      layerStates\n      lastAgentMessage\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SubmitActivationTurn($input: SubmitActivationTurnInput!) {\n    submitActivationTurn(input: $input) {\n      id\n      currentLayer\n      status\n      layerStates\n      lastAgentMessage\n    }\n  }\n",
): (typeof documents)["\n  mutation SubmitActivationTurn($input: SubmitActivationTurnInput!) {\n    submitActivationTurn(input: $input) {\n      id\n      currentLayer\n      status\n      layerStates\n      lastAgentMessage\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation CheckpointActivationLayer($input: CheckpointActivationLayerInput!) {\n    checkpointActivationLayer(input: $input) {\n      id\n      currentLayer\n      status\n      layerStates\n      lastAgentMessage\n    }\n  }\n",
): (typeof documents)["\n  mutation CheckpointActivationLayer($input: CheckpointActivationLayerInput!) {\n    checkpointActivationLayer(input: $input) {\n      id\n      currentLayer\n      status\n      layerStates\n      lastAgentMessage\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation ApplyActivationBundle($input: ApplyActivationBundleInput!) {\n    applyActivationBundle(input: $input) {\n      id\n      status\n      layerStates\n      completedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation ApplyActivationBundle($input: ApplyActivationBundleInput!) {\n    applyActivationBundle(input: $input) {\n      id\n      status\n      layerStates\n      completedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation DismissActivationRecommendation($input: DismissActivationRecommendationInput!) {\n    dismissActivationRecommendation(input: $input) {\n      id\n      layerStates\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation DismissActivationRecommendation($input: DismissActivationRecommendationInput!) {\n    dismissActivationRecommendation(input: $input) {\n      id\n      layerStates\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query Threads(\n    $tenantId: ID!\n    $channel: ThreadChannel\n    $agentId: ID\n    $assigneeId: ID\n    $limit: Int\n    $cursor: String\n  ) {\n    threads(\n      tenantId: $tenantId\n      channel: $channel\n      agentId: $agentId\n      assigneeId: $assigneeId\n      limit: $limit\n      cursor: $cursor\n    ) {\n      id\n      tenantId\n      agentId\n      number\n      identifier\n      title\n      status\n      lifecycleStatus\n      channel\n      assigneeType\n      assigneeId\n      assignee {\n        id\n        name\n      }\n      reporterId\n      labels\n      metadata\n      dueAt\n      closedAt\n      archivedAt\n      lastActivityAt\n      lastTurnCompletedAt\n      lastReadAt\n      lastResponsePreview\n      createdAt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  query Threads(\n    $tenantId: ID!\n    $channel: ThreadChannel\n    $agentId: ID\n    $assigneeId: ID\n    $limit: Int\n    $cursor: String\n  ) {\n    threads(\n      tenantId: $tenantId\n      channel: $channel\n      agentId: $agentId\n      assigneeId: $assigneeId\n      limit: $limit\n      cursor: $cursor\n    ) {\n      id\n      tenantId\n      agentId\n      number\n      identifier\n      title\n      status\n      lifecycleStatus\n      channel\n      assigneeType\n      assigneeId\n      assignee {\n        id\n        name\n      }\n      reporterId\n      labels\n      metadata\n      dueAt\n      closedAt\n      archivedAt\n      lastActivityAt\n      lastTurnCompletedAt\n      lastReadAt\n      lastResponsePreview\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query Thread($id: ID!) {\n    thread(id: $id) {\n      id\n      tenantId\n      agentId\n      number\n      identifier\n      title\n      status\n      lifecycleStatus\n      channel\n      assigneeType\n      assigneeId\n      reporterId\n      labels\n      metadata\n      dueAt\n      closedAt\n      messages(limit: 100) {\n        edges {\n          node {\n            id\n            role\n            content\n            senderType\n            senderId\n            createdAt\n            durableArtifact {\n              id\n              title\n              type\n              status\n            }\n          }\n        }\n      }\n      attachments {\n        id\n        name\n        s3Key\n        mimeType\n        sizeBytes\n        createdAt\n      }\n      createdAt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  query Thread($id: ID!) {\n    thread(id: $id) {\n      id\n      tenantId\n      agentId\n      number\n      identifier\n      title\n      status\n      lifecycleStatus\n      channel\n      assigneeType\n      assigneeId\n      reporterId\n      labels\n      metadata\n      dueAt\n      closedAt\n      messages(limit: 100) {\n        edges {\n          node {\n            id\n            role\n            content\n            senderType\n            senderId\n            createdAt\n            durableArtifact {\n              id\n              title\n              type\n              status\n            }\n          }\n        }\n      }\n      attachments {\n        id\n        name\n        s3Key\n        mimeType\n        sizeBytes\n        createdAt\n      }\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation CreateThread($input: CreateThreadInput!) {\n    createThread(input: $input) {\n      id\n      number\n      title\n      status\n      createdAt\n    }\n  }\n",
): (typeof documents)["\n  mutation CreateThread($input: CreateThreadInput!) {\n    createThread(input: $input) {\n      id\n      number\n      title\n      status\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation UpdateThread($id: ID!, $input: UpdateThreadInput!) {\n    updateThread(id: $id, input: $input) {\n      id\n      title\n      status\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation UpdateThread($id: ID!, $input: UpdateThreadInput!) {\n    updateThread(id: $id, input: $input) {\n      id\n      title\n      status\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  subscription OnAgentStatusChanged($tenantId: ID!) {\n    onAgentStatusChanged(tenantId: $tenantId) {\n      agentId\n      tenantId\n      status\n      name\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  subscription OnAgentStatusChanged($tenantId: ID!) {\n    onAgentStatusChanged(tenantId: $tenantId) {\n      agentId\n      tenantId\n      status\n      name\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  subscription OnNewMessage($threadId: ID!) {\n    onNewMessage(threadId: $threadId) {\n      messageId\n      threadId\n      tenantId\n      role\n      content\n      senderType\n      senderId\n      createdAt\n    }\n  }\n",
): (typeof documents)["\n  subscription OnNewMessage($threadId: ID!) {\n    onNewMessage(threadId: $threadId) {\n      messageId\n      threadId\n      tenantId\n      role\n      content\n      senderType\n      senderId\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  subscription OnHeartbeatActivity($tenantId: ID!) {\n    onHeartbeatActivity(tenantId: $tenantId) {\n      heartbeatId\n      tenantId\n      status\n      message\n      createdAt\n    }\n  }\n",
): (typeof documents)["\n  subscription OnHeartbeatActivity($tenantId: ID!) {\n    onHeartbeatActivity(tenantId: $tenantId) {\n      heartbeatId\n      tenantId\n      status\n      message\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  subscription OnThreadUpdated($tenantId: ID!) {\n    onThreadUpdated(tenantId: $tenantId) {\n      threadId\n      tenantId\n      status\n      title\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  subscription OnThreadUpdated($tenantId: ID!) {\n    onThreadUpdated(tenantId: $tenantId) {\n      threadId\n      tenantId\n      status\n      title\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  subscription OnThreadTurnUpdated($tenantId: ID!) {\n    onThreadTurnUpdated(tenantId: $tenantId) {\n      runId\n      triggerId\n      threadId\n      tenantId\n      status\n      triggerName\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  subscription OnThreadTurnUpdated($tenantId: ID!) {\n    onThreadTurnUpdated(tenantId: $tenantId) {\n      runId\n      triggerId\n      threadId\n      tenantId\n      status\n      triggerName\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  subscription OnInboxItemStatusChanged($tenantId: ID!) {\n    onInboxItemStatusChanged(tenantId: $tenantId) {\n      inboxItemId\n      tenantId\n      status\n      title\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  subscription OnInboxItemStatusChanged($tenantId: ID!) {\n    onInboxItemStatusChanged(tenantId: $tenantId) {\n      inboxItemId\n      tenantId\n      status\n      title\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query InboxItems(\n    $tenantId: ID!\n    $status: InboxItemStatus\n    $entityType: String\n    $entityId: ID\n  ) {\n    inboxItems(\n      tenantId: $tenantId\n      status: $status\n      entityType: $entityType\n      entityId: $entityId\n    ) {\n      id\n      tenantId\n      requesterType\n      requesterId\n      type\n      status\n      title\n      description\n      entityType\n      entityId\n      config\n      revision\n      reviewNotes\n      decidedBy\n      decidedAt\n      expiresAt\n      comments {\n        id\n        inboxItemId\n        authorType\n        authorId\n        content\n        createdAt\n      }\n      links {\n        id\n        linkedType\n        linkedId\n        createdAt\n      }\n      linkedThreads {\n        id\n        number\n        identifier\n        title\n        status\n      }\n      createdAt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  query InboxItems(\n    $tenantId: ID!\n    $status: InboxItemStatus\n    $entityType: String\n    $entityId: ID\n  ) {\n    inboxItems(\n      tenantId: $tenantId\n      status: $status\n      entityType: $entityType\n      entityId: $entityId\n    ) {\n      id\n      tenantId\n      requesterType\n      requesterId\n      type\n      status\n      title\n      description\n      entityType\n      entityId\n      config\n      revision\n      reviewNotes\n      decidedBy\n      decidedAt\n      expiresAt\n      comments {\n        id\n        inboxItemId\n        authorType\n        authorId\n        content\n        createdAt\n      }\n      links {\n        id\n        linkedType\n        linkedId\n        createdAt\n      }\n      linkedThreads {\n        id\n        number\n        identifier\n        title\n        status\n      }\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query InboxItem($id: ID!) {\n    inboxItem(id: $id) {\n      id\n      tenantId\n      requesterType\n      requesterId\n      type\n      status\n      title\n      description\n      entityType\n      entityId\n      config\n      revision\n      reviewNotes\n      decidedBy\n      decidedAt\n      expiresAt\n      comments {\n        id\n        inboxItemId\n        authorType\n        authorId\n        content\n        createdAt\n      }\n      links {\n        id\n        linkedType\n        linkedId\n        createdAt\n      }\n      linkedThreads {\n        id\n        number\n        identifier\n        title\n        status\n      }\n      createdAt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  query InboxItem($id: ID!) {\n    inboxItem(id: $id) {\n      id\n      tenantId\n      requesterType\n      requesterId\n      type\n      status\n      title\n      description\n      entityType\n      entityId\n      config\n      revision\n      reviewNotes\n      decidedBy\n      decidedAt\n      expiresAt\n      comments {\n        id\n        inboxItemId\n        authorType\n        authorId\n        content\n        createdAt\n      }\n      links {\n        id\n        linkedType\n        linkedId\n        createdAt\n      }\n      linkedThreads {\n        id\n        number\n        identifier\n        title\n        status\n      }\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation DecideInboxItem($id: ID!, $input: InboxItemDecisionInput!) {\n    decideInboxItem(id: $id, input: $input) {\n      id\n      status\n      reviewNotes\n      decidedBy\n      decidedAt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation DecideInboxItem($id: ID!, $input: InboxItemDecisionInput!) {\n    decideInboxItem(id: $id, input: $input) {\n      id\n      status\n      reviewNotes\n      decidedBy\n      decidedAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation AddInboxItemComment($input: AddInboxItemCommentInput!) {\n    addInboxItemComment(input: $input) {\n      id\n      inboxItemId\n      content\n      authorType\n      authorId\n      createdAt\n    }\n  }\n",
): (typeof documents)["\n  mutation AddInboxItemComment($input: AddInboxItemCommentInput!) {\n    addInboxItemComment(input: $input) {\n      id\n      inboxItemId\n      content\n      authorType\n      authorId\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  subscription OnOrgUpdated($tenantId: ID!) {\n    onOrgUpdated(tenantId: $tenantId) {\n      tenantId\n      changeType\n      entityType\n      entityId\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  subscription OnOrgUpdated($tenantId: ID!) {\n    onOrgUpdated(tenantId: $tenantId) {\n      tenantId\n      changeType\n      entityType\n      entityId\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query ThreadTurnsForThread($tenantId: ID!, $threadId: ID!, $limit: Int) {\n    threadTurns(tenantId: $tenantId, threadId: $threadId, limit: $limit) {\n      id\n      tenantId\n      agentId\n      invocationSource\n      triggerDetail\n      triggerName\n      threadId\n      turnNumber\n      status\n      startedAt\n      finishedAt\n      error\n      resultJson\n      usageJson\n      totalCost\n      retryAttempt\n      originTurnId\n      createdAt\n    }\n  }\n",
): (typeof documents)["\n  query ThreadTurnsForThread($tenantId: ID!, $threadId: ID!, $limit: Int) {\n    threadTurns(tenantId: $tenantId, threadId: $threadId, limit: $limit) {\n      id\n      tenantId\n      agentId\n      invocationSource\n      triggerDetail\n      triggerName\n      threadId\n      turnNumber\n      status\n      startedAt\n      finishedAt\n      error\n      resultJson\n      usageJson\n      totalCost\n      retryAttempt\n      originTurnId\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query ArtifactsForThread($tenantId: ID!, $threadId: ID!, $limit: Int) {\n    artifacts(tenantId: $tenantId, threadId: $threadId, limit: $limit) {\n      id\n      tenantId\n      agentId\n      threadId\n      title\n      type\n      status\n      summary\n      createdAt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  query ArtifactsForThread($tenantId: ID!, $threadId: ID!, $limit: Int) {\n    artifacts(tenantId: $tenantId, threadId: $threadId, limit: $limit) {\n      id\n      tenantId\n      agentId\n      threadId\n      title\n      type\n      status\n      summary\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query ArtifactDetail($id: ID!) {\n    artifact(id: $id) {\n      id\n      title\n      type\n      status\n      content\n      summary\n      createdAt\n    }\n  }\n",
): (typeof documents)["\n  query ArtifactDetail($id: ID!) {\n    artifact(id: $id) {\n      id\n      title\n      type\n      status\n      content\n      summary\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query MemoryRecords($assistantId: ID!, $namespace: String!) {\n    memoryRecords(assistantId: $assistantId, namespace: $namespace) {\n      memoryRecordId\n      content {\n        text\n      }\n      createdAt\n      updatedAt\n      expiresAt\n      namespace\n      strategyId\n      # "Contributes to:" chips — Unit 8 / handoff #3. One nested resolver\n      # call per record, capped at typical list size ≤50. DataLoader is a\n      # future optimization if large result sets become the norm.\n      wikiPages {\n        id\n        type\n        slug\n        title\n      }\n    }\n  }\n',
): (typeof documents)['\n  query MemoryRecords($assistantId: ID!, $namespace: String!) {\n    memoryRecords(assistantId: $assistantId, namespace: $namespace) {\n      memoryRecordId\n      content {\n        text\n      }\n      createdAt\n      updatedAt\n      expiresAt\n      namespace\n      strategyId\n      # "Contributes to:" chips — Unit 8 / handoff #3. One nested resolver\n      # call per record, capped at typical list size ≤50. DataLoader is a\n      # future optimization if large result sets become the norm.\n      wikiPages {\n        id\n        type\n        slug\n        title\n      }\n    }\n  }\n'];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation DeleteMemoryRecord($memoryRecordId: ID!) {\n    deleteMemoryRecord(memoryRecordId: $memoryRecordId)\n  }\n",
): (typeof documents)["\n  mutation DeleteMemoryRecord($memoryRecordId: ID!) {\n    deleteMemoryRecord(memoryRecordId: $memoryRecordId)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation UpdateMemoryRecord($memoryRecordId: ID!, $content: String!) {\n    updateMemoryRecord(memoryRecordId: $memoryRecordId, content: $content)\n  }\n",
): (typeof documents)["\n  mutation UpdateMemoryRecord($memoryRecordId: ID!, $content: String!) {\n    updateMemoryRecord(memoryRecordId: $memoryRecordId, content: $content)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query AgentWorkspaceReviews(\n    $tenantId: ID!\n    $agentId: ID\n    $status: String\n    $limit: Int\n  ) {\n    agentWorkspaceReviews(\n      tenantId: $tenantId\n      agentId: $agentId\n      status: $status\n      limit: $limit\n    ) {\n      threadId\n      reviewObjectKey\n      targetPath\n      requestedAt\n      reason\n      payload\n      reviewEtag\n      run {\n        id\n        agentId\n        targetPath\n        status\n        currentWakeupRequestId\n        currentThreadTurnId\n        lastEventAt\n        createdAt\n        updatedAt\n      }\n      latestEvent {\n        id\n        eventType\n        reason\n        sourceObjectKey\n        payload\n        createdAt\n      }\n    }\n  }\n",
): (typeof documents)["\n  query AgentWorkspaceReviews(\n    $tenantId: ID!\n    $agentId: ID\n    $status: String\n    $limit: Int\n  ) {\n    agentWorkspaceReviews(\n      tenantId: $tenantId\n      agentId: $agentId\n      status: $status\n      limit: $limit\n    ) {\n      threadId\n      reviewObjectKey\n      targetPath\n      requestedAt\n      reason\n      payload\n      reviewEtag\n      run {\n        id\n        agentId\n        targetPath\n        status\n        currentWakeupRequestId\n        currentThreadTurnId\n        lastEventAt\n        createdAt\n        updatedAt\n      }\n      latestEvent {\n        id\n        eventType\n        reason\n        sourceObjectKey\n        payload\n        createdAt\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query AgentWorkspaceReview($runId: ID!) {\n    agentWorkspaceReview(runId: $runId) {\n      threadId\n      reviewObjectKey\n      targetPath\n      requestedAt\n      reason\n      payload\n      reviewBody\n      reviewEtag\n      reviewMissing\n      proposedChanges {\n        path\n        kind\n        summary\n        diff\n        before\n        after\n      }\n      run {\n        id\n        tenantId\n        agentId\n        targetPath\n        status\n        currentWakeupRequestId\n        currentThreadTurnId\n        lastEventAt\n        createdAt\n        updatedAt\n      }\n      events {\n        id\n        eventType\n        reason\n        sourceObjectKey\n        payload\n        createdAt\n      }\n      decisionEvents {\n        id\n        eventType\n        reason\n        actorType\n        actorId\n        payload\n        createdAt\n      }\n    }\n  }\n",
): (typeof documents)["\n  query AgentWorkspaceReview($runId: ID!) {\n    agentWorkspaceReview(runId: $runId) {\n      threadId\n      reviewObjectKey\n      targetPath\n      requestedAt\n      reason\n      payload\n      reviewBody\n      reviewEtag\n      reviewMissing\n      proposedChanges {\n        path\n        kind\n        summary\n        diff\n        before\n        after\n      }\n      run {\n        id\n        tenantId\n        agentId\n        targetPath\n        status\n        currentWakeupRequestId\n        currentThreadTurnId\n        lastEventAt\n        createdAt\n        updatedAt\n      }\n      events {\n        id\n        eventType\n        reason\n        sourceObjectKey\n        payload\n        createdAt\n      }\n      decisionEvents {\n        id\n        eventType\n        reason\n        actorType\n        actorId\n        payload\n        createdAt\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation AcceptAgentWorkspaceReview(\n    $runId: ID!\n    $input: AgentWorkspaceReviewDecisionInput\n  ) {\n    acceptAgentWorkspaceReview(runId: $runId, input: $input) {\n      id\n      status\n      currentWakeupRequestId\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation AcceptAgentWorkspaceReview(\n    $runId: ID!\n    $input: AgentWorkspaceReviewDecisionInput\n  ) {\n    acceptAgentWorkspaceReview(runId: $runId, input: $input) {\n      id\n      status\n      currentWakeupRequestId\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation CancelAgentWorkspaceReview(\n    $runId: ID!\n    $input: AgentWorkspaceReviewDecisionInput\n  ) {\n    cancelAgentWorkspaceReview(runId: $runId, input: $input) {\n      id\n      status\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation CancelAgentWorkspaceReview(\n    $runId: ID!\n    $input: AgentWorkspaceReviewDecisionInput\n  ) {\n    cancelAgentWorkspaceReview(runId: $runId, input: $input) {\n      id\n      status\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation ResumeAgentWorkspaceRun(\n    $runId: ID!\n    $input: AgentWorkspaceReviewDecisionInput\n  ) {\n    resumeAgentWorkspaceRun(runId: $runId, input: $input) {\n      id\n      status\n      currentWakeupRequestId\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation ResumeAgentWorkspaceRun(\n    $runId: ID!\n    $input: AgentWorkspaceReviewDecisionInput\n  ) {\n    resumeAgentWorkspaceRun(runId: $runId, input: $input) {\n      id\n      status\n      currentWakeupRequestId\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation RegisterPushToken($input: RegisterPushTokenInput!) {\n    registerPushToken(input: $input)\n  }\n",
): (typeof documents)["\n  mutation RegisterPushToken($input: RegisterPushTokenInput!) {\n    registerPushToken(input: $input)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation UnregisterPushToken($token: String!) {\n    unregisterPushToken(token: $token)\n  }\n",
): (typeof documents)["\n  mutation UnregisterPushToken($token: String!) {\n    unregisterPushToken(token: $token)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query AgentWorkspaces($agentId: ID!) {\n    agentWorkspaces(agentId: $agentId) {\n      slug\n      name\n      purpose\n    }\n  }\n",
): (typeof documents)["\n  query AgentWorkspaces($agentId: ID!) {\n    agentWorkspaces(agentId: $agentId) {\n      slug\n      name\n      purpose\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query UserQuickActions($tenantId: ID!) {\n    userQuickActions(tenantId: $tenantId) {\n      id\n      userId\n      tenantId\n      title\n      prompt\n      workspaceAgentId\n      sortOrder\n      createdAt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  query UserQuickActions($tenantId: ID!) {\n    userQuickActions(tenantId: $tenantId) {\n      id\n      userId\n      tenantId\n      title\n      prompt\n      workspaceAgentId\n      sortOrder\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation CreateQuickAction($input: CreateQuickActionInput!) {\n    createQuickAction(input: $input) {\n      id\n      userId\n      tenantId\n      title\n      prompt\n      workspaceAgentId\n      sortOrder\n      createdAt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation CreateQuickAction($input: CreateQuickActionInput!) {\n    createQuickAction(input: $input) {\n      id\n      userId\n      tenantId\n      title\n      prompt\n      workspaceAgentId\n      sortOrder\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation UpdateQuickAction($id: ID!, $input: UpdateQuickActionInput!) {\n    updateQuickAction(id: $id, input: $input) {\n      id\n      userId\n      tenantId\n      title\n      prompt\n      workspaceAgentId\n      sortOrder\n      createdAt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation UpdateQuickAction($id: ID!, $input: UpdateQuickActionInput!) {\n    updateQuickAction(id: $id, input: $input) {\n      id\n      userId\n      tenantId\n      title\n      prompt\n      workspaceAgentId\n      sortOrder\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation DeleteQuickAction($id: ID!) {\n    deleteQuickAction(id: $id)\n  }\n",
): (typeof documents)["\n  mutation DeleteQuickAction($id: ID!) {\n    deleteQuickAction(id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation ReorderQuickActions($input: ReorderQuickActionsInput!) {\n    reorderQuickActions(input: $input) {\n      id\n      sortOrder\n    }\n  }\n",
): (typeof documents)["\n  mutation ReorderQuickActions($input: ReorderQuickActionsInput!) {\n    reorderQuickActions(input: $input) {\n      id\n      sortOrder\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation RefreshGenUI($messageId: ID!, $toolIndex: Int!) {\n    refreshGenUI(messageId: $messageId, toolIndex: $toolIndex) {\n      id\n      toolResults\n    }\n  }\n",
): (typeof documents)["\n  mutation RefreshGenUI($messageId: ID!, $toolIndex: Int!) {\n    refreshGenUI(messageId: $messageId, toolIndex: $toolIndex) {\n      id\n      toolResults\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation CreateRecipe($input: CreateRecipeInput!) {\n    createRecipe(input: $input) {\n      id\n      title\n      genuiType\n    }\n  }\n",
): (typeof documents)["\n  mutation CreateRecipe($input: CreateRecipeInput!) {\n    createRecipe(input: $input) {\n      id\n      title\n      genuiType\n    }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> =
  TDocumentNode extends DocumentNode<infer TType, any> ? TType : never;
