import { graphql } from "@/gql";

// Typed graphql() operations for the Settings surface. These live separately
// from the legacy untyped `graphql-queries.ts` (which codegen excludes) so the
// settings work gets full type-safety from the generated documents.

// ─── General ────────────────────────────────────────────────────────────

export const SettingsTenantDetailQuery = graphql(`
  query SettingsTenantDetail($id: ID!) {
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
      }
      createdAt
    }
  }
`);

export const SettingsDeploymentStatusQuery = graphql(`
  query SettingsDeploymentStatus {
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
      cogneeEnabled
      cogneeEndpoint
      cogneeLogGroupName
      cogneeBackendMode
      cogneeClusterArn
      cogneeServiceName
      twentyProvisioned
      twentyRuntimeEnabled
      twentyUrl
      twentyClusterArn
      twentyServerServiceName
      twentyWorkerServiceName
      twentyServerLogGroupName
      twentyWorkerLogGroupName
      twentyAlbArn
      twentyTargetGroupArn
      managedApplications {
        key
        displayName
        description
        status
        enabled
        provisioned
        runtimeEnabled
        url
        endpoint
        backendMode
        logGroupName
        logGroupNames
        clusterArn
        serviceName
        serviceNames
        albArn
        targetGroupArn
        storageBucketName
        databaseName
        message
        managedMcpServerId
        managedMcpStatus
        managedMcpInstalled
        managedMcpInstallAvailable
        managedMcpMessage
      }
    }
  }
`);

export const SettingsDeploymentReleasesQuery = graphql(`
  query SettingsDeploymentReleases($limit: Int) {
    deploymentReleases(limit: $limit) {
      version
      name
      prerelease
      draft
      publishedAt
      htmlUrl
      manifestUrl
      manifestSha256
      signatureUrl
      signed
      deployable
    }
  }
`);

export const SettingsStartDeploymentReleaseUpdateMutation = graphql(`
  mutation SettingsStartDeploymentReleaseUpdate(
    $input: StartDeploymentReleaseUpdateInput!
  ) {
    startDeploymentReleaseUpdate(input: $input) {
      executionArn
      stateMachineArn
      evidenceBucket
      evidencePrefix
      message
      release {
        version
        manifestUrl
        manifestSha256
        signed
        deployable
      }
    }
  }
`);

export const SettingsSetKnowledgeGraphDeploymentMutation = graphql(`
  mutation SettingsSetKnowledgeGraphDeployment($enabled: Boolean!) {
    setKnowledgeGraphDeployment(input: { enabled: $enabled }) {
      desiredEnabled
      workflowUrl
      message
    }
  }
`);

export const SettingsSetManagedApplicationDeploymentMutation = graphql(`
  mutation SettingsSetManagedApplicationDeployment(
    $key: String!
    $action: ManagedApplicationDeploymentAction!
  ) {
    setManagedApplicationDeployment(input: { key: $key, action: $action }) {
      key
      action
      desiredEnabled
      provisioned
      runtimeEnabled
      workflowUrl
      message
    }
  }
`);

export const SettingsInstallManagedApplicationMcpServerMutation = graphql(`
  mutation SettingsInstallManagedApplicationMcpServer($key: String!) {
    installManagedApplicationMcpServer(key: $key) {
      key
      serverId
      installed
      status
      message
    }
  }
`);

export const SettingsManagedApplicationsQuery = graphql(`
  query SettingsManagedApplications {
    managedApplications {
      id
      key
      displayName
      desiredStatus
      currentStatus
      selectedReleaseVersion
      selectedManifestDigest
      lastJobId
      updatedAt
    }
  }
`);

export const SettingsManagedApplicationDeploymentQuery = graphql(`
  query SettingsManagedApplicationDeployment($jobId: ID!) {
    managedApplicationDeployment(jobId: $jobId) {
      id
      appKey
      operation
      status
      releaseVersion
      manifestDigest
      desiredConfigVersion
      stateMachineArn
      planExecutionArn
      applyExecutionArn
      codebuildBuildArn
      planDigest
      planSummary
      dataImpact
      evidenceBucket
      evidencePrefix
      approvalRequired
      approvedAt
      rejectedAt
      errorMessage
      createdAt
      updatedAt
      events {
        id
        eventType
        message
        payload
        createdAt
      }
    }
  }
`);

export const SettingsDeploymentEvidenceQuery = graphql(`
  query SettingsDeploymentEvidence($jobId: ID!) {
    deploymentEvidence(jobId: $jobId) {
      jobId
      bucket
      prefix
      urls
    }
  }
`);

export const SettingsStartManagedApplicationPlanMutation = graphql(`
  mutation SettingsStartManagedApplicationPlan(
    $input: StartManagedApplicationPlanInput!
  ) {
    startManagedApplicationPlan(input: $input) {
      id
      appKey
      operation
      status
      releaseVersion
      manifestDigest
      desiredConfigVersion
      stateMachineArn
      planExecutionArn
      applyExecutionArn
      codebuildBuildArn
      planDigest
      planSummary
      dataImpact
      evidenceBucket
      evidencePrefix
      approvalRequired
      approvedAt
      rejectedAt
      errorMessage
      createdAt
      updatedAt
      events {
        id
        eventType
        message
        payload
        createdAt
      }
    }
  }
`);

export const SettingsApproveManagedApplicationDeploymentMutation = graphql(`
  mutation SettingsApproveManagedApplicationDeployment(
    $input: ApproveManagedApplicationDeploymentInput!
  ) {
    approveManagedApplicationDeployment(input: $input) {
      id
      appKey
      operation
      status
      releaseVersion
      manifestDigest
      desiredConfigVersion
      stateMachineArn
      planExecutionArn
      applyExecutionArn
      codebuildBuildArn
      planDigest
      planSummary
      dataImpact
      evidenceBucket
      evidencePrefix
      approvalRequired
      approvedAt
      rejectedAt
      errorMessage
      createdAt
      updatedAt
      events {
        id
        eventType
        message
        payload
        createdAt
      }
    }
  }
`);

export const SettingsRejectManagedApplicationDeploymentMutation = graphql(`
  mutation SettingsRejectManagedApplicationDeployment(
    $input: RejectManagedApplicationDeploymentInput!
  ) {
    rejectManagedApplicationDeployment(input: $input) {
      id
      appKey
      operation
      status
      releaseVersion
      manifestDigest
      desiredConfigVersion
      stateMachineArn
      planExecutionArn
      applyExecutionArn
      codebuildBuildArn
      planDigest
      planSummary
      dataImpact
      evidenceBucket
      evidencePrefix
      approvalRequired
      approvedAt
      rejectedAt
      errorMessage
      createdAt
      updatedAt
      events {
        id
        eventType
        message
        payload
        createdAt
      }
    }
  }
`);

export const SettingsKnowledgeGraphHealthCheckQuery = graphql(`
  query SettingsKnowledgeGraphHealthCheck {
    knowledgeGraphHealthCheck {
      healthy
      statusCode
      latencyMs
      endpoint
      checkedAt
      message
    }
  }
`);

export const SettingsManagedApplicationHealthCheckQuery = graphql(`
  query SettingsManagedApplicationHealthCheck($key: String!) {
    managedApplicationHealthCheck(key: $key) {
      key
      healthy
      statusCode
      latencyMs
      endpoint
      checkedAt
      message
    }
  }
`);

export const SettingsKnowledgeGraphOntologyQuery = graphql(`
  query SettingsKnowledgeGraphOntology($tenantId: ID!) {
    ontologyDefinitions(tenantId: $tenantId) {
      activeVersion {
        id
        versionNumber
        status
        activatedAt
      }
      entityTypes {
        id
        slug
        name
        description
        broadType
        aliases
        lifecycleStatus
        externalMappings {
          id
          mappingKind
          vocabulary
          externalUri
          externalLabel
        }
      }
      relationshipTypes {
        id
        slug
        name
        description
        sourceTypeSlugs
        targetTypeSlugs
        aliases
        lifecycleStatus
        externalMappings {
          id
          mappingKind
          vocabulary
          externalUri
          externalLabel
        }
      }
      externalMappings {
        id
        subjectKind
        subjectId
        mappingKind
        vocabulary
        externalUri
        externalLabel
      }
    }
  }
`);

export const SettingsKnowledgeGraphThreadCandidatesQuery = graphql(`
  query SettingsKnowledgeGraphThreadCandidates(
    $tenantId: ID!
    $query: String
    $limit: Int
  ) {
    knowledgeGraphThreadCandidates(
      tenantId: $tenantId
      query: $query
      limit: $limit
    ) {
      threadId
      tenantId
      title
      number
      requesterUserId
      requesterName
      spaceId
      spaceName
      messageCount
      lastMessageAt
      lastIngestRun {
        id
        threadId
        status
        entityCount
        relationshipCount
        evidenceCount
        diagnosticCount
        messageCount
        metrics
        durationMs
        error
        createdAt
        startedAt
        finishedAt
      }
    }
  }
`);

