/* eslint-disable */
import * as types from './graphql';
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

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
    "\n  query CliAgents(\n    $tenantId: ID!\n    $status: AgentStatus\n    $type: AgentType\n    $includeSystem: Boolean\n  ) {\n    agents(\n      tenantId: $tenantId\n      status: $status\n      type: $type\n      includeSystem: $includeSystem\n    ) {\n      id\n      name\n      slug\n      role\n      type\n      status\n      runtime\n      lastHeartbeatAt\n    }\n  }\n": typeof types.CliAgentsDocument,
    "\n  query CliAllTenantAgents(\n    $tenantId: ID!\n    $includeSystem: Boolean\n    $includeSubAgents: Boolean\n  ) {\n    allTenantAgents(\n      tenantId: $tenantId\n      includeSystem: $includeSystem\n      includeSubAgents: $includeSubAgents\n    ) {\n      id\n      name\n      slug\n      role\n      type\n      status\n      runtime\n      lastHeartbeatAt\n    }\n  }\n": typeof types.CliAllTenantAgentsDocument,
    "\n  query CliAgent($id: ID!) {\n    agent(id: $id) {\n      id\n      name\n      slug\n      role\n      type\n      source\n      status\n      systemPrompt\n      runtime\n      adapterType\n      version\n      humanPairId\n      parentAgentId\n      reportsToId\n      lastHeartbeatAt\n      createdAt\n      updatedAt\n      capabilities {\n        capability\n        enabled\n        config\n      }\n      skills {\n        skillId\n        enabled\n        rateLimitRpm\n      }\n      budgetPolicy {\n        period\n        limitUsd\n        actionOnExceed\n      }\n    }\n  }\n": typeof types.CliAgentDocument,
    "\n  mutation CliCreateAgent($input: CreateAgentInput!) {\n    createAgent(input: $input) {\n      id\n      name\n      type\n      status\n    }\n  }\n": typeof types.CliCreateAgentDocument,
    "\n  mutation CliUpdateAgent($id: ID!, $input: UpdateAgentInput!) {\n    updateAgent(id: $id, input: $input) {\n      id\n      name\n      role\n      type\n      status\n    }\n  }\n": typeof types.CliUpdateAgentDocument,
    "\n  mutation CliDeleteAgent($id: ID!) {\n    deleteAgent(id: $id)\n  }\n": typeof types.CliDeleteAgentDocument,
    "\n  mutation CliUpdateAgentStatus($id: ID!, $status: AgentStatus!) {\n    updateAgentStatus(id: $id, status: $status) {\n      id\n      status\n    }\n  }\n": typeof types.CliUpdateAgentStatusDocument,
    "\n  mutation CliSetAgentCapabilities(\n    $agentId: ID!\n    $capabilities: [AgentCapabilityInput!]!\n  ) {\n    setAgentCapabilities(agentId: $agentId, capabilities: $capabilities) {\n      capability\n      enabled\n    }\n  }\n": typeof types.CliSetAgentCapabilitiesDocument,
    "\n  mutation CliSetAgentSkills($agentId: ID!, $skills: [AgentSkillInput!]!) {\n    setAgentSkills(agentId: $agentId, skills: $skills) {\n      skillId\n      enabled\n      rateLimitRpm\n    }\n  }\n": typeof types.CliSetAgentSkillsDocument,
    "\n  mutation CliSetAgentBudgetPolicy(\n    $agentId: ID!\n    $input: AgentBudgetPolicyInput!\n  ) {\n    setAgentBudgetPolicy(agentId: $agentId, input: $input) {\n      period\n      limitUsd\n      actionOnExceed\n    }\n  }\n": typeof types.CliSetAgentBudgetPolicyDocument,
    "\n  mutation CliDeleteAgentBudgetPolicy($agentId: ID!) {\n    deleteAgentBudgetPolicy(agentId: $agentId)\n  }\n": typeof types.CliDeleteAgentBudgetPolicyDocument,
    "\n  query CliAgentApiKeys($agentId: ID!) {\n    agentApiKeys(agentId: $agentId) {\n      id\n      name\n      keyPrefix\n      lastUsedAt\n      revokedAt\n      createdAt\n    }\n  }\n": typeof types.CliAgentApiKeysDocument,
    "\n  mutation CliCreateAgentApiKey($input: CreateAgentApiKeyInput!) {\n    createAgentApiKey(input: $input) {\n      apiKey {\n        id\n        name\n        keyPrefix\n        createdAt\n      }\n      plainTextKey\n    }\n  }\n": typeof types.CliCreateAgentApiKeyDocument,
    "\n  mutation CliRevokeAgentApiKey($id: ID!) {\n    revokeAgentApiKey(id: $id) {\n      id\n      revokedAt\n    }\n  }\n": typeof types.CliRevokeAgentApiKeyDocument,
    "\n  mutation CliToggleAgentEmail($agentId: ID!, $enabled: Boolean!) {\n    toggleAgentEmailChannel(agentId: $agentId, enabled: $enabled) {\n      capability\n      enabled\n    }\n  }\n": typeof types.CliToggleAgentEmailDocument,
    "\n  mutation CliClaimVanityEmail($agentId: ID!, $localPart: String!) {\n    claimVanityEmailAddress(agentId: $agentId, localPart: $localPart) {\n      capability\n      enabled\n      config\n    }\n  }\n": typeof types.CliClaimVanityEmailDocument,
    "\n  mutation CliReleaseVanityEmail($agentId: ID!) {\n    releaseVanityEmailAddress(agentId: $agentId) {\n      capability\n      enabled\n    }\n  }\n": typeof types.CliReleaseVanityEmailDocument,
    "\n  mutation CliUpdateAgentEmailAllowlist(\n    $agentId: ID!\n    $allowedSenders: [String!]!\n  ) {\n    updateAgentEmailAllowlist(\n      agentId: $agentId\n      allowedSenders: $allowedSenders\n    ) {\n      capability\n      config\n    }\n  }\n": typeof types.CliUpdateAgentEmailAllowlistDocument,
    "\n  query CliAgentTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n": typeof types.CliAgentTenantBySlugDocument,
    "\n  query CliArtifacts(\n    $tenantId: ID!\n    $threadId: ID\n    $agentId: ID\n    $type: ArtifactType\n    $status: ArtifactStatus\n    $limit: Int\n    $cursor: String\n  ) {\n    artifacts(\n      tenantId: $tenantId\n      threadId: $threadId\n      agentId: $agentId\n      type: $type\n      status: $status\n      limit: $limit\n      cursor: $cursor\n    ) {\n      id\n      title\n      type\n      status\n      agentId\n      threadId\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.CliArtifactsDocument,
    "\n  query CliArtifact($id: ID!) {\n    artifact(id: $id) {\n      id\n      tenantId\n      agentId\n      threadId\n      title\n      type\n      status\n      summary\n      content\n      s3Key\n      sourceMessageId\n      favoritedAt\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.CliArtifactDocument,
    "\n  query CliArtifactTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n": typeof types.CliArtifactTenantBySlugDocument,
    "\n  query CliBudgetPolicies($tenantId: ID!) {\n    budgetPolicies(tenantId: $tenantId) {\n      id\n      scope\n      agentId\n      period\n      limitUsd\n      actionOnExceed\n      enabled\n    }\n  }\n": typeof types.CliBudgetPoliciesDocument,
    "\n  query CliBudgetStatus($tenantId: ID!) {\n    budgetStatus(tenantId: $tenantId) {\n      policy {\n        id\n        scope\n        agentId\n        period\n        limitUsd\n      }\n      spentUsd\n      remainingUsd\n      percentUsed\n      status\n    }\n  }\n": typeof types.CliBudgetStatusDocument,
    "\n  mutation CliUpsertBudgetPolicy($tenantId: ID!, $input: UpsertBudgetPolicyInput!) {\n    upsertBudgetPolicy(tenantId: $tenantId, input: $input) {\n      id\n      scope\n      agentId\n      limitUsd\n      period\n      actionOnExceed\n    }\n  }\n": typeof types.CliUpsertBudgetPolicyDocument,
    "\n  mutation CliDeleteBudgetPolicy($id: ID!) {\n    deleteBudgetPolicy(id: $id)\n  }\n": typeof types.CliDeleteBudgetPolicyDocument,
    "\n  query CliCostSummary($tenantId: ID!, $from: AWSDateTime, $to: AWSDateTime) {\n    costSummary(tenantId: $tenantId, from: $from, to: $to) {\n      totalUsd\n      llmUsd\n      computeUsd\n      toolsUsd\n      evalUsd\n      totalInputTokens\n      totalOutputTokens\n      eventCount\n    }\n  }\n": typeof types.CliCostSummaryDocument,
    "\n  query CliCostByAgent($tenantId: ID!, $from: AWSDateTime, $to: AWSDateTime) {\n    costByAgent(tenantId: $tenantId, from: $from, to: $to) {\n      agentId\n      agentName\n      totalUsd\n      eventCount\n    }\n  }\n": typeof types.CliCostByAgentDocument,
    "\n  query CliCostByModel($tenantId: ID!, $from: AWSDateTime, $to: AWSDateTime) {\n    costByModel(tenantId: $tenantId, from: $from, to: $to) {\n      model\n      totalUsd\n      inputTokens\n      outputTokens\n    }\n  }\n": typeof types.CliCostByModelDocument,
    "\n  query CliCostSeries($tenantId: ID!, $days: Int) {\n    costTimeSeries(tenantId: $tenantId, days: $days) {\n      day\n      totalUsd\n      llmUsd\n      computeUsd\n      toolsUsd\n      eventCount\n    }\n  }\n": typeof types.CliCostSeriesDocument,
    "\n  query CliDashboard($tenantId: ID!) {\n    agents(tenantId: $tenantId) {\n      id\n      status\n    }\n    threads(tenantId: $tenantId, limit: 200) {\n      id\n      status\n      archivedAt\n    }\n    inboxItems(tenantId: $tenantId, status: PENDING) {\n      id\n    }\n    costSummary(tenantId: $tenantId) {\n      totalUsd\n      llmUsd\n      computeUsd\n      eventCount\n    }\n  }\n": typeof types.CliDashboardDocument,
    "\n  query CliEvalRuns($tenantId: ID!, $agentId: ID, $limit: Int, $offset: Int) {\n    evalRuns(\n      tenantId: $tenantId\n      agentId: $agentId\n      limit: $limit\n      offset: $offset\n    ) {\n      totalCount\n      items {\n        id\n        status\n        model\n        categories\n        agentId\n        agentName\n        agentTemplateId\n        totalTests\n        passed\n        failed\n        passRate\n        regression\n        costUsd\n        errorMessage\n        startedAt\n        completedAt\n        createdAt\n      }\n    }\n  }\n": typeof types.CliEvalRunsDocument,
    "\n  query CliEvalRun($id: ID!) {\n    evalRun(id: $id) {\n      id\n      status\n      model\n      categories\n      agentId\n      agentName\n      agentTemplateId\n      totalTests\n      passed\n      failed\n      passRate\n      regression\n      costUsd\n      errorMessage\n      startedAt\n      completedAt\n      createdAt\n    }\n  }\n": typeof types.CliEvalRunDocument,
    "\n  query CliEvalRunResults($runId: ID!) {\n    evalRunResults(runId: $runId) {\n      id\n      testCaseId\n      testCaseName\n      category\n      status\n      score\n      durationMs\n      agentSessionId\n      input\n      expected\n      actualOutput\n      evaluatorResults\n      assertions\n      errorMessage\n      createdAt\n    }\n  }\n": typeof types.CliEvalRunResultsDocument,
    "\n  query CliEvalTestCases($tenantId: ID!, $category: String, $search: String) {\n    evalTestCases(tenantId: $tenantId, category: $category, search: $search) {\n      id\n      name\n      category\n      query\n      systemPrompt\n      agentTemplateId\n      agentcoreEvaluatorIds\n      tags\n      enabled\n      source\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.CliEvalTestCasesDocument,
    "\n  query CliEvalTestCase($id: ID!) {\n    evalTestCase(id: $id) {\n      id\n      tenantId\n      name\n      category\n      query\n      systemPrompt\n      agentTemplateId\n      assertions\n      agentcoreEvaluatorIds\n      tags\n      enabled\n      source\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.CliEvalTestCaseDocument,
    "\n  query CliComputersForEval($tenantId: ID!) {\n    computers(tenantId: $tenantId) {\n      id\n      name\n      slug\n      runtimeStatus\n    }\n  }\n": typeof types.CliComputersForEvalDocument,
    "\n  query CliTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n": typeof types.CliTenantBySlugDocument,
    "\n  mutation CliStartEvalRun($tenantId: ID!, $input: StartEvalRunInput!) {\n    startEvalRun(tenantId: $tenantId, input: $input) {\n      id\n      status\n      model\n      categories\n      agentTemplateId\n      totalTests\n      createdAt\n    }\n  }\n": typeof types.CliStartEvalRunDocument,
    "\n  mutation CliCancelEvalRun($id: ID!) {\n    cancelEvalRun(id: $id) {\n      id\n      status\n      completedAt\n    }\n  }\n": typeof types.CliCancelEvalRunDocument,
    "\n  mutation CliDeleteEvalRun($id: ID!) {\n    deleteEvalRun(id: $id)\n  }\n": typeof types.CliDeleteEvalRunDocument,
    "\n  mutation CliCreateEvalTestCase(\n    $tenantId: ID!\n    $input: CreateEvalTestCaseInput!\n  ) {\n    createEvalTestCase(tenantId: $tenantId, input: $input) {\n      id\n      name\n      category\n    }\n  }\n": typeof types.CliCreateEvalTestCaseDocument,
    "\n  mutation CliUpdateEvalTestCase($id: ID!, $input: UpdateEvalTestCaseInput!) {\n    updateEvalTestCase(id: $id, input: $input) {\n      id\n      name\n      category\n      enabled\n    }\n  }\n": typeof types.CliUpdateEvalTestCaseDocument,
    "\n  mutation CliDeleteEvalTestCase($id: ID!) {\n    deleteEvalTestCase(id: $id)\n  }\n": typeof types.CliDeleteEvalTestCaseDocument,
    "\n  mutation CliSeedEvalTestCases($tenantId: ID!, $categories: [String!]) {\n    seedEvalTestCases(tenantId: $tenantId, categories: $categories)\n  }\n": typeof types.CliSeedEvalTestCasesDocument,
    "\n  query CliInboxItems(\n    $tenantId: ID!\n    $status: InboxItemStatus\n    $entityType: String\n    $entityId: ID\n    $recipientId: ID\n  ) {\n    inboxItems(\n      tenantId: $tenantId\n      status: $status\n      entityType: $entityType\n      entityId: $entityId\n      recipientId: $recipientId\n    ) {\n      id\n      type\n      status\n      title\n      description\n      requesterType\n      requesterId\n      recipientId\n      entityType\n      entityId\n      revision\n      reviewNotes\n      decidedBy\n      decidedAt\n      expiresAt\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.CliInboxItemsDocument,
    "\n  query CliInboxItem($id: ID!) {\n    inboxItem(id: $id) {\n      id\n      type\n      status\n      title\n      description\n      requesterType\n      requesterId\n      recipientId\n      entityType\n      entityId\n      config\n      revision\n      reviewNotes\n      decidedBy\n      decidedAt\n      expiresAt\n      createdAt\n      updatedAt\n      comments {\n        id\n        authorType\n        authorId\n        content\n        createdAt\n      }\n      links {\n        id\n        linkedType\n        linkedId\n        createdAt\n      }\n      linkedThreads {\n        id\n        number\n        identifier\n        title\n        status\n      }\n    }\n  }\n": typeof types.CliInboxItemDocument,
    "\n  mutation CliInboxApprove($id: ID!, $input: ApproveInboxItemInput) {\n    approveInboxItem(id: $id, input: $input) {\n      id\n      status\n      reviewNotes\n      decidedAt\n    }\n  }\n": typeof types.CliInboxApproveDocument,
    "\n  mutation CliInboxReject($id: ID!, $input: RejectInboxItemInput) {\n    rejectInboxItem(id: $id, input: $input) {\n      id\n      status\n      reviewNotes\n      decidedAt\n    }\n  }\n": typeof types.CliInboxRejectDocument,
    "\n  mutation CliInboxRequestRevision($id: ID!, $input: RequestRevisionInput!) {\n    requestRevision(id: $id, input: $input) {\n      id\n      status\n      reviewNotes\n      revision\n    }\n  }\n": typeof types.CliInboxRequestRevisionDocument,
    "\n  mutation CliInboxResubmit($id: ID!, $input: ResubmitInboxItemInput) {\n    resubmitInboxItem(id: $id, input: $input) {\n      id\n      status\n      revision\n    }\n  }\n": typeof types.CliInboxResubmitDocument,
    "\n  mutation CliInboxCancel($id: ID!) {\n    cancelInboxItem(id: $id) {\n      id\n      status\n    }\n  }\n": typeof types.CliInboxCancelDocument,
    "\n  mutation CliInboxAddComment($input: AddInboxItemCommentInput!) {\n    addInboxItemComment(input: $input) {\n      id\n      inboxItemId\n      authorType\n      authorId\n      content\n      createdAt\n    }\n  }\n": typeof types.CliInboxAddCommentDocument,
    "\n  query CliInboxTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n": typeof types.CliInboxTenantBySlugDocument,
    "\n  query CliKnowledgeBases($tenantId: ID!) {\n    knowledgeBases(tenantId: $tenantId) {\n      id\n      name\n      slug\n      embeddingModel\n      status\n      documentCount\n      lastSyncAt\n      lastSyncStatus\n    }\n  }\n": typeof types.CliKnowledgeBasesDocument,
    "\n  query CliKnowledgeBase($id: ID!) {\n    knowledgeBase(id: $id) {\n      id\n      name\n      slug\n      description\n      embeddingModel\n      chunkingStrategy\n      chunkSizeTokens\n      chunkOverlapPercent\n      status\n      awsKbId\n      documentCount\n      lastSyncAt\n      lastSyncStatus\n      errorMessage\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.CliKnowledgeBaseDocument,
    "\n  mutation CliCreateKB($input: CreateKnowledgeBaseInput!) {\n    createKnowledgeBase(input: $input) {\n      id\n      name\n      slug\n      status\n    }\n  }\n": typeof types.CliCreateKbDocument,
    "\n  mutation CliUpdateKB($id: ID!, $input: UpdateKnowledgeBaseInput!) {\n    updateKnowledgeBase(id: $id, input: $input) {\n      id\n      name\n      description\n    }\n  }\n": typeof types.CliUpdateKbDocument,
    "\n  mutation CliDeleteKB($id: ID!) {\n    deleteKnowledgeBase(id: $id)\n  }\n": typeof types.CliDeleteKbDocument,
    "\n  mutation CliSyncKB($id: ID!) {\n    syncKnowledgeBase(id: $id) {\n      id\n      status\n      lastSyncStatus\n      lastSyncAt\n    }\n  }\n": typeof types.CliSyncKbDocument,
    "\n  query CliAgentKBs($agentId: ID!) {\n    agent(id: $agentId) {\n      id\n      knowledgeBases {\n        knowledgeBaseId\n        enabled\n        searchConfig\n      }\n    }\n  }\n": typeof types.CliAgentKBsDocument,
    "\n  mutation CliSetAgentKBs(\n    $agentId: ID!\n    $knowledgeBases: [AgentKnowledgeBaseInput!]!\n  ) {\n    setAgentKnowledgeBases(agentId: $agentId, knowledgeBases: $knowledgeBases) {\n      id\n      knowledgeBaseId\n      enabled\n    }\n  }\n": typeof types.CliSetAgentKBsDocument,
    "\n  query CliKBTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n": typeof types.CliKbTenantBySlugDocument,
    "\n  query CliLabelList($tenantId: ID!) {\n    threadLabels(tenantId: $tenantId) {\n      id\n      name\n      color\n      description\n      createdAt\n    }\n  }\n": typeof types.CliLabelListDocument,
    "\n  mutation CliLabelCreate($input: CreateThreadLabelInput!) {\n    createThreadLabel(input: $input) {\n      id\n      name\n      color\n      description\n    }\n  }\n": typeof types.CliLabelCreateDocument,
    "\n  mutation CliLabelUpdate($id: ID!, $input: UpdateThreadLabelInput!) {\n    updateThreadLabel(id: $id, input: $input) {\n      id\n      name\n      color\n      description\n    }\n  }\n": typeof types.CliLabelUpdateDocument,
    "\n  mutation CliLabelDelete($id: ID!) {\n    deleteThreadLabel(id: $id)\n  }\n": typeof types.CliLabelDeleteDocument,
    "\n  query CliLabelTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n": typeof types.CliLabelTenantBySlugDocument,
    "\n  query CliMe {\n    me {\n      id\n      email\n      name\n      tenantId\n    }\n  }\n": typeof types.CliMeDocument,
    "\n  query CliTenantMembers($tenantId: ID!) {\n    tenantMembers(tenantId: $tenantId) {\n      id\n      tenantId\n      principalType\n      principalId\n      role\n      status\n      createdAt\n    }\n  }\n": typeof types.CliTenantMembersDocument,
    "\n  mutation CliInviteMember($tenantId: ID!, $input: InviteMemberInput!) {\n    inviteMember(tenantId: $tenantId, input: $input) {\n      id\n      principalId\n      role\n      status\n    }\n  }\n": typeof types.CliInviteMemberDocument,
    "\n  mutation CliUpdateTenantMember($id: ID!, $input: UpdateTenantMemberInput!) {\n    updateTenantMember(id: $id, input: $input) {\n      id\n      role\n      status\n    }\n  }\n": typeof types.CliUpdateTenantMemberDocument,
    "\n  mutation CliRemoveTenantMember($id: ID!) {\n    removeTenantMember(id: $id)\n  }\n": typeof types.CliRemoveTenantMemberDocument,
    "\n  query CliMemberTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n": typeof types.CliMemberTenantBySlugDocument,
    "\n  query CliMemoryRecords($tenantId: ID, $assistantId: ID, $namespace: String!) {\n    memoryRecords(tenantId: $tenantId, assistantId: $assistantId, namespace: $namespace) {\n      memoryRecordId\n      namespace\n      content {\n        text\n      }\n      strategy\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.CliMemoryRecordsDocument,
    "\n  query CliMemorySearch($tenantId: ID, $assistantId: ID, $query: String!, $strategy: MemoryStrategy, $limit: Int) {\n    memorySearch(tenantId: $tenantId, assistantId: $assistantId, query: $query, strategy: $strategy, limit: $limit) {\n      records {\n        memoryRecordId\n        namespace\n        content {\n          text\n        }\n        score\n      }\n    }\n  }\n": typeof types.CliMemorySearchDocument,
    "\n  query CliMemoryGraph($tenantId: ID, $assistantId: ID) {\n    memoryGraph(tenantId: $tenantId, assistantId: $assistantId) {\n      nodes { id label type }\n      edges { source target type }\n    }\n  }\n": typeof types.CliMemoryGraphDocument,
    "\n  mutation CliUpdateMemoryRecord($tenantId: ID, $assistantId: ID, $memoryRecordId: ID!, $content: String!) {\n    updateMemoryRecord(tenantId: $tenantId, assistantId: $assistantId, memoryRecordId: $memoryRecordId, content: $content)\n  }\n": typeof types.CliUpdateMemoryRecordDocument,
    "\n  mutation CliDeleteMemoryRecord($tenantId: ID, $assistantId: ID, $memoryRecordId: ID!) {\n    deleteMemoryRecord(tenantId: $tenantId, assistantId: $assistantId, memoryRecordId: $memoryRecordId)\n  }\n": typeof types.CliDeleteMemoryRecordDocument,
    "\n  query CliMemoryTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n": typeof types.CliMemoryTenantBySlugDocument,
    "\n  mutation CliMsgSendMessage($input: SendMessageInput!) {\n    sendMessage(input: $input) {\n      id\n      threadId\n      role\n      content\n      createdAt\n    }\n  }\n": typeof types.CliMsgSendMessageDocument,
    "\n  query CliMsgMessages($threadId: ID!, $limit: Int, $cursor: String) {\n    messages(threadId: $threadId, limit: $limit, cursor: $cursor) {\n      edges {\n        cursor\n        node {\n          id\n          role\n          senderType\n          senderId\n          content\n          tokenCount\n          createdAt\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n": typeof types.CliMsgMessagesDocument,
    "\n  query CliAgentPerformance($tenantId: ID!, $from: AWSDateTime, $to: AWSDateTime) {\n    agentPerformance(tenantId: $tenantId, from: $from, to: $to) {\n      agentId\n      agentName\n      invocationCount\n      errorCount\n      avgDurationMs\n      p95DurationMs\n      totalInputTokens\n      totalOutputTokens\n      totalCostUsd\n    }\n  }\n": typeof types.CliAgentPerformanceDocument,
    "\n  query CliSingleAgentPerformance($agentId: ID!, $tenantId: ID!) {\n    singleAgentPerformance(agentId: $agentId, tenantId: $tenantId) {\n      agentId\n      agentName\n      invocationCount\n      errorCount\n      avgDurationMs\n      p95DurationMs\n      totalInputTokens\n      totalOutputTokens\n      totalCostUsd\n    }\n  }\n": typeof types.CliSingleAgentPerformanceDocument,
    "\n  query CliRecipes($tenantId: ID!, $threadId: ID, $agentId: ID, $limit: Int, $cursor: String) {\n    recipes(tenantId: $tenantId, threadId: $threadId, agentId: $agentId, limit: $limit, cursor: $cursor) {\n      id\n      title\n      server\n      tool\n      genuiType\n      agentId\n      threadId\n      lastRefreshed\n      createdAt\n    }\n  }\n": typeof types.CliRecipesDocument,
    "\n  query CliRecipe($id: ID!) {\n    recipe(id: $id) {\n      id\n      title\n      summary\n      server\n      tool\n      params\n      genuiType\n      templates\n      cachedResult\n      lastRefreshed\n      lastError\n      agentId\n      threadId\n      sourceMessageId\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.CliRecipeDocument,
    "\n  mutation CliCreateRecipe($input: CreateRecipeInput!) {\n    createRecipe(input: $input) {\n      id\n      title\n      server\n      tool\n    }\n  }\n": typeof types.CliCreateRecipeDocument,
    "\n  mutation CliUpdateRecipe($id: ID!, $input: UpdateRecipeInput!) {\n    updateRecipe(id: $id, input: $input) {\n      id\n      title\n    }\n  }\n": typeof types.CliUpdateRecipeDocument,
    "\n  mutation CliDeleteRecipe($id: ID!) {\n    deleteRecipe(id: $id)\n  }\n": typeof types.CliDeleteRecipeDocument,
    "\n  query CliRecipeTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n": typeof types.CliRecipeTenantBySlugDocument,
    "\n  query CliRoutines($tenantId: ID!, $teamId: ID, $agentId: ID, $status: RoutineStatus) {\n    routines(tenantId: $tenantId, teamId: $teamId, agentId: $agentId, status: $status) {\n      id\n      name\n      type\n      status\n      engine\n      schedule\n      agentId\n      teamId\n      lastRunAt\n      nextRunAt\n    }\n  }\n": typeof types.CliRoutinesDocument,
    "\n  query CliRoutine($id: ID!) {\n    routine(id: $id) {\n      id\n      name\n      description\n      type\n      status\n      engine\n      schedule\n      agentId\n      teamId\n      visibility\n      owningAgentId\n      currentVersion\n      lastRunAt\n      nextRunAt\n      createdAt\n      updatedAt\n      triggers {\n        id\n        triggerType\n        enabled\n        config\n      }\n    }\n  }\n": typeof types.CliRoutineDocument,
    "\n  mutation CliCreateRoutine($input: CreateRoutineInput!) {\n    createRoutine(input: $input) {\n      id\n      name\n      type\n      status\n    }\n  }\n": typeof types.CliCreateRoutineDocument,
    "\n  mutation CliUpdateRoutine($id: ID!, $input: UpdateRoutineInput!) {\n    updateRoutine(id: $id, input: $input) {\n      id\n      name\n      status\n    }\n  }\n": typeof types.CliUpdateRoutineDocument,
    "\n  mutation CliDeleteRoutine($id: ID!) {\n    deleteRoutine(id: $id)\n  }\n": typeof types.CliDeleteRoutineDocument,
    "\n  mutation CliTriggerRoutineRun($routineId: ID!, $input: AWSJSON) {\n    triggerRoutineRun(routineId: $routineId, input: $input) {\n      id\n      status\n      startedAt\n    }\n  }\n": typeof types.CliTriggerRoutineRunDocument,
    "\n  query CliRoutineExecutions($routineId: ID!, $status: RoutineExecutionStatus, $limit: Int, $cursor: String) {\n    routineExecutions(routineId: $routineId, status: $status, limit: $limit, cursor: $cursor) {\n      id\n      status\n      startedAt\n      finishedAt\n      errorMessage\n    }\n  }\n": typeof types.CliRoutineExecutionsDocument,
    "\n  query CliRoutineExecution($id: ID!) {\n    routineExecution(id: $id) {\n      id\n      routineId\n      status\n      startedAt\n      finishedAt\n      errorMessage\n      inputJson\n      outputJson\n    }\n  }\n": typeof types.CliRoutineExecutionDocument,
    "\n  mutation CliSetRoutineTrigger($routineId: ID!, $input: RoutineTriggerInput!) {\n    setRoutineTrigger(routineId: $routineId, input: $input) {\n      id\n      triggerType\n      enabled\n    }\n  }\n": typeof types.CliSetRoutineTriggerDocument,
    "\n  mutation CliDeleteRoutineTrigger($id: ID!) {\n    deleteRoutineTrigger(id: $id)\n  }\n": typeof types.CliDeleteRoutineTriggerDocument,
    "\n  query CliRoutineTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n": typeof types.CliRoutineTenantBySlugDocument,
    "\n  query CliScheduledJobs(\n    $tenantId: ID!\n    $agentId: ID\n    $routineId: ID\n    $triggerType: String\n    $enabled: Boolean\n    $limit: Int\n  ) {\n    scheduledJobs(\n      tenantId: $tenantId\n      agentId: $agentId\n      routineId: $routineId\n      triggerType: $triggerType\n      enabled: $enabled\n      limit: $limit\n    ) {\n      id\n      name\n      description\n      triggerType\n      agentId\n      routineId\n      scheduleType\n      scheduleExpression\n      timezone\n      enabled\n      lastRunAt\n      nextRunAt\n      createdAt\n    }\n  }\n": typeof types.CliScheduledJobsDocument,
    "\n  query CliScheduledJob($id: ID!) {\n    scheduledJob(id: $id) {\n      id\n      name\n      description\n      triggerType\n      agentId\n      routineId\n      prompt\n      scheduleType\n      scheduleExpression\n      timezone\n      enabled\n      ebScheduleName\n      lastRunAt\n      nextRunAt\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.CliScheduledJobDocument,
    "\n  mutation CliCreateScheduledJob($input: CreateScheduledJobInput!) {\n    createScheduledJob(input: $input) {\n      id\n      name\n      enabled\n      scheduleExpression\n      timezone\n    }\n  }\n": typeof types.CliCreateScheduledJobDocument,
    "\n  mutation CliDeleteScheduledJob($id: ID!) {\n    deleteScheduledJob(id: $id) {\n      id\n      ok\n    }\n  }\n": typeof types.CliDeleteScheduledJobDocument,
    "\n  mutation CliRunScheduledJob($id: ID!) {\n    runScheduledJob(id: $id) {\n      id\n      dispatched\n      statusCode\n      errorMessage\n    }\n  }\n": typeof types.CliRunScheduledJobDocument,
    "\n  mutation CliUpdateScheduledJob($id: ID!, $input: UpdateScheduledJobInput!) {\n    updateScheduledJob(id: $id, input: $input) {\n      id\n      name\n      enabled\n      scheduleType\n      scheduleExpression\n      timezone\n      nextRunAt\n      updatedAt\n    }\n  }\n": typeof types.CliUpdateScheduledJobDocument,
    "\n  query CliSchedJobTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n": typeof types.CliSchedJobTenantBySlugDocument,
    "\n  query CliSkillCatalog {\n    skillCatalog {\n      id\n      skillId\n      displayName\n      description\n      category\n      icon\n      source\n      enabled\n    }\n  }\n": typeof types.CliSkillCatalogDocument,
    "\n  query CliSkillTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n": typeof types.CliSkillTenantBySlugDocument,
    "\n  mutation CliInstallSkill($input: InstallSkillInput!) {\n    installSkill(input: $input) {\n      id\n      tenantId\n      skillId\n      source\n      version\n      catalogVersion\n      enabled\n      installedAt\n      updatedAt\n    }\n  }\n": typeof types.CliInstallSkillDocument,
    "\n  mutation CliUninstallSkill($tenantId: ID!, $skillId: String!) {\n    uninstallSkill(tenantId: $tenantId, skillId: $skillId)\n  }\n": typeof types.CliUninstallSkillDocument,
    "\n  query CliTeams($tenantId: ID!) {\n    teams(tenantId: $tenantId) {\n      id\n      name\n      slug\n      type\n      status\n      budgetMonthlyCents\n      createdAt\n    }\n  }\n": typeof types.CliTeamsDocument,
    "\n  query CliTeam($id: ID!) {\n    team(id: $id) {\n      id\n      name\n      slug\n      description\n      type\n      status\n      budgetMonthlyCents\n      createdAt\n      updatedAt\n      agents {\n        id\n        agentId\n        role\n        joinedAt\n      }\n      users {\n        id\n        userId\n        role\n        joinedAt\n      }\n    }\n  }\n": typeof types.CliTeamDocument,
    "\n  mutation CliCreateTeam($input: CreateTeamInput!) {\n    createTeam(input: $input) {\n      id\n      name\n      type\n      status\n    }\n  }\n": typeof types.CliCreateTeamDocument,
    "\n  mutation CliUpdateTeam($id: ID!, $input: UpdateTeamInput!) {\n    updateTeam(id: $id, input: $input) {\n      id\n      name\n      type\n      status\n      budgetMonthlyCents\n    }\n  }\n": typeof types.CliUpdateTeamDocument,
    "\n  mutation CliDeleteTeam($id: ID!) {\n    deleteTeam(id: $id)\n  }\n": typeof types.CliDeleteTeamDocument,
    "\n  mutation CliAddTeamAgent($teamId: ID!, $input: AddTeamAgentInput!) {\n    addTeamAgent(teamId: $teamId, input: $input) {\n      id\n      agentId\n      role\n    }\n  }\n": typeof types.CliAddTeamAgentDocument,
    "\n  mutation CliRemoveTeamAgent($teamId: ID!, $agentId: ID!) {\n    removeTeamAgent(teamId: $teamId, agentId: $agentId)\n  }\n": typeof types.CliRemoveTeamAgentDocument,
    "\n  mutation CliAddTeamUser($teamId: ID!, $input: AddTeamUserInput!) {\n    addTeamUser(teamId: $teamId, input: $input) {\n      id\n      userId\n      role\n    }\n  }\n": typeof types.CliAddTeamUserDocument,
    "\n  mutation CliRemoveTeamUser($teamId: ID!, $userId: ID!) {\n    removeTeamUser(teamId: $teamId, userId: $userId)\n  }\n": typeof types.CliRemoveTeamUserDocument,
    "\n  query CliTeamTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n    }\n  }\n": typeof types.CliTeamTenantBySlugDocument,
    "\n  mutation CliCreateTenant($input: CreateTenantInput!) {\n    createTenant(input: $input) {\n      id\n      name\n      slug\n      plan\n      issuePrefix\n    }\n  }\n": typeof types.CliCreateTenantDocument,
    "\n  mutation CliUpdateTenant($id: ID!, $input: UpdateTenantInput!) {\n    updateTenant(id: $id, input: $input) {\n      id\n      name\n      slug\n      plan\n      issuePrefix\n    }\n  }\n": typeof types.CliUpdateTenantDocument,
    "\n  query CliTenantSettings($id: ID!) {\n    tenant(id: $id) {\n      id\n      name\n      slug\n      settings {\n        id\n        defaultModel\n        budgetMonthlyCents\n        autoCloseThreadMinutes\n        maxAgents\n        features\n      }\n    }\n  }\n": typeof types.CliTenantSettingsDocument,
    "\n  mutation CliUpdateTenantSettings(\n    $tenantId: ID!\n    $input: UpdateTenantSettingsInput!\n  ) {\n    updateTenantSettings(tenantId: $tenantId, input: $input) {\n      id\n      defaultModel\n      budgetMonthlyCents\n      autoCloseThreadMinutes\n      maxAgents\n      features\n    }\n  }\n": typeof types.CliUpdateTenantSettingsDocument,
    "\n  query CliTenantBySlugForCmd($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n    }\n  }\n": typeof types.CliTenantBySlugForCmdDocument,
    "\n  query CliThreads(\n    $tenantId: ID!\n    $status: ThreadStatus\n    $channel: ThreadChannel\n    $agentId: ID\n    $assigneeId: ID\n    $search: String\n    $limit: Int\n  ) {\n    threads(\n      tenantId: $tenantId\n      status: $status\n      channel: $channel\n      agentId: $agentId\n      assigneeId: $assigneeId\n      search: $search\n      limit: $limit\n    ) {\n      id\n      number\n      title\n      status\n      channel\n      assigneeType\n      assigneeId\n      agentId\n      lastActivityAt\n      archivedAt\n      createdAt\n    }\n  }\n": typeof types.CliThreadsDocument,
    "\n  query CliThreadById($id: ID!) {\n    thread(id: $id) {\n      id\n      number\n      identifier\n      title\n      status\n      channel\n      assigneeType\n      assigneeId\n      agentId\n      reporterId\n      billingCode\n      labels\n      dueAt\n      startedAt\n      completedAt\n      archivedAt\n      lastActivityAt\n      lastResponsePreview\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.CliThreadByIdDocument,
    "\n  query CliThreadByNumber($tenantId: ID!, $number: Int!) {\n    threadByNumber(tenantId: $tenantId, number: $number) {\n      id\n      number\n      identifier\n      title\n      status\n      channel\n      assigneeType\n      assigneeId\n      agentId\n      reporterId\n      billingCode\n      labels\n      dueAt\n      startedAt\n      completedAt\n      archivedAt\n      lastActivityAt\n      lastResponsePreview\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.CliThreadByNumberDocument,
    "\n  query CliThreadLabelsForResolve($tenantId: ID!) {\n    threadLabels(tenantId: $tenantId) {\n      id\n      name\n      color\n    }\n  }\n": typeof types.CliThreadLabelsForResolveDocument,
    "\n  mutation CliCreateThread($input: CreateThreadInput!) {\n    createThread(input: $input) {\n      id\n      number\n      title\n      status\n    }\n  }\n": typeof types.CliCreateThreadDocument,
    "\n  mutation CliUpdateThread($id: ID!, $input: UpdateThreadInput!) {\n    updateThread(id: $id, input: $input) {\n      id\n      number\n      title\n      status\n      assigneeType\n      assigneeId\n      dueAt\n      archivedAt\n    }\n  }\n": typeof types.CliUpdateThreadDocument,
    "\n  mutation CliDeleteThread($id: ID!) {\n    deleteThread(id: $id)\n  }\n": typeof types.CliDeleteThreadDocument,
    "\n  mutation CliCheckoutThread($id: ID!, $input: CheckoutThreadInput!) {\n    checkoutThread(id: $id, input: $input) {\n      id\n      status\n      checkoutRunId\n      checkoutVersion\n    }\n  }\n": typeof types.CliCheckoutThreadDocument,
    "\n  mutation CliReleaseThread($id: ID!, $input: ReleaseThreadInput!) {\n    releaseThread(id: $id, input: $input) {\n      id\n      status\n      checkoutRunId\n    }\n  }\n": typeof types.CliReleaseThreadDocument,
    "\n  mutation CliAssignThreadLabel($threadId: ID!, $labelId: ID!) {\n    assignThreadLabel(threadId: $threadId, labelId: $labelId) {\n      id\n      threadId\n      labelId\n      createdAt\n    }\n  }\n": typeof types.CliAssignThreadLabelDocument,
    "\n  mutation CliRemoveThreadLabel($threadId: ID!, $labelId: ID!) {\n    removeThreadLabel(threadId: $threadId, labelId: $labelId)\n  }\n": typeof types.CliRemoveThreadLabelDocument,
    "\n  mutation CliEscalateThread($input: EscalateThreadInput!) {\n    escalateThread(input: $input) {\n      id\n      status\n      assigneeType\n      assigneeId\n    }\n  }\n": typeof types.CliEscalateThreadDocument,
    "\n  mutation CliDelegateThread($input: DelegateThreadInput!) {\n    delegateThread(input: $input) {\n      id\n      status\n      assigneeType\n      assigneeId\n    }\n  }\n": typeof types.CliDelegateThreadDocument,
    "\n  mutation CliSendMessage($input: SendMessageInput!) {\n    sendMessage(input: $input) {\n      id\n      threadId\n      role\n      content\n      createdAt\n    }\n  }\n": typeof types.CliSendMessageDocument,
    "\n  query CliThreadTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n": typeof types.CliThreadTenantBySlugDocument,
    "\n  query CliThreadTraces($threadId: ID!, $tenantId: ID!) {\n    threadTraces(threadId: $threadId, tenantId: $tenantId) {\n      traceId\n      threadId\n      agentId\n      agentName\n      model\n      inputTokens\n      outputTokens\n      durationMs\n      costUsd\n      estimated\n    }\n  }\n": typeof types.CliThreadTracesDocument,
    "\n  query CliTurnInvocationLogs($tenantId: ID!, $turnId: ID!) {\n    turnInvocationLogs(tenantId: $tenantId, turnId: $turnId) {\n      requestId\n      modelId\n      timestamp\n      inputTokenCount\n      outputTokenCount\n      cacheReadTokenCount\n      toolCount\n      costUsd\n    }\n  }\n": typeof types.CliTurnInvocationLogsDocument,
    "\n  query CliThreadTurns(\n    $tenantId: ID!\n    $agentId: ID\n    $routineId: ID\n    $triggerId: ID\n    $threadId: ID\n    $status: String\n    $limit: Int\n  ) {\n    threadTurns(\n      tenantId: $tenantId\n      agentId: $agentId\n      routineId: $routineId\n      triggerId: $triggerId\n      threadId: $threadId\n      status: $status\n      limit: $limit\n    ) {\n      id\n      agentId\n      routineId\n      threadId\n      status\n      invocationSource\n      triggerName\n      startedAt\n      finishedAt\n      totalCost\n      error\n    }\n  }\n": typeof types.CliThreadTurnsDocument,
    "\n  query CliThreadTurn($id: ID!) {\n    threadTurn(id: $id) {\n      id\n      tenantId\n      agentId\n      routineId\n      threadId\n      turnNumber\n      status\n      invocationSource\n      triggerName\n      triggerDetail\n      startedAt\n      finishedAt\n      error\n      errorCode\n      totalCost\n      lastActivityAt\n      retryAttempt\n      externalRunId\n      sessionIdBefore\n      sessionIdAfter\n      createdAt\n    }\n  }\n": typeof types.CliThreadTurnDocument,
    "\n  query CliThreadTurnEvents($runId: ID!, $limit: Int) {\n    threadTurnEvents(runId: $runId, limit: $limit) {\n      seq\n      eventType\n      stream\n      level\n      message\n      createdAt\n    }\n  }\n": typeof types.CliThreadTurnEventsDocument,
    "\n  mutation CliCancelThreadTurn($id: ID!) {\n    cancelThreadTurn(id: $id) {\n      id\n      status\n      finishedAt\n    }\n  }\n": typeof types.CliCancelThreadTurnDocument,
    "\n  query CliTurnTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n": typeof types.CliTurnTenantBySlugDocument,
    "\n  query CliQueuedWakeups($tenantId: ID!) {\n    queuedWakeups(tenantId: $tenantId) {\n      id\n      agentId\n      status\n      source\n      triggerDetail\n      reason\n      coalescedCount\n      requestedAt\n      claimedAt\n    }\n  }\n": typeof types.CliQueuedWakeupsDocument,
    "\n  mutation CliCreateWakeup($input: CreateWakeupRequestInput!) {\n    createWakeupRequest(input: $input) {\n      id\n      agentId\n      status\n      requestedAt\n    }\n  }\n": typeof types.CliCreateWakeupDocument,
    "\n  query CliWakeupTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n": typeof types.CliWakeupTenantBySlugDocument,
    "\n  query CliWebhooks($tenantId: ID!, $targetType: String, $enabled: Boolean, $limit: Int) {\n    webhooks(tenantId: $tenantId, targetType: $targetType, enabled: $enabled, limit: $limit) {\n      id\n      name\n      targetType\n      agentId\n      routineId\n      enabled\n      rateLimit\n      invocationCount\n      lastInvokedAt\n      createdAt\n    }\n  }\n": typeof types.CliWebhooksDocument,
    "\n  query CliWebhook($id: ID!) {\n    webhook(id: $id) {\n      id\n      name\n      description\n      token\n      targetType\n      agentId\n      routineId\n      prompt\n      enabled\n      rateLimit\n      invocationCount\n      lastInvokedAt\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.CliWebhookDocument,
    "\n  mutation CliCreateWebhook($input: CreateWebhookInput!) {\n    createWebhook(input: $input) {\n      id\n      name\n      token\n      targetType\n      enabled\n    }\n  }\n": typeof types.CliCreateWebhookDocument,
    "\n  mutation CliUpdateWebhook($id: ID!, $input: UpdateWebhookInput!) {\n    updateWebhook(id: $id, input: $input) {\n      id\n      name\n      targetType\n      enabled\n      rateLimit\n    }\n  }\n": typeof types.CliUpdateWebhookDocument,
    "\n  mutation CliDeleteWebhook($id: ID!) {\n    deleteWebhook(id: $id)\n  }\n": typeof types.CliDeleteWebhookDocument,
    "\n  mutation CliRegenerateWebhookToken($id: ID!) {\n    regenerateWebhookToken(id: $id) {\n      id\n      token\n    }\n  }\n": typeof types.CliRegenerateWebhookTokenDocument,
    "\n  query CliWebhookDeliveries($webhookId: ID!, $limit: Int) {\n    webhookDeliveries(webhookId: $webhookId, limit: $limit) {\n      id\n      providerName\n      providerEventId\n      normalizedKind\n      receivedAt\n      signatureStatus\n      resolutionStatus\n      statusCode\n      durationMs\n      threadId\n      threadCreated\n      retryCount\n      isReplay\n      errorMessage\n    }\n  }\n": typeof types.CliWebhookDeliveriesDocument,
    "\n  mutation CliTestWebhook($id: ID!) {\n    testWebhook(id: $id) {\n      id\n      webhookId\n      tenantId\n      receivedAt\n      resolutionStatus\n      signatureStatus\n      statusCode\n      bodyPreview\n    }\n  }\n": typeof types.CliTestWebhookDocument,
    "\n  query CliWebhookForTest($id: ID!) {\n    webhook(id: $id) {\n      id\n      token\n    }\n  }\n": typeof types.CliWebhookForTestDocument,
    "\n  query CliWebhookTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n": typeof types.CliWebhookTenantBySlugDocument,
    "\n  query CliWikiTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n": typeof types.CliWikiTenantBySlugDocument,
    "\n  query CliAllTenantAgentsForWiki($tenantId: ID!) {\n    allTenantAgents(tenantId: $tenantId, includeSystem: false, includeSubAgents: false) {\n      id\n      name\n      slug\n      type\n      status\n    }\n  }\n": typeof types.CliAllTenantAgentsForWikiDocument,
    "\n  mutation CliCompileWikiNow($tenantId: ID!, $ownerId: ID!, $modelId: String, $forceNew: Boolean) {\n    compileWikiNow(\n      tenantId: $tenantId\n      ownerId: $ownerId\n      modelId: $modelId\n      forceNew: $forceNew\n    ) {\n      id\n      tenantId\n      ownerId\n      status\n      trigger\n      dedupeKey\n      attempt\n      createdAt\n    }\n  }\n": typeof types.CliCompileWikiNowDocument,
    "\n  mutation CliResetWikiCursor(\n    $tenantId: ID!\n    $ownerId: ID!\n    $force: Boolean\n    $dryRun: Boolean\n    $includeBrain: Boolean\n  ) {\n    resetWikiCursor(\n      tenantId: $tenantId\n      ownerId: $ownerId\n      force: $force\n      dryRun: $dryRun\n      includeBrain: $includeBrain\n    ) {\n      tenantId\n      ownerId\n      cursorCleared\n      pagesArchived\n      dryRun\n      brainIncluded\n      impact\n    }\n  }\n": typeof types.CliResetWikiCursorDocument,
    "\n  query CliWikiCompileJobs($tenantId: ID!, $ownerId: ID, $limit: Int) {\n    wikiCompileJobs(tenantId: $tenantId, ownerId: $ownerId, limit: $limit) {\n      id\n      tenantId\n      ownerId\n      status\n      trigger\n      dedupeKey\n      attempt\n      claimedAt\n      startedAt\n      finishedAt\n      error\n      metrics\n      createdAt\n    }\n  }\n": typeof types.CliWikiCompileJobsDocument,
    "\n  query CliCmdTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n": typeof types.CliCmdTenantBySlugDocument,
};
const documents: Documents = {
    "\n  query CliAgents(\n    $tenantId: ID!\n    $status: AgentStatus\n    $type: AgentType\n    $includeSystem: Boolean\n  ) {\n    agents(\n      tenantId: $tenantId\n      status: $status\n      type: $type\n      includeSystem: $includeSystem\n    ) {\n      id\n      name\n      slug\n      role\n      type\n      status\n      runtime\n      lastHeartbeatAt\n    }\n  }\n": types.CliAgentsDocument,
    "\n  query CliAllTenantAgents(\n    $tenantId: ID!\n    $includeSystem: Boolean\n    $includeSubAgents: Boolean\n  ) {\n    allTenantAgents(\n      tenantId: $tenantId\n      includeSystem: $includeSystem\n      includeSubAgents: $includeSubAgents\n    ) {\n      id\n      name\n      slug\n      role\n      type\n      status\n      runtime\n      lastHeartbeatAt\n    }\n  }\n": types.CliAllTenantAgentsDocument,
    "\n  query CliAgent($id: ID!) {\n    agent(id: $id) {\n      id\n      name\n      slug\n      role\n      type\n      source\n      status\n      systemPrompt\n      runtime\n      adapterType\n      version\n      humanPairId\n      parentAgentId\n      reportsToId\n      lastHeartbeatAt\n      createdAt\n      updatedAt\n      capabilities {\n        capability\n        enabled\n        config\n      }\n      skills {\n        skillId\n        enabled\n        rateLimitRpm\n      }\n      budgetPolicy {\n        period\n        limitUsd\n        actionOnExceed\n      }\n    }\n  }\n": types.CliAgentDocument,
    "\n  mutation CliCreateAgent($input: CreateAgentInput!) {\n    createAgent(input: $input) {\n      id\n      name\n      type\n      status\n    }\n  }\n": types.CliCreateAgentDocument,
    "\n  mutation CliUpdateAgent($id: ID!, $input: UpdateAgentInput!) {\n    updateAgent(id: $id, input: $input) {\n      id\n      name\n      role\n      type\n      status\n    }\n  }\n": types.CliUpdateAgentDocument,
    "\n  mutation CliDeleteAgent($id: ID!) {\n    deleteAgent(id: $id)\n  }\n": types.CliDeleteAgentDocument,
    "\n  mutation CliUpdateAgentStatus($id: ID!, $status: AgentStatus!) {\n    updateAgentStatus(id: $id, status: $status) {\n      id\n      status\n    }\n  }\n": types.CliUpdateAgentStatusDocument,
    "\n  mutation CliSetAgentCapabilities(\n    $agentId: ID!\n    $capabilities: [AgentCapabilityInput!]!\n  ) {\n    setAgentCapabilities(agentId: $agentId, capabilities: $capabilities) {\n      capability\n      enabled\n    }\n  }\n": types.CliSetAgentCapabilitiesDocument,
    "\n  mutation CliSetAgentSkills($agentId: ID!, $skills: [AgentSkillInput!]!) {\n    setAgentSkills(agentId: $agentId, skills: $skills) {\n      skillId\n      enabled\n      rateLimitRpm\n    }\n  }\n": types.CliSetAgentSkillsDocument,
    "\n  mutation CliSetAgentBudgetPolicy(\n    $agentId: ID!\n    $input: AgentBudgetPolicyInput!\n  ) {\n    setAgentBudgetPolicy(agentId: $agentId, input: $input) {\n      period\n      limitUsd\n      actionOnExceed\n    }\n  }\n": types.CliSetAgentBudgetPolicyDocument,
    "\n  mutation CliDeleteAgentBudgetPolicy($agentId: ID!) {\n    deleteAgentBudgetPolicy(agentId: $agentId)\n  }\n": types.CliDeleteAgentBudgetPolicyDocument,
    "\n  query CliAgentApiKeys($agentId: ID!) {\n    agentApiKeys(agentId: $agentId) {\n      id\n      name\n      keyPrefix\n      lastUsedAt\n      revokedAt\n      createdAt\n    }\n  }\n": types.CliAgentApiKeysDocument,
    "\n  mutation CliCreateAgentApiKey($input: CreateAgentApiKeyInput!) {\n    createAgentApiKey(input: $input) {\n      apiKey {\n        id\n        name\n        keyPrefix\n        createdAt\n      }\n      plainTextKey\n    }\n  }\n": types.CliCreateAgentApiKeyDocument,
    "\n  mutation CliRevokeAgentApiKey($id: ID!) {\n    revokeAgentApiKey(id: $id) {\n      id\n      revokedAt\n    }\n  }\n": types.CliRevokeAgentApiKeyDocument,
    "\n  mutation CliToggleAgentEmail($agentId: ID!, $enabled: Boolean!) {\n    toggleAgentEmailChannel(agentId: $agentId, enabled: $enabled) {\n      capability\n      enabled\n    }\n  }\n": types.CliToggleAgentEmailDocument,
    "\n  mutation CliClaimVanityEmail($agentId: ID!, $localPart: String!) {\n    claimVanityEmailAddress(agentId: $agentId, localPart: $localPart) {\n      capability\n      enabled\n      config\n    }\n  }\n": types.CliClaimVanityEmailDocument,
    "\n  mutation CliReleaseVanityEmail($agentId: ID!) {\n    releaseVanityEmailAddress(agentId: $agentId) {\n      capability\n      enabled\n    }\n  }\n": types.CliReleaseVanityEmailDocument,
    "\n  mutation CliUpdateAgentEmailAllowlist(\n    $agentId: ID!\n    $allowedSenders: [String!]!\n  ) {\n    updateAgentEmailAllowlist(\n      agentId: $agentId\n      allowedSenders: $allowedSenders\n    ) {\n      capability\n      config\n    }\n  }\n": types.CliUpdateAgentEmailAllowlistDocument,
    "\n  query CliAgentTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n": types.CliAgentTenantBySlugDocument,
    "\n  query CliArtifacts(\n    $tenantId: ID!\n    $threadId: ID\n    $agentId: ID\n    $type: ArtifactType\n    $status: ArtifactStatus\n    $limit: Int\n    $cursor: String\n  ) {\n    artifacts(\n      tenantId: $tenantId\n      threadId: $threadId\n      agentId: $agentId\n      type: $type\n      status: $status\n      limit: $limit\n      cursor: $cursor\n    ) {\n      id\n      title\n      type\n      status\n      agentId\n      threadId\n      createdAt\n      updatedAt\n    }\n  }\n": types.CliArtifactsDocument,
    "\n  query CliArtifact($id: ID!) {\n    artifact(id: $id) {\n      id\n      tenantId\n      agentId\n      threadId\n      title\n      type\n      status\n      summary\n      content\n      s3Key\n      sourceMessageId\n      favoritedAt\n      createdAt\n      updatedAt\n    }\n  }\n": types.CliArtifactDocument,
    "\n  query CliArtifactTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n": types.CliArtifactTenantBySlugDocument,
    "\n  query CliBudgetPolicies($tenantId: ID!) {\n    budgetPolicies(tenantId: $tenantId) {\n      id\n      scope\n      agentId\n      period\n      limitUsd\n      actionOnExceed\n      enabled\n    }\n  }\n": types.CliBudgetPoliciesDocument,
    "\n  query CliBudgetStatus($tenantId: ID!) {\n    budgetStatus(tenantId: $tenantId) {\n      policy {\n        id\n        scope\n        agentId\n        period\n        limitUsd\n      }\n      spentUsd\n      remainingUsd\n      percentUsed\n      status\n    }\n  }\n": types.CliBudgetStatusDocument,
    "\n  mutation CliUpsertBudgetPolicy($tenantId: ID!, $input: UpsertBudgetPolicyInput!) {\n    upsertBudgetPolicy(tenantId: $tenantId, input: $input) {\n      id\n      scope\n      agentId\n      limitUsd\n      period\n      actionOnExceed\n    }\n  }\n": types.CliUpsertBudgetPolicyDocument,
    "\n  mutation CliDeleteBudgetPolicy($id: ID!) {\n    deleteBudgetPolicy(id: $id)\n  }\n": types.CliDeleteBudgetPolicyDocument,
    "\n  query CliCostSummary($tenantId: ID!, $from: AWSDateTime, $to: AWSDateTime) {\n    costSummary(tenantId: $tenantId, from: $from, to: $to) {\n      totalUsd\n      llmUsd\n      computeUsd\n      toolsUsd\n      evalUsd\n      totalInputTokens\n      totalOutputTokens\n      eventCount\n    }\n  }\n": types.CliCostSummaryDocument,
    "\n  query CliCostByAgent($tenantId: ID!, $from: AWSDateTime, $to: AWSDateTime) {\n    costByAgent(tenantId: $tenantId, from: $from, to: $to) {\n      agentId\n      agentName\n      totalUsd\n      eventCount\n    }\n  }\n": types.CliCostByAgentDocument,
    "\n  query CliCostByModel($tenantId: ID!, $from: AWSDateTime, $to: AWSDateTime) {\n    costByModel(tenantId: $tenantId, from: $from, to: $to) {\n      model\n      totalUsd\n      inputTokens\n      outputTokens\n    }\n  }\n": types.CliCostByModelDocument,
    "\n  query CliCostSeries($tenantId: ID!, $days: Int) {\n    costTimeSeries(tenantId: $tenantId, days: $days) {\n      day\n      totalUsd\n      llmUsd\n      computeUsd\n      toolsUsd\n      eventCount\n    }\n  }\n": types.CliCostSeriesDocument,
    "\n  query CliDashboard($tenantId: ID!) {\n    agents(tenantId: $tenantId) {\n      id\n      status\n    }\n    threads(tenantId: $tenantId, limit: 200) {\n      id\n      status\n      archivedAt\n    }\n    inboxItems(tenantId: $tenantId, status: PENDING) {\n      id\n    }\n    costSummary(tenantId: $tenantId) {\n      totalUsd\n      llmUsd\n      computeUsd\n      eventCount\n    }\n  }\n": types.CliDashboardDocument,
    "\n  query CliEvalRuns($tenantId: ID!, $agentId: ID, $limit: Int, $offset: Int) {\n    evalRuns(\n      tenantId: $tenantId\n      agentId: $agentId\n      limit: $limit\n      offset: $offset\n    ) {\n      totalCount\n      items {\n        id\n        status\n        model\n        categories\n        agentId\n        agentName\n        agentTemplateId\n        totalTests\n        passed\n        failed\n        passRate\n        regression\n        costUsd\n        errorMessage\n        startedAt\n        completedAt\n        createdAt\n      }\n    }\n  }\n": types.CliEvalRunsDocument,
    "\n  query CliEvalRun($id: ID!) {\n    evalRun(id: $id) {\n      id\n      status\n      model\n      categories\n      agentId\n      agentName\n      agentTemplateId\n      totalTests\n      passed\n      failed\n      passRate\n      regression\n      costUsd\n      errorMessage\n      startedAt\n      completedAt\n      createdAt\n    }\n  }\n": types.CliEvalRunDocument,
    "\n  query CliEvalRunResults($runId: ID!) {\n    evalRunResults(runId: $runId) {\n      id\n      testCaseId\n      testCaseName\n      category\n      status\n      score\n      durationMs\n      agentSessionId\n      input\n      expected\n      actualOutput\n      evaluatorResults\n      assertions\n      errorMessage\n      createdAt\n    }\n  }\n": types.CliEvalRunResultsDocument,
    "\n  query CliEvalTestCases($tenantId: ID!, $category: String, $search: String) {\n    evalTestCases(tenantId: $tenantId, category: $category, search: $search) {\n      id\n      name\n      category\n      query\n      systemPrompt\n      agentTemplateId\n      agentcoreEvaluatorIds\n      tags\n      enabled\n      source\n      createdAt\n      updatedAt\n    }\n  }\n": types.CliEvalTestCasesDocument,
    "\n  query CliEvalTestCase($id: ID!) {\n    evalTestCase(id: $id) {\n      id\n      tenantId\n      name\n      category\n      query\n      systemPrompt\n      agentTemplateId\n      assertions\n      agentcoreEvaluatorIds\n      tags\n      enabled\n      source\n      createdAt\n      updatedAt\n    }\n  }\n": types.CliEvalTestCaseDocument,
    "\n  query CliComputersForEval($tenantId: ID!) {\n    computers(tenantId: $tenantId) {\n      id\n      name\n      slug\n      runtimeStatus\n    }\n  }\n": types.CliComputersForEvalDocument,
    "\n  query CliTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n": types.CliTenantBySlugDocument,
    "\n  mutation CliStartEvalRun($tenantId: ID!, $input: StartEvalRunInput!) {\n    startEvalRun(tenantId: $tenantId, input: $input) {\n      id\n      status\n      model\n      categories\n      agentTemplateId\n      totalTests\n      createdAt\n    }\n  }\n": types.CliStartEvalRunDocument,
    "\n  mutation CliCancelEvalRun($id: ID!) {\n    cancelEvalRun(id: $id) {\n      id\n      status\n      completedAt\n    }\n  }\n": types.CliCancelEvalRunDocument,
    "\n  mutation CliDeleteEvalRun($id: ID!) {\n    deleteEvalRun(id: $id)\n  }\n": types.CliDeleteEvalRunDocument,
    "\n  mutation CliCreateEvalTestCase(\n    $tenantId: ID!\n    $input: CreateEvalTestCaseInput!\n  ) {\n    createEvalTestCase(tenantId: $tenantId, input: $input) {\n      id\n      name\n      category\n    }\n  }\n": types.CliCreateEvalTestCaseDocument,
    "\n  mutation CliUpdateEvalTestCase($id: ID!, $input: UpdateEvalTestCaseInput!) {\n    updateEvalTestCase(id: $id, input: $input) {\n      id\n      name\n      category\n      enabled\n    }\n  }\n": types.CliUpdateEvalTestCaseDocument,
    "\n  mutation CliDeleteEvalTestCase($id: ID!) {\n    deleteEvalTestCase(id: $id)\n  }\n": types.CliDeleteEvalTestCaseDocument,
    "\n  mutation CliSeedEvalTestCases($tenantId: ID!, $categories: [String!]) {\n    seedEvalTestCases(tenantId: $tenantId, categories: $categories)\n  }\n": types.CliSeedEvalTestCasesDocument,
    "\n  query CliInboxItems(\n    $tenantId: ID!\n    $status: InboxItemStatus\n    $entityType: String\n    $entityId: ID\n    $recipientId: ID\n  ) {\n    inboxItems(\n      tenantId: $tenantId\n      status: $status\n      entityType: $entityType\n      entityId: $entityId\n      recipientId: $recipientId\n    ) {\n      id\n      type\n      status\n      title\n      description\n      requesterType\n      requesterId\n      recipientId\n      entityType\n      entityId\n      revision\n      reviewNotes\n      decidedBy\n      decidedAt\n      expiresAt\n      createdAt\n      updatedAt\n    }\n  }\n": types.CliInboxItemsDocument,
    "\n  query CliInboxItem($id: ID!) {\n    inboxItem(id: $id) {\n      id\n      type\n      status\n      title\n      description\n      requesterType\n      requesterId\n      recipientId\n      entityType\n      entityId\n      config\n      revision\n      reviewNotes\n      decidedBy\n      decidedAt\n      expiresAt\n      createdAt\n      updatedAt\n      comments {\n        id\n        authorType\n        authorId\n        content\n        createdAt\n      }\n      links {\n        id\n        linkedType\n        linkedId\n        createdAt\n      }\n      linkedThreads {\n        id\n        number\n        identifier\n        title\n        status\n      }\n    }\n  }\n": types.CliInboxItemDocument,
    "\n  mutation CliInboxApprove($id: ID!, $input: ApproveInboxItemInput) {\n    approveInboxItem(id: $id, input: $input) {\n      id\n      status\n      reviewNotes\n      decidedAt\n    }\n  }\n": types.CliInboxApproveDocument,
    "\n  mutation CliInboxReject($id: ID!, $input: RejectInboxItemInput) {\n    rejectInboxItem(id: $id, input: $input) {\n      id\n      status\n      reviewNotes\n      decidedAt\n    }\n  }\n": types.CliInboxRejectDocument,
    "\n  mutation CliInboxRequestRevision($id: ID!, $input: RequestRevisionInput!) {\n    requestRevision(id: $id, input: $input) {\n      id\n      status\n      reviewNotes\n      revision\n    }\n  }\n": types.CliInboxRequestRevisionDocument,
    "\n  mutation CliInboxResubmit($id: ID!, $input: ResubmitInboxItemInput) {\n    resubmitInboxItem(id: $id, input: $input) {\n      id\n      status\n      revision\n    }\n  }\n": types.CliInboxResubmitDocument,
    "\n  mutation CliInboxCancel($id: ID!) {\n    cancelInboxItem(id: $id) {\n      id\n      status\n    }\n  }\n": types.CliInboxCancelDocument,
    "\n  mutation CliInboxAddComment($input: AddInboxItemCommentInput!) {\n    addInboxItemComment(input: $input) {\n      id\n      inboxItemId\n      authorType\n      authorId\n      content\n      createdAt\n    }\n  }\n": types.CliInboxAddCommentDocument,
    "\n  query CliInboxTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n": types.CliInboxTenantBySlugDocument,
    "\n  query CliKnowledgeBases($tenantId: ID!) {\n    knowledgeBases(tenantId: $tenantId) {\n      id\n      name\n      slug\n      embeddingModel\n      status\n      documentCount\n      lastSyncAt\n      lastSyncStatus\n    }\n  }\n": types.CliKnowledgeBasesDocument,
    "\n  query CliKnowledgeBase($id: ID!) {\n    knowledgeBase(id: $id) {\n      id\n      name\n      slug\n      description\n      embeddingModel\n      chunkingStrategy\n      chunkSizeTokens\n      chunkOverlapPercent\n      status\n      awsKbId\n      documentCount\n      lastSyncAt\n      lastSyncStatus\n      errorMessage\n      createdAt\n      updatedAt\n    }\n  }\n": types.CliKnowledgeBaseDocument,
    "\n  mutation CliCreateKB($input: CreateKnowledgeBaseInput!) {\n    createKnowledgeBase(input: $input) {\n      id\n      name\n      slug\n      status\n    }\n  }\n": types.CliCreateKbDocument,
    "\n  mutation CliUpdateKB($id: ID!, $input: UpdateKnowledgeBaseInput!) {\n    updateKnowledgeBase(id: $id, input: $input) {\n      id\n      name\n      description\n    }\n  }\n": types.CliUpdateKbDocument,
    "\n  mutation CliDeleteKB($id: ID!) {\n    deleteKnowledgeBase(id: $id)\n  }\n": types.CliDeleteKbDocument,
    "\n  mutation CliSyncKB($id: ID!) {\n    syncKnowledgeBase(id: $id) {\n      id\n      status\n      lastSyncStatus\n      lastSyncAt\n    }\n  }\n": types.CliSyncKbDocument,
    "\n  query CliAgentKBs($agentId: ID!) {\n    agent(id: $agentId) {\n      id\n      knowledgeBases {\n        knowledgeBaseId\n        enabled\n        searchConfig\n      }\n    }\n  }\n": types.CliAgentKBsDocument,
    "\n  mutation CliSetAgentKBs(\n    $agentId: ID!\n    $knowledgeBases: [AgentKnowledgeBaseInput!]!\n  ) {\n    setAgentKnowledgeBases(agentId: $agentId, knowledgeBases: $knowledgeBases) {\n      id\n      knowledgeBaseId\n      enabled\n    }\n  }\n": types.CliSetAgentKBsDocument,
    "\n  query CliKBTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n": types.CliKbTenantBySlugDocument,
    "\n  query CliLabelList($tenantId: ID!) {\n    threadLabels(tenantId: $tenantId) {\n      id\n      name\n      color\n      description\n      createdAt\n    }\n  }\n": types.CliLabelListDocument,
    "\n  mutation CliLabelCreate($input: CreateThreadLabelInput!) {\n    createThreadLabel(input: $input) {\n      id\n      name\n      color\n      description\n    }\n  }\n": types.CliLabelCreateDocument,
    "\n  mutation CliLabelUpdate($id: ID!, $input: UpdateThreadLabelInput!) {\n    updateThreadLabel(id: $id, input: $input) {\n      id\n      name\n      color\n      description\n    }\n  }\n": types.CliLabelUpdateDocument,
    "\n  mutation CliLabelDelete($id: ID!) {\n    deleteThreadLabel(id: $id)\n  }\n": types.CliLabelDeleteDocument,
    "\n  query CliLabelTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n": types.CliLabelTenantBySlugDocument,
    "\n  query CliMe {\n    me {\n      id\n      email\n      name\n      tenantId\n    }\n  }\n": types.CliMeDocument,
    "\n  query CliTenantMembers($tenantId: ID!) {\n    tenantMembers(tenantId: $tenantId) {\n      id\n      tenantId\n      principalType\n      principalId\n      role\n      status\n      createdAt\n    }\n  }\n": types.CliTenantMembersDocument,
    "\n  mutation CliInviteMember($tenantId: ID!, $input: InviteMemberInput!) {\n    inviteMember(tenantId: $tenantId, input: $input) {\n      id\n      principalId\n      role\n      status\n    }\n  }\n": types.CliInviteMemberDocument,
    "\n  mutation CliUpdateTenantMember($id: ID!, $input: UpdateTenantMemberInput!) {\n    updateTenantMember(id: $id, input: $input) {\n      id\n      role\n      status\n    }\n  }\n": types.CliUpdateTenantMemberDocument,
    "\n  mutation CliRemoveTenantMember($id: ID!) {\n    removeTenantMember(id: $id)\n  }\n": types.CliRemoveTenantMemberDocument,
    "\n  query CliMemberTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n": types.CliMemberTenantBySlugDocument,
    "\n  query CliMemoryRecords($tenantId: ID, $assistantId: ID, $namespace: String!) {\n    memoryRecords(tenantId: $tenantId, assistantId: $assistantId, namespace: $namespace) {\n      memoryRecordId\n      namespace\n      content {\n        text\n      }\n      strategy\n      createdAt\n      updatedAt\n    }\n  }\n": types.CliMemoryRecordsDocument,
    "\n  query CliMemorySearch($tenantId: ID, $assistantId: ID, $query: String!, $strategy: MemoryStrategy, $limit: Int) {\n    memorySearch(tenantId: $tenantId, assistantId: $assistantId, query: $query, strategy: $strategy, limit: $limit) {\n      records {\n        memoryRecordId\n        namespace\n        content {\n          text\n        }\n        score\n      }\n    }\n  }\n": types.CliMemorySearchDocument,
    "\n  query CliMemoryGraph($tenantId: ID, $assistantId: ID) {\n    memoryGraph(tenantId: $tenantId, assistantId: $assistantId) {\n      nodes { id label type }\n      edges { source target type }\n    }\n  }\n": types.CliMemoryGraphDocument,
    "\n  mutation CliUpdateMemoryRecord($tenantId: ID, $assistantId: ID, $memoryRecordId: ID!, $content: String!) {\n    updateMemoryRecord(tenantId: $tenantId, assistantId: $assistantId, memoryRecordId: $memoryRecordId, content: $content)\n  }\n": types.CliUpdateMemoryRecordDocument,
    "\n  mutation CliDeleteMemoryRecord($tenantId: ID, $assistantId: ID, $memoryRecordId: ID!) {\n    deleteMemoryRecord(tenantId: $tenantId, assistantId: $assistantId, memoryRecordId: $memoryRecordId)\n  }\n": types.CliDeleteMemoryRecordDocument,
    "\n  query CliMemoryTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n": types.CliMemoryTenantBySlugDocument,
    "\n  mutation CliMsgSendMessage($input: SendMessageInput!) {\n    sendMessage(input: $input) {\n      id\n      threadId\n      role\n      content\n      createdAt\n    }\n  }\n": types.CliMsgSendMessageDocument,
    "\n  query CliMsgMessages($threadId: ID!, $limit: Int, $cursor: String) {\n    messages(threadId: $threadId, limit: $limit, cursor: $cursor) {\n      edges {\n        cursor\n        node {\n          id\n          role\n          senderType\n          senderId\n          content\n          tokenCount\n          createdAt\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n": types.CliMsgMessagesDocument,
    "\n  query CliAgentPerformance($tenantId: ID!, $from: AWSDateTime, $to: AWSDateTime) {\n    agentPerformance(tenantId: $tenantId, from: $from, to: $to) {\n      agentId\n      agentName\n      invocationCount\n      errorCount\n      avgDurationMs\n      p95DurationMs\n      totalInputTokens\n      totalOutputTokens\n      totalCostUsd\n    }\n  }\n": types.CliAgentPerformanceDocument,
    "\n  query CliSingleAgentPerformance($agentId: ID!, $tenantId: ID!) {\n    singleAgentPerformance(agentId: $agentId, tenantId: $tenantId) {\n      agentId\n      agentName\n      invocationCount\n      errorCount\n      avgDurationMs\n      p95DurationMs\n      totalInputTokens\n      totalOutputTokens\n      totalCostUsd\n    }\n  }\n": types.CliSingleAgentPerformanceDocument,
    "\n  query CliRecipes($tenantId: ID!, $threadId: ID, $agentId: ID, $limit: Int, $cursor: String) {\n    recipes(tenantId: $tenantId, threadId: $threadId, agentId: $agentId, limit: $limit, cursor: $cursor) {\n      id\n      title\n      server\n      tool\n      genuiType\n      agentId\n      threadId\n      lastRefreshed\n      createdAt\n    }\n  }\n": types.CliRecipesDocument,
    "\n  query CliRecipe($id: ID!) {\n    recipe(id: $id) {\n      id\n      title\n      summary\n      server\n      tool\n      params\n      genuiType\n      templates\n      cachedResult\n      lastRefreshed\n      lastError\n      agentId\n      threadId\n      sourceMessageId\n      createdAt\n      updatedAt\n    }\n  }\n": types.CliRecipeDocument,
    "\n  mutation CliCreateRecipe($input: CreateRecipeInput!) {\n    createRecipe(input: $input) {\n      id\n      title\n      server\n      tool\n    }\n  }\n": types.CliCreateRecipeDocument,
    "\n  mutation CliUpdateRecipe($id: ID!, $input: UpdateRecipeInput!) {\n    updateRecipe(id: $id, input: $input) {\n      id\n      title\n    }\n  }\n": types.CliUpdateRecipeDocument,
    "\n  mutation CliDeleteRecipe($id: ID!) {\n    deleteRecipe(id: $id)\n  }\n": types.CliDeleteRecipeDocument,
    "\n  query CliRecipeTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n": types.CliRecipeTenantBySlugDocument,
    "\n  query CliRoutines($tenantId: ID!, $teamId: ID, $agentId: ID, $status: RoutineStatus) {\n    routines(tenantId: $tenantId, teamId: $teamId, agentId: $agentId, status: $status) {\n      id\n      name\n      type\n      status\n      engine\n      schedule\n      agentId\n      teamId\n      lastRunAt\n      nextRunAt\n    }\n  }\n": types.CliRoutinesDocument,
    "\n  query CliRoutine($id: ID!) {\n    routine(id: $id) {\n      id\n      name\n      description\n      type\n      status\n      engine\n      schedule\n      agentId\n      teamId\n      visibility\n      owningAgentId\n      currentVersion\n      lastRunAt\n      nextRunAt\n      createdAt\n      updatedAt\n      triggers {\n        id\n        triggerType\n        enabled\n        config\n      }\n    }\n  }\n": types.CliRoutineDocument,
    "\n  mutation CliCreateRoutine($input: CreateRoutineInput!) {\n    createRoutine(input: $input) {\n      id\n      name\n      type\n      status\n    }\n  }\n": types.CliCreateRoutineDocument,
    "\n  mutation CliUpdateRoutine($id: ID!, $input: UpdateRoutineInput!) {\n    updateRoutine(id: $id, input: $input) {\n      id\n      name\n      status\n    }\n  }\n": types.CliUpdateRoutineDocument,
    "\n  mutation CliDeleteRoutine($id: ID!) {\n    deleteRoutine(id: $id)\n  }\n": types.CliDeleteRoutineDocument,
    "\n  mutation CliTriggerRoutineRun($routineId: ID!, $input: AWSJSON) {\n    triggerRoutineRun(routineId: $routineId, input: $input) {\n      id\n      status\n      startedAt\n    }\n  }\n": types.CliTriggerRoutineRunDocument,
    "\n  query CliRoutineExecutions($routineId: ID!, $status: RoutineExecutionStatus, $limit: Int, $cursor: String) {\n    routineExecutions(routineId: $routineId, status: $status, limit: $limit, cursor: $cursor) {\n      id\n      status\n      startedAt\n      finishedAt\n      errorMessage\n    }\n  }\n": types.CliRoutineExecutionsDocument,
    "\n  query CliRoutineExecution($id: ID!) {\n    routineExecution(id: $id) {\n      id\n      routineId\n      status\n      startedAt\n      finishedAt\n      errorMessage\n      inputJson\n      outputJson\n    }\n  }\n": types.CliRoutineExecutionDocument,
    "\n  mutation CliSetRoutineTrigger($routineId: ID!, $input: RoutineTriggerInput!) {\n    setRoutineTrigger(routineId: $routineId, input: $input) {\n      id\n      triggerType\n      enabled\n    }\n  }\n": types.CliSetRoutineTriggerDocument,
    "\n  mutation CliDeleteRoutineTrigger($id: ID!) {\n    deleteRoutineTrigger(id: $id)\n  }\n": types.CliDeleteRoutineTriggerDocument,
    "\n  query CliRoutineTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n": types.CliRoutineTenantBySlugDocument,
    "\n  query CliScheduledJobs(\n    $tenantId: ID!\n    $agentId: ID\n    $routineId: ID\n    $triggerType: String\n    $enabled: Boolean\n    $limit: Int\n  ) {\n    scheduledJobs(\n      tenantId: $tenantId\n      agentId: $agentId\n      routineId: $routineId\n      triggerType: $triggerType\n      enabled: $enabled\n      limit: $limit\n    ) {\n      id\n      name\n      description\n      triggerType\n      agentId\n      routineId\n      scheduleType\n      scheduleExpression\n      timezone\n      enabled\n      lastRunAt\n      nextRunAt\n      createdAt\n    }\n  }\n": types.CliScheduledJobsDocument,
    "\n  query CliScheduledJob($id: ID!) {\n    scheduledJob(id: $id) {\n      id\n      name\n      description\n      triggerType\n      agentId\n      routineId\n      prompt\n      scheduleType\n      scheduleExpression\n      timezone\n      enabled\n      ebScheduleName\n      lastRunAt\n      nextRunAt\n      createdAt\n      updatedAt\n    }\n  }\n": types.CliScheduledJobDocument,
    "\n  mutation CliCreateScheduledJob($input: CreateScheduledJobInput!) {\n    createScheduledJob(input: $input) {\n      id\n      name\n      enabled\n      scheduleExpression\n      timezone\n    }\n  }\n": types.CliCreateScheduledJobDocument,
    "\n  mutation CliDeleteScheduledJob($id: ID!) {\n    deleteScheduledJob(id: $id) {\n      id\n      ok\n    }\n  }\n": types.CliDeleteScheduledJobDocument,
    "\n  mutation CliRunScheduledJob($id: ID!) {\n    runScheduledJob(id: $id) {\n      id\n      dispatched\n      statusCode\n      errorMessage\n    }\n  }\n": types.CliRunScheduledJobDocument,
    "\n  mutation CliUpdateScheduledJob($id: ID!, $input: UpdateScheduledJobInput!) {\n    updateScheduledJob(id: $id, input: $input) {\n      id\n      name\n      enabled\n      scheduleType\n      scheduleExpression\n      timezone\n      nextRunAt\n      updatedAt\n    }\n  }\n": types.CliUpdateScheduledJobDocument,
    "\n  query CliSchedJobTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n": types.CliSchedJobTenantBySlugDocument,
    "\n  query CliSkillCatalog {\n    skillCatalog {\n      id\n      skillId\n      displayName\n      description\n      category\n      icon\n      source\n      enabled\n    }\n  }\n": types.CliSkillCatalogDocument,
    "\n  query CliSkillTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n": types.CliSkillTenantBySlugDocument,
    "\n  mutation CliInstallSkill($input: InstallSkillInput!) {\n    installSkill(input: $input) {\n      id\n      tenantId\n      skillId\n      source\n      version\n      catalogVersion\n      enabled\n      installedAt\n      updatedAt\n    }\n  }\n": types.CliInstallSkillDocument,
    "\n  mutation CliUninstallSkill($tenantId: ID!, $skillId: String!) {\n    uninstallSkill(tenantId: $tenantId, skillId: $skillId)\n  }\n": types.CliUninstallSkillDocument,
    "\n  query CliTeams($tenantId: ID!) {\n    teams(tenantId: $tenantId) {\n      id\n      name\n      slug\n      type\n      status\n      budgetMonthlyCents\n      createdAt\n    }\n  }\n": types.CliTeamsDocument,
    "\n  query CliTeam($id: ID!) {\n    team(id: $id) {\n      id\n      name\n      slug\n      description\n      type\n      status\n      budgetMonthlyCents\n      createdAt\n      updatedAt\n      agents {\n        id\n        agentId\n        role\n        joinedAt\n      }\n      users {\n        id\n        userId\n        role\n        joinedAt\n      }\n    }\n  }\n": types.CliTeamDocument,
    "\n  mutation CliCreateTeam($input: CreateTeamInput!) {\n    createTeam(input: $input) {\n      id\n      name\n      type\n      status\n    }\n  }\n": types.CliCreateTeamDocument,
    "\n  mutation CliUpdateTeam($id: ID!, $input: UpdateTeamInput!) {\n    updateTeam(id: $id, input: $input) {\n      id\n      name\n      type\n      status\n      budgetMonthlyCents\n    }\n  }\n": types.CliUpdateTeamDocument,
    "\n  mutation CliDeleteTeam($id: ID!) {\n    deleteTeam(id: $id)\n  }\n": types.CliDeleteTeamDocument,
    "\n  mutation CliAddTeamAgent($teamId: ID!, $input: AddTeamAgentInput!) {\n    addTeamAgent(teamId: $teamId, input: $input) {\n      id\n      agentId\n      role\n    }\n  }\n": types.CliAddTeamAgentDocument,
    "\n  mutation CliRemoveTeamAgent($teamId: ID!, $agentId: ID!) {\n    removeTeamAgent(teamId: $teamId, agentId: $agentId)\n  }\n": types.CliRemoveTeamAgentDocument,
    "\n  mutation CliAddTeamUser($teamId: ID!, $input: AddTeamUserInput!) {\n    addTeamUser(teamId: $teamId, input: $input) {\n      id\n      userId\n      role\n    }\n  }\n": types.CliAddTeamUserDocument,
    "\n  mutation CliRemoveTeamUser($teamId: ID!, $userId: ID!) {\n    removeTeamUser(teamId: $teamId, userId: $userId)\n  }\n": types.CliRemoveTeamUserDocument,
    "\n  query CliTeamTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n    }\n  }\n": types.CliTeamTenantBySlugDocument,
    "\n  mutation CliCreateTenant($input: CreateTenantInput!) {\n    createTenant(input: $input) {\n      id\n      name\n      slug\n      plan\n      issuePrefix\n    }\n  }\n": types.CliCreateTenantDocument,
    "\n  mutation CliUpdateTenant($id: ID!, $input: UpdateTenantInput!) {\n    updateTenant(id: $id, input: $input) {\n      id\n      name\n      slug\n      plan\n      issuePrefix\n    }\n  }\n": types.CliUpdateTenantDocument,
    "\n  query CliTenantSettings($id: ID!) {\n    tenant(id: $id) {\n      id\n      name\n      slug\n      settings {\n        id\n        defaultModel\n        budgetMonthlyCents\n        autoCloseThreadMinutes\n        maxAgents\n        features\n      }\n    }\n  }\n": types.CliTenantSettingsDocument,
    "\n  mutation CliUpdateTenantSettings(\n    $tenantId: ID!\n    $input: UpdateTenantSettingsInput!\n  ) {\n    updateTenantSettings(tenantId: $tenantId, input: $input) {\n      id\n      defaultModel\n      budgetMonthlyCents\n      autoCloseThreadMinutes\n      maxAgents\n      features\n    }\n  }\n": types.CliUpdateTenantSettingsDocument,
    "\n  query CliTenantBySlugForCmd($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n    }\n  }\n": types.CliTenantBySlugForCmdDocument,
    "\n  query CliThreads(\n    $tenantId: ID!\n    $status: ThreadStatus\n    $channel: ThreadChannel\n    $agentId: ID\n    $assigneeId: ID\n    $search: String\n    $limit: Int\n  ) {\n    threads(\n      tenantId: $tenantId\n      status: $status\n      channel: $channel\n      agentId: $agentId\n      assigneeId: $assigneeId\n      search: $search\n      limit: $limit\n    ) {\n      id\n      number\n      title\n      status\n      channel\n      assigneeType\n      assigneeId\n      agentId\n      lastActivityAt\n      archivedAt\n      createdAt\n    }\n  }\n": types.CliThreadsDocument,
    "\n  query CliThreadById($id: ID!) {\n    thread(id: $id) {\n      id\n      number\n      identifier\n      title\n      status\n      channel\n      assigneeType\n      assigneeId\n      agentId\n      reporterId\n      billingCode\n      labels\n      dueAt\n      startedAt\n      completedAt\n      archivedAt\n      lastActivityAt\n      lastResponsePreview\n      createdAt\n      updatedAt\n    }\n  }\n": types.CliThreadByIdDocument,
    "\n  query CliThreadByNumber($tenantId: ID!, $number: Int!) {\n    threadByNumber(tenantId: $tenantId, number: $number) {\n      id\n      number\n      identifier\n      title\n      status\n      channel\n      assigneeType\n      assigneeId\n      agentId\n      reporterId\n      billingCode\n      labels\n      dueAt\n      startedAt\n      completedAt\n      archivedAt\n      lastActivityAt\n      lastResponsePreview\n      createdAt\n      updatedAt\n    }\n  }\n": types.CliThreadByNumberDocument,
    "\n  query CliThreadLabelsForResolve($tenantId: ID!) {\n    threadLabels(tenantId: $tenantId) {\n      id\n      name\n      color\n    }\n  }\n": types.CliThreadLabelsForResolveDocument,
    "\n  mutation CliCreateThread($input: CreateThreadInput!) {\n    createThread(input: $input) {\n      id\n      number\n      title\n      status\n    }\n  }\n": types.CliCreateThreadDocument,
    "\n  mutation CliUpdateThread($id: ID!, $input: UpdateThreadInput!) {\n    updateThread(id: $id, input: $input) {\n      id\n      number\n      title\n      status\n      assigneeType\n      assigneeId\n      dueAt\n      archivedAt\n    }\n  }\n": types.CliUpdateThreadDocument,
    "\n  mutation CliDeleteThread($id: ID!) {\n    deleteThread(id: $id)\n  }\n": types.CliDeleteThreadDocument,
    "\n  mutation CliCheckoutThread($id: ID!, $input: CheckoutThreadInput!) {\n    checkoutThread(id: $id, input: $input) {\n      id\n      status\n      checkoutRunId\n      checkoutVersion\n    }\n  }\n": types.CliCheckoutThreadDocument,
    "\n  mutation CliReleaseThread($id: ID!, $input: ReleaseThreadInput!) {\n    releaseThread(id: $id, input: $input) {\n      id\n      status\n      checkoutRunId\n    }\n  }\n": types.CliReleaseThreadDocument,
    "\n  mutation CliAssignThreadLabel($threadId: ID!, $labelId: ID!) {\n    assignThreadLabel(threadId: $threadId, labelId: $labelId) {\n      id\n      threadId\n      labelId\n      createdAt\n    }\n  }\n": types.CliAssignThreadLabelDocument,
    "\n  mutation CliRemoveThreadLabel($threadId: ID!, $labelId: ID!) {\n    removeThreadLabel(threadId: $threadId, labelId: $labelId)\n  }\n": types.CliRemoveThreadLabelDocument,
    "\n  mutation CliEscalateThread($input: EscalateThreadInput!) {\n    escalateThread(input: $input) {\n      id\n      status\n      assigneeType\n      assigneeId\n    }\n  }\n": types.CliEscalateThreadDocument,
    "\n  mutation CliDelegateThread($input: DelegateThreadInput!) {\n    delegateThread(input: $input) {\n      id\n      status\n      assigneeType\n      assigneeId\n    }\n  }\n": types.CliDelegateThreadDocument,
    "\n  mutation CliSendMessage($input: SendMessageInput!) {\n    sendMessage(input: $input) {\n      id\n      threadId\n      role\n      content\n      createdAt\n    }\n  }\n": types.CliSendMessageDocument,
    "\n  query CliThreadTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n": types.CliThreadTenantBySlugDocument,
    "\n  query CliThreadTraces($threadId: ID!, $tenantId: ID!) {\n    threadTraces(threadId: $threadId, tenantId: $tenantId) {\n      traceId\n      threadId\n      agentId\n      agentName\n      model\n      inputTokens\n      outputTokens\n      durationMs\n      costUsd\n      estimated\n    }\n  }\n": types.CliThreadTracesDocument,
    "\n  query CliTurnInvocationLogs($tenantId: ID!, $turnId: ID!) {\n    turnInvocationLogs(tenantId: $tenantId, turnId: $turnId) {\n      requestId\n      modelId\n      timestamp\n      inputTokenCount\n      outputTokenCount\n      cacheReadTokenCount\n      toolCount\n      costUsd\n    }\n  }\n": types.CliTurnInvocationLogsDocument,
    "\n  query CliThreadTurns(\n    $tenantId: ID!\n    $agentId: ID\n    $routineId: ID\n    $triggerId: ID\n    $threadId: ID\n    $status: String\n    $limit: Int\n  ) {\n    threadTurns(\n      tenantId: $tenantId\n      agentId: $agentId\n      routineId: $routineId\n      triggerId: $triggerId\n      threadId: $threadId\n      status: $status\n      limit: $limit\n    ) {\n      id\n      agentId\n      routineId\n      threadId\n      status\n      invocationSource\n      triggerName\n      startedAt\n      finishedAt\n      totalCost\n      error\n    }\n  }\n": types.CliThreadTurnsDocument,
    "\n  query CliThreadTurn($id: ID!) {\n    threadTurn(id: $id) {\n      id\n      tenantId\n      agentId\n      routineId\n      threadId\n      turnNumber\n      status\n      invocationSource\n      triggerName\n      triggerDetail\n      startedAt\n      finishedAt\n      error\n      errorCode\n      totalCost\n      lastActivityAt\n      retryAttempt\n      externalRunId\n      sessionIdBefore\n      sessionIdAfter\n      createdAt\n    }\n  }\n": types.CliThreadTurnDocument,
    "\n  query CliThreadTurnEvents($runId: ID!, $limit: Int) {\n    threadTurnEvents(runId: $runId, limit: $limit) {\n      seq\n      eventType\n      stream\n      level\n      message\n      createdAt\n    }\n  }\n": types.CliThreadTurnEventsDocument,
    "\n  mutation CliCancelThreadTurn($id: ID!) {\n    cancelThreadTurn(id: $id) {\n      id\n      status\n      finishedAt\n    }\n  }\n": types.CliCancelThreadTurnDocument,
    "\n  query CliTurnTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n": types.CliTurnTenantBySlugDocument,
    "\n  query CliQueuedWakeups($tenantId: ID!) {\n    queuedWakeups(tenantId: $tenantId) {\n      id\n      agentId\n      status\n      source\n      triggerDetail\n      reason\n      coalescedCount\n      requestedAt\n      claimedAt\n    }\n  }\n": types.CliQueuedWakeupsDocument,
    "\n  mutation CliCreateWakeup($input: CreateWakeupRequestInput!) {\n    createWakeupRequest(input: $input) {\n      id\n      agentId\n      status\n      requestedAt\n    }\n  }\n": types.CliCreateWakeupDocument,
    "\n  query CliWakeupTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n": types.CliWakeupTenantBySlugDocument,
    "\n  query CliWebhooks($tenantId: ID!, $targetType: String, $enabled: Boolean, $limit: Int) {\n    webhooks(tenantId: $tenantId, targetType: $targetType, enabled: $enabled, limit: $limit) {\n      id\n      name\n      targetType\n      agentId\n      routineId\n      enabled\n      rateLimit\n      invocationCount\n      lastInvokedAt\n      createdAt\n    }\n  }\n": types.CliWebhooksDocument,
    "\n  query CliWebhook($id: ID!) {\n    webhook(id: $id) {\n      id\n      name\n      description\n      token\n      targetType\n      agentId\n      routineId\n      prompt\n      enabled\n      rateLimit\n      invocationCount\n      lastInvokedAt\n      createdAt\n      updatedAt\n    }\n  }\n": types.CliWebhookDocument,
    "\n  mutation CliCreateWebhook($input: CreateWebhookInput!) {\n    createWebhook(input: $input) {\n      id\n      name\n      token\n      targetType\n      enabled\n    }\n  }\n": types.CliCreateWebhookDocument,
    "\n  mutation CliUpdateWebhook($id: ID!, $input: UpdateWebhookInput!) {\n    updateWebhook(id: $id, input: $input) {\n      id\n      name\n      targetType\n      enabled\n      rateLimit\n    }\n  }\n": types.CliUpdateWebhookDocument,
    "\n  mutation CliDeleteWebhook($id: ID!) {\n    deleteWebhook(id: $id)\n  }\n": types.CliDeleteWebhookDocument,
    "\n  mutation CliRegenerateWebhookToken($id: ID!) {\n    regenerateWebhookToken(id: $id) {\n      id\n      token\n    }\n  }\n": types.CliRegenerateWebhookTokenDocument,
    "\n  query CliWebhookDeliveries($webhookId: ID!, $limit: Int) {\n    webhookDeliveries(webhookId: $webhookId, limit: $limit) {\n      id\n      providerName\n      providerEventId\n      normalizedKind\n      receivedAt\n      signatureStatus\n      resolutionStatus\n      statusCode\n      durationMs\n      threadId\n      threadCreated\n      retryCount\n      isReplay\n      errorMessage\n    }\n  }\n": types.CliWebhookDeliveriesDocument,
    "\n  mutation CliTestWebhook($id: ID!) {\n    testWebhook(id: $id) {\n      id\n      webhookId\n      tenantId\n      receivedAt\n      resolutionStatus\n      signatureStatus\n      statusCode\n      bodyPreview\n    }\n  }\n": types.CliTestWebhookDocument,
    "\n  query CliWebhookForTest($id: ID!) {\n    webhook(id: $id) {\n      id\n      token\n    }\n  }\n": types.CliWebhookForTestDocument,
    "\n  query CliWebhookTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n": types.CliWebhookTenantBySlugDocument,
    "\n  query CliWikiTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n": types.CliWikiTenantBySlugDocument,
    "\n  query CliAllTenantAgentsForWiki($tenantId: ID!) {\n    allTenantAgents(tenantId: $tenantId, includeSystem: false, includeSubAgents: false) {\n      id\n      name\n      slug\n      type\n      status\n    }\n  }\n": types.CliAllTenantAgentsForWikiDocument,
    "\n  mutation CliCompileWikiNow($tenantId: ID!, $ownerId: ID!, $modelId: String, $forceNew: Boolean) {\n    compileWikiNow(\n      tenantId: $tenantId\n      ownerId: $ownerId\n      modelId: $modelId\n      forceNew: $forceNew\n    ) {\n      id\n      tenantId\n      ownerId\n      status\n      trigger\n      dedupeKey\n      attempt\n      createdAt\n    }\n  }\n": types.CliCompileWikiNowDocument,
    "\n  mutation CliResetWikiCursor(\n    $tenantId: ID!\n    $ownerId: ID!\n    $force: Boolean\n    $dryRun: Boolean\n    $includeBrain: Boolean\n  ) {\n    resetWikiCursor(\n      tenantId: $tenantId\n      ownerId: $ownerId\n      force: $force\n      dryRun: $dryRun\n      includeBrain: $includeBrain\n    ) {\n      tenantId\n      ownerId\n      cursorCleared\n      pagesArchived\n      dryRun\n      brainIncluded\n      impact\n    }\n  }\n": types.CliResetWikiCursorDocument,
    "\n  query CliWikiCompileJobs($tenantId: ID!, $ownerId: ID, $limit: Int) {\n    wikiCompileJobs(tenantId: $tenantId, ownerId: $ownerId, limit: $limit) {\n      id\n      tenantId\n      ownerId\n      status\n      trigger\n      dedupeKey\n      attempt\n      claimedAt\n      startedAt\n      finishedAt\n      error\n      metrics\n      createdAt\n    }\n  }\n": types.CliWikiCompileJobsDocument,
    "\n  query CliCmdTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n": types.CliCmdTenantBySlugDocument,
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
export function graphql(source: "\n  query CliAgents(\n    $tenantId: ID!\n    $status: AgentStatus\n    $type: AgentType\n    $includeSystem: Boolean\n  ) {\n    agents(\n      tenantId: $tenantId\n      status: $status\n      type: $type\n      includeSystem: $includeSystem\n    ) {\n      id\n      name\n      slug\n      role\n      type\n      status\n      runtime\n      lastHeartbeatAt\n    }\n  }\n"): (typeof documents)["\n  query CliAgents(\n    $tenantId: ID!\n    $status: AgentStatus\n    $type: AgentType\n    $includeSystem: Boolean\n  ) {\n    agents(\n      tenantId: $tenantId\n      status: $status\n      type: $type\n      includeSystem: $includeSystem\n    ) {\n      id\n      name\n      slug\n      role\n      type\n      status\n      runtime\n      lastHeartbeatAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliAllTenantAgents(\n    $tenantId: ID!\n    $includeSystem: Boolean\n    $includeSubAgents: Boolean\n  ) {\n    allTenantAgents(\n      tenantId: $tenantId\n      includeSystem: $includeSystem\n      includeSubAgents: $includeSubAgents\n    ) {\n      id\n      name\n      slug\n      role\n      type\n      status\n      runtime\n      lastHeartbeatAt\n    }\n  }\n"): (typeof documents)["\n  query CliAllTenantAgents(\n    $tenantId: ID!\n    $includeSystem: Boolean\n    $includeSubAgents: Boolean\n  ) {\n    allTenantAgents(\n      tenantId: $tenantId\n      includeSystem: $includeSystem\n      includeSubAgents: $includeSubAgents\n    ) {\n      id\n      name\n      slug\n      role\n      type\n      status\n      runtime\n      lastHeartbeatAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliAgent($id: ID!) {\n    agent(id: $id) {\n      id\n      name\n      slug\n      role\n      type\n      source\n      status\n      systemPrompt\n      runtime\n      adapterType\n      version\n      humanPairId\n      parentAgentId\n      reportsToId\n      lastHeartbeatAt\n      createdAt\n      updatedAt\n      capabilities {\n        capability\n        enabled\n        config\n      }\n      skills {\n        skillId\n        enabled\n        rateLimitRpm\n      }\n      budgetPolicy {\n        period\n        limitUsd\n        actionOnExceed\n      }\n    }\n  }\n"): (typeof documents)["\n  query CliAgent($id: ID!) {\n    agent(id: $id) {\n      id\n      name\n      slug\n      role\n      type\n      source\n      status\n      systemPrompt\n      runtime\n      adapterType\n      version\n      humanPairId\n      parentAgentId\n      reportsToId\n      lastHeartbeatAt\n      createdAt\n      updatedAt\n      capabilities {\n        capability\n        enabled\n        config\n      }\n      skills {\n        skillId\n        enabled\n        rateLimitRpm\n      }\n      budgetPolicy {\n        period\n        limitUsd\n        actionOnExceed\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliCreateAgent($input: CreateAgentInput!) {\n    createAgent(input: $input) {\n      id\n      name\n      type\n      status\n    }\n  }\n"): (typeof documents)["\n  mutation CliCreateAgent($input: CreateAgentInput!) {\n    createAgent(input: $input) {\n      id\n      name\n      type\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliUpdateAgent($id: ID!, $input: UpdateAgentInput!) {\n    updateAgent(id: $id, input: $input) {\n      id\n      name\n      role\n      type\n      status\n    }\n  }\n"): (typeof documents)["\n  mutation CliUpdateAgent($id: ID!, $input: UpdateAgentInput!) {\n    updateAgent(id: $id, input: $input) {\n      id\n      name\n      role\n      type\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliDeleteAgent($id: ID!) {\n    deleteAgent(id: $id)\n  }\n"): (typeof documents)["\n  mutation CliDeleteAgent($id: ID!) {\n    deleteAgent(id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliUpdateAgentStatus($id: ID!, $status: AgentStatus!) {\n    updateAgentStatus(id: $id, status: $status) {\n      id\n      status\n    }\n  }\n"): (typeof documents)["\n  mutation CliUpdateAgentStatus($id: ID!, $status: AgentStatus!) {\n    updateAgentStatus(id: $id, status: $status) {\n      id\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliSetAgentCapabilities(\n    $agentId: ID!\n    $capabilities: [AgentCapabilityInput!]!\n  ) {\n    setAgentCapabilities(agentId: $agentId, capabilities: $capabilities) {\n      capability\n      enabled\n    }\n  }\n"): (typeof documents)["\n  mutation CliSetAgentCapabilities(\n    $agentId: ID!\n    $capabilities: [AgentCapabilityInput!]!\n  ) {\n    setAgentCapabilities(agentId: $agentId, capabilities: $capabilities) {\n      capability\n      enabled\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliSetAgentSkills($agentId: ID!, $skills: [AgentSkillInput!]!) {\n    setAgentSkills(agentId: $agentId, skills: $skills) {\n      skillId\n      enabled\n      rateLimitRpm\n    }\n  }\n"): (typeof documents)["\n  mutation CliSetAgentSkills($agentId: ID!, $skills: [AgentSkillInput!]!) {\n    setAgentSkills(agentId: $agentId, skills: $skills) {\n      skillId\n      enabled\n      rateLimitRpm\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliSetAgentBudgetPolicy(\n    $agentId: ID!\n    $input: AgentBudgetPolicyInput!\n  ) {\n    setAgentBudgetPolicy(agentId: $agentId, input: $input) {\n      period\n      limitUsd\n      actionOnExceed\n    }\n  }\n"): (typeof documents)["\n  mutation CliSetAgentBudgetPolicy(\n    $agentId: ID!\n    $input: AgentBudgetPolicyInput!\n  ) {\n    setAgentBudgetPolicy(agentId: $agentId, input: $input) {\n      period\n      limitUsd\n      actionOnExceed\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliDeleteAgentBudgetPolicy($agentId: ID!) {\n    deleteAgentBudgetPolicy(agentId: $agentId)\n  }\n"): (typeof documents)["\n  mutation CliDeleteAgentBudgetPolicy($agentId: ID!) {\n    deleteAgentBudgetPolicy(agentId: $agentId)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliAgentApiKeys($agentId: ID!) {\n    agentApiKeys(agentId: $agentId) {\n      id\n      name\n      keyPrefix\n      lastUsedAt\n      revokedAt\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  query CliAgentApiKeys($agentId: ID!) {\n    agentApiKeys(agentId: $agentId) {\n      id\n      name\n      keyPrefix\n      lastUsedAt\n      revokedAt\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliCreateAgentApiKey($input: CreateAgentApiKeyInput!) {\n    createAgentApiKey(input: $input) {\n      apiKey {\n        id\n        name\n        keyPrefix\n        createdAt\n      }\n      plainTextKey\n    }\n  }\n"): (typeof documents)["\n  mutation CliCreateAgentApiKey($input: CreateAgentApiKeyInput!) {\n    createAgentApiKey(input: $input) {\n      apiKey {\n        id\n        name\n        keyPrefix\n        createdAt\n      }\n      plainTextKey\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliRevokeAgentApiKey($id: ID!) {\n    revokeAgentApiKey(id: $id) {\n      id\n      revokedAt\n    }\n  }\n"): (typeof documents)["\n  mutation CliRevokeAgentApiKey($id: ID!) {\n    revokeAgentApiKey(id: $id) {\n      id\n      revokedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliToggleAgentEmail($agentId: ID!, $enabled: Boolean!) {\n    toggleAgentEmailChannel(agentId: $agentId, enabled: $enabled) {\n      capability\n      enabled\n    }\n  }\n"): (typeof documents)["\n  mutation CliToggleAgentEmail($agentId: ID!, $enabled: Boolean!) {\n    toggleAgentEmailChannel(agentId: $agentId, enabled: $enabled) {\n      capability\n      enabled\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliClaimVanityEmail($agentId: ID!, $localPart: String!) {\n    claimVanityEmailAddress(agentId: $agentId, localPart: $localPart) {\n      capability\n      enabled\n      config\n    }\n  }\n"): (typeof documents)["\n  mutation CliClaimVanityEmail($agentId: ID!, $localPart: String!) {\n    claimVanityEmailAddress(agentId: $agentId, localPart: $localPart) {\n      capability\n      enabled\n      config\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliReleaseVanityEmail($agentId: ID!) {\n    releaseVanityEmailAddress(agentId: $agentId) {\n      capability\n      enabled\n    }\n  }\n"): (typeof documents)["\n  mutation CliReleaseVanityEmail($agentId: ID!) {\n    releaseVanityEmailAddress(agentId: $agentId) {\n      capability\n      enabled\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliUpdateAgentEmailAllowlist(\n    $agentId: ID!\n    $allowedSenders: [String!]!\n  ) {\n    updateAgentEmailAllowlist(\n      agentId: $agentId\n      allowedSenders: $allowedSenders\n    ) {\n      capability\n      config\n    }\n  }\n"): (typeof documents)["\n  mutation CliUpdateAgentEmailAllowlist(\n    $agentId: ID!\n    $allowedSenders: [String!]!\n  ) {\n    updateAgentEmailAllowlist(\n      agentId: $agentId\n      allowedSenders: $allowedSenders\n    ) {\n      capability\n      config\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliAgentTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n"): (typeof documents)["\n  query CliAgentTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliArtifacts(\n    $tenantId: ID!\n    $threadId: ID\n    $agentId: ID\n    $type: ArtifactType\n    $status: ArtifactStatus\n    $limit: Int\n    $cursor: String\n  ) {\n    artifacts(\n      tenantId: $tenantId\n      threadId: $threadId\n      agentId: $agentId\n      type: $type\n      status: $status\n      limit: $limit\n      cursor: $cursor\n    ) {\n      id\n      title\n      type\n      status\n      agentId\n      threadId\n      createdAt\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  query CliArtifacts(\n    $tenantId: ID!\n    $threadId: ID\n    $agentId: ID\n    $type: ArtifactType\n    $status: ArtifactStatus\n    $limit: Int\n    $cursor: String\n  ) {\n    artifacts(\n      tenantId: $tenantId\n      threadId: $threadId\n      agentId: $agentId\n      type: $type\n      status: $status\n      limit: $limit\n      cursor: $cursor\n    ) {\n      id\n      title\n      type\n      status\n      agentId\n      threadId\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliArtifact($id: ID!) {\n    artifact(id: $id) {\n      id\n      tenantId\n      agentId\n      threadId\n      title\n      type\n      status\n      summary\n      content\n      s3Key\n      sourceMessageId\n      favoritedAt\n      createdAt\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  query CliArtifact($id: ID!) {\n    artifact(id: $id) {\n      id\n      tenantId\n      agentId\n      threadId\n      title\n      type\n      status\n      summary\n      content\n      s3Key\n      sourceMessageId\n      favoritedAt\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliArtifactTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n"): (typeof documents)["\n  query CliArtifactTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliBudgetPolicies($tenantId: ID!) {\n    budgetPolicies(tenantId: $tenantId) {\n      id\n      scope\n      agentId\n      period\n      limitUsd\n      actionOnExceed\n      enabled\n    }\n  }\n"): (typeof documents)["\n  query CliBudgetPolicies($tenantId: ID!) {\n    budgetPolicies(tenantId: $tenantId) {\n      id\n      scope\n      agentId\n      period\n      limitUsd\n      actionOnExceed\n      enabled\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliBudgetStatus($tenantId: ID!) {\n    budgetStatus(tenantId: $tenantId) {\n      policy {\n        id\n        scope\n        agentId\n        period\n        limitUsd\n      }\n      spentUsd\n      remainingUsd\n      percentUsed\n      status\n    }\n  }\n"): (typeof documents)["\n  query CliBudgetStatus($tenantId: ID!) {\n    budgetStatus(tenantId: $tenantId) {\n      policy {\n        id\n        scope\n        agentId\n        period\n        limitUsd\n      }\n      spentUsd\n      remainingUsd\n      percentUsed\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliUpsertBudgetPolicy($tenantId: ID!, $input: UpsertBudgetPolicyInput!) {\n    upsertBudgetPolicy(tenantId: $tenantId, input: $input) {\n      id\n      scope\n      agentId\n      limitUsd\n      period\n      actionOnExceed\n    }\n  }\n"): (typeof documents)["\n  mutation CliUpsertBudgetPolicy($tenantId: ID!, $input: UpsertBudgetPolicyInput!) {\n    upsertBudgetPolicy(tenantId: $tenantId, input: $input) {\n      id\n      scope\n      agentId\n      limitUsd\n      period\n      actionOnExceed\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliDeleteBudgetPolicy($id: ID!) {\n    deleteBudgetPolicy(id: $id)\n  }\n"): (typeof documents)["\n  mutation CliDeleteBudgetPolicy($id: ID!) {\n    deleteBudgetPolicy(id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliCostSummary($tenantId: ID!, $from: AWSDateTime, $to: AWSDateTime) {\n    costSummary(tenantId: $tenantId, from: $from, to: $to) {\n      totalUsd\n      llmUsd\n      computeUsd\n      toolsUsd\n      evalUsd\n      totalInputTokens\n      totalOutputTokens\n      eventCount\n    }\n  }\n"): (typeof documents)["\n  query CliCostSummary($tenantId: ID!, $from: AWSDateTime, $to: AWSDateTime) {\n    costSummary(tenantId: $tenantId, from: $from, to: $to) {\n      totalUsd\n      llmUsd\n      computeUsd\n      toolsUsd\n      evalUsd\n      totalInputTokens\n      totalOutputTokens\n      eventCount\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliCostByAgent($tenantId: ID!, $from: AWSDateTime, $to: AWSDateTime) {\n    costByAgent(tenantId: $tenantId, from: $from, to: $to) {\n      agentId\n      agentName\n      totalUsd\n      eventCount\n    }\n  }\n"): (typeof documents)["\n  query CliCostByAgent($tenantId: ID!, $from: AWSDateTime, $to: AWSDateTime) {\n    costByAgent(tenantId: $tenantId, from: $from, to: $to) {\n      agentId\n      agentName\n      totalUsd\n      eventCount\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliCostByModel($tenantId: ID!, $from: AWSDateTime, $to: AWSDateTime) {\n    costByModel(tenantId: $tenantId, from: $from, to: $to) {\n      model\n      totalUsd\n      inputTokens\n      outputTokens\n    }\n  }\n"): (typeof documents)["\n  query CliCostByModel($tenantId: ID!, $from: AWSDateTime, $to: AWSDateTime) {\n    costByModel(tenantId: $tenantId, from: $from, to: $to) {\n      model\n      totalUsd\n      inputTokens\n      outputTokens\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliCostSeries($tenantId: ID!, $days: Int) {\n    costTimeSeries(tenantId: $tenantId, days: $days) {\n      day\n      totalUsd\n      llmUsd\n      computeUsd\n      toolsUsd\n      eventCount\n    }\n  }\n"): (typeof documents)["\n  query CliCostSeries($tenantId: ID!, $days: Int) {\n    costTimeSeries(tenantId: $tenantId, days: $days) {\n      day\n      totalUsd\n      llmUsd\n      computeUsd\n      toolsUsd\n      eventCount\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliDashboard($tenantId: ID!) {\n    agents(tenantId: $tenantId) {\n      id\n      status\n    }\n    threads(tenantId: $tenantId, limit: 200) {\n      id\n      status\n      archivedAt\n    }\n    inboxItems(tenantId: $tenantId, status: PENDING) {\n      id\n    }\n    costSummary(tenantId: $tenantId) {\n      totalUsd\n      llmUsd\n      computeUsd\n      eventCount\n    }\n  }\n"): (typeof documents)["\n  query CliDashboard($tenantId: ID!) {\n    agents(tenantId: $tenantId) {\n      id\n      status\n    }\n    threads(tenantId: $tenantId, limit: 200) {\n      id\n      status\n      archivedAt\n    }\n    inboxItems(tenantId: $tenantId, status: PENDING) {\n      id\n    }\n    costSummary(tenantId: $tenantId) {\n      totalUsd\n      llmUsd\n      computeUsd\n      eventCount\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliEvalRuns($tenantId: ID!, $agentId: ID, $limit: Int, $offset: Int) {\n    evalRuns(\n      tenantId: $tenantId\n      agentId: $agentId\n      limit: $limit\n      offset: $offset\n    ) {\n      totalCount\n      items {\n        id\n        status\n        model\n        categories\n        agentId\n        agentName\n        agentTemplateId\n        totalTests\n        passed\n        failed\n        passRate\n        regression\n        costUsd\n        errorMessage\n        startedAt\n        completedAt\n        createdAt\n      }\n    }\n  }\n"): (typeof documents)["\n  query CliEvalRuns($tenantId: ID!, $agentId: ID, $limit: Int, $offset: Int) {\n    evalRuns(\n      tenantId: $tenantId\n      agentId: $agentId\n      limit: $limit\n      offset: $offset\n    ) {\n      totalCount\n      items {\n        id\n        status\n        model\n        categories\n        agentId\n        agentName\n        agentTemplateId\n        totalTests\n        passed\n        failed\n        passRate\n        regression\n        costUsd\n        errorMessage\n        startedAt\n        completedAt\n        createdAt\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliEvalRun($id: ID!) {\n    evalRun(id: $id) {\n      id\n      status\n      model\n      categories\n      agentId\n      agentName\n      agentTemplateId\n      totalTests\n      passed\n      failed\n      passRate\n      regression\n      costUsd\n      errorMessage\n      startedAt\n      completedAt\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  query CliEvalRun($id: ID!) {\n    evalRun(id: $id) {\n      id\n      status\n      model\n      categories\n      agentId\n      agentName\n      agentTemplateId\n      totalTests\n      passed\n      failed\n      passRate\n      regression\n      costUsd\n      errorMessage\n      startedAt\n      completedAt\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliEvalRunResults($runId: ID!) {\n    evalRunResults(runId: $runId) {\n      id\n      testCaseId\n      testCaseName\n      category\n      status\n      score\n      durationMs\n      agentSessionId\n      input\n      expected\n      actualOutput\n      evaluatorResults\n      assertions\n      errorMessage\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  query CliEvalRunResults($runId: ID!) {\n    evalRunResults(runId: $runId) {\n      id\n      testCaseId\n      testCaseName\n      category\n      status\n      score\n      durationMs\n      agentSessionId\n      input\n      expected\n      actualOutput\n      evaluatorResults\n      assertions\n      errorMessage\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliEvalTestCases($tenantId: ID!, $category: String, $search: String) {\n    evalTestCases(tenantId: $tenantId, category: $category, search: $search) {\n      id\n      name\n      category\n      query\n      systemPrompt\n      agentTemplateId\n      agentcoreEvaluatorIds\n      tags\n      enabled\n      source\n      createdAt\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  query CliEvalTestCases($tenantId: ID!, $category: String, $search: String) {\n    evalTestCases(tenantId: $tenantId, category: $category, search: $search) {\n      id\n      name\n      category\n      query\n      systemPrompt\n      agentTemplateId\n      agentcoreEvaluatorIds\n      tags\n      enabled\n      source\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliEvalTestCase($id: ID!) {\n    evalTestCase(id: $id) {\n      id\n      tenantId\n      name\n      category\n      query\n      systemPrompt\n      agentTemplateId\n      assertions\n      agentcoreEvaluatorIds\n      tags\n      enabled\n      source\n      createdAt\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  query CliEvalTestCase($id: ID!) {\n    evalTestCase(id: $id) {\n      id\n      tenantId\n      name\n      category\n      query\n      systemPrompt\n      agentTemplateId\n      assertions\n      agentcoreEvaluatorIds\n      tags\n      enabled\n      source\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliComputersForEval($tenantId: ID!) {\n    computers(tenantId: $tenantId) {\n      id\n      name\n      slug\n      runtimeStatus\n    }\n  }\n"): (typeof documents)["\n  query CliComputersForEval($tenantId: ID!) {\n    computers(tenantId: $tenantId) {\n      id\n      name\n      slug\n      runtimeStatus\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n"): (typeof documents)["\n  query CliTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliStartEvalRun($tenantId: ID!, $input: StartEvalRunInput!) {\n    startEvalRun(tenantId: $tenantId, input: $input) {\n      id\n      status\n      model\n      categories\n      agentTemplateId\n      totalTests\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  mutation CliStartEvalRun($tenantId: ID!, $input: StartEvalRunInput!) {\n    startEvalRun(tenantId: $tenantId, input: $input) {\n      id\n      status\n      model\n      categories\n      agentTemplateId\n      totalTests\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliCancelEvalRun($id: ID!) {\n    cancelEvalRun(id: $id) {\n      id\n      status\n      completedAt\n    }\n  }\n"): (typeof documents)["\n  mutation CliCancelEvalRun($id: ID!) {\n    cancelEvalRun(id: $id) {\n      id\n      status\n      completedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliDeleteEvalRun($id: ID!) {\n    deleteEvalRun(id: $id)\n  }\n"): (typeof documents)["\n  mutation CliDeleteEvalRun($id: ID!) {\n    deleteEvalRun(id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliCreateEvalTestCase(\n    $tenantId: ID!\n    $input: CreateEvalTestCaseInput!\n  ) {\n    createEvalTestCase(tenantId: $tenantId, input: $input) {\n      id\n      name\n      category\n    }\n  }\n"): (typeof documents)["\n  mutation CliCreateEvalTestCase(\n    $tenantId: ID!\n    $input: CreateEvalTestCaseInput!\n  ) {\n    createEvalTestCase(tenantId: $tenantId, input: $input) {\n      id\n      name\n      category\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliUpdateEvalTestCase($id: ID!, $input: UpdateEvalTestCaseInput!) {\n    updateEvalTestCase(id: $id, input: $input) {\n      id\n      name\n      category\n      enabled\n    }\n  }\n"): (typeof documents)["\n  mutation CliUpdateEvalTestCase($id: ID!, $input: UpdateEvalTestCaseInput!) {\n    updateEvalTestCase(id: $id, input: $input) {\n      id\n      name\n      category\n      enabled\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliDeleteEvalTestCase($id: ID!) {\n    deleteEvalTestCase(id: $id)\n  }\n"): (typeof documents)["\n  mutation CliDeleteEvalTestCase($id: ID!) {\n    deleteEvalTestCase(id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliSeedEvalTestCases($tenantId: ID!, $categories: [String!]) {\n    seedEvalTestCases(tenantId: $tenantId, categories: $categories)\n  }\n"): (typeof documents)["\n  mutation CliSeedEvalTestCases($tenantId: ID!, $categories: [String!]) {\n    seedEvalTestCases(tenantId: $tenantId, categories: $categories)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliInboxItems(\n    $tenantId: ID!\n    $status: InboxItemStatus\n    $entityType: String\n    $entityId: ID\n    $recipientId: ID\n  ) {\n    inboxItems(\n      tenantId: $tenantId\n      status: $status\n      entityType: $entityType\n      entityId: $entityId\n      recipientId: $recipientId\n    ) {\n      id\n      type\n      status\n      title\n      description\n      requesterType\n      requesterId\n      recipientId\n      entityType\n      entityId\n      revision\n      reviewNotes\n      decidedBy\n      decidedAt\n      expiresAt\n      createdAt\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  query CliInboxItems(\n    $tenantId: ID!\n    $status: InboxItemStatus\n    $entityType: String\n    $entityId: ID\n    $recipientId: ID\n  ) {\n    inboxItems(\n      tenantId: $tenantId\n      status: $status\n      entityType: $entityType\n      entityId: $entityId\n      recipientId: $recipientId\n    ) {\n      id\n      type\n      status\n      title\n      description\n      requesterType\n      requesterId\n      recipientId\n      entityType\n      entityId\n      revision\n      reviewNotes\n      decidedBy\n      decidedAt\n      expiresAt\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliInboxItem($id: ID!) {\n    inboxItem(id: $id) {\n      id\n      type\n      status\n      title\n      description\n      requesterType\n      requesterId\n      recipientId\n      entityType\n      entityId\n      config\n      revision\n      reviewNotes\n      decidedBy\n      decidedAt\n      expiresAt\n      createdAt\n      updatedAt\n      comments {\n        id\n        authorType\n        authorId\n        content\n        createdAt\n      }\n      links {\n        id\n        linkedType\n        linkedId\n        createdAt\n      }\n      linkedThreads {\n        id\n        number\n        identifier\n        title\n        status\n      }\n    }\n  }\n"): (typeof documents)["\n  query CliInboxItem($id: ID!) {\n    inboxItem(id: $id) {\n      id\n      type\n      status\n      title\n      description\n      requesterType\n      requesterId\n      recipientId\n      entityType\n      entityId\n      config\n      revision\n      reviewNotes\n      decidedBy\n      decidedAt\n      expiresAt\n      createdAt\n      updatedAt\n      comments {\n        id\n        authorType\n        authorId\n        content\n        createdAt\n      }\n      links {\n        id\n        linkedType\n        linkedId\n        createdAt\n      }\n      linkedThreads {\n        id\n        number\n        identifier\n        title\n        status\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliInboxApprove($id: ID!, $input: ApproveInboxItemInput) {\n    approveInboxItem(id: $id, input: $input) {\n      id\n      status\n      reviewNotes\n      decidedAt\n    }\n  }\n"): (typeof documents)["\n  mutation CliInboxApprove($id: ID!, $input: ApproveInboxItemInput) {\n    approveInboxItem(id: $id, input: $input) {\n      id\n      status\n      reviewNotes\n      decidedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliInboxReject($id: ID!, $input: RejectInboxItemInput) {\n    rejectInboxItem(id: $id, input: $input) {\n      id\n      status\n      reviewNotes\n      decidedAt\n    }\n  }\n"): (typeof documents)["\n  mutation CliInboxReject($id: ID!, $input: RejectInboxItemInput) {\n    rejectInboxItem(id: $id, input: $input) {\n      id\n      status\n      reviewNotes\n      decidedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliInboxRequestRevision($id: ID!, $input: RequestRevisionInput!) {\n    requestRevision(id: $id, input: $input) {\n      id\n      status\n      reviewNotes\n      revision\n    }\n  }\n"): (typeof documents)["\n  mutation CliInboxRequestRevision($id: ID!, $input: RequestRevisionInput!) {\n    requestRevision(id: $id, input: $input) {\n      id\n      status\n      reviewNotes\n      revision\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliInboxResubmit($id: ID!, $input: ResubmitInboxItemInput) {\n    resubmitInboxItem(id: $id, input: $input) {\n      id\n      status\n      revision\n    }\n  }\n"): (typeof documents)["\n  mutation CliInboxResubmit($id: ID!, $input: ResubmitInboxItemInput) {\n    resubmitInboxItem(id: $id, input: $input) {\n      id\n      status\n      revision\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliInboxCancel($id: ID!) {\n    cancelInboxItem(id: $id) {\n      id\n      status\n    }\n  }\n"): (typeof documents)["\n  mutation CliInboxCancel($id: ID!) {\n    cancelInboxItem(id: $id) {\n      id\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliInboxAddComment($input: AddInboxItemCommentInput!) {\n    addInboxItemComment(input: $input) {\n      id\n      inboxItemId\n      authorType\n      authorId\n      content\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  mutation CliInboxAddComment($input: AddInboxItemCommentInput!) {\n    addInboxItemComment(input: $input) {\n      id\n      inboxItemId\n      authorType\n      authorId\n      content\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliInboxTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n"): (typeof documents)["\n  query CliInboxTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliKnowledgeBases($tenantId: ID!) {\n    knowledgeBases(tenantId: $tenantId) {\n      id\n      name\n      slug\n      embeddingModel\n      status\n      documentCount\n      lastSyncAt\n      lastSyncStatus\n    }\n  }\n"): (typeof documents)["\n  query CliKnowledgeBases($tenantId: ID!) {\n    knowledgeBases(tenantId: $tenantId) {\n      id\n      name\n      slug\n      embeddingModel\n      status\n      documentCount\n      lastSyncAt\n      lastSyncStatus\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliKnowledgeBase($id: ID!) {\n    knowledgeBase(id: $id) {\n      id\n      name\n      slug\n      description\n      embeddingModel\n      chunkingStrategy\n      chunkSizeTokens\n      chunkOverlapPercent\n      status\n      awsKbId\n      documentCount\n      lastSyncAt\n      lastSyncStatus\n      errorMessage\n      createdAt\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  query CliKnowledgeBase($id: ID!) {\n    knowledgeBase(id: $id) {\n      id\n      name\n      slug\n      description\n      embeddingModel\n      chunkingStrategy\n      chunkSizeTokens\n      chunkOverlapPercent\n      status\n      awsKbId\n      documentCount\n      lastSyncAt\n      lastSyncStatus\n      errorMessage\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliCreateKB($input: CreateKnowledgeBaseInput!) {\n    createKnowledgeBase(input: $input) {\n      id\n      name\n      slug\n      status\n    }\n  }\n"): (typeof documents)["\n  mutation CliCreateKB($input: CreateKnowledgeBaseInput!) {\n    createKnowledgeBase(input: $input) {\n      id\n      name\n      slug\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliUpdateKB($id: ID!, $input: UpdateKnowledgeBaseInput!) {\n    updateKnowledgeBase(id: $id, input: $input) {\n      id\n      name\n      description\n    }\n  }\n"): (typeof documents)["\n  mutation CliUpdateKB($id: ID!, $input: UpdateKnowledgeBaseInput!) {\n    updateKnowledgeBase(id: $id, input: $input) {\n      id\n      name\n      description\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliDeleteKB($id: ID!) {\n    deleteKnowledgeBase(id: $id)\n  }\n"): (typeof documents)["\n  mutation CliDeleteKB($id: ID!) {\n    deleteKnowledgeBase(id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliSyncKB($id: ID!) {\n    syncKnowledgeBase(id: $id) {\n      id\n      status\n      lastSyncStatus\n      lastSyncAt\n    }\n  }\n"): (typeof documents)["\n  mutation CliSyncKB($id: ID!) {\n    syncKnowledgeBase(id: $id) {\n      id\n      status\n      lastSyncStatus\n      lastSyncAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliAgentKBs($agentId: ID!) {\n    agent(id: $agentId) {\n      id\n      knowledgeBases {\n        knowledgeBaseId\n        enabled\n        searchConfig\n      }\n    }\n  }\n"): (typeof documents)["\n  query CliAgentKBs($agentId: ID!) {\n    agent(id: $agentId) {\n      id\n      knowledgeBases {\n        knowledgeBaseId\n        enabled\n        searchConfig\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliSetAgentKBs(\n    $agentId: ID!\n    $knowledgeBases: [AgentKnowledgeBaseInput!]!\n  ) {\n    setAgentKnowledgeBases(agentId: $agentId, knowledgeBases: $knowledgeBases) {\n      id\n      knowledgeBaseId\n      enabled\n    }\n  }\n"): (typeof documents)["\n  mutation CliSetAgentKBs(\n    $agentId: ID!\n    $knowledgeBases: [AgentKnowledgeBaseInput!]!\n  ) {\n    setAgentKnowledgeBases(agentId: $agentId, knowledgeBases: $knowledgeBases) {\n      id\n      knowledgeBaseId\n      enabled\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliKBTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n"): (typeof documents)["\n  query CliKBTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliLabelList($tenantId: ID!) {\n    threadLabels(tenantId: $tenantId) {\n      id\n      name\n      color\n      description\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  query CliLabelList($tenantId: ID!) {\n    threadLabels(tenantId: $tenantId) {\n      id\n      name\n      color\n      description\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliLabelCreate($input: CreateThreadLabelInput!) {\n    createThreadLabel(input: $input) {\n      id\n      name\n      color\n      description\n    }\n  }\n"): (typeof documents)["\n  mutation CliLabelCreate($input: CreateThreadLabelInput!) {\n    createThreadLabel(input: $input) {\n      id\n      name\n      color\n      description\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliLabelUpdate($id: ID!, $input: UpdateThreadLabelInput!) {\n    updateThreadLabel(id: $id, input: $input) {\n      id\n      name\n      color\n      description\n    }\n  }\n"): (typeof documents)["\n  mutation CliLabelUpdate($id: ID!, $input: UpdateThreadLabelInput!) {\n    updateThreadLabel(id: $id, input: $input) {\n      id\n      name\n      color\n      description\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliLabelDelete($id: ID!) {\n    deleteThreadLabel(id: $id)\n  }\n"): (typeof documents)["\n  mutation CliLabelDelete($id: ID!) {\n    deleteThreadLabel(id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliLabelTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n"): (typeof documents)["\n  query CliLabelTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliMe {\n    me {\n      id\n      email\n      name\n      tenantId\n    }\n  }\n"): (typeof documents)["\n  query CliMe {\n    me {\n      id\n      email\n      name\n      tenantId\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliTenantMembers($tenantId: ID!) {\n    tenantMembers(tenantId: $tenantId) {\n      id\n      tenantId\n      principalType\n      principalId\n      role\n      status\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  query CliTenantMembers($tenantId: ID!) {\n    tenantMembers(tenantId: $tenantId) {\n      id\n      tenantId\n      principalType\n      principalId\n      role\n      status\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliInviteMember($tenantId: ID!, $input: InviteMemberInput!) {\n    inviteMember(tenantId: $tenantId, input: $input) {\n      id\n      principalId\n      role\n      status\n    }\n  }\n"): (typeof documents)["\n  mutation CliInviteMember($tenantId: ID!, $input: InviteMemberInput!) {\n    inviteMember(tenantId: $tenantId, input: $input) {\n      id\n      principalId\n      role\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliUpdateTenantMember($id: ID!, $input: UpdateTenantMemberInput!) {\n    updateTenantMember(id: $id, input: $input) {\n      id\n      role\n      status\n    }\n  }\n"): (typeof documents)["\n  mutation CliUpdateTenantMember($id: ID!, $input: UpdateTenantMemberInput!) {\n    updateTenantMember(id: $id, input: $input) {\n      id\n      role\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliRemoveTenantMember($id: ID!) {\n    removeTenantMember(id: $id)\n  }\n"): (typeof documents)["\n  mutation CliRemoveTenantMember($id: ID!) {\n    removeTenantMember(id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliMemberTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n"): (typeof documents)["\n  query CliMemberTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliMemoryRecords($tenantId: ID, $assistantId: ID, $namespace: String!) {\n    memoryRecords(tenantId: $tenantId, assistantId: $assistantId, namespace: $namespace) {\n      memoryRecordId\n      namespace\n      content {\n        text\n      }\n      strategy\n      createdAt\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  query CliMemoryRecords($tenantId: ID, $assistantId: ID, $namespace: String!) {\n    memoryRecords(tenantId: $tenantId, assistantId: $assistantId, namespace: $namespace) {\n      memoryRecordId\n      namespace\n      content {\n        text\n      }\n      strategy\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliMemorySearch($tenantId: ID, $assistantId: ID, $query: String!, $strategy: MemoryStrategy, $limit: Int) {\n    memorySearch(tenantId: $tenantId, assistantId: $assistantId, query: $query, strategy: $strategy, limit: $limit) {\n      records {\n        memoryRecordId\n        namespace\n        content {\n          text\n        }\n        score\n      }\n    }\n  }\n"): (typeof documents)["\n  query CliMemorySearch($tenantId: ID, $assistantId: ID, $query: String!, $strategy: MemoryStrategy, $limit: Int) {\n    memorySearch(tenantId: $tenantId, assistantId: $assistantId, query: $query, strategy: $strategy, limit: $limit) {\n      records {\n        memoryRecordId\n        namespace\n        content {\n          text\n        }\n        score\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliMemoryGraph($tenantId: ID, $assistantId: ID) {\n    memoryGraph(tenantId: $tenantId, assistantId: $assistantId) {\n      nodes { id label type }\n      edges { source target type }\n    }\n  }\n"): (typeof documents)["\n  query CliMemoryGraph($tenantId: ID, $assistantId: ID) {\n    memoryGraph(tenantId: $tenantId, assistantId: $assistantId) {\n      nodes { id label type }\n      edges { source target type }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliUpdateMemoryRecord($tenantId: ID, $assistantId: ID, $memoryRecordId: ID!, $content: String!) {\n    updateMemoryRecord(tenantId: $tenantId, assistantId: $assistantId, memoryRecordId: $memoryRecordId, content: $content)\n  }\n"): (typeof documents)["\n  mutation CliUpdateMemoryRecord($tenantId: ID, $assistantId: ID, $memoryRecordId: ID!, $content: String!) {\n    updateMemoryRecord(tenantId: $tenantId, assistantId: $assistantId, memoryRecordId: $memoryRecordId, content: $content)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliDeleteMemoryRecord($tenantId: ID, $assistantId: ID, $memoryRecordId: ID!) {\n    deleteMemoryRecord(tenantId: $tenantId, assistantId: $assistantId, memoryRecordId: $memoryRecordId)\n  }\n"): (typeof documents)["\n  mutation CliDeleteMemoryRecord($tenantId: ID, $assistantId: ID, $memoryRecordId: ID!) {\n    deleteMemoryRecord(tenantId: $tenantId, assistantId: $assistantId, memoryRecordId: $memoryRecordId)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliMemoryTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n"): (typeof documents)["\n  query CliMemoryTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliMsgSendMessage($input: SendMessageInput!) {\n    sendMessage(input: $input) {\n      id\n      threadId\n      role\n      content\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  mutation CliMsgSendMessage($input: SendMessageInput!) {\n    sendMessage(input: $input) {\n      id\n      threadId\n      role\n      content\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliMsgMessages($threadId: ID!, $limit: Int, $cursor: String) {\n    messages(threadId: $threadId, limit: $limit, cursor: $cursor) {\n      edges {\n        cursor\n        node {\n          id\n          role\n          senderType\n          senderId\n          content\n          tokenCount\n          createdAt\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n"): (typeof documents)["\n  query CliMsgMessages($threadId: ID!, $limit: Int, $cursor: String) {\n    messages(threadId: $threadId, limit: $limit, cursor: $cursor) {\n      edges {\n        cursor\n        node {\n          id\n          role\n          senderType\n          senderId\n          content\n          tokenCount\n          createdAt\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliAgentPerformance($tenantId: ID!, $from: AWSDateTime, $to: AWSDateTime) {\n    agentPerformance(tenantId: $tenantId, from: $from, to: $to) {\n      agentId\n      agentName\n      invocationCount\n      errorCount\n      avgDurationMs\n      p95DurationMs\n      totalInputTokens\n      totalOutputTokens\n      totalCostUsd\n    }\n  }\n"): (typeof documents)["\n  query CliAgentPerformance($tenantId: ID!, $from: AWSDateTime, $to: AWSDateTime) {\n    agentPerformance(tenantId: $tenantId, from: $from, to: $to) {\n      agentId\n      agentName\n      invocationCount\n      errorCount\n      avgDurationMs\n      p95DurationMs\n      totalInputTokens\n      totalOutputTokens\n      totalCostUsd\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliSingleAgentPerformance($agentId: ID!, $tenantId: ID!) {\n    singleAgentPerformance(agentId: $agentId, tenantId: $tenantId) {\n      agentId\n      agentName\n      invocationCount\n      errorCount\n      avgDurationMs\n      p95DurationMs\n      totalInputTokens\n      totalOutputTokens\n      totalCostUsd\n    }\n  }\n"): (typeof documents)["\n  query CliSingleAgentPerformance($agentId: ID!, $tenantId: ID!) {\n    singleAgentPerformance(agentId: $agentId, tenantId: $tenantId) {\n      agentId\n      agentName\n      invocationCount\n      errorCount\n      avgDurationMs\n      p95DurationMs\n      totalInputTokens\n      totalOutputTokens\n      totalCostUsd\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliRecipes($tenantId: ID!, $threadId: ID, $agentId: ID, $limit: Int, $cursor: String) {\n    recipes(tenantId: $tenantId, threadId: $threadId, agentId: $agentId, limit: $limit, cursor: $cursor) {\n      id\n      title\n      server\n      tool\n      genuiType\n      agentId\n      threadId\n      lastRefreshed\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  query CliRecipes($tenantId: ID!, $threadId: ID, $agentId: ID, $limit: Int, $cursor: String) {\n    recipes(tenantId: $tenantId, threadId: $threadId, agentId: $agentId, limit: $limit, cursor: $cursor) {\n      id\n      title\n      server\n      tool\n      genuiType\n      agentId\n      threadId\n      lastRefreshed\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliRecipe($id: ID!) {\n    recipe(id: $id) {\n      id\n      title\n      summary\n      server\n      tool\n      params\n      genuiType\n      templates\n      cachedResult\n      lastRefreshed\n      lastError\n      agentId\n      threadId\n      sourceMessageId\n      createdAt\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  query CliRecipe($id: ID!) {\n    recipe(id: $id) {\n      id\n      title\n      summary\n      server\n      tool\n      params\n      genuiType\n      templates\n      cachedResult\n      lastRefreshed\n      lastError\n      agentId\n      threadId\n      sourceMessageId\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliCreateRecipe($input: CreateRecipeInput!) {\n    createRecipe(input: $input) {\n      id\n      title\n      server\n      tool\n    }\n  }\n"): (typeof documents)["\n  mutation CliCreateRecipe($input: CreateRecipeInput!) {\n    createRecipe(input: $input) {\n      id\n      title\n      server\n      tool\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliUpdateRecipe($id: ID!, $input: UpdateRecipeInput!) {\n    updateRecipe(id: $id, input: $input) {\n      id\n      title\n    }\n  }\n"): (typeof documents)["\n  mutation CliUpdateRecipe($id: ID!, $input: UpdateRecipeInput!) {\n    updateRecipe(id: $id, input: $input) {\n      id\n      title\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliDeleteRecipe($id: ID!) {\n    deleteRecipe(id: $id)\n  }\n"): (typeof documents)["\n  mutation CliDeleteRecipe($id: ID!) {\n    deleteRecipe(id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliRecipeTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n"): (typeof documents)["\n  query CliRecipeTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliRoutines($tenantId: ID!, $teamId: ID, $agentId: ID, $status: RoutineStatus) {\n    routines(tenantId: $tenantId, teamId: $teamId, agentId: $agentId, status: $status) {\n      id\n      name\n      type\n      status\n      engine\n      schedule\n      agentId\n      teamId\n      lastRunAt\n      nextRunAt\n    }\n  }\n"): (typeof documents)["\n  query CliRoutines($tenantId: ID!, $teamId: ID, $agentId: ID, $status: RoutineStatus) {\n    routines(tenantId: $tenantId, teamId: $teamId, agentId: $agentId, status: $status) {\n      id\n      name\n      type\n      status\n      engine\n      schedule\n      agentId\n      teamId\n      lastRunAt\n      nextRunAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliRoutine($id: ID!) {\n    routine(id: $id) {\n      id\n      name\n      description\n      type\n      status\n      engine\n      schedule\n      agentId\n      teamId\n      visibility\n      owningAgentId\n      currentVersion\n      lastRunAt\n      nextRunAt\n      createdAt\n      updatedAt\n      triggers {\n        id\n        triggerType\n        enabled\n        config\n      }\n    }\n  }\n"): (typeof documents)["\n  query CliRoutine($id: ID!) {\n    routine(id: $id) {\n      id\n      name\n      description\n      type\n      status\n      engine\n      schedule\n      agentId\n      teamId\n      visibility\n      owningAgentId\n      currentVersion\n      lastRunAt\n      nextRunAt\n      createdAt\n      updatedAt\n      triggers {\n        id\n        triggerType\n        enabled\n        config\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliCreateRoutine($input: CreateRoutineInput!) {\n    createRoutine(input: $input) {\n      id\n      name\n      type\n      status\n    }\n  }\n"): (typeof documents)["\n  mutation CliCreateRoutine($input: CreateRoutineInput!) {\n    createRoutine(input: $input) {\n      id\n      name\n      type\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliUpdateRoutine($id: ID!, $input: UpdateRoutineInput!) {\n    updateRoutine(id: $id, input: $input) {\n      id\n      name\n      status\n    }\n  }\n"): (typeof documents)["\n  mutation CliUpdateRoutine($id: ID!, $input: UpdateRoutineInput!) {\n    updateRoutine(id: $id, input: $input) {\n      id\n      name\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliDeleteRoutine($id: ID!) {\n    deleteRoutine(id: $id)\n  }\n"): (typeof documents)["\n  mutation CliDeleteRoutine($id: ID!) {\n    deleteRoutine(id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliTriggerRoutineRun($routineId: ID!, $input: AWSJSON) {\n    triggerRoutineRun(routineId: $routineId, input: $input) {\n      id\n      status\n      startedAt\n    }\n  }\n"): (typeof documents)["\n  mutation CliTriggerRoutineRun($routineId: ID!, $input: AWSJSON) {\n    triggerRoutineRun(routineId: $routineId, input: $input) {\n      id\n      status\n      startedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliRoutineExecutions($routineId: ID!, $status: RoutineExecutionStatus, $limit: Int, $cursor: String) {\n    routineExecutions(routineId: $routineId, status: $status, limit: $limit, cursor: $cursor) {\n      id\n      status\n      startedAt\n      finishedAt\n      errorMessage\n    }\n  }\n"): (typeof documents)["\n  query CliRoutineExecutions($routineId: ID!, $status: RoutineExecutionStatus, $limit: Int, $cursor: String) {\n    routineExecutions(routineId: $routineId, status: $status, limit: $limit, cursor: $cursor) {\n      id\n      status\n      startedAt\n      finishedAt\n      errorMessage\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliRoutineExecution($id: ID!) {\n    routineExecution(id: $id) {\n      id\n      routineId\n      status\n      startedAt\n      finishedAt\n      errorMessage\n      inputJson\n      outputJson\n    }\n  }\n"): (typeof documents)["\n  query CliRoutineExecution($id: ID!) {\n    routineExecution(id: $id) {\n      id\n      routineId\n      status\n      startedAt\n      finishedAt\n      errorMessage\n      inputJson\n      outputJson\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliSetRoutineTrigger($routineId: ID!, $input: RoutineTriggerInput!) {\n    setRoutineTrigger(routineId: $routineId, input: $input) {\n      id\n      triggerType\n      enabled\n    }\n  }\n"): (typeof documents)["\n  mutation CliSetRoutineTrigger($routineId: ID!, $input: RoutineTriggerInput!) {\n    setRoutineTrigger(routineId: $routineId, input: $input) {\n      id\n      triggerType\n      enabled\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliDeleteRoutineTrigger($id: ID!) {\n    deleteRoutineTrigger(id: $id)\n  }\n"): (typeof documents)["\n  mutation CliDeleteRoutineTrigger($id: ID!) {\n    deleteRoutineTrigger(id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliRoutineTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n"): (typeof documents)["\n  query CliRoutineTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliScheduledJobs(\n    $tenantId: ID!\n    $agentId: ID\n    $routineId: ID\n    $triggerType: String\n    $enabled: Boolean\n    $limit: Int\n  ) {\n    scheduledJobs(\n      tenantId: $tenantId\n      agentId: $agentId\n      routineId: $routineId\n      triggerType: $triggerType\n      enabled: $enabled\n      limit: $limit\n    ) {\n      id\n      name\n      description\n      triggerType\n      agentId\n      routineId\n      scheduleType\n      scheduleExpression\n      timezone\n      enabled\n      lastRunAt\n      nextRunAt\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  query CliScheduledJobs(\n    $tenantId: ID!\n    $agentId: ID\n    $routineId: ID\n    $triggerType: String\n    $enabled: Boolean\n    $limit: Int\n  ) {\n    scheduledJobs(\n      tenantId: $tenantId\n      agentId: $agentId\n      routineId: $routineId\n      triggerType: $triggerType\n      enabled: $enabled\n      limit: $limit\n    ) {\n      id\n      name\n      description\n      triggerType\n      agentId\n      routineId\n      scheduleType\n      scheduleExpression\n      timezone\n      enabled\n      lastRunAt\n      nextRunAt\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliScheduledJob($id: ID!) {\n    scheduledJob(id: $id) {\n      id\n      name\n      description\n      triggerType\n      agentId\n      routineId\n      prompt\n      scheduleType\n      scheduleExpression\n      timezone\n      enabled\n      ebScheduleName\n      lastRunAt\n      nextRunAt\n      createdAt\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  query CliScheduledJob($id: ID!) {\n    scheduledJob(id: $id) {\n      id\n      name\n      description\n      triggerType\n      agentId\n      routineId\n      prompt\n      scheduleType\n      scheduleExpression\n      timezone\n      enabled\n      ebScheduleName\n      lastRunAt\n      nextRunAt\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliCreateScheduledJob($input: CreateScheduledJobInput!) {\n    createScheduledJob(input: $input) {\n      id\n      name\n      enabled\n      scheduleExpression\n      timezone\n    }\n  }\n"): (typeof documents)["\n  mutation CliCreateScheduledJob($input: CreateScheduledJobInput!) {\n    createScheduledJob(input: $input) {\n      id\n      name\n      enabled\n      scheduleExpression\n      timezone\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliDeleteScheduledJob($id: ID!) {\n    deleteScheduledJob(id: $id) {\n      id\n      ok\n    }\n  }\n"): (typeof documents)["\n  mutation CliDeleteScheduledJob($id: ID!) {\n    deleteScheduledJob(id: $id) {\n      id\n      ok\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliRunScheduledJob($id: ID!) {\n    runScheduledJob(id: $id) {\n      id\n      dispatched\n      statusCode\n      errorMessage\n    }\n  }\n"): (typeof documents)["\n  mutation CliRunScheduledJob($id: ID!) {\n    runScheduledJob(id: $id) {\n      id\n      dispatched\n      statusCode\n      errorMessage\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliUpdateScheduledJob($id: ID!, $input: UpdateScheduledJobInput!) {\n    updateScheduledJob(id: $id, input: $input) {\n      id\n      name\n      enabled\n      scheduleType\n      scheduleExpression\n      timezone\n      nextRunAt\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  mutation CliUpdateScheduledJob($id: ID!, $input: UpdateScheduledJobInput!) {\n    updateScheduledJob(id: $id, input: $input) {\n      id\n      name\n      enabled\n      scheduleType\n      scheduleExpression\n      timezone\n      nextRunAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliSchedJobTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n"): (typeof documents)["\n  query CliSchedJobTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliSkillCatalog {\n    skillCatalog {\n      id\n      skillId\n      displayName\n      description\n      category\n      icon\n      source\n      enabled\n    }\n  }\n"): (typeof documents)["\n  query CliSkillCatalog {\n    skillCatalog {\n      id\n      skillId\n      displayName\n      description\n      category\n      icon\n      source\n      enabled\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliSkillTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n"): (typeof documents)["\n  query CliSkillTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliInstallSkill($input: InstallSkillInput!) {\n    installSkill(input: $input) {\n      id\n      tenantId\n      skillId\n      source\n      version\n      catalogVersion\n      enabled\n      installedAt\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  mutation CliInstallSkill($input: InstallSkillInput!) {\n    installSkill(input: $input) {\n      id\n      tenantId\n      skillId\n      source\n      version\n      catalogVersion\n      enabled\n      installedAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliUninstallSkill($tenantId: ID!, $skillId: String!) {\n    uninstallSkill(tenantId: $tenantId, skillId: $skillId)\n  }\n"): (typeof documents)["\n  mutation CliUninstallSkill($tenantId: ID!, $skillId: String!) {\n    uninstallSkill(tenantId: $tenantId, skillId: $skillId)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliTeams($tenantId: ID!) {\n    teams(tenantId: $tenantId) {\n      id\n      name\n      slug\n      type\n      status\n      budgetMonthlyCents\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  query CliTeams($tenantId: ID!) {\n    teams(tenantId: $tenantId) {\n      id\n      name\n      slug\n      type\n      status\n      budgetMonthlyCents\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliTeam($id: ID!) {\n    team(id: $id) {\n      id\n      name\n      slug\n      description\n      type\n      status\n      budgetMonthlyCents\n      createdAt\n      updatedAt\n      agents {\n        id\n        agentId\n        role\n        joinedAt\n      }\n      users {\n        id\n        userId\n        role\n        joinedAt\n      }\n    }\n  }\n"): (typeof documents)["\n  query CliTeam($id: ID!) {\n    team(id: $id) {\n      id\n      name\n      slug\n      description\n      type\n      status\n      budgetMonthlyCents\n      createdAt\n      updatedAt\n      agents {\n        id\n        agentId\n        role\n        joinedAt\n      }\n      users {\n        id\n        userId\n        role\n        joinedAt\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliCreateTeam($input: CreateTeamInput!) {\n    createTeam(input: $input) {\n      id\n      name\n      type\n      status\n    }\n  }\n"): (typeof documents)["\n  mutation CliCreateTeam($input: CreateTeamInput!) {\n    createTeam(input: $input) {\n      id\n      name\n      type\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliUpdateTeam($id: ID!, $input: UpdateTeamInput!) {\n    updateTeam(id: $id, input: $input) {\n      id\n      name\n      type\n      status\n      budgetMonthlyCents\n    }\n  }\n"): (typeof documents)["\n  mutation CliUpdateTeam($id: ID!, $input: UpdateTeamInput!) {\n    updateTeam(id: $id, input: $input) {\n      id\n      name\n      type\n      status\n      budgetMonthlyCents\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliDeleteTeam($id: ID!) {\n    deleteTeam(id: $id)\n  }\n"): (typeof documents)["\n  mutation CliDeleteTeam($id: ID!) {\n    deleteTeam(id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliAddTeamAgent($teamId: ID!, $input: AddTeamAgentInput!) {\n    addTeamAgent(teamId: $teamId, input: $input) {\n      id\n      agentId\n      role\n    }\n  }\n"): (typeof documents)["\n  mutation CliAddTeamAgent($teamId: ID!, $input: AddTeamAgentInput!) {\n    addTeamAgent(teamId: $teamId, input: $input) {\n      id\n      agentId\n      role\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliRemoveTeamAgent($teamId: ID!, $agentId: ID!) {\n    removeTeamAgent(teamId: $teamId, agentId: $agentId)\n  }\n"): (typeof documents)["\n  mutation CliRemoveTeamAgent($teamId: ID!, $agentId: ID!) {\n    removeTeamAgent(teamId: $teamId, agentId: $agentId)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliAddTeamUser($teamId: ID!, $input: AddTeamUserInput!) {\n    addTeamUser(teamId: $teamId, input: $input) {\n      id\n      userId\n      role\n    }\n  }\n"): (typeof documents)["\n  mutation CliAddTeamUser($teamId: ID!, $input: AddTeamUserInput!) {\n    addTeamUser(teamId: $teamId, input: $input) {\n      id\n      userId\n      role\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliRemoveTeamUser($teamId: ID!, $userId: ID!) {\n    removeTeamUser(teamId: $teamId, userId: $userId)\n  }\n"): (typeof documents)["\n  mutation CliRemoveTeamUser($teamId: ID!, $userId: ID!) {\n    removeTeamUser(teamId: $teamId, userId: $userId)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliTeamTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n    }\n  }\n"): (typeof documents)["\n  query CliTeamTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliCreateTenant($input: CreateTenantInput!) {\n    createTenant(input: $input) {\n      id\n      name\n      slug\n      plan\n      issuePrefix\n    }\n  }\n"): (typeof documents)["\n  mutation CliCreateTenant($input: CreateTenantInput!) {\n    createTenant(input: $input) {\n      id\n      name\n      slug\n      plan\n      issuePrefix\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliUpdateTenant($id: ID!, $input: UpdateTenantInput!) {\n    updateTenant(id: $id, input: $input) {\n      id\n      name\n      slug\n      plan\n      issuePrefix\n    }\n  }\n"): (typeof documents)["\n  mutation CliUpdateTenant($id: ID!, $input: UpdateTenantInput!) {\n    updateTenant(id: $id, input: $input) {\n      id\n      name\n      slug\n      plan\n      issuePrefix\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliTenantSettings($id: ID!) {\n    tenant(id: $id) {\n      id\n      name\n      slug\n      settings {\n        id\n        defaultModel\n        budgetMonthlyCents\n        autoCloseThreadMinutes\n        maxAgents\n        features\n      }\n    }\n  }\n"): (typeof documents)["\n  query CliTenantSettings($id: ID!) {\n    tenant(id: $id) {\n      id\n      name\n      slug\n      settings {\n        id\n        defaultModel\n        budgetMonthlyCents\n        autoCloseThreadMinutes\n        maxAgents\n        features\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliUpdateTenantSettings(\n    $tenantId: ID!\n    $input: UpdateTenantSettingsInput!\n  ) {\n    updateTenantSettings(tenantId: $tenantId, input: $input) {\n      id\n      defaultModel\n      budgetMonthlyCents\n      autoCloseThreadMinutes\n      maxAgents\n      features\n    }\n  }\n"): (typeof documents)["\n  mutation CliUpdateTenantSettings(\n    $tenantId: ID!\n    $input: UpdateTenantSettingsInput!\n  ) {\n    updateTenantSettings(tenantId: $tenantId, input: $input) {\n      id\n      defaultModel\n      budgetMonthlyCents\n      autoCloseThreadMinutes\n      maxAgents\n      features\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliTenantBySlugForCmd($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n    }\n  }\n"): (typeof documents)["\n  query CliTenantBySlugForCmd($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliThreads(\n    $tenantId: ID!\n    $status: ThreadStatus\n    $channel: ThreadChannel\n    $agentId: ID\n    $assigneeId: ID\n    $search: String\n    $limit: Int\n  ) {\n    threads(\n      tenantId: $tenantId\n      status: $status\n      channel: $channel\n      agentId: $agentId\n      assigneeId: $assigneeId\n      search: $search\n      limit: $limit\n    ) {\n      id\n      number\n      title\n      status\n      channel\n      assigneeType\n      assigneeId\n      agentId\n      lastActivityAt\n      archivedAt\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  query CliThreads(\n    $tenantId: ID!\n    $status: ThreadStatus\n    $channel: ThreadChannel\n    $agentId: ID\n    $assigneeId: ID\n    $search: String\n    $limit: Int\n  ) {\n    threads(\n      tenantId: $tenantId\n      status: $status\n      channel: $channel\n      agentId: $agentId\n      assigneeId: $assigneeId\n      search: $search\n      limit: $limit\n    ) {\n      id\n      number\n      title\n      status\n      channel\n      assigneeType\n      assigneeId\n      agentId\n      lastActivityAt\n      archivedAt\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliThreadById($id: ID!) {\n    thread(id: $id) {\n      id\n      number\n      identifier\n      title\n      status\n      channel\n      assigneeType\n      assigneeId\n      agentId\n      reporterId\n      billingCode\n      labels\n      dueAt\n      startedAt\n      completedAt\n      archivedAt\n      lastActivityAt\n      lastResponsePreview\n      createdAt\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  query CliThreadById($id: ID!) {\n    thread(id: $id) {\n      id\n      number\n      identifier\n      title\n      status\n      channel\n      assigneeType\n      assigneeId\n      agentId\n      reporterId\n      billingCode\n      labels\n      dueAt\n      startedAt\n      completedAt\n      archivedAt\n      lastActivityAt\n      lastResponsePreview\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliThreadByNumber($tenantId: ID!, $number: Int!) {\n    threadByNumber(tenantId: $tenantId, number: $number) {\n      id\n      number\n      identifier\n      title\n      status\n      channel\n      assigneeType\n      assigneeId\n      agentId\n      reporterId\n      billingCode\n      labels\n      dueAt\n      startedAt\n      completedAt\n      archivedAt\n      lastActivityAt\n      lastResponsePreview\n      createdAt\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  query CliThreadByNumber($tenantId: ID!, $number: Int!) {\n    threadByNumber(tenantId: $tenantId, number: $number) {\n      id\n      number\n      identifier\n      title\n      status\n      channel\n      assigneeType\n      assigneeId\n      agentId\n      reporterId\n      billingCode\n      labels\n      dueAt\n      startedAt\n      completedAt\n      archivedAt\n      lastActivityAt\n      lastResponsePreview\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliThreadLabelsForResolve($tenantId: ID!) {\n    threadLabels(tenantId: $tenantId) {\n      id\n      name\n      color\n    }\n  }\n"): (typeof documents)["\n  query CliThreadLabelsForResolve($tenantId: ID!) {\n    threadLabels(tenantId: $tenantId) {\n      id\n      name\n      color\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliCreateThread($input: CreateThreadInput!) {\n    createThread(input: $input) {\n      id\n      number\n      title\n      status\n    }\n  }\n"): (typeof documents)["\n  mutation CliCreateThread($input: CreateThreadInput!) {\n    createThread(input: $input) {\n      id\n      number\n      title\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliUpdateThread($id: ID!, $input: UpdateThreadInput!) {\n    updateThread(id: $id, input: $input) {\n      id\n      number\n      title\n      status\n      assigneeType\n      assigneeId\n      dueAt\n      archivedAt\n    }\n  }\n"): (typeof documents)["\n  mutation CliUpdateThread($id: ID!, $input: UpdateThreadInput!) {\n    updateThread(id: $id, input: $input) {\n      id\n      number\n      title\n      status\n      assigneeType\n      assigneeId\n      dueAt\n      archivedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliDeleteThread($id: ID!) {\n    deleteThread(id: $id)\n  }\n"): (typeof documents)["\n  mutation CliDeleteThread($id: ID!) {\n    deleteThread(id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliCheckoutThread($id: ID!, $input: CheckoutThreadInput!) {\n    checkoutThread(id: $id, input: $input) {\n      id\n      status\n      checkoutRunId\n      checkoutVersion\n    }\n  }\n"): (typeof documents)["\n  mutation CliCheckoutThread($id: ID!, $input: CheckoutThreadInput!) {\n    checkoutThread(id: $id, input: $input) {\n      id\n      status\n      checkoutRunId\n      checkoutVersion\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliReleaseThread($id: ID!, $input: ReleaseThreadInput!) {\n    releaseThread(id: $id, input: $input) {\n      id\n      status\n      checkoutRunId\n    }\n  }\n"): (typeof documents)["\n  mutation CliReleaseThread($id: ID!, $input: ReleaseThreadInput!) {\n    releaseThread(id: $id, input: $input) {\n      id\n      status\n      checkoutRunId\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliAssignThreadLabel($threadId: ID!, $labelId: ID!) {\n    assignThreadLabel(threadId: $threadId, labelId: $labelId) {\n      id\n      threadId\n      labelId\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  mutation CliAssignThreadLabel($threadId: ID!, $labelId: ID!) {\n    assignThreadLabel(threadId: $threadId, labelId: $labelId) {\n      id\n      threadId\n      labelId\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliRemoveThreadLabel($threadId: ID!, $labelId: ID!) {\n    removeThreadLabel(threadId: $threadId, labelId: $labelId)\n  }\n"): (typeof documents)["\n  mutation CliRemoveThreadLabel($threadId: ID!, $labelId: ID!) {\n    removeThreadLabel(threadId: $threadId, labelId: $labelId)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliEscalateThread($input: EscalateThreadInput!) {\n    escalateThread(input: $input) {\n      id\n      status\n      assigneeType\n      assigneeId\n    }\n  }\n"): (typeof documents)["\n  mutation CliEscalateThread($input: EscalateThreadInput!) {\n    escalateThread(input: $input) {\n      id\n      status\n      assigneeType\n      assigneeId\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliDelegateThread($input: DelegateThreadInput!) {\n    delegateThread(input: $input) {\n      id\n      status\n      assigneeType\n      assigneeId\n    }\n  }\n"): (typeof documents)["\n  mutation CliDelegateThread($input: DelegateThreadInput!) {\n    delegateThread(input: $input) {\n      id\n      status\n      assigneeType\n      assigneeId\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliSendMessage($input: SendMessageInput!) {\n    sendMessage(input: $input) {\n      id\n      threadId\n      role\n      content\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  mutation CliSendMessage($input: SendMessageInput!) {\n    sendMessage(input: $input) {\n      id\n      threadId\n      role\n      content\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliThreadTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n"): (typeof documents)["\n  query CliThreadTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliThreadTraces($threadId: ID!, $tenantId: ID!) {\n    threadTraces(threadId: $threadId, tenantId: $tenantId) {\n      traceId\n      threadId\n      agentId\n      agentName\n      model\n      inputTokens\n      outputTokens\n      durationMs\n      costUsd\n      estimated\n    }\n  }\n"): (typeof documents)["\n  query CliThreadTraces($threadId: ID!, $tenantId: ID!) {\n    threadTraces(threadId: $threadId, tenantId: $tenantId) {\n      traceId\n      threadId\n      agentId\n      agentName\n      model\n      inputTokens\n      outputTokens\n      durationMs\n      costUsd\n      estimated\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliTurnInvocationLogs($tenantId: ID!, $turnId: ID!) {\n    turnInvocationLogs(tenantId: $tenantId, turnId: $turnId) {\n      requestId\n      modelId\n      timestamp\n      inputTokenCount\n      outputTokenCount\n      cacheReadTokenCount\n      toolCount\n      costUsd\n    }\n  }\n"): (typeof documents)["\n  query CliTurnInvocationLogs($tenantId: ID!, $turnId: ID!) {\n    turnInvocationLogs(tenantId: $tenantId, turnId: $turnId) {\n      requestId\n      modelId\n      timestamp\n      inputTokenCount\n      outputTokenCount\n      cacheReadTokenCount\n      toolCount\n      costUsd\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliThreadTurns(\n    $tenantId: ID!\n    $agentId: ID\n    $routineId: ID\n    $triggerId: ID\n    $threadId: ID\n    $status: String\n    $limit: Int\n  ) {\n    threadTurns(\n      tenantId: $tenantId\n      agentId: $agentId\n      routineId: $routineId\n      triggerId: $triggerId\n      threadId: $threadId\n      status: $status\n      limit: $limit\n    ) {\n      id\n      agentId\n      routineId\n      threadId\n      status\n      invocationSource\n      triggerName\n      startedAt\n      finishedAt\n      totalCost\n      error\n    }\n  }\n"): (typeof documents)["\n  query CliThreadTurns(\n    $tenantId: ID!\n    $agentId: ID\n    $routineId: ID\n    $triggerId: ID\n    $threadId: ID\n    $status: String\n    $limit: Int\n  ) {\n    threadTurns(\n      tenantId: $tenantId\n      agentId: $agentId\n      routineId: $routineId\n      triggerId: $triggerId\n      threadId: $threadId\n      status: $status\n      limit: $limit\n    ) {\n      id\n      agentId\n      routineId\n      threadId\n      status\n      invocationSource\n      triggerName\n      startedAt\n      finishedAt\n      totalCost\n      error\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliThreadTurn($id: ID!) {\n    threadTurn(id: $id) {\n      id\n      tenantId\n      agentId\n      routineId\n      threadId\n      turnNumber\n      status\n      invocationSource\n      triggerName\n      triggerDetail\n      startedAt\n      finishedAt\n      error\n      errorCode\n      totalCost\n      lastActivityAt\n      retryAttempt\n      externalRunId\n      sessionIdBefore\n      sessionIdAfter\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  query CliThreadTurn($id: ID!) {\n    threadTurn(id: $id) {\n      id\n      tenantId\n      agentId\n      routineId\n      threadId\n      turnNumber\n      status\n      invocationSource\n      triggerName\n      triggerDetail\n      startedAt\n      finishedAt\n      error\n      errorCode\n      totalCost\n      lastActivityAt\n      retryAttempt\n      externalRunId\n      sessionIdBefore\n      sessionIdAfter\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliThreadTurnEvents($runId: ID!, $limit: Int) {\n    threadTurnEvents(runId: $runId, limit: $limit) {\n      seq\n      eventType\n      stream\n      level\n      message\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  query CliThreadTurnEvents($runId: ID!, $limit: Int) {\n    threadTurnEvents(runId: $runId, limit: $limit) {\n      seq\n      eventType\n      stream\n      level\n      message\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliCancelThreadTurn($id: ID!) {\n    cancelThreadTurn(id: $id) {\n      id\n      status\n      finishedAt\n    }\n  }\n"): (typeof documents)["\n  mutation CliCancelThreadTurn($id: ID!) {\n    cancelThreadTurn(id: $id) {\n      id\n      status\n      finishedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliTurnTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n"): (typeof documents)["\n  query CliTurnTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliQueuedWakeups($tenantId: ID!) {\n    queuedWakeups(tenantId: $tenantId) {\n      id\n      agentId\n      status\n      source\n      triggerDetail\n      reason\n      coalescedCount\n      requestedAt\n      claimedAt\n    }\n  }\n"): (typeof documents)["\n  query CliQueuedWakeups($tenantId: ID!) {\n    queuedWakeups(tenantId: $tenantId) {\n      id\n      agentId\n      status\n      source\n      triggerDetail\n      reason\n      coalescedCount\n      requestedAt\n      claimedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliCreateWakeup($input: CreateWakeupRequestInput!) {\n    createWakeupRequest(input: $input) {\n      id\n      agentId\n      status\n      requestedAt\n    }\n  }\n"): (typeof documents)["\n  mutation CliCreateWakeup($input: CreateWakeupRequestInput!) {\n    createWakeupRequest(input: $input) {\n      id\n      agentId\n      status\n      requestedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliWakeupTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n"): (typeof documents)["\n  query CliWakeupTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliWebhooks($tenantId: ID!, $targetType: String, $enabled: Boolean, $limit: Int) {\n    webhooks(tenantId: $tenantId, targetType: $targetType, enabled: $enabled, limit: $limit) {\n      id\n      name\n      targetType\n      agentId\n      routineId\n      enabled\n      rateLimit\n      invocationCount\n      lastInvokedAt\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  query CliWebhooks($tenantId: ID!, $targetType: String, $enabled: Boolean, $limit: Int) {\n    webhooks(tenantId: $tenantId, targetType: $targetType, enabled: $enabled, limit: $limit) {\n      id\n      name\n      targetType\n      agentId\n      routineId\n      enabled\n      rateLimit\n      invocationCount\n      lastInvokedAt\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliWebhook($id: ID!) {\n    webhook(id: $id) {\n      id\n      name\n      description\n      token\n      targetType\n      agentId\n      routineId\n      prompt\n      enabled\n      rateLimit\n      invocationCount\n      lastInvokedAt\n      createdAt\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  query CliWebhook($id: ID!) {\n    webhook(id: $id) {\n      id\n      name\n      description\n      token\n      targetType\n      agentId\n      routineId\n      prompt\n      enabled\n      rateLimit\n      invocationCount\n      lastInvokedAt\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliCreateWebhook($input: CreateWebhookInput!) {\n    createWebhook(input: $input) {\n      id\n      name\n      token\n      targetType\n      enabled\n    }\n  }\n"): (typeof documents)["\n  mutation CliCreateWebhook($input: CreateWebhookInput!) {\n    createWebhook(input: $input) {\n      id\n      name\n      token\n      targetType\n      enabled\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliUpdateWebhook($id: ID!, $input: UpdateWebhookInput!) {\n    updateWebhook(id: $id, input: $input) {\n      id\n      name\n      targetType\n      enabled\n      rateLimit\n    }\n  }\n"): (typeof documents)["\n  mutation CliUpdateWebhook($id: ID!, $input: UpdateWebhookInput!) {\n    updateWebhook(id: $id, input: $input) {\n      id\n      name\n      targetType\n      enabled\n      rateLimit\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliDeleteWebhook($id: ID!) {\n    deleteWebhook(id: $id)\n  }\n"): (typeof documents)["\n  mutation CliDeleteWebhook($id: ID!) {\n    deleteWebhook(id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliRegenerateWebhookToken($id: ID!) {\n    regenerateWebhookToken(id: $id) {\n      id\n      token\n    }\n  }\n"): (typeof documents)["\n  mutation CliRegenerateWebhookToken($id: ID!) {\n    regenerateWebhookToken(id: $id) {\n      id\n      token\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliWebhookDeliveries($webhookId: ID!, $limit: Int) {\n    webhookDeliveries(webhookId: $webhookId, limit: $limit) {\n      id\n      providerName\n      providerEventId\n      normalizedKind\n      receivedAt\n      signatureStatus\n      resolutionStatus\n      statusCode\n      durationMs\n      threadId\n      threadCreated\n      retryCount\n      isReplay\n      errorMessage\n    }\n  }\n"): (typeof documents)["\n  query CliWebhookDeliveries($webhookId: ID!, $limit: Int) {\n    webhookDeliveries(webhookId: $webhookId, limit: $limit) {\n      id\n      providerName\n      providerEventId\n      normalizedKind\n      receivedAt\n      signatureStatus\n      resolutionStatus\n      statusCode\n      durationMs\n      threadId\n      threadCreated\n      retryCount\n      isReplay\n      errorMessage\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliTestWebhook($id: ID!) {\n    testWebhook(id: $id) {\n      id\n      webhookId\n      tenantId\n      receivedAt\n      resolutionStatus\n      signatureStatus\n      statusCode\n      bodyPreview\n    }\n  }\n"): (typeof documents)["\n  mutation CliTestWebhook($id: ID!) {\n    testWebhook(id: $id) {\n      id\n      webhookId\n      tenantId\n      receivedAt\n      resolutionStatus\n      signatureStatus\n      statusCode\n      bodyPreview\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliWebhookForTest($id: ID!) {\n    webhook(id: $id) {\n      id\n      token\n    }\n  }\n"): (typeof documents)["\n  query CliWebhookForTest($id: ID!) {\n    webhook(id: $id) {\n      id\n      token\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliWebhookTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n"): (typeof documents)["\n  query CliWebhookTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliWikiTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n"): (typeof documents)["\n  query CliWikiTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliAllTenantAgentsForWiki($tenantId: ID!) {\n    allTenantAgents(tenantId: $tenantId, includeSystem: false, includeSubAgents: false) {\n      id\n      name\n      slug\n      type\n      status\n    }\n  }\n"): (typeof documents)["\n  query CliAllTenantAgentsForWiki($tenantId: ID!) {\n    allTenantAgents(tenantId: $tenantId, includeSystem: false, includeSubAgents: false) {\n      id\n      name\n      slug\n      type\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliCompileWikiNow($tenantId: ID!, $ownerId: ID!, $modelId: String, $forceNew: Boolean) {\n    compileWikiNow(\n      tenantId: $tenantId\n      ownerId: $ownerId\n      modelId: $modelId\n      forceNew: $forceNew\n    ) {\n      id\n      tenantId\n      ownerId\n      status\n      trigger\n      dedupeKey\n      attempt\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  mutation CliCompileWikiNow($tenantId: ID!, $ownerId: ID!, $modelId: String, $forceNew: Boolean) {\n    compileWikiNow(\n      tenantId: $tenantId\n      ownerId: $ownerId\n      modelId: $modelId\n      forceNew: $forceNew\n    ) {\n      id\n      tenantId\n      ownerId\n      status\n      trigger\n      dedupeKey\n      attempt\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliResetWikiCursor(\n    $tenantId: ID!\n    $ownerId: ID!\n    $force: Boolean\n    $dryRun: Boolean\n    $includeBrain: Boolean\n  ) {\n    resetWikiCursor(\n      tenantId: $tenantId\n      ownerId: $ownerId\n      force: $force\n      dryRun: $dryRun\n      includeBrain: $includeBrain\n    ) {\n      tenantId\n      ownerId\n      cursorCleared\n      pagesArchived\n      dryRun\n      brainIncluded\n      impact\n    }\n  }\n"): (typeof documents)["\n  mutation CliResetWikiCursor(\n    $tenantId: ID!\n    $ownerId: ID!\n    $force: Boolean\n    $dryRun: Boolean\n    $includeBrain: Boolean\n  ) {\n    resetWikiCursor(\n      tenantId: $tenantId\n      ownerId: $ownerId\n      force: $force\n      dryRun: $dryRun\n      includeBrain: $includeBrain\n    ) {\n      tenantId\n      ownerId\n      cursorCleared\n      pagesArchived\n      dryRun\n      brainIncluded\n      impact\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliWikiCompileJobs($tenantId: ID!, $ownerId: ID, $limit: Int) {\n    wikiCompileJobs(tenantId: $tenantId, ownerId: $ownerId, limit: $limit) {\n      id\n      tenantId\n      ownerId\n      status\n      trigger\n      dedupeKey\n      attempt\n      claimedAt\n      startedAt\n      finishedAt\n      error\n      metrics\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  query CliWikiCompileJobs($tenantId: ID!, $ownerId: ID, $limit: Int) {\n    wikiCompileJobs(tenantId: $tenantId, ownerId: $ownerId, limit: $limit) {\n      id\n      tenantId\n      ownerId\n      status\n      trigger\n      dedupeKey\n      attempt\n      claimedAt\n      startedAt\n      finishedAt\n      error\n      metrics\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliCmdTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n"): (typeof documents)["\n  query CliCmdTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n    }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;