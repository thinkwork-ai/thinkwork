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

// Minimal release-label read for the sidebar account menu. Kept separate
// from SettingsDeploymentStatusQuery so the always-mounted sidebar doesn't
// drag the full infrastructure payload on every load.
export const SidebarDeployedReleaseQuery = graphql(`
  query SidebarDeployedRelease {
    deploymentStatus {
      releaseVersion
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
      releaseVersion
      releaseManifestUrl
      releaseManifestSha256
      deploymentControllerArn
      deploymentRunnerProjectName
      deploymentEvidenceBucket
      bucketName
      databaseEndpoint
      ecrUrl
      adminUrl
      apiEndpoint
      appsyncUrl
      appsyncRealtimeUrl
      agentcoreStatus
      managedMemoryEnabled
    }
  }
`);

export const SettingsEmailChannelQuery = graphql(`
  query SettingsEmailChannel {
    emailChannelSummary {
      productionReady
      ledgerEventCount
      providers {
        id
        provider
        displayName
        status
        activeForProduction
        credentialConfigured
        webhookSecretConfigured
        defaultFromEmail
        metadata
        createdAt
        updatedAt
      }
      domains {
        id
        providerInstallId
        domain
        ownershipType
        status
        sendingVerifiedAt
        inboundVerifiedAt
        dnsRecords
        providerMetadata
        createdAt
        updatedAt
      }
      readinessChecks {
        id
        providerInstallId
        domainId
        checkKey
        status
        lastCheckedAt
        failureCode
        failureMessage
        metadata
        createdAt
        updatedAt
      }
      blockingReadinessChecks {
        id
        providerInstallId
        domainId
        checkKey
        status
        failureCode
        failureMessage
      }
      spacePolicies {
        id
        spaceId
        providerInstallId
        enabled
        registeredUsersAllowed
        privateSpaceMembershipRequired
        outsideSenderDefault
        firstSendReviewRequired
        policy
        allowlists {
          id
          valueType
          value
          reason
          createdByUserId
          createdAt
        }
        createdAt
        updatedAt
      }
    }
  }
`);

export const SettingsSaveEmailProviderCredentialMutation = graphql(`
  mutation SettingsSaveEmailProviderCredential(
    $input: SaveEmailProviderCredentialInput!
  ) {
    saveEmailProviderCredential(input: $input) {
      id
      provider
      status
      activeForProduction
      credentialConfigured
      webhookSecretConfigured
      defaultFromEmail
      metadata
      updatedAt
    }
  }
`);

export const SettingsConfigureEmailProviderMutation = graphql(`
  mutation SettingsConfigureEmailProvider(
    $input: ConfigureEmailProviderInput!
  ) {
    configureEmailProvider(input: $input) {
      id
      provider
      status
      activeForProduction
      credentialConfigured
      defaultFromEmail
      metadata
      updatedAt
    }
  }
`) as any;

export const SettingsRunEmailReadinessProbeMutation = graphql(`
  mutation SettingsRunEmailReadinessProbe($providerInstallId: ID!) {
    runEmailReadinessProbe(providerInstallId: $providerInstallId) {
      id
      providerInstallId
      domainId
      checkKey
      status
      failureCode
      failureMessage
      lastCheckedAt
    }
  }
`);

export const SettingsSpaceEmailPolicyQuery = graphql(`
  query SettingsSpaceEmailPolicy($spaceId: ID!) {
    emailSpaceEmailPolicy(spaceId: $spaceId) {
      id
      spaceId
      providerInstallId
      enabled
      registeredUsersAllowed
      privateSpaceMembershipRequired
      outsideSenderDefault
      firstSendReviewRequired
      updatedAt
    }
  }
`);

export const SettingsUpsertEmailSpacePolicyMutation = graphql(`
  mutation SettingsUpsertEmailSpacePolicy(
    $input: UpsertEmailSpacePolicyInput!
  ) {
    upsertEmailSpacePolicy(input: $input) {
      id
      spaceId
      providerInstallId
      enabled
      registeredUsersAllowed
      privateSpaceMembershipRequired
      outsideSenderDefault
      firstSendReviewRequired
      policy
      allowlists {
        id
        valueType
        value
        reason
        createdAt
      }
      updatedAt
    }
  }
`);

export const SettingsAddEmailSpaceSenderAllowlistMutation = graphql(`
  mutation SettingsAddEmailSpaceSenderAllowlist(
    $input: AddEmailSpaceSenderAllowlistInput!
  ) {
    addEmailSpaceSenderAllowlist(input: $input) {
      id
      spaceId
      valueType
      value
      reason
      createdAt
    }
  }
`);

export const SettingsRemoveEmailSpaceSenderAllowlistMutation = graphql(`
  mutation SettingsRemoveEmailSpaceSenderAllowlist($id: ID!) {
    removeEmailSpaceSenderAllowlist(id: $id)
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
      id
      status
      targetReleaseVersion
      failureMessage
      recoveryAction
      executionArn
      stateMachineArn
      evidenceBucket
      evidencePrefix
    }
  }
`);

export const SettingsStartReleaseUpdatePreflightMutation = graphql(`
  mutation SettingsStartReleaseUpdatePreflight(
    $input: StartReleaseUpdatePreflightInput!
  ) {
    startReleaseUpdatePreflight(input: $input) {
      id
      status
      targetReleaseVersion
      currentReleaseVersion
      manifestSha256
      manifestSigned
      manifestTrustPolicy
      terraformModuleVersion
      preflightSummary
      preservedConfigSummary
      remediationSummary
      stateMachineArn
      executionArn
      codebuildBuildArn
      evidenceBucket
      evidencePrefix
      statusPointerBucket
      statusPointerKey
      finalStatus
      failureCategory
      failureMessage
      recoveryAction
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

export const SettingsReleaseUpdateJobQuery = graphql(`
  query SettingsReleaseUpdateJob($jobId: ID!) {
    releaseUpdateJob(jobId: $jobId) {
      id
      status
      targetReleaseVersion
      currentReleaseVersion
      manifestSha256
      manifestSigned
      manifestTrustPolicy
      terraformModuleVersion
      preflightSummary
      preservedConfigSummary
      remediationSummary
      stateMachineArn
      executionArn
      codebuildBuildArn
      evidenceBucket
      evidencePrefix
      statusPointerBucket
      statusPointerKey
      finalStatus
      failureCategory
      failureMessage
      recoveryAction
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

export const SettingsRemediateReleaseRunnerMutation = graphql(`
  mutation SettingsRemediateReleaseRunner(
    $input: RemediateReleaseRunnerInput!
  ) {
    remediateReleaseRunner(input: $input) {
      id
      status
      targetReleaseVersion
      currentReleaseVersion
      manifestSha256
      manifestSigned
      manifestTrustPolicy
      terraformModuleVersion
      preflightSummary
      preservedConfigSummary
      remediationSummary
      stateMachineArn
      executionArn
      codebuildBuildArn
      evidenceBucket
      evidencePrefix
      statusPointerBucket
      statusPointerKey
      finalStatus
      failureCategory
      failureMessage
      recoveryAction
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

// ─── Branding (operator-only white-label logo/header text) ───────────────

export const SettingsUpdateTenantBrandingMutation = graphql(`
  mutation SettingsUpdateTenantBranding(
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

export const SettingsDeleteSpaceMutation = graphql(`
  mutation SettingsDeleteSpace($tenantId: ID!, $id: ID!) {
    deleteSpace(tenantId: $tenantId, id: $id)
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
      runtimeConfig
      model
      blockedTools
      sandbox
      browser
      webSearch
      webExtract
      sendEmail
      contextEngine
      jsonRenderUi
    }
  }
`);

export const SettingsTenantGoalBudgetQuery = graphql(`
  query SettingsTenantGoalBudget($id: ID!) {
    tenant(id: $id) {
      id
      settings {
        id
        goalDefaultTokenBudget
        updatedAt
      }
    }
  }
`);

export const SettingsUpdateTenantGoalBudgetMutation = graphql(`
  mutation SettingsUpdateTenantGoalBudget(
    $tenantId: ID!
    $input: UpdateTenantSettingsInput!
  ) {
    updateTenantSettings(tenantId: $tenantId, input: $input) {
      id
      goalDefaultTokenBudget
      updatedAt
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
      runtimeConfig
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

export const SettingsPiExtensionFieldsFragment = graphql(`
  fragment SettingsPiExtensionFields on PiExtension {
    id
    tenantId
    sourceId
    sourceType
    repositoryUrl
    repositoryOwner
    repositoryName
    displayName
    description
    sourceRef
    commitSha
    manifestHash
    artifactHash
    artifactUri
    runtimeTarget
    status
    statusReason
    manifest
    toolNames
    lifecycleHooks
    permissionClasses
    verificationReport
    reviewedByUserId
    reviewedAt
    approvedByUserId
    approvedAt
    rejectedByUserId
    rejectedAt
    executable
    assignmentSummary {
      defaultAgentEnabled
      enabledProfileCount
      disabledCount
    }
    assignments {
      id
      tenantId
      versionId
      targetType
      agentProfileId
      enabled
      grantedPermissions
      createdAt
      updatedAt
    }
    createdAt
    updatedAt
  }
`);

export const SettingsPiExtensionsQuery = graphql(`
  query SettingsPiExtensions($tenantId: ID!) {
    piExtensions(tenantId: $tenantId) {
      ...SettingsPiExtensionFields
    }
  }
`);

/**
 * Lean Pi-extension registry read for the Composer (plan U8). Sources the
 * version identity + current assignments the Composer's pi_extension controls
 * need to render a version picker and detach — without pulling the full
 * fragment-masked review payload the registry surface uses. Version identity
 * lives here in the registry data (KTD-5), not in the inspector rows.
 */
export const SettingsComposerPiExtensionsQuery = graphql(`
  query SettingsComposerPiExtensions($tenantId: ID!) {
    piExtensions(tenantId: $tenantId) {
      id
      sourceId
      displayName
      repositoryName
      repositoryOwner
      sourceRef
      status
      permissionClasses
      createdAt
      updatedAt
      assignments {
        id
        versionId
        targetType
        agentProfileId
        enabled
      }
    }
  }
`);

export const SettingsImportPiExtensionFromGitHubMutation = graphql(`
  mutation SettingsImportPiExtensionFromGitHub(
    $input: ImportPiExtensionFromGitHubInput!
  ) {
    importPiExtensionFromGitHub(input: $input) {
      ...SettingsPiExtensionFields
    }
  }
`);

export const SettingsApprovePiExtensionVersionMutation = graphql(`
  mutation SettingsApprovePiExtensionVersion(
    $input: ApprovePiExtensionVersionInput!
  ) {
    approvePiExtensionVersion(input: $input) {
      ...SettingsPiExtensionFields
    }
  }
`);

export const SettingsRejectPiExtensionVersionMutation = graphql(`
  mutation SettingsRejectPiExtensionVersion(
    $input: RejectPiExtensionVersionInput!
  ) {
    rejectPiExtensionVersion(input: $input) {
      ...SettingsPiExtensionFields
    }
  }
`);

// ─── Users (operator-only section) ───────────────────────────────────────

export const SettingsMeQuery = graphql(`
  query SettingsMe {
    me {
      id
      tenantId
      email
      name
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
`);

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
      visibleSpendUsd
      estimatedUsd
      invocationReconciledUsd
      billReconciledUsd
      mismatchUsd
      unreconciledUsd
      minimumReconciliationState
      remainingUsd
      percentUsed
      status
    }
  }
`);

export const SettingsAccountUsageQuery = graphql(`
  query SettingsAccountUsage($tenantId: ID!, $userId: ID!, $days: Int) {
    accountUsage(tenantId: $tenantId, userId: $userId, days: $days) {
      periodStart
      periodEnd
      summary {
        totalUsd
        enforcedUsd
        estimatedUsd
        invocationReconciledUsd
        billReconciledUsd
        mismatchUsd
        unreconciledUsd
        minimumReconciliationState
        llmUsd
        computeUsd
        toolsUsd
        cacheUsd
        conversationUsd
        systemUsd
        inputTokens
        outputTokens
        cachedReadTokens
        cachedWriteTokens
        eventCount
      }
      daily {
        day
        totalUsd
        enforcedUsd
        estimatedUsd
        invocationReconciledUsd
        billReconciledUsd
        mismatchUsd
        unreconciledUsd
        minimumReconciliationState
        llmUsd
        computeUsd
        toolsUsd
        cacheUsd
        conversationUsd
        systemUsd
        inputTokens
        outputTokens
        cachedReadTokens
        cachedWriteTokens
        eventCount
      }
      models {
        model
        displayName
        totalUsd
        enforcedUsd
        estimatedUsd
        invocationReconciledUsd
        billReconciledUsd
        mismatchUsd
        unreconciledUsd
        minimumReconciliationState
        inputTokens
        outputTokens
        cachedReadTokens
        cachedWriteTokens
        cacheUsd
        usageShare
      }
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

export const SettingsAddManualUserMutation = graphql(`
  mutation SettingsAddManualUser($tenantId: ID!, $input: AddManualUserInput!) {
    addManualUser(tenantId: $tenantId, input: $input) {
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

export const SettingsResendMemberInviteMutation = graphql(`
  mutation SettingsResendMemberInvite(
    $tenantId: ID!
    $input: ResendMemberInviteInput!
  ) {
    resendMemberInvite(tenantId: $tenantId, input: $input) {
      status
      message
    }
  }
`);

export const SettingsSetTenantMemberPasswordMutation = graphql(`
  mutation SettingsSetTenantMemberPassword(
    $tenantId: ID!
    $input: SetTenantMemberPasswordInput!
  ) {
    setTenantMemberPassword(tenantId: $tenantId, input: $input) {
      status
      message
    }
  }
`);

// ─── Analytics (usage cost, operator-only) ───────────────────────────────

export const SettingsCostSummaryQuery = graphql(`
  query SettingsCostSummary(
    $tenantId: ID!
    $from: AWSDateTime
    $to: AWSDateTime
  ) {
    costSummary(tenantId: $tenantId, from: $from, to: $to) {
      totalUsd
      llmUsd
      computeUsd
      toolsUsd
      cacheUsd
      conversationUsd
      systemUsd
      totalInputTokens
      totalOutputTokens
      totalCachedReadTokens
      totalCachedWriteTokens
      eventCount
    }
  }
`);

export const SettingsCostByUserQuery = graphql(`
  query SettingsCostByUser(
    $tenantId: ID!
    $from: AWSDateTime
    $to: AWSDateTime
  ) {
    costByUser(tenantId: $tenantId, from: $from, to: $to) {
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
      visibleSpendUsd
      estimatedUsd
      invocationReconciledUsd
      billReconciledUsd
      mismatchUsd
      unreconciledUsd
      minimumReconciliationState
      remainingUsd
      percentUsed
      status
    }
  }
`);

export const SettingsCostByModelQuery = graphql(`
  query SettingsCostByModel(
    $tenantId: ID!
    $from: AWSDateTime
    $to: AWSDateTime
  ) {
    costByModel(tenantId: $tenantId, from: $from, to: $to) {
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

// ─── Webhooks ────────────────────────────────────────────────────────────
// THINK-137 U8 (R8): the standalone Webhooks settings surface retired — every
// webhook is now an Automation with a `webhook` trigger. The former webhook
// list/detail queries + update/delete/regenerate mutations moved out with the
// deleted SettingsWebhooks / SettingsWebhookDetail components. The
// `/settings/webhooks/$webhookId` redirect route owns the only remaining
// webhook read (its owning Automation), inline in the route file.

export const SettingsTenantCredentialsQuery = graphql(`
  query SettingsTenantCredentials(
    $tenantId: ID!
    $status: TenantCredentialStatus
  ) {
    tenantCredentials(tenantId: $tenantId, status: $status) {
      id
      tenantId
      displayName
      slug
      kind
      status
      metadataJson
    }
  }
`);

// prettier-ignore
export const SettingsCreateTenantCredentialMutation = graphql(`
  mutation SettingsCreateTenantCredential($input: CreateTenantCredentialInput!) {
    createTenantCredential(input: $input) {
      id
      slug
      kind
      status
      metadataJson
    }
  }
`);

// prettier-ignore
export const SettingsRotateTenantCredentialMutation = graphql(`
  mutation SettingsRotateTenantCredential($input: RotateTenantCredentialInput!) {
    rotateTenantCredential(input: $input) {
      id
      slug
      kind
      status
      metadataJson
    }
  }
`);

export const SettingsUpdateTenantCredentialMutation = graphql(`
  mutation SettingsUpdateTenantCredential(
    $id: ID!
    $input: UpdateTenantCredentialInput!
  ) {
    updateTenantCredential(id: $id, input: $input) {
      id
      slug
      kind
      status
      metadataJson
    }
  }
`);

export const SettingsGrantCapabilityMutation = graphql(`
  mutation SettingsGrantCapability($input: GrantCapabilityInput!) {
    grantCapability(input: $input) {
      outcome
      inspectionState
      computedAt
      configFingerprint
      item {
        capabilityClass
        capabilityId
        displayName
        active
        provenance
        reason
        detail
        tokenStatus
      }
    }
  }
`);

export const SettingsDetachCapabilityMutation = graphql(`
  mutation SettingsDetachCapability($input: DetachCapabilityInput!) {
    detachCapability(input: $input) {
      outcome
      inspectionState
      computedAt
      configFingerprint
      item {
        capabilityClass
        capabilityId
        displayName
        active
        provenance
        reason
        detail
        tokenStatus
      }
    }
  }
`);

export const SettingsCapabilityInspectorQuery = graphql(`
  query SettingsCapabilityInspector(
    $tenantId: ID!
    $agentId: ID
    $spaceId: ID
    $agentProfileId: ID
    $perspectiveUserId: ID
  ) {
    capabilityInspector(
      tenantId: $tenantId
      agentId: $agentId
      spaceId: $spaceId
      agentProfileId: $agentProfileId
      perspectiveUserId: $perspectiveUserId
    ) {
      state
      stateDetail
      agentId
      spaceId
      agentProfileId
      perspectiveUserId
      noUserBaseline
      predicted {
        variant
        computedAt
        configFingerprint
        items {
          capabilityClass
          capabilityId
          displayName
          active
          provenance
          reason
          detail
          tokenStatus
        }
      }
      observed {
        variant
        computedAt
        configFingerprint
        items {
          capabilityClass
          capabilityId
          displayName
          active
          provenance
          reason
          detail
          tokenStatus
        }
      }
      divergence {
        state
        manifestId
        manifestCreatedAt
        manifestFingerprint
        deltas {
          capabilityClass
          capabilityId
          kind
        }
      }
    }
  }
`);

// Workspace preview read surface (Composer plan U2, KTD-3): the rendered
// workspace tree for a selection tuple plus lazy per-file content. Both are
// computed through the runtime's own `persist:false` render path, and both
// are profile-invariant — the Profile chip scopes the controls pane only
// (R4), so no agentProfileId variable exists here by design.
export const SettingsWorkspacePreviewQuery = graphql(`
  query SettingsWorkspacePreview(
    $tenantId: ID!
    $agentId: ID
    $spaceId: ID
    $perspectiveUserId: ID
  ) {
    workspacePreview(
      tenantId: $tenantId
      agentId: $agentId
      spaceId: $spaceId
      perspectiveUserId: $perspectiveUserId
    ) {
      state
      stateDetail
      agentId
      spaceId
      perspectiveUserId
      noUserBaseline
      files {
        path
        owner
        generated
        size
      }
    }
  }
`);

export const SettingsWorkspacePreviewFileQuery = graphql(`
  query SettingsWorkspacePreviewFile(
    $tenantId: ID!
    $agentId: ID
    $spaceId: ID
    $perspectiveUserId: ID
    $path: String!
  ) {
    workspacePreviewFile(
      tenantId: $tenantId
      agentId: $agentId
      spaceId: $spaceId
      perspectiveUserId: $perspectiveUserId
      path: $path
    ) {
      state
      stateDetail
      file {
        path
        owner
        generated
        size
      }
      content
    }
  }
`);

// ─── Knowledge Model (THINK-193 U4) ─────────────────────────────────────

export const SettingsCanonicalEntitiesQuery = graphql(`
  query SettingsCanonicalEntities(
    $tenantId: ID
    $entityTypeSlug: String
    $search: String
    $status: String
    $limit: Int
  ) {
    canonicalEntities(
      tenantId: $tenantId
      entityTypeSlug: $entityTypeSlug
      search: $search
      status: $status
      limit: $limit
    ) {
      id
      entityTypeSlug
      displayName
      normalizedName
      status
      mergedIntoId
      version
      updatedAt
      sourceMappings {
        id
        sourceSystem
        namespace
        externalId
        visibility
        createdBy
        createdByUserId
        createdThreadRef
        createdAt
      }
    }
  }
`);

export const SettingsEntityResolutionCasesQuery = graphql(`
  query SettingsEntityResolutionCases(
    $tenantId: ID
    $status: String
    $limit: Int
  ) {
    entityResolutionCases(tenantId: $tenantId, status: $status, limit: $limit) {
      id
      entityTypeSlug
      displayHint
      candidates
      conflictingClaims
      impactSummary
      itemCount
      status
      decision
      createdAt
      updatedAt
    }
  }
`);

export const SettingsResolveEntityResolutionCaseMutation = graphql(`
  mutation SettingsResolveEntityResolutionCase(
    $tenantId: ID
    $caseId: ID!
    $decision: EntityResolutionDecision!
    $canonicalEntityId: ID
    $displayName: String
  ) {
    resolveEntityResolutionCase(
      tenantId: $tenantId
      caseId: $caseId
      decision: $decision
      canonicalEntityId: $canonicalEntityId
      displayName: $displayName
    ) {
      id
      status
      decision
      resolvedCanonicalEntityId
      updatedAt
    }
  }
`);

export const SettingsCanonicalEntityMergePreviewQuery = graphql(`
  query SettingsCanonicalEntityMergePreview(
    $tenantId: ID
    $survivorId: ID!
    $loserId: ID!
  ) {
    canonicalEntityMergePreview(
      tenantId: $tenantId
      survivorId: $survivorId
      loserId: $loserId
    ) {
      sourceMappingCount
      identityClaimCount
      memoryClaimCount
    }
  }
`);

export const SettingsMergeCanonicalEntitiesMutation = graphql(`
  mutation SettingsMergeCanonicalEntities(
    $tenantId: ID
    $survivorId: ID!
    $loserId: ID!
    $confirmImpact: CanonicalEntityMergeImpactInput!
  ) {
    mergeCanonicalEntities(
      tenantId: $tenantId
      survivorId: $survivorId
      loserId: $loserId
      confirmImpact: $confirmImpact
    ) {
      survivorId
      loserId
      impact {
        sourceMappingCount
        identityClaimCount
        memoryClaimCount
      }
    }
  }
`);

// ─── Identity stewardship (THINK-321 U8) ──────────────────────────────────

export const SettingsAuthorEntitySourceMappingMutation = graphql(`
  mutation SettingsAuthorEntitySourceMapping(
    $tenantId: ID
    $canonicalEntityId: ID!
    $sourceSystem: String!
    $namespace: String
    $externalId: String!
  ) {
    authorEntitySourceMapping(
      tenantId: $tenantId
      canonicalEntityId: $canonicalEntityId
      sourceSystem: $sourceSystem
      namespace: $namespace
      externalId: $externalId
    ) {
      status
      reason
      mapping {
        id
        canonicalEntityId
        sourceSystem
        namespace
        externalId
        createdBy
      }
      existingMappingId
      existingCanonicalEntityId
    }
  }
`);

export const SettingsRevokeEntitySourceMappingMutation = graphql(`
  mutation SettingsRevokeEntitySourceMapping(
    $tenantId: ID
    $mappingId: ID!
    $reason: String
  ) {
    revokeEntitySourceMapping(
      tenantId: $tenantId
      mappingId: $mappingId
      reason: $reason
    ) {
      status
      reason
      canonicalEntityId
      sourceSystem
      namespace
      externalId
    }
  }
`);

export const SettingsCanonicalEntitySplitPreviewQuery = graphql(`
  query SettingsCanonicalEntitySplitPreview(
    $tenantId: ID
    $canonicalEntityId: ID!
    $assignments: [SplitMappingAssignmentInput!]!
  ) {
    canonicalEntitySplitPreview(
      tenantId: $tenantId
      canonicalEntityId: $canonicalEntityId
      assignments: $assignments
    ) {
      mappingCountA
      mappingCountB
      claimCountFollowingB
      claimCountRemainingA
      memoryClaimCount
    }
  }
`);

export const SettingsSplitCanonicalEntityMutation = graphql(`
  mutation SettingsSplitCanonicalEntity(
    $tenantId: ID
    $canonicalEntityId: ID!
    $assignments: [SplitMappingAssignmentInput!]!
    $newEntityDisplayName: String!
    $confirmImpact: CanonicalEntitySplitImpactInput!
  ) {
    splitCanonicalEntity(
      tenantId: $tenantId
      canonicalEntityId: $canonicalEntityId
      assignments: $assignments
      newEntityDisplayName: $newEntityDisplayName
      confirmImpact: $confirmImpact
    ) {
      entityAId
      entityBId
      impact {
        mappingCountA
        mappingCountB
        claimCountFollowingB
        claimCountRemainingA
      }
    }
  }
`);

// ─── Connections (per-user integrations surface) ──────────────────────────
// Slack per-user identity links render alongside the OAuth connections on the
// Connections tab — the same GraphQL surface mobile's Credential Locker uses.

export const SettingsMySlackLinksQuery = graphql(`
  query SettingsMySlackLinks($tenantId: ID!) {
    mySlackLinks(tenantId: $tenantId) {
      id
      slackTeamId
      slackTeamName
      slackUserId
      slackUserName
      slackUserEmail
      status
      linkedAt
    }
  }
`);

export const SettingsUnlinkSlackIdentityMutation = graphql(`
  mutation SettingsUnlinkSlackIdentity($id: ID!) {
    unlinkSlackIdentity(id: $id) {
      id
      status
    }
  }
`);

// ─── Brain access (THINK-625) ───────────────────────────────────────────
//
// Claims reach the Company Brain only through the per-tenant manifest, so
// every mutation returns the publish outcome next to the row — the UI has to
// be able to say "saved, but not live yet".

export const SettingsUserBrainClaimsQuery = graphql(`
  query SettingsUserBrainClaims($tenantId: ID!, $userId: ID!) {
    userBrainClaims(tenantId: $tenantId, userId: $userId) {
      id
      tenantId
      userId
      securityGroups
      kbCollections
      kbBundles
      defaultKbBundle
      toolAllowlist
      isOperator
      kbTrace
      enabled
      notes
      updatedAt
    }
  }
`);

export const SettingsSetUserBrainClaimsMutation = graphql(`
  mutation SettingsSetUserBrainClaims(
    $tenantId: ID!
    $userId: ID!
    $input: UserBrainClaimsInput!
  ) {
    setUserBrainClaims(tenantId: $tenantId, userId: $userId, input: $input) {
      claims {
        id
        tenantId
        userId
        securityGroups
        kbCollections
        kbBundles
        defaultKbBundle
        toolAllowlist
        isOperator
        kbTrace
        enabled
        notes
        updatedAt
      }
      manifest {
        published
        key
        reason
      }
    }
  }
`);

export const SettingsClearUserBrainClaimsMutation = graphql(`
  mutation SettingsClearUserBrainClaims($tenantId: ID!, $userId: ID!) {
    clearUserBrainClaims(tenantId: $tenantId, userId: $userId) {
      manifest {
        published
        key
        reason
      }
    }
  }
`);

export const SettingsRepublishUserClaimsManifestMutation = graphql(`
  mutation SettingsRepublishUserClaimsManifest($tenantId: ID!) {
    republishUserClaimsManifest(tenantId: $tenantId) {
      published
      key
      reason
    }
  }
`);