export const SettingsKnowledgeGraphIngestRunsQuery = graphql(`
  query SettingsKnowledgeGraphIngestRuns(
    $tenantId: ID!
    $threadId: ID
    $limit: Int
  ) {
    knowledgeGraphIngestRuns(
      tenantId: $tenantId
      threadId: $threadId
      limit: $limit
    ) {
      id
      threadId
      status
      trigger
      cogneeDatasetName
      cogneeDatasetId
      entityCount
      relationshipCount
      evidenceCount
      diagnosticCount
      messageCount
      metrics
      durationMs
      error
      createdAt
      updatedAt
      startedAt
      finishedAt
    }
  }
`);

export const SettingsKnowledgeGraphEntitiesQuery = graphql(`
  query SettingsKnowledgeGraphEntities(
    $tenantId: ID!
    $threadId: ID
    $runId: ID
    $search: String
    $ontologyType: String
    $groundingStatus: KnowledgeGraphGroundingStatus
    $provenanceStatus: KnowledgeGraphProvenanceStatus
    $limit: Int
  ) {
    knowledgeGraphEntities(
      tenantId: $tenantId
      threadId: $threadId
      runId: $runId
      search: $search
      ontologyType: $ontologyType
      groundingStatus: $groundingStatus
      provenanceStatus: $provenanceStatus
      limit: $limit
    ) {
      id
      label
      normalizedLabel
      typeLabel
      ontologyTypeSlug
      groundingStatus
      provenanceStatus
      summary
      aliases
      relationshipCount
      evidenceCount
      lastSeenAt
      createdAt
      updatedAt
    }
  }
`);

export const SettingsKnowledgeGraphEntityQuery = graphql(`
  query SettingsKnowledgeGraphEntity($tenantId: ID!, $entityId: ID!) {
    knowledgeGraphEntity(tenantId: $tenantId, entityId: $entityId) {
      id
      label
      normalizedLabel
      typeLabel
      ontologyTypeSlug
      groundingStatus
      provenanceStatus
      summary
      aliases
      properties
      diagnostics
      relationshipCount
      evidenceCount
      lastSeenAt
      relationships {
        id
        sourceEntityId
        targetEntityId
        label
        ontologyTypeSlug
        groundingStatus
        provenanceStatus
        confidence
        evidenceCount
        lastSeenAt
        evidence {
          id
          snippet
          messageId
          messageRole
          messageCreatedAt
          speakerLabel
        }
      }
      evidence {
        id
        snippet
        messageId
        messageRole
        messageCreatedAt
        speakerLabel
      }
    }
  }
`);

export const SettingsStartKnowledgeGraphThreadIngestMutation = graphql(`
  mutation SettingsStartKnowledgeGraphThreadIngest(
    $input: StartKnowledgeGraphThreadIngestInput!
  ) {
    startKnowledgeGraphThreadIngest(input: $input) {
      id
      status
      threadId
      entityCount
      relationshipCount
      evidenceCount
      diagnosticCount
      messageCount
      metrics
      durationMs
      error
      createdAt
      startedAt
      finishedAt
    }
  }
`);

export const SettingsRenameTenantSlugMutation = graphql(`
  mutation SettingsRenameTenantSlug($tenantId: ID!, $newSlug: String!) {
    renameTenantSlug(tenantId: $tenantId, newSlug: $newSlug) {
      id
      slug
      updatedAt
    }
  }
`);

// ─── App Style (operator-only applet theme, ported from admin) ───────────

// Reads the tenant `features` JSON; the App Style section parses
// `features.artifactStyle.appletTheme.css` out of it client-side.
export const SettingsTenantFeaturesQuery = graphql(`
  query SettingsTenantFeatures($id: ID!) {
    tenant(id: $id) {
      id
      settings {
        id
        features
      }
    }
  }
`);

export const SettingsUpdateTenantArtifactStyleMutation = graphql(`
  mutation SettingsUpdateTenantArtifactStyle(
    $tenantId: ID!
    $input: UpdateTenantSettingsInput!
  ) {
    updateTenantSettings(tenantId: $tenantId, input: $input) {
      id
      features
      updatedAt
    }
  }
`);

// ─── Spaces (operator-only section) ──────────────────────────────────────

export const SettingsSpacesListQuery = graphql(`
  query SettingsSpacesList($tenantId: ID!) {
    spaces(tenantId: $tenantId, status: ACTIVE, includeAllForAdmin: true) {
      id
      tenantId
      name
      description
      status
      accessMode
      updatedAt
    }
  }
`);

export const SettingsCreateSpaceMutation = graphql(`
  mutation SettingsCreateSpace($input: CreateSpaceInput!) {
    createSpace(input: $input) {
      id
      tenantId
      name
      description
      status
      accessMode
      updatedAt
    }
  }
`);

export const SettingsSpaceQuery = graphql(`
  query SettingsSpace($id: ID!) {
    space(id: $id) {
      id
      tenantId
      name
      description
      status
      accessMode
      slug
      config
      renderDiagnostics
      toolPolicy
      mcpPolicy
      builtInTools
    }
  }
`);

export const SettingsUpdateSpaceMutation = graphql(`
  mutation SettingsUpdateSpace($input: UpdateSpaceInput!) {
    updateSpace(input: $input) {
      id
      name
      description
      accessMode
    }
  }
`);

// ─── Agent config (operator-only section) ────────────────────────────────

export const SettingsTenantAgentQuery = graphql(`
  query SettingsTenantAgent($tenantId: ID!) {
    agent: tenantAgent(tenantId: $tenantId) {
      id
      tenantId
      name
      runtime
      model
      blockedTools
      sandbox
      browser
      webSearch
      webExtract
      sendEmail
      contextEngine
    }
  }
`);

export const SettingsTenantSandboxStatusQuery = graphql(`
  query SettingsTenantSandboxStatus($id: ID!) {
    tenant(id: $id) {
      id
      sandboxEnabled
      complianceTier
      sandboxInterpreterPublicId
      sandboxInterpreterInternalId
    }
  }
`);

export const SettingsModelCatalogQuery = graphql(`
  query SettingsModelCatalog {
    modelCatalog {
      id
      modelId
      displayName
      provider
    }
  }
`);

export const SettingsTenantModelCatalogQuery = graphql(`
  query SettingsTenantModelCatalog(
    $tenantId: ID!
    $includeDisabled: Boolean = true
  ) {
    tenantModelCatalog(tenantId: $tenantId, includeDisabled: $includeDisabled) {
      tenantId
      modelId
      provider
      displayName
      canonicalDisplayName
      inputCostPerMillion
      outputCostPerMillion
      contextWindow
      maxOutputTokens
      supportsVision
      supportsTools
      enabled
      pricingStatus
      pricingSource
      pricingDiagnostics
      lastPricedAt
      importSource
      importPayload
      importedByUserId
      importedAt
      createdAt
      updatedAt
    }
  }
`);

export const SettingsBedrockModelImportCandidatesQuery = graphql(`
  query SettingsBedrockModelImportCandidates($tenantId: ID!) {
    bedrockModelImportCandidates(tenantId: $tenantId) {
      provider
      providerName
      modelName
      modelId
      displayName
      inputModalities
      outputModalities
      supportsStreaming
      supportsVision
      supportsTools
      customizationsSupported
      inferenceTypesSupported
      lifecycleStatus
      inputCostPerMillion
      outputCostPerMillion
      pricingStatus
      pricingSource
      pricingDiagnostics
      alreadyImported
      enabled
    }
  }
`);

export const SettingsImportTenantBedrockModelsMutation = graphql(`
  mutation SettingsImportTenantBedrockModels(
    $input: ImportTenantBedrockModelsInput!
  ) {
    importTenantBedrockModels(input: $input) {
      tenantId
      modelId
      provider
      displayName
      canonicalDisplayName
      inputCostPerMillion
      outputCostPerMillion
      contextWindow
      maxOutputTokens
      supportsVision
      supportsTools
      enabled
      pricingStatus
      pricingSource
      pricingDiagnostics
      lastPricedAt
      importSource
      importPayload
      importedByUserId
      importedAt
      createdAt
      updatedAt
    }
  }
`);

export const SettingsUpdateTenantModelCatalogEntryMutation = graphql(`
  mutation SettingsUpdateTenantModelCatalogEntry(
    $input: UpdateTenantModelCatalogEntryInput!
  ) {
    updateTenantModelCatalogEntry(input: $input) {
      tenantId
      modelId
      provider
      displayName
      canonicalDisplayName
      inputCostPerMillion
      outputCostPerMillion
      contextWindow
      maxOutputTokens
      supportsVision
      supportsTools
      enabled
      pricingStatus
      pricingSource
      pricingDiagnostics
      lastPricedAt
      importSource
      importPayload
      importedByUserId
      importedAt
      createdAt
      updatedAt
    }
  }
`);

export const SettingsUpdateTenantAgentMutation = graphql(`
  mutation SettingsUpdateTenantAgent(
    $tenantId: ID!
    $input: UpdateTenantAgentInput!
  ) {
    updateTenantAgent(tenantId: $tenantId, input: $input) {
      id
      runtime
      model
      updatedAt
    }
  }
`);

// ─── Agent Profiles (operator-only section) ─────────────────────────────

export const SettingsAgentProfilesQuery = graphql(`
  query SettingsAgentProfiles($tenantId: ID!) {
    agentProfiles(tenantId: $tenantId, includeDisabled: true) {
      id
      tenantId
      slug
      name
      description
      routingGuidance
      instructions
      modelId
      model {
        id
        modelId
        provider
        displayName
        inputCostPerMillion
        outputCostPerMillion
      }
      enabled
      builtInKey
      toolPolicy
      skillPolicy
      executionControls
      spaces {
        id
        name
        slug
      }
      createdAt
      updatedAt
    }
    agentProfileEditorCatalog(tenantId: $tenantId) {
      models {
        id
        modelId
        provider
        displayName
        inputCostPerMillion
        outputCostPerMillion
      }
      spaces {
        id
        name
        slug
      }
      skills {
        slug
        displayName
        description
        category
      }
      builtInTools
      mcpServers {
        id
        name
        slug
        enabled
        status
        tools
      }
    }
  }
`);

export const SettingsCreateAgentProfileMutation = graphql(`
  mutation SettingsCreateAgentProfile(
    $tenantId: ID!
    $input: AgentProfileInput!
  ) {
    createAgentProfile(tenantId: $tenantId, input: $input) {
      id
      slug
      name
      updatedAt
    }
  }
`);

export const SettingsUpdateAgentProfileMutation = graphql(`
  mutation SettingsUpdateAgentProfile(
    $tenantId: ID!
    $id: ID!
    $input: UpdateAgentProfileInput!
  ) {
    updateAgentProfile(tenantId: $tenantId, id: $id, input: $input) {
      id
      slug
      name
      enabled
      updatedAt
    }
  }
`);

export const SettingsDeleteAgentProfileMutation = graphql(`
  mutation SettingsDeleteAgentProfile($tenantId: ID!, $id: ID!) {
    deleteAgentProfile(tenantId: $tenantId, id: $id)
  }
`);

// ─── Users (operator-only section) ───────────────────────────────────────

export const SettingsTenantMembersQuery = graphql(`
  query SettingsTenantMembers($tenantId: ID!) {
    tenantMembers(tenantId: $tenantId) {
      id
      principalType
      principalId
      role
      status
      cognitoStatus
      createdAt
      user {
        id
        name
        email
        profile {
          id
          title
          timezone
          pronouns
          callBy
          notes
        }
      }
    }
  }
`);

export const SettingsUpdateUserMutation = graphql(`
  mutation SettingsUpdateUser($id: ID!, $input: UpdateUserInput!) {
    updateUser(id: $id, input: $input) {
      id
      name
      updatedAt
    }
  }
`);

export const SettingsUpdateUserProfileMutation = graphql(`
  mutation SettingsUpdateUserProfile(
    $userId: ID!
    $input: UpdateUserProfileInput!
  ) {
    updateUserProfile(userId: $userId, input: $input) {
      id
      title
      timezone
      pronouns
      callBy
      notes
      updatedAt
    }
  }
`);

export const SettingsUserBudgetStatusQuery = graphql(`
  query SettingsUserBudgetStatus($tenantId: ID!, $userId: ID!) {
    userBudgetStatus(tenantId: $tenantId, userId: $userId) {
      policy {
        id
        tenantId
        userId
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
`);

export const SettingsUpsertBudgetPolicyMutation = graphql(`
  mutation SettingsUpsertBudgetPolicy(
    $tenantId: ID!
    $input: UpsertBudgetPolicyInput!
  ) {
    upsertBudgetPolicy(tenantId: $tenantId, input: $input) {
      id
      tenantId
      userId
      scope
      period
      limitUsd
      actionOnExceed
      enabled
      updatedAt
    }
  }
`);

export const SettingsDeleteBudgetPolicyMutation = graphql(`
  mutation SettingsDeleteBudgetPolicy($id: ID!) {
    deleteBudgetPolicy(id: $id)
  }
`);

export const SettingsUpdateTenantMemberMutation = graphql(`
  mutation SettingsUpdateTenantMember(
    $id: ID!
    $input: UpdateTenantMemberInput!
  ) {
    updateTenantMember(id: $id, input: $input) {
      id
      role
      status
      updatedAt
    }
  }
`);

export const SettingsRemoveTenantMemberMutation = graphql(`
  mutation SettingsRemoveTenantMember($id: ID!) {
    removeTenantMember(id: $id)
  }
`);

export const SettingsInviteMemberMutation = graphql(`
  mutation SettingsInviteMember($tenantId: ID!, $input: InviteMemberInput!) {
    inviteMember(tenantId: $tenantId, input: $input) {
      id
      principalType
      principalId
      role
      status
      createdAt
      user {
        id
        name
        email
      }
    }
  }
`);

// ─── Analytics (usage cost, operator-only) ───────────────────────────────

export const SettingsCostSummaryQuery = graphql(`
  query SettingsCostSummary($tenantId: ID!) {
    costSummary(tenantId: $tenantId) {
      totalUsd
      llmUsd
      computeUsd
      toolsUsd
      totalInputTokens
      totalOutputTokens
      eventCount
    }
  }
`);

export const SettingsCostByUserQuery = graphql(`
  query SettingsCostByUser($tenantId: ID!) {
    costByUser(tenantId: $tenantId) {
      userId
      userName
      userEmail
      totalUsd
      eventCount
      isSystem
    }
  }
`);

export const SettingsBudgetStatusQuery = graphql(`
  query SettingsBudgetStatus($tenantId: ID!) {
    budgetStatus(tenantId: $tenantId) {
      policy {
        id
        tenantId
        userId
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
`);

export const SettingsCostByModelQuery = graphql(`
  query SettingsCostByModel($tenantId: ID!) {
    costByModel(tenantId: $tenantId) {
      model
      totalUsd
      inputTokens
      outputTokens
    }
  }
`);

export const SettingsCostTimeSeriesQuery = graphql(`
  query SettingsCostTimeSeries($tenantId: ID!, $days: Int) {
    costTimeSeries(tenantId: $tenantId, days: $days) {
      day
      totalUsd
      llmUsd
      computeUsd
      toolsUsd
      eventCount
    }
  }
`);

// ─── Routines + Webhooks (operator-only) ─────────────────────────────────

export const SettingsRoutinesQuery = graphql(`
  query SettingsRoutines($tenantId: ID!) {
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

export const SettingsWebhooksQuery = graphql(`
  query SettingsWebhooks($tenantId: ID!) {
    webhooks(tenantId: $tenantId) {
      id
      name
      description
      targetType
      enabled
      invocationCount
      lastInvokedAt
      createdAt
    }
  }
`);

export const SettingsWebhookQuery = graphql(`
  query SettingsWebhook($id: ID!) {
    webhook(id: $id) {
      id
      name
      description
      token
      targetType
      prompt
      enabled
      rateLimit
      invocationCount
      lastInvokedAt
      createdAt
    }
  }
`);

export const SettingsWebhookDeliveriesQuery = graphql(`
  query SettingsWebhookDeliveries($webhookId: ID!, $limit: Int) {
    webhookDeliveries(webhookId: $webhookId, limit: $limit) {
      id
      receivedAt
      providerName
      normalizedKind
      signatureStatus
      resolutionStatus
      statusCode
      threadCreated
    }
  }
`);

export const SettingsUpdateWebhookMutation = graphql(`
  mutation SettingsUpdateWebhook($id: ID!, $input: UpdateWebhookInput!) {
    updateWebhook(id: $id, input: $input) {
      id
      name
      description
      prompt
      enabled
      rateLimit
    }
  }
`);

export const SettingsDeleteWebhookMutation = graphql(`
  mutation SettingsDeleteWebhook($id: ID!) {
    deleteWebhook(id: $id)
  }
`);

export const SettingsRegenerateWebhookTokenMutation = graphql(`
  mutation SettingsRegenerateWebhookToken($id: ID!) {
    regenerateWebhookToken(id: $id) {
      id
      token
    }
  }
`);
