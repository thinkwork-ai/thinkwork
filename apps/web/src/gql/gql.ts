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
  "\n  query AppletState($appId: ID!, $instanceId: ID!, $key: String!) {\n    appletState(appId: $appId, instanceId: $instanceId, key: $key) {\n      appId\n      instanceId\n      key\n      value\n      updatedAt\n    }\n  }\n": typeof types.AppletStateDocument;
  "\n  mutation SaveAppletState($input: SaveAppletStateInput!) {\n    saveAppletState(input: $input) {\n      appId\n      instanceId\n      key\n      value\n      updatedAt\n    }\n  }\n": typeof types.SaveAppletStateDocument;
  "\n  subscription SpacesThreadActivity($userId: ID!) {\n    onThreadActivity(userId: $userId) {\n      userId\n      tenantId\n      threadId\n      messageId\n      authorId\n      authorType\n      snippet\n      threadTitle\n      createdAt\n    }\n  }\n": typeof types.SpacesThreadActivityDocument;
  "\n  query AdminApplets(\n    $tenantId: ID!\n    $userId: ID\n    $cursor: String\n    $limit: Int\n  ) {\n    adminApplets(\n      tenantId: $tenantId\n      userId: $userId\n      cursor: $cursor\n      limit: $limit\n    ) {\n      nodes {\n        appId\n        name\n        version\n        tenantId\n        threadId\n        prompt\n        agentVersion\n        modelId\n        generatedAt\n        stdlibVersionAtGeneration\n        artifact {\n          id\n          favoritedAt\n        }\n      }\n      nextCursor\n    }\n  }\n": typeof types.AdminAppletsDocument;
  "\n  mutation AdminUpdateAppletSource($input: AdminUpdateAppletSourceInput!) {\n    adminUpdateAppletSource(input: $input) {\n      ok\n      appId\n      version\n      validated\n      persisted\n      errors\n    }\n  }\n": typeof types.AdminUpdateAppletSourceDocument;
  "\n  query EvalSummary($tenantId: ID!) {\n    evalSummary(tenantId: $tenantId) {\n      totalRuns\n      latestPassRate\n      avgPassRate\n      regressionCount\n    }\n  }\n": typeof types.EvalSummaryDocument;
  "\n  query EvalRuns($tenantId: ID!, $limit: Int, $offset: Int) {\n    evalRuns(tenantId: $tenantId, limit: $limit, offset: $offset) {\n      items {\n        id\n        status\n        model\n        categories\n        totalTests\n        passed\n        failed\n        passRate\n        regression\n        costUsd\n        agentId\n        agentName\n        scheduledJobId\n        executionTarget\n        runtimeHost\n        startedAt\n        completedAt\n        createdAt\n      }\n      totalCount\n    }\n  }\n": typeof types.EvalRunsDocument;
  "\n  query EvalRun($id: ID!) {\n    evalRun(id: $id) {\n      id\n      status\n      model\n      categories\n      totalTests\n      passed\n      failed\n      passRate\n      regression\n      costUsd\n      errorMessage\n      agentId\n      agentName\n      scheduledJobId\n      executionTarget\n      runtimeHost\n      startedAt\n      completedAt\n      createdAt\n    }\n  }\n": typeof types.EvalRunDocument;
  "\n  query EvalRunResults($runId: ID!) {\n    evalRunResults(runId: $runId) {\n      id\n      testCaseId\n      testCaseName\n      category\n      status\n      score\n      durationMs\n      agentSessionId\n      input\n      actualOutput\n      systemPrompt\n      evaluatorResults\n      assertions\n      errorMessage\n      createdAt\n    }\n  }\n": typeof types.EvalRunResultsDocument;
  "\n  query EvalResultSpans($runId: ID!, $testCaseId: ID!) {\n    evalResultSpans(runId: $runId, testCaseId: $testCaseId) {\n      timestamp\n      name\n      attributes\n    }\n  }\n": typeof types.EvalResultSpansDocument;
  "\n  query EvalTimeSeries($tenantId: ID!, $days: Int) {\n    evalTimeSeries(tenantId: $tenantId, days: $days) {\n      day\n      passRate\n      runCount\n      passed\n      failed\n    }\n  }\n": typeof types.EvalTimeSeriesDocument;
  "\n  query EvalTestCases($tenantId: ID!, $category: String, $search: String) {\n    evalTestCases(tenantId: $tenantId, category: $category, search: $search) {\n      id\n      name\n      category\n      query\n      systemPrompt\n      assertions\n      agentcoreEvaluatorIds\n      tags\n      enabled\n      source\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.EvalTestCasesDocument;
  "\n  query EvalTestCase($id: ID!) {\n    evalTestCase(id: $id) {\n      id\n      name\n      category\n      query\n      systemPrompt\n      assertions\n      agentcoreEvaluatorIds\n      tags\n      enabled\n      source\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.EvalTestCaseDocument;
  "\n  query EvalTestCaseHistory($testCaseId: ID!, $limit: Int) {\n    evalTestCaseHistory(testCaseId: $testCaseId, limit: $limit) {\n      id\n      runId\n      testCaseName\n      category\n      status\n      score\n      durationMs\n      input\n      expected\n      actualOutput\n      assertions\n      evaluatorResults\n      errorMessage\n      createdAt\n    }\n  }\n": typeof types.EvalTestCaseHistoryDocument;
  "\n  mutation StartEvalRun($tenantId: ID!, $input: StartEvalRunInput!) {\n    startEvalRun(tenantId: $tenantId, input: $input) {\n      id\n      status\n      categories\n      createdAt\n    }\n  }\n": typeof types.StartEvalRunDocument;
  "\n  mutation CreateEvalTestCase(\n    $tenantId: ID!\n    $input: CreateEvalTestCaseInput!\n  ) {\n    createEvalTestCase(tenantId: $tenantId, input: $input) {\n      id\n      name\n      category\n      query\n      systemPrompt\n      assertions\n      agentcoreEvaluatorIds\n      enabled\n      createdAt\n    }\n  }\n": typeof types.CreateEvalTestCaseDocument;
  "\n  mutation UpdateEvalTestCase($id: ID!, $input: UpdateEvalTestCaseInput!) {\n    updateEvalTestCase(id: $id, input: $input) {\n      id\n      name\n      category\n      query\n      systemPrompt\n      assertions\n      agentcoreEvaluatorIds\n      enabled\n      updatedAt\n    }\n  }\n": typeof types.UpdateEvalTestCaseDocument;
  "\n  mutation SeedEvalTestCases($tenantId: ID!, $categories: [String!]) {\n    seedEvalTestCases(tenantId: $tenantId, categories: $categories)\n  }\n": typeof types.SeedEvalTestCasesDocument;
  "\n  mutation DeleteEvalTestCase($id: ID!) {\n    deleteEvalTestCase(id: $id)\n  }\n": typeof types.DeleteEvalTestCaseDocument;
  "\n  mutation DeleteEvalRun($id: ID!) {\n    deleteEvalRun(id: $id)\n  }\n": typeof types.DeleteEvalRunDocument;
  "\n  mutation CancelEvalRun($id: ID!) {\n    cancelEvalRun(id: $id) {\n      id\n      status\n      completedAt\n    }\n  }\n": typeof types.CancelEvalRunDocument;
  "\n  subscription OnEvalRunUpdated($tenantId: ID!) {\n    onEvalRunUpdated(tenantId: $tenantId) {\n      runId\n      tenantId\n      agentId\n      status\n      totalTests\n      passed\n      failed\n      passRate\n      errorMessage\n      updatedAt\n    }\n  }\n": typeof types.OnEvalRunUpdatedDocument;
  "\n  query KnowledgeBasesList($tenantId: ID!) {\n    knowledgeBases(tenantId: $tenantId) {\n      id\n      name\n      description\n      status\n      documentCount\n      lastSyncAt\n    }\n  }\n": typeof types.KnowledgeBasesListDocument;
  "\n  query KnowledgeBaseDetail($id: ID!) {\n    knowledgeBase(id: $id) {\n      id\n      tenantId\n      name\n      slug\n      description\n      embeddingModel\n      chunkingStrategy\n      chunkSizeTokens\n      chunkOverlapPercent\n      status\n      awsKbId\n      lastSyncAt\n      lastSyncStatus\n      documentCount\n      errorMessage\n    }\n  }\n": typeof types.KnowledgeBaseDetailDocument;
  "\n  query TestKnowledgeBaseRetrieval($id: ID!, $query: String!) {\n    testKnowledgeBaseRetrieval(id: $id, query: $query) {\n      status\n      hits {\n        snippet\n        score\n        source\n      }\n    }\n  }\n": typeof types.TestKnowledgeBaseRetrievalDocument;
  "\n  mutation CreateKnowledgeBase($input: CreateKnowledgeBaseInput!) {\n    createKnowledgeBase(input: $input) {\n      id\n      name\n      status\n    }\n  }\n": typeof types.CreateKnowledgeBaseDocument;
  "\n  mutation UpdateKnowledgeBase($id: ID!, $input: UpdateKnowledgeBaseInput!) {\n    updateKnowledgeBase(id: $id, input: $input) {\n      id\n      name\n      description\n      chunkingStrategy\n      chunkSizeTokens\n      chunkOverlapPercent\n      status\n    }\n  }\n": typeof types.UpdateKnowledgeBaseDocument;
  "\n  mutation SyncKnowledgeBase($id: ID!) {\n    syncKnowledgeBase(id: $id) {\n      id\n      status\n      lastSyncStatus\n    }\n  }\n": typeof types.SyncKnowledgeBaseDocument;
  "\n  mutation RetryKnowledgeBase($id: ID!) {\n    retryKnowledgeBase(id: $id) {\n      id\n      status\n      errorMessage\n    }\n  }\n": typeof types.RetryKnowledgeBaseDocument;
  "\n  mutation DeleteKnowledgeBase($id: ID!) {\n    deleteKnowledgeBase(id: $id)\n  }\n": typeof types.DeleteKnowledgeBaseDocument;
  "\n  query KnowledgeBaseBindings($tenantId: ID!) {\n    tenantAgent(tenantId: $tenantId) {\n      id\n      knowledgeBases {\n        knowledgeBaseId\n      }\n    }\n    spaces(tenantId: $tenantId, status: ACTIVE) {\n      id\n      name\n      knowledgeBases {\n        knowledgeBaseId\n      }\n    }\n  }\n": typeof types.KnowledgeBaseBindingsDocument;
  "\n  mutation SetAgentKnowledgeBases(\n    $agentId: ID!\n    $knowledgeBases: [AgentKnowledgeBaseInput!]!\n  ) {\n    setAgentKnowledgeBases(agentId: $agentId, knowledgeBases: $knowledgeBases) {\n      id\n      knowledgeBaseId\n    }\n  }\n": typeof types.SetAgentKnowledgeBasesDocument;
  "\n  mutation SetSpaceKnowledgeBases($input: SetSpaceKnowledgeBasesInput!) {\n    setSpaceKnowledgeBases(input: $input) {\n      id\n      knowledgeBaseId\n    }\n  }\n": typeof types.SetSpaceKnowledgeBasesDocument;
  "\n  query RoutineDetail($id: ID!) {\n    routine(id: $id) {\n      id\n      tenantId\n      name\n      description\n      type\n      status\n      schedule\n      engine\n      currentVersion\n      config\n      lastRunAt\n      nextRunAt\n      agentId\n      agent {\n        id\n        name\n        avatarUrl\n      }\n      triggers {\n        id\n        triggerType\n        config\n        enabled\n      }\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.RoutineDetailDocument;
  "\n  query RoutineRecipeCatalog($tenantId: ID!) {\n    routineRecipeCatalog(tenantId: $tenantId) {\n      id\n      displayName\n      description\n      category\n      hitlCapable\n      defaultArgs\n      configFields {\n        key\n        label\n        value\n        inputType\n        control\n        required\n        editable\n        options\n        placeholder\n        helpText\n        min\n        max\n        pattern\n      }\n    }\n  }\n": typeof types.RoutineRecipeCatalogDocument;
  "\n  query TenantCredentials($tenantId: ID!, $status: TenantCredentialStatus) {\n    tenantCredentials(tenantId: $tenantId, status: $status) {\n      id\n      tenantId\n      displayName\n      slug\n      kind\n      status\n      metadataJson\n      schemaJson\n      eventbridgeConnectionArn\n      lastUsedAt\n      lastValidatedAt\n      createdAt\n      updatedAt\n      deletedAt\n    }\n  }\n": typeof types.TenantCredentialsDocument;
  "\n  mutation TriggerRoutineRun($routineId: ID!, $input: AWSJSON) {\n    triggerRoutineRun(routineId: $routineId, input: $input) {\n      id\n      status\n      triggerSource\n      startedAt\n    }\n  }\n": typeof types.TriggerRoutineRunDocument;
  "\n  query RoutineDefinition($routineId: ID!) {\n    routineDefinition(routineId: $routineId) {\n      routineId\n      currentVersion\n      versionId\n      title\n      description\n      kind\n      steps {\n        nodeId\n        recipeId\n        recipeName\n        label\n        args\n        configFields {\n          key\n          label\n          value\n          inputType\n          control\n          required\n          editable\n          options\n          placeholder\n          helpText\n          min\n          max\n          pattern\n        }\n      }\n    }\n  }\n": typeof types.RoutineDefinitionDocument;
  "\n  query RoutineDefinitionArtifacts($routineId: ID!) {\n    routineDefinition(routineId: $routineId) {\n      routineId\n      versionId\n      aslJson\n      markdownSummary\n      stepManifestJson\n    }\n  }\n": typeof types.RoutineDefinitionArtifactsDocument;
  "\n  mutation UpdateRoutineDefinition($input: UpdateRoutineDefinitionInput!) {\n    updateRoutineDefinition(input: $input) {\n      routineId\n      currentVersion\n      versionId\n      description\n      steps {\n        nodeId\n        args\n        configFields {\n          key\n          value\n          editable\n        }\n      }\n    }\n  }\n": typeof types.UpdateRoutineDefinitionDocument;
  "\n  query RoutineExecutionsList(\n    $routineId: ID!\n    $status: RoutineExecutionStatus\n    $limit: Int\n    $cursor: String\n  ) {\n    routineExecutions(\n      routineId: $routineId\n      status: $status\n      limit: $limit\n      cursor: $cursor\n    ) {\n      id\n      status\n      triggerSource\n      startedAt\n      finishedAt\n      totalLlmCostUsdCents\n      errorCode\n      createdAt\n    }\n  }\n": typeof types.RoutineExecutionsListDocument;
  "\n  query RoutineExecutionDetail($id: ID!) {\n    routineExecution(id: $id) {\n      id\n      tenantId\n      routineId\n      stateMachineArn\n      aliasArn\n      versionArn\n      sfnExecutionArn\n      triggerSource\n      inputJson\n      outputJson\n      status\n      startedAt\n      finishedAt\n      errorCode\n      errorMessage\n      totalLlmCostUsdCents\n      stepEvents {\n        id\n        nodeId\n        recipeType\n        status\n        startedAt\n        finishedAt\n        inputJson\n        outputJson\n        errorJson\n        llmCostUsdCents\n        retryCount\n        stdoutS3Uri\n        stderrS3Uri\n        stdoutPreview\n        truncated\n        createdAt\n      }\n      routine {\n        id\n        name\n        description\n        currentVersion\n        documentationMd\n      }\n      aslVersion {\n        id\n        versionNumber\n        aslJson\n        markdownSummary\n        stepManifestJson\n      }\n      createdAt\n    }\n  }\n": typeof types.RoutineExecutionDetailDocument;
  "\n  query SettingsTenantDetail($id: ID!) {\n    tenant(id: $id) {\n      id\n      name\n      slug\n      plan\n      issuePrefix\n      issueCounter\n      settings {\n        id\n        defaultModel\n      }\n      createdAt\n    }\n  }\n": typeof types.SettingsTenantDetailDocument;
  "\n  query SidebarDeployedRelease {\n    deploymentStatus {\n      releaseVersion\n    }\n  }\n": typeof types.SidebarDeployedReleaseDocument;
  "\n  query SettingsDeploymentStatus {\n    deploymentStatus {\n      stage\n      source\n      region\n      accountId\n      releaseVersion\n      releaseManifestUrl\n      releaseManifestSha256\n      deploymentControllerArn\n      deploymentRunnerProjectName\n      deploymentEvidenceBucket\n      bucketName\n      databaseEndpoint\n      ecrUrl\n      adminUrl\n      docsUrl\n      apiEndpoint\n      appsyncUrl\n      appsyncRealtimeUrl\n      hindsightEndpoint\n      agentcoreStatus\n      hindsightEnabled\n      managedMemoryEnabled\n      cogneeEnabled\n      cogneeEndpoint\n      cogneeLogGroupName\n      cogneeBackendMode\n      cogneeClusterArn\n      cogneeServiceName\n      twentyProvisioned\n      twentyRuntimeEnabled\n      twentyUrl\n      twentyClusterArn\n      twentyServerServiceName\n      twentyWorkerServiceName\n      twentyServerLogGroupName\n      twentyWorkerLogGroupName\n      twentyAlbArn\n      twentyTargetGroupArn\n      managedApplications {\n        key\n        displayName\n        description\n        status\n        enabled\n        provisioned\n        runtimeEnabled\n        url\n        endpoint\n        backendMode\n        logGroupName\n        logGroupNames\n        clusterArn\n        serviceName\n        serviceNames\n        albArn\n        targetGroupArn\n        storageBucketName\n        databaseName\n        message\n        managedMcpServerId\n        managedMcpStatus\n        managedMcpInstalled\n        managedMcpInstallAvailable\n        managedMcpMessage\n      }\n    }\n  }\n": typeof types.SettingsDeploymentStatusDocument;
  "\n  query SettingsDeploymentReleases($limit: Int) {\n    deploymentReleases(limit: $limit) {\n      version\n      name\n      prerelease\n      draft\n      publishedAt\n      htmlUrl\n      manifestUrl\n      manifestSha256\n      signatureUrl\n      signed\n      deployable\n    }\n  }\n": typeof types.SettingsDeploymentReleasesDocument;
  "\n  mutation SettingsStartDeploymentReleaseUpdate(\n    $input: StartDeploymentReleaseUpdateInput!\n  ) {\n    startDeploymentReleaseUpdate(input: $input) {\n      executionArn\n      stateMachineArn\n      evidenceBucket\n      evidencePrefix\n      message\n      release {\n        version\n        manifestUrl\n        manifestSha256\n        signed\n        deployable\n      }\n    }\n  }\n": typeof types.SettingsStartDeploymentReleaseUpdateDocument;
  "\n  mutation SettingsSetKnowledgeGraphDeployment($enabled: Boolean!) {\n    setKnowledgeGraphDeployment(input: { enabled: $enabled }) {\n      desiredEnabled\n      workflowUrl\n      message\n    }\n  }\n": typeof types.SettingsSetKnowledgeGraphDeploymentDocument;
  "\n  mutation SettingsSetManagedApplicationDeployment(\n    $key: String!\n    $action: ManagedApplicationDeploymentAction!\n  ) {\n    setManagedApplicationDeployment(input: { key: $key, action: $action }) {\n      key\n      action\n      desiredEnabled\n      provisioned\n      runtimeEnabled\n      workflowUrl\n      message\n    }\n  }\n": typeof types.SettingsSetManagedApplicationDeploymentDocument;
  "\n  mutation SettingsInstallManagedApplicationMcpServer($key: String!) {\n    installManagedApplicationMcpServer(key: $key) {\n      key\n      serverId\n      installed\n      status\n      message\n    }\n  }\n": typeof types.SettingsInstallManagedApplicationMcpServerDocument;
  "\n  query SettingsManagedApplications {\n    managedApplications {\n      id\n      key\n      displayName\n      desiredStatus\n      currentStatus\n      selectedReleaseVersion\n      selectedManifestDigest\n      lastJobId\n      updatedAt\n    }\n  }\n": typeof types.SettingsManagedApplicationsDocument;
  "\n  query SettingsManagedApplicationDeployment($jobId: ID!) {\n    managedApplicationDeployment(jobId: $jobId) {\n      id\n      appKey\n      operation\n      status\n      releaseVersion\n      manifestDigest\n      desiredConfigVersion\n      stateMachineArn\n      planExecutionArn\n      applyExecutionArn\n      codebuildBuildArn\n      planDigest\n      planSummary\n      dataImpact\n      evidenceBucket\n      evidencePrefix\n      approvalRequired\n      approvedAt\n      rejectedAt\n      errorMessage\n      createdAt\n      updatedAt\n      events {\n        id\n        eventType\n        message\n        payload\n        createdAt\n      }\n    }\n  }\n": typeof types.SettingsManagedApplicationDeploymentDocument;
  "\n  query SettingsDeploymentEvidence($jobId: ID!) {\n    deploymentEvidence(jobId: $jobId) {\n      jobId\n      bucket\n      prefix\n      urls\n    }\n  }\n": typeof types.SettingsDeploymentEvidenceDocument;
  "\n  mutation SettingsStartManagedApplicationPlan(\n    $input: StartManagedApplicationPlanInput!\n  ) {\n    startManagedApplicationPlan(input: $input) {\n      id\n      appKey\n      operation\n      status\n      releaseVersion\n      manifestDigest\n      desiredConfigVersion\n      stateMachineArn\n      planExecutionArn\n      applyExecutionArn\n      codebuildBuildArn\n      planDigest\n      planSummary\n      dataImpact\n      evidenceBucket\n      evidencePrefix\n      approvalRequired\n      approvedAt\n      rejectedAt\n      errorMessage\n      createdAt\n      updatedAt\n      events {\n        id\n        eventType\n        message\n        payload\n        createdAt\n      }\n    }\n  }\n": typeof types.SettingsStartManagedApplicationPlanDocument;
  "\n  mutation SettingsApproveManagedApplicationDeployment(\n    $input: ApproveManagedApplicationDeploymentInput!\n  ) {\n    approveManagedApplicationDeployment(input: $input) {\n      id\n      appKey\n      operation\n      status\n      releaseVersion\n      manifestDigest\n      desiredConfigVersion\n      stateMachineArn\n      planExecutionArn\n      applyExecutionArn\n      codebuildBuildArn\n      planDigest\n      planSummary\n      dataImpact\n      evidenceBucket\n      evidencePrefix\n      approvalRequired\n      approvedAt\n      rejectedAt\n      errorMessage\n      createdAt\n      updatedAt\n      events {\n        id\n        eventType\n        message\n        payload\n        createdAt\n      }\n    }\n  }\n": typeof types.SettingsApproveManagedApplicationDeploymentDocument;
  "\n  mutation SettingsRejectManagedApplicationDeployment(\n    $input: RejectManagedApplicationDeploymentInput!\n  ) {\n    rejectManagedApplicationDeployment(input: $input) {\n      id\n      appKey\n      operation\n      status\n      releaseVersion\n      manifestDigest\n      desiredConfigVersion\n      stateMachineArn\n      planExecutionArn\n      applyExecutionArn\n      codebuildBuildArn\n      planDigest\n      planSummary\n      dataImpact\n      evidenceBucket\n      evidencePrefix\n      approvalRequired\n      approvedAt\n      rejectedAt\n      errorMessage\n      createdAt\n      updatedAt\n      events {\n        id\n        eventType\n        message\n        payload\n        createdAt\n      }\n    }\n  }\n": typeof types.SettingsRejectManagedApplicationDeploymentDocument;
  "\n  query SettingsKnowledgeGraphHealthCheck {\n    knowledgeGraphHealthCheck {\n      healthy\n      statusCode\n      latencyMs\n      endpoint\n      checkedAt\n      message\n    }\n  }\n": typeof types.SettingsKnowledgeGraphHealthCheckDocument;
  "\n  query SettingsManagedApplicationHealthCheck($key: String!) {\n    managedApplicationHealthCheck(key: $key) {\n      key\n      healthy\n      statusCode\n      latencyMs\n      endpoint\n      checkedAt\n      message\n    }\n  }\n": typeof types.SettingsManagedApplicationHealthCheckDocument;
  "\n  query SettingsKnowledgeGraphOntology($tenantId: ID!) {\n    ontologyDefinitions(tenantId: $tenantId) {\n      activeVersion {\n        id\n        versionNumber\n        status\n        activatedAt\n      }\n      entityTypes {\n        id\n        slug\n        name\n        description\n        broadType\n        aliases\n        lifecycleStatus\n        externalMappings {\n          id\n          mappingKind\n          vocabulary\n          externalUri\n          externalLabel\n        }\n      }\n      relationshipTypes {\n        id\n        slug\n        name\n        description\n        sourceTypeSlugs\n        targetTypeSlugs\n        aliases\n        lifecycleStatus\n        externalMappings {\n          id\n          mappingKind\n          vocabulary\n          externalUri\n          externalLabel\n        }\n      }\n      externalMappings {\n        id\n        subjectKind\n        subjectId\n        mappingKind\n        vocabulary\n        externalUri\n        externalLabel\n      }\n    }\n  }\n": typeof types.SettingsKnowledgeGraphOntologyDocument;
  "\n  query SettingsKnowledgeGraphThreadCandidates(\n    $tenantId: ID!\n    $query: String\n    $limit: Int\n  ) {\n    knowledgeGraphThreadCandidates(\n      tenantId: $tenantId\n      query: $query\n      limit: $limit\n    ) {\n      threadId\n      tenantId\n      title\n      number\n      requesterUserId\n      requesterName\n      spaceId\n      spaceName\n      messageCount\n      lastMessageAt\n      lastIngestRun {\n        id\n        threadId\n        status\n        entityCount\n        relationshipCount\n        evidenceCount\n        diagnosticCount\n        messageCount\n        metrics\n        durationMs\n        error\n        createdAt\n        startedAt\n        finishedAt\n      }\n    }\n  }\n": typeof types.SettingsKnowledgeGraphThreadCandidatesDocument;
  "\n  query SettingsKnowledgeGraphIngestRuns(\n    $tenantId: ID!\n    $threadId: ID\n    $limit: Int\n  ) {\n    knowledgeGraphIngestRuns(\n      tenantId: $tenantId\n      threadId: $threadId\n      limit: $limit\n    ) {\n      id\n      threadId\n      status\n      trigger\n      cogneeDatasetName\n      cogneeDatasetId\n      entityCount\n      relationshipCount\n      evidenceCount\n      diagnosticCount\n      messageCount\n      metrics\n      durationMs\n      error\n      createdAt\n      updatedAt\n      startedAt\n      finishedAt\n    }\n  }\n": typeof types.SettingsKnowledgeGraphIngestRunsDocument;
  "\n  query SettingsKnowledgeGraphEntities(\n    $tenantId: ID!\n    $threadId: ID\n    $runId: ID\n    $search: String\n    $ontologyType: String\n    $groundingStatus: KnowledgeGraphGroundingStatus\n    $provenanceStatus: KnowledgeGraphProvenanceStatus\n    $limit: Int\n  ) {\n    knowledgeGraphEntities(\n      tenantId: $tenantId\n      threadId: $threadId\n      runId: $runId\n      search: $search\n      ontologyType: $ontologyType\n      groundingStatus: $groundingStatus\n      provenanceStatus: $provenanceStatus\n      limit: $limit\n    ) {\n      id\n      label\n      normalizedLabel\n      typeLabel\n      ontologyTypeSlug\n      groundingStatus\n      provenanceStatus\n      summary\n      aliases\n      relationshipCount\n      evidenceCount\n      lastSeenAt\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.SettingsKnowledgeGraphEntitiesDocument;
  "\n  query SettingsKnowledgeGraphEntity($tenantId: ID!, $entityId: ID!) {\n    knowledgeGraphEntity(tenantId: $tenantId, entityId: $entityId) {\n      id\n      label\n      normalizedLabel\n      typeLabel\n      ontologyTypeSlug\n      groundingStatus\n      provenanceStatus\n      summary\n      aliases\n      properties\n      diagnostics\n      relationshipCount\n      evidenceCount\n      lastSeenAt\n      relationships {\n        id\n        sourceEntityId\n        targetEntityId\n        label\n        ontologyTypeSlug\n        groundingStatus\n        provenanceStatus\n        confidence\n        evidenceCount\n        lastSeenAt\n        evidence {\n          id\n          snippet\n          messageId\n          messageRole\n          messageCreatedAt\n          speakerLabel\n        }\n      }\n      evidence {\n        id\n        snippet\n        messageId\n        messageRole\n        messageCreatedAt\n        speakerLabel\n      }\n    }\n  }\n": typeof types.SettingsKnowledgeGraphEntityDocument;
  "\n  mutation SettingsStartKnowledgeGraphThreadIngest(\n    $input: StartKnowledgeGraphThreadIngestInput!\n  ) {\n    startKnowledgeGraphThreadIngest(input: $input) {\n      id\n      status\n      threadId\n      entityCount\n      relationshipCount\n      evidenceCount\n      diagnosticCount\n      messageCount\n      metrics\n      durationMs\n      error\n      createdAt\n      startedAt\n      finishedAt\n    }\n  }\n": typeof types.SettingsStartKnowledgeGraphThreadIngestDocument;
  "\n  mutation SettingsRenameTenantSlug($tenantId: ID!, $newSlug: String!) {\n    renameTenantSlug(tenantId: $tenantId, newSlug: $newSlug) {\n      id\n      slug\n      updatedAt\n    }\n  }\n": typeof types.SettingsRenameTenantSlugDocument;
  "\n  query SettingsTenantFeatures($id: ID!) {\n    tenant(id: $id) {\n      id\n      settings {\n        id\n        features\n      }\n    }\n  }\n": typeof types.SettingsTenantFeaturesDocument;
  "\n  mutation SettingsUpdateTenantArtifactStyle(\n    $tenantId: ID!\n    $input: UpdateTenantSettingsInput!\n  ) {\n    updateTenantSettings(tenantId: $tenantId, input: $input) {\n      id\n      features\n      updatedAt\n    }\n  }\n": typeof types.SettingsUpdateTenantArtifactStyleDocument;
  "\n  query SettingsSpacesList($tenantId: ID!) {\n    spaces(tenantId: $tenantId, status: ACTIVE, includeAllForAdmin: true) {\n      id\n      tenantId\n      name\n      description\n      status\n      accessMode\n      updatedAt\n    }\n  }\n": typeof types.SettingsSpacesListDocument;
  "\n  mutation SettingsCreateSpace($input: CreateSpaceInput!) {\n    createSpace(input: $input) {\n      id\n      tenantId\n      name\n      description\n      status\n      accessMode\n      updatedAt\n    }\n  }\n": typeof types.SettingsCreateSpaceDocument;
  "\n  query SettingsSpace($id: ID!) {\n    space(id: $id) {\n      id\n      tenantId\n      name\n      description\n      status\n      accessMode\n      slug\n      config\n      renderDiagnostics\n      toolPolicy\n      mcpPolicy\n      builtInTools\n    }\n  }\n": typeof types.SettingsSpaceDocument;
  "\n  mutation SettingsUpdateSpace($input: UpdateSpaceInput!) {\n    updateSpace(input: $input) {\n      id\n      name\n      description\n      accessMode\n    }\n  }\n": typeof types.SettingsUpdateSpaceDocument;
  "\n  query SettingsTenantAgent($tenantId: ID!) {\n    agent: tenantAgent(tenantId: $tenantId) {\n      id\n      tenantId\n      name\n      runtime\n      model\n      blockedTools\n      sandbox\n      browser\n      webSearch\n      webExtract\n      sendEmail\n      contextEngine\n    }\n  }\n": typeof types.SettingsTenantAgentDocument;
  "\n  query SettingsTenantSandboxStatus($id: ID!) {\n    tenant(id: $id) {\n      id\n      sandboxEnabled\n      complianceTier\n      sandboxInterpreterPublicId\n      sandboxInterpreterInternalId\n    }\n  }\n": typeof types.SettingsTenantSandboxStatusDocument;
  "\n  query SettingsModelCatalog {\n    modelCatalog {\n      id\n      modelId\n      displayName\n      provider\n    }\n  }\n": typeof types.SettingsModelCatalogDocument;
  "\n  query SettingsTenantModelCatalog(\n    $tenantId: ID!\n    $includeDisabled: Boolean = true\n  ) {\n    tenantModelCatalog(tenantId: $tenantId, includeDisabled: $includeDisabled) {\n      tenantId\n      modelId\n      provider\n      displayName\n      canonicalDisplayName\n      inputCostPerMillion\n      outputCostPerMillion\n      contextWindow\n      maxOutputTokens\n      supportsVision\n      supportsTools\n      enabled\n      pricingStatus\n      pricingSource\n      pricingDiagnostics\n      lastPricedAt\n      importSource\n      importPayload\n      importedByUserId\n      importedAt\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.SettingsTenantModelCatalogDocument;
  "\n  query SettingsBedrockModelImportCandidates($tenantId: ID!) {\n    bedrockModelImportCandidates(tenantId: $tenantId) {\n      provider\n      providerName\n      modelName\n      modelId\n      displayName\n      inputModalities\n      outputModalities\n      supportsStreaming\n      supportsVision\n      supportsTools\n      customizationsSupported\n      inferenceTypesSupported\n      lifecycleStatus\n      inputCostPerMillion\n      outputCostPerMillion\n      pricingStatus\n      pricingSource\n      pricingDiagnostics\n      alreadyImported\n      enabled\n    }\n  }\n": typeof types.SettingsBedrockModelImportCandidatesDocument;
  "\n  mutation SettingsImportTenantBedrockModels(\n    $input: ImportTenantBedrockModelsInput!\n  ) {\n    importTenantBedrockModels(input: $input) {\n      tenantId\n      modelId\n      provider\n      displayName\n      canonicalDisplayName\n      inputCostPerMillion\n      outputCostPerMillion\n      contextWindow\n      maxOutputTokens\n      supportsVision\n      supportsTools\n      enabled\n      pricingStatus\n      pricingSource\n      pricingDiagnostics\n      lastPricedAt\n      importSource\n      importPayload\n      importedByUserId\n      importedAt\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.SettingsImportTenantBedrockModelsDocument;
  "\n  mutation SettingsUpdateTenantModelCatalogEntry(\n    $input: UpdateTenantModelCatalogEntryInput!\n  ) {\n    updateTenantModelCatalogEntry(input: $input) {\n      tenantId\n      modelId\n      provider\n      displayName\n      canonicalDisplayName\n      inputCostPerMillion\n      outputCostPerMillion\n      contextWindow\n      maxOutputTokens\n      supportsVision\n      supportsTools\n      enabled\n      pricingStatus\n      pricingSource\n      pricingDiagnostics\n      lastPricedAt\n      importSource\n      importPayload\n      importedByUserId\n      importedAt\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.SettingsUpdateTenantModelCatalogEntryDocument;
  "\n  mutation SettingsUpdateTenantAgent(\n    $tenantId: ID!\n    $input: UpdateTenantAgentInput!\n  ) {\n    updateTenantAgent(tenantId: $tenantId, input: $input) {\n      id\n      runtime\n      model\n      updatedAt\n    }\n  }\n": typeof types.SettingsUpdateTenantAgentDocument;
  "\n  query SettingsAgentProfiles($tenantId: ID!) {\n    agentProfiles(tenantId: $tenantId, includeDisabled: true) {\n      id\n      tenantId\n      slug\n      name\n      description\n      routingGuidance\n      instructions\n      modelId\n      model {\n        id\n        modelId\n        provider\n        displayName\n        inputCostPerMillion\n        outputCostPerMillion\n      }\n      enabled\n      builtInKey\n      toolPolicy\n      skillPolicy\n      executionControls\n      spaces {\n        id\n        name\n        slug\n      }\n      createdAt\n      updatedAt\n    }\n    agentProfileEditorCatalog(tenantId: $tenantId) {\n      models {\n        id\n        modelId\n        provider\n        displayName\n        inputCostPerMillion\n        outputCostPerMillion\n      }\n      spaces {\n        id\n        name\n        slug\n      }\n      skills {\n        slug\n        displayName\n        description\n        category\n      }\n      builtInTools\n      mcpServers {\n        id\n        name\n        slug\n        enabled\n        status\n        tools\n      }\n    }\n  }\n": typeof types.SettingsAgentProfilesDocument;
  "\n  mutation SettingsCreateAgentProfile(\n    $tenantId: ID!\n    $input: AgentProfileInput!\n  ) {\n    createAgentProfile(tenantId: $tenantId, input: $input) {\n      id\n      slug\n      name\n      updatedAt\n    }\n  }\n": typeof types.SettingsCreateAgentProfileDocument;
  "\n  mutation SettingsUpdateAgentProfile(\n    $tenantId: ID!\n    $id: ID!\n    $input: UpdateAgentProfileInput!\n  ) {\n    updateAgentProfile(tenantId: $tenantId, id: $id, input: $input) {\n      id\n      slug\n      name\n      enabled\n      updatedAt\n    }\n  }\n": typeof types.SettingsUpdateAgentProfileDocument;
  "\n  mutation SettingsDeleteAgentProfile($tenantId: ID!, $id: ID!) {\n    deleteAgentProfile(tenantId: $tenantId, id: $id)\n  }\n": typeof types.SettingsDeleteAgentProfileDocument;
  "\n  query SettingsTenantMembers($tenantId: ID!) {\n    tenantMembers(tenantId: $tenantId) {\n      id\n      principalType\n      principalId\n      role\n      status\n      cognitoStatus\n      createdAt\n      user {\n        id\n        name\n        email\n        profile {\n          id\n          title\n          timezone\n          pronouns\n          callBy\n          notes\n        }\n      }\n    }\n  }\n": typeof types.SettingsTenantMembersDocument;
  "\n  mutation SettingsUpdateUser($id: ID!, $input: UpdateUserInput!) {\n    updateUser(id: $id, input: $input) {\n      id\n      name\n      updatedAt\n    }\n  }\n": typeof types.SettingsUpdateUserDocument;
  "\n  mutation SettingsUpdateUserProfile(\n    $userId: ID!\n    $input: UpdateUserProfileInput!\n  ) {\n    updateUserProfile(userId: $userId, input: $input) {\n      id\n      title\n      timezone\n      pronouns\n      callBy\n      notes\n      updatedAt\n    }\n  }\n": typeof types.SettingsUpdateUserProfileDocument;
  "\n  query SettingsUserBudgetStatus($tenantId: ID!, $userId: ID!) {\n    userBudgetStatus(tenantId: $tenantId, userId: $userId) {\n      policy {\n        id\n        tenantId\n        userId\n        scope\n        period\n        limitUsd\n        actionOnExceed\n        enabled\n      }\n      spentUsd\n      remainingUsd\n      percentUsed\n      status\n    }\n  }\n": typeof types.SettingsUserBudgetStatusDocument;
  "\n  mutation SettingsUpsertBudgetPolicy(\n    $tenantId: ID!\n    $input: UpsertBudgetPolicyInput!\n  ) {\n    upsertBudgetPolicy(tenantId: $tenantId, input: $input) {\n      id\n      tenantId\n      userId\n      scope\n      period\n      limitUsd\n      actionOnExceed\n      enabled\n      updatedAt\n    }\n  }\n": typeof types.SettingsUpsertBudgetPolicyDocument;
  "\n  mutation SettingsDeleteBudgetPolicy($id: ID!) {\n    deleteBudgetPolicy(id: $id)\n  }\n": typeof types.SettingsDeleteBudgetPolicyDocument;
  "\n  mutation SettingsUpdateTenantMember(\n    $id: ID!\n    $input: UpdateTenantMemberInput!\n  ) {\n    updateTenantMember(id: $id, input: $input) {\n      id\n      role\n      status\n      updatedAt\n    }\n  }\n": typeof types.SettingsUpdateTenantMemberDocument;
  "\n  mutation SettingsRemoveTenantMember($id: ID!) {\n    removeTenantMember(id: $id)\n  }\n": typeof types.SettingsRemoveTenantMemberDocument;
  "\n  mutation SettingsInviteMember($tenantId: ID!, $input: InviteMemberInput!) {\n    inviteMember(tenantId: $tenantId, input: $input) {\n      id\n      principalType\n      principalId\n      role\n      status\n      createdAt\n      user {\n        id\n        name\n        email\n      }\n    }\n  }\n": typeof types.SettingsInviteMemberDocument;
  "\n  query SettingsCostSummary($tenantId: ID!) {\n    costSummary(tenantId: $tenantId) {\n      totalUsd\n      llmUsd\n      computeUsd\n      toolsUsd\n      totalInputTokens\n      totalOutputTokens\n      eventCount\n    }\n  }\n": typeof types.SettingsCostSummaryDocument;
  "\n  query SettingsCostByUser($tenantId: ID!) {\n    costByUser(tenantId: $tenantId) {\n      userId\n      userName\n      userEmail\n      totalUsd\n      eventCount\n      isSystem\n    }\n  }\n": typeof types.SettingsCostByUserDocument;
  "\n  query SettingsBudgetStatus($tenantId: ID!) {\n    budgetStatus(tenantId: $tenantId) {\n      policy {\n        id\n        tenantId\n        userId\n        scope\n        period\n        limitUsd\n        actionOnExceed\n        enabled\n      }\n      spentUsd\n      remainingUsd\n      percentUsed\n      status\n    }\n  }\n": typeof types.SettingsBudgetStatusDocument;
  "\n  query SettingsCostByModel($tenantId: ID!) {\n    costByModel(tenantId: $tenantId) {\n      model\n      totalUsd\n      inputTokens\n      outputTokens\n    }\n  }\n": typeof types.SettingsCostByModelDocument;
  "\n  query SettingsCostTimeSeries($tenantId: ID!, $days: Int) {\n    costTimeSeries(tenantId: $tenantId, days: $days) {\n      day\n      totalUsd\n      llmUsd\n      computeUsd\n      toolsUsd\n      eventCount\n    }\n  }\n": typeof types.SettingsCostTimeSeriesDocument;
  "\n  query SettingsRoutines($tenantId: ID!) {\n    routines(tenantId: $tenantId) {\n      id\n      name\n      description\n      status\n      lastRunAt\n      engine\n      createdAt\n    }\n  }\n": typeof types.SettingsRoutinesDocument;
  "\n  query SettingsWebhooks($tenantId: ID!) {\n    webhooks(tenantId: $tenantId) {\n      id\n      name\n      description\n      targetType\n      enabled\n      invocationCount\n      lastInvokedAt\n      createdAt\n    }\n  }\n": typeof types.SettingsWebhooksDocument;
  "\n  query SettingsWebhook($id: ID!) {\n    webhook(id: $id) {\n      id\n      name\n      description\n      token\n      targetType\n      prompt\n      enabled\n      rateLimit\n      invocationCount\n      lastInvokedAt\n      createdAt\n    }\n  }\n": typeof types.SettingsWebhookDocument;
  "\n  query SettingsWebhookDeliveries($webhookId: ID!, $limit: Int) {\n    webhookDeliveries(webhookId: $webhookId, limit: $limit) {\n      id\n      receivedAt\n      providerName\n      normalizedKind\n      signatureStatus\n      resolutionStatus\n      statusCode\n      threadCreated\n    }\n  }\n": typeof types.SettingsWebhookDeliveriesDocument;
  "\n  mutation SettingsUpdateWebhook($id: ID!, $input: UpdateWebhookInput!) {\n    updateWebhook(id: $id, input: $input) {\n      id\n      name\n      description\n      prompt\n      enabled\n      rateLimit\n    }\n  }\n": typeof types.SettingsUpdateWebhookDocument;
  "\n  mutation SettingsDeleteWebhook($id: ID!) {\n    deleteWebhook(id: $id)\n  }\n": typeof types.SettingsDeleteWebhookDocument;
  "\n  mutation SettingsRegenerateWebhookToken($id: ID!) {\n    regenerateWebhookToken(id: $id) {\n      id\n      token\n    }\n  }\n": typeof types.SettingsRegenerateWebhookTokenDocument;
  "\n  query SettingsPluginCatalog {\n    pluginCatalog {\n      pluginKey\n      displayName\n      description\n      latestVersion\n      updateAvailable\n      versions {\n        version\n        payloadSha256\n        requiredOauthScopes\n        components {\n          key\n          type\n          displayName\n        }\n      }\n      install {\n        id\n        pluginKey\n        pinnedVersion\n        state\n        lastTransitionAt\n        lastError\n        activatedUserCount\n        components {\n          id\n          componentKey\n          componentType\n          state\n          handlerRef\n          lastError\n        }\n      }\n    }\n  }\n": typeof types.SettingsPluginCatalogDocument;
  "\n  query SettingsPluginInstalls {\n    pluginInstalls {\n      id\n      pluginKey\n      pinnedVersion\n      state\n      lastTransitionAt\n      lastError\n      activatedUserCount\n      components {\n        id\n        componentKey\n        componentType\n        state\n        handlerRef\n        lastError\n      }\n    }\n  }\n": typeof types.SettingsPluginInstallsDocument;
  "\n  query SettingsMyPluginActivations {\n    myPluginActivations {\n      id\n      pluginInstallId\n      pluginKey\n      status\n      grantedScopes\n      grantedAt\n      revokedAt\n    }\n  }\n": typeof types.SettingsMyPluginActivationsDocument;
  "\n  mutation SettingsInstallPlugin($input: InstallPluginInput!) {\n    installPlugin(input: $input) {\n      id\n      pluginKey\n      pinnedVersion\n      state\n    }\n  }\n": typeof types.SettingsInstallPluginDocument;
  "\n  mutation SettingsUpgradePlugin($input: UpgradePluginInput!) {\n    upgradePlugin(input: $input) {\n      id\n      pluginKey\n      pinnedVersion\n      state\n    }\n  }\n": typeof types.SettingsUpgradePluginDocument;
  "\n  mutation SettingsUninstallPlugin($input: UninstallPluginInput!) {\n    uninstallPlugin(input: $input) {\n      id\n      pluginKey\n      state\n    }\n  }\n": typeof types.SettingsUninstallPluginDocument;
  "\n  mutation SettingsRetryPluginComponent($input: RetryPluginComponentInput!) {\n    retryPluginComponent(input: $input) {\n      id\n      state\n      components {\n        id\n        componentKey\n        componentType\n        state\n        lastError\n      }\n    }\n  }\n": typeof types.SettingsRetryPluginComponentDocument;
  "\n  mutation SettingsActivatePlugin($input: ActivatePluginInput!) {\n    activatePlugin(input: $input) {\n      authorizeUrl\n    }\n  }\n": typeof types.SettingsActivatePluginDocument;
  "\n  mutation SettingsDeactivatePlugin($input: DeactivatePluginInput!) {\n    deactivatePlugin(input: $input) {\n      id\n      status\n      revokedAt\n    }\n  }\n": typeof types.SettingsDeactivatePluginDocument;
  "\n  query TenantSkillCatalog($agentId: ID) {\n    tenantSkillCatalog(agentId: $agentId) {\n      slug\n      displayName\n      description\n      icon\n      installed\n    }\n  }\n": typeof types.TenantSkillCatalogDocument;
  "\n  mutation AnswerUserQuestion($questionId: ID!, $answers: AWSJSON!) {\n    answerUserQuestion(questionId: $questionId, answers: $answers) {\n      id\n      threadId\n      messageId\n      status\n      answers\n      answeredVia\n      answeredBy\n      answeredAt\n    }\n  }\n": typeof types.AnswerUserQuestionDocument;
  "\n  mutation OnboardingBootstrapUser {\n    bootstrapUser {\n      tenant {\n        id\n        name\n        slug\n        plan\n      }\n    }\n  }\n": typeof types.OnboardingBootstrapUserDocument;
};
const documents: Documents = {
  "\n  query AppletState($appId: ID!, $instanceId: ID!, $key: String!) {\n    appletState(appId: $appId, instanceId: $instanceId, key: $key) {\n      appId\n      instanceId\n      key\n      value\n      updatedAt\n    }\n  }\n":
    types.AppletStateDocument,
  "\n  mutation SaveAppletState($input: SaveAppletStateInput!) {\n    saveAppletState(input: $input) {\n      appId\n      instanceId\n      key\n      value\n      updatedAt\n    }\n  }\n":
    types.SaveAppletStateDocument,
  "\n  subscription SpacesThreadActivity($userId: ID!) {\n    onThreadActivity(userId: $userId) {\n      userId\n      tenantId\n      threadId\n      messageId\n      authorId\n      authorType\n      snippet\n      threadTitle\n      createdAt\n    }\n  }\n":
    types.SpacesThreadActivityDocument,
  "\n  query AdminApplets(\n    $tenantId: ID!\n    $userId: ID\n    $cursor: String\n    $limit: Int\n  ) {\n    adminApplets(\n      tenantId: $tenantId\n      userId: $userId\n      cursor: $cursor\n      limit: $limit\n    ) {\n      nodes {\n        appId\n        name\n        version\n        tenantId\n        threadId\n        prompt\n        agentVersion\n        modelId\n        generatedAt\n        stdlibVersionAtGeneration\n        artifact {\n          id\n          favoritedAt\n        }\n      }\n      nextCursor\n    }\n  }\n":
    types.AdminAppletsDocument,
  "\n  mutation AdminUpdateAppletSource($input: AdminUpdateAppletSourceInput!) {\n    adminUpdateAppletSource(input: $input) {\n      ok\n      appId\n      version\n      validated\n      persisted\n      errors\n    }\n  }\n":
    types.AdminUpdateAppletSourceDocument,
  "\n  query EvalSummary($tenantId: ID!) {\n    evalSummary(tenantId: $tenantId) {\n      totalRuns\n      latestPassRate\n      avgPassRate\n      regressionCount\n    }\n  }\n":
    types.EvalSummaryDocument,
  "\n  query EvalRuns($tenantId: ID!, $limit: Int, $offset: Int) {\n    evalRuns(tenantId: $tenantId, limit: $limit, offset: $offset) {\n      items {\n        id\n        status\n        model\n        categories\n        totalTests\n        passed\n        failed\n        passRate\n        regression\n        costUsd\n        agentId\n        agentName\n        scheduledJobId\n        executionTarget\n        runtimeHost\n        startedAt\n        completedAt\n        createdAt\n      }\n      totalCount\n    }\n  }\n":
    types.EvalRunsDocument,
  "\n  query EvalRun($id: ID!) {\n    evalRun(id: $id) {\n      id\n      status\n      model\n      categories\n      totalTests\n      passed\n      failed\n      passRate\n      regression\n      costUsd\n      errorMessage\n      agentId\n      agentName\n      scheduledJobId\n      executionTarget\n      runtimeHost\n      startedAt\n      completedAt\n      createdAt\n    }\n  }\n":
    types.EvalRunDocument,
  "\n  query EvalRunResults($runId: ID!) {\n    evalRunResults(runId: $runId) {\n      id\n      testCaseId\n      testCaseName\n      category\n      status\n      score\n      durationMs\n      agentSessionId\n      input\n      actualOutput\n      systemPrompt\n      evaluatorResults\n      assertions\n      errorMessage\n      createdAt\n    }\n  }\n":
    types.EvalRunResultsDocument,
  "\n  query EvalResultSpans($runId: ID!, $testCaseId: ID!) {\n    evalResultSpans(runId: $runId, testCaseId: $testCaseId) {\n      timestamp\n      name\n      attributes\n    }\n  }\n":
    types.EvalResultSpansDocument,
  "\n  query EvalTimeSeries($tenantId: ID!, $days: Int) {\n    evalTimeSeries(tenantId: $tenantId, days: $days) {\n      day\n      passRate\n      runCount\n      passed\n      failed\n    }\n  }\n":
    types.EvalTimeSeriesDocument,
  "\n  query EvalTestCases($tenantId: ID!, $category: String, $search: String) {\n    evalTestCases(tenantId: $tenantId, category: $category, search: $search) {\n      id\n      name\n      category\n      query\n      systemPrompt\n      assertions\n      agentcoreEvaluatorIds\n      tags\n      enabled\n      source\n      createdAt\n      updatedAt\n    }\n  }\n":
    types.EvalTestCasesDocument,
  "\n  query EvalTestCase($id: ID!) {\n    evalTestCase(id: $id) {\n      id\n      name\n      category\n      query\n      systemPrompt\n      assertions\n      agentcoreEvaluatorIds\n      tags\n      enabled\n      source\n      createdAt\n      updatedAt\n    }\n  }\n":
    types.EvalTestCaseDocument,
  "\n  query EvalTestCaseHistory($testCaseId: ID!, $limit: Int) {\n    evalTestCaseHistory(testCaseId: $testCaseId, limit: $limit) {\n      id\n      runId\n      testCaseName\n      category\n      status\n      score\n      durationMs\n      input\n      expected\n      actualOutput\n      assertions\n      evaluatorResults\n      errorMessage\n      createdAt\n    }\n  }\n":
    types.EvalTestCaseHistoryDocument,
  "\n  mutation StartEvalRun($tenantId: ID!, $input: StartEvalRunInput!) {\n    startEvalRun(tenantId: $tenantId, input: $input) {\n      id\n      status\n      categories\n      createdAt\n    }\n  }\n":
    types.StartEvalRunDocument,
  "\n  mutation CreateEvalTestCase(\n    $tenantId: ID!\n    $input: CreateEvalTestCaseInput!\n  ) {\n    createEvalTestCase(tenantId: $tenantId, input: $input) {\n      id\n      name\n      category\n      query\n      systemPrompt\n      assertions\n      agentcoreEvaluatorIds\n      enabled\n      createdAt\n    }\n  }\n":
    types.CreateEvalTestCaseDocument,
  "\n  mutation UpdateEvalTestCase($id: ID!, $input: UpdateEvalTestCaseInput!) {\n    updateEvalTestCase(id: $id, input: $input) {\n      id\n      name\n      category\n      query\n      systemPrompt\n      assertions\n      agentcoreEvaluatorIds\n      enabled\n      updatedAt\n    }\n  }\n":
    types.UpdateEvalTestCaseDocument,
  "\n  mutation SeedEvalTestCases($tenantId: ID!, $categories: [String!]) {\n    seedEvalTestCases(tenantId: $tenantId, categories: $categories)\n  }\n":
    types.SeedEvalTestCasesDocument,
  "\n  mutation DeleteEvalTestCase($id: ID!) {\n    deleteEvalTestCase(id: $id)\n  }\n":
    types.DeleteEvalTestCaseDocument,
  "\n  mutation DeleteEvalRun($id: ID!) {\n    deleteEvalRun(id: $id)\n  }\n":
    types.DeleteEvalRunDocument,
  "\n  mutation CancelEvalRun($id: ID!) {\n    cancelEvalRun(id: $id) {\n      id\n      status\n      completedAt\n    }\n  }\n":
    types.CancelEvalRunDocument,
  "\n  subscription OnEvalRunUpdated($tenantId: ID!) {\n    onEvalRunUpdated(tenantId: $tenantId) {\n      runId\n      tenantId\n      agentId\n      status\n      totalTests\n      passed\n      failed\n      passRate\n      errorMessage\n      updatedAt\n    }\n  }\n":
    types.OnEvalRunUpdatedDocument,
  "\n  query KnowledgeBasesList($tenantId: ID!) {\n    knowledgeBases(tenantId: $tenantId) {\n      id\n      name\n      description\n      status\n      documentCount\n      lastSyncAt\n    }\n  }\n":
    types.KnowledgeBasesListDocument,
  "\n  query KnowledgeBaseDetail($id: ID!) {\n    knowledgeBase(id: $id) {\n      id\n      tenantId\n      name\n      slug\n      description\n      embeddingModel\n      chunkingStrategy\n      chunkSizeTokens\n      chunkOverlapPercent\n      status\n      awsKbId\n      lastSyncAt\n      lastSyncStatus\n      documentCount\n      errorMessage\n    }\n  }\n":
    types.KnowledgeBaseDetailDocument,
  "\n  query TestKnowledgeBaseRetrieval($id: ID!, $query: String!) {\n    testKnowledgeBaseRetrieval(id: $id, query: $query) {\n      status\n      hits {\n        snippet\n        score\n        source\n      }\n    }\n  }\n":
    types.TestKnowledgeBaseRetrievalDocument,
  "\n  mutation CreateKnowledgeBase($input: CreateKnowledgeBaseInput!) {\n    createKnowledgeBase(input: $input) {\n      id\n      name\n      status\n    }\n  }\n":
    types.CreateKnowledgeBaseDocument,
  "\n  mutation UpdateKnowledgeBase($id: ID!, $input: UpdateKnowledgeBaseInput!) {\n    updateKnowledgeBase(id: $id, input: $input) {\n      id\n      name\n      description\n      chunkingStrategy\n      chunkSizeTokens\n      chunkOverlapPercent\n      status\n    }\n  }\n":
    types.UpdateKnowledgeBaseDocument,
  "\n  mutation SyncKnowledgeBase($id: ID!) {\n    syncKnowledgeBase(id: $id) {\n      id\n      status\n      lastSyncStatus\n    }\n  }\n":
    types.SyncKnowledgeBaseDocument,
  "\n  mutation RetryKnowledgeBase($id: ID!) {\n    retryKnowledgeBase(id: $id) {\n      id\n      status\n      errorMessage\n    }\n  }\n":
    types.RetryKnowledgeBaseDocument,
  "\n  mutation DeleteKnowledgeBase($id: ID!) {\n    deleteKnowledgeBase(id: $id)\n  }\n":
    types.DeleteKnowledgeBaseDocument,
  "\n  query KnowledgeBaseBindings($tenantId: ID!) {\n    tenantAgent(tenantId: $tenantId) {\n      id\n      knowledgeBases {\n        knowledgeBaseId\n      }\n    }\n    spaces(tenantId: $tenantId, status: ACTIVE) {\n      id\n      name\n      knowledgeBases {\n        knowledgeBaseId\n      }\n    }\n  }\n":
    types.KnowledgeBaseBindingsDocument,
  "\n  mutation SetAgentKnowledgeBases(\n    $agentId: ID!\n    $knowledgeBases: [AgentKnowledgeBaseInput!]!\n  ) {\n    setAgentKnowledgeBases(agentId: $agentId, knowledgeBases: $knowledgeBases) {\n      id\n      knowledgeBaseId\n    }\n  }\n":
    types.SetAgentKnowledgeBasesDocument,
  "\n  mutation SetSpaceKnowledgeBases($input: SetSpaceKnowledgeBasesInput!) {\n    setSpaceKnowledgeBases(input: $input) {\n      id\n      knowledgeBaseId\n    }\n  }\n":
    types.SetSpaceKnowledgeBasesDocument,
  "\n  query RoutineDetail($id: ID!) {\n    routine(id: $id) {\n      id\n      tenantId\n      name\n      description\n      type\n      status\n      schedule\n      engine\n      currentVersion\n      config\n      lastRunAt\n      nextRunAt\n      agentId\n      agent {\n        id\n        name\n        avatarUrl\n      }\n      triggers {\n        id\n        triggerType\n        config\n        enabled\n      }\n      createdAt\n      updatedAt\n    }\n  }\n":
    types.RoutineDetailDocument,
  "\n  query RoutineRecipeCatalog($tenantId: ID!) {\n    routineRecipeCatalog(tenantId: $tenantId) {\n      id\n      displayName\n      description\n      category\n      hitlCapable\n      defaultArgs\n      configFields {\n        key\n        label\n        value\n        inputType\n        control\n        required\n        editable\n        options\n        placeholder\n        helpText\n        min\n        max\n        pattern\n      }\n    }\n  }\n":
    types.RoutineRecipeCatalogDocument,
  "\n  query TenantCredentials($tenantId: ID!, $status: TenantCredentialStatus) {\n    tenantCredentials(tenantId: $tenantId, status: $status) {\n      id\n      tenantId\n      displayName\n      slug\n      kind\n      status\n      metadataJson\n      schemaJson\n      eventbridgeConnectionArn\n      lastUsedAt\n      lastValidatedAt\n      createdAt\n      updatedAt\n      deletedAt\n    }\n  }\n":
    types.TenantCredentialsDocument,
  "\n  mutation TriggerRoutineRun($routineId: ID!, $input: AWSJSON) {\n    triggerRoutineRun(routineId: $routineId, input: $input) {\n      id\n      status\n      triggerSource\n      startedAt\n    }\n  }\n":
    types.TriggerRoutineRunDocument,
  "\n  query RoutineDefinition($routineId: ID!) {\n    routineDefinition(routineId: $routineId) {\n      routineId\n      currentVersion\n      versionId\n      title\n      description\n      kind\n      steps {\n        nodeId\n        recipeId\n        recipeName\n        label\n        args\n        configFields {\n          key\n          label\n          value\n          inputType\n          control\n          required\n          editable\n          options\n          placeholder\n          helpText\n          min\n          max\n          pattern\n        }\n      }\n    }\n  }\n":
    types.RoutineDefinitionDocument,
  "\n  query RoutineDefinitionArtifacts($routineId: ID!) {\n    routineDefinition(routineId: $routineId) {\n      routineId\n      versionId\n      aslJson\n      markdownSummary\n      stepManifestJson\n    }\n  }\n":
    types.RoutineDefinitionArtifactsDocument,
  "\n  mutation UpdateRoutineDefinition($input: UpdateRoutineDefinitionInput!) {\n    updateRoutineDefinition(input: $input) {\n      routineId\n      currentVersion\n      versionId\n      description\n      steps {\n        nodeId\n        args\n        configFields {\n          key\n          value\n          editable\n        }\n      }\n    }\n  }\n":
    types.UpdateRoutineDefinitionDocument,
  "\n  query RoutineExecutionsList(\n    $routineId: ID!\n    $status: RoutineExecutionStatus\n    $limit: Int\n    $cursor: String\n  ) {\n    routineExecutions(\n      routineId: $routineId\n      status: $status\n      limit: $limit\n      cursor: $cursor\n    ) {\n      id\n      status\n      triggerSource\n      startedAt\n      finishedAt\n      totalLlmCostUsdCents\n      errorCode\n      createdAt\n    }\n  }\n":
    types.RoutineExecutionsListDocument,
  "\n  query RoutineExecutionDetail($id: ID!) {\n    routineExecution(id: $id) {\n      id\n      tenantId\n      routineId\n      stateMachineArn\n      aliasArn\n      versionArn\n      sfnExecutionArn\n      triggerSource\n      inputJson\n      outputJson\n      status\n      startedAt\n      finishedAt\n      errorCode\n      errorMessage\n      totalLlmCostUsdCents\n      stepEvents {\n        id\n        nodeId\n        recipeType\n        status\n        startedAt\n        finishedAt\n        inputJson\n        outputJson\n        errorJson\n        llmCostUsdCents\n        retryCount\n        stdoutS3Uri\n        stderrS3Uri\n        stdoutPreview\n        truncated\n        createdAt\n      }\n      routine {\n        id\n        name\n        description\n        currentVersion\n        documentationMd\n      }\n      aslVersion {\n        id\n        versionNumber\n        aslJson\n        markdownSummary\n        stepManifestJson\n      }\n      createdAt\n    }\n  }\n":
    types.RoutineExecutionDetailDocument,
  "\n  query SettingsTenantDetail($id: ID!) {\n    tenant(id: $id) {\n      id\n      name\n      slug\n      plan\n      issuePrefix\n      issueCounter\n      settings {\n        id\n        defaultModel\n      }\n      createdAt\n    }\n  }\n":
    types.SettingsTenantDetailDocument,
  "\n  query SidebarDeployedRelease {\n    deploymentStatus {\n      releaseVersion\n    }\n  }\n":
    types.SidebarDeployedReleaseDocument,
  "\n  query SettingsDeploymentStatus {\n    deploymentStatus {\n      stage\n      source\n      region\n      accountId\n      releaseVersion\n      releaseManifestUrl\n      releaseManifestSha256\n      deploymentControllerArn\n      deploymentRunnerProjectName\n      deploymentEvidenceBucket\n      bucketName\n      databaseEndpoint\n      ecrUrl\n      adminUrl\n      docsUrl\n      apiEndpoint\n      appsyncUrl\n      appsyncRealtimeUrl\n      hindsightEndpoint\n      agentcoreStatus\n      hindsightEnabled\n      managedMemoryEnabled\n      cogneeEnabled\n      cogneeEndpoint\n      cogneeLogGroupName\n      cogneeBackendMode\n      cogneeClusterArn\n      cogneeServiceName\n      twentyProvisioned\n      twentyRuntimeEnabled\n      twentyUrl\n      twentyClusterArn\n      twentyServerServiceName\n      twentyWorkerServiceName\n      twentyServerLogGroupName\n      twentyWorkerLogGroupName\n      twentyAlbArn\n      twentyTargetGroupArn\n      managedApplications {\n        key\n        displayName\n        description\n        status\n        enabled\n        provisioned\n        runtimeEnabled\n        url\n        endpoint\n        backendMode\n        logGroupName\n        logGroupNames\n        clusterArn\n        serviceName\n        serviceNames\n        albArn\n        targetGroupArn\n        storageBucketName\n        databaseName\n        message\n        managedMcpServerId\n        managedMcpStatus\n        managedMcpInstalled\n        managedMcpInstallAvailable\n        managedMcpMessage\n      }\n    }\n  }\n":
    types.SettingsDeploymentStatusDocument,
  "\n  query SettingsDeploymentReleases($limit: Int) {\n    deploymentReleases(limit: $limit) {\n      version\n      name\n      prerelease\n      draft\n      publishedAt\n      htmlUrl\n      manifestUrl\n      manifestSha256\n      signatureUrl\n      signed\n      deployable\n    }\n  }\n":
    types.SettingsDeploymentReleasesDocument,
  "\n  mutation SettingsStartDeploymentReleaseUpdate(\n    $input: StartDeploymentReleaseUpdateInput!\n  ) {\n    startDeploymentReleaseUpdate(input: $input) {\n      executionArn\n      stateMachineArn\n      evidenceBucket\n      evidencePrefix\n      message\n      release {\n        version\n        manifestUrl\n        manifestSha256\n        signed\n        deployable\n      }\n    }\n  }\n":
    types.SettingsStartDeploymentReleaseUpdateDocument,
  "\n  mutation SettingsSetKnowledgeGraphDeployment($enabled: Boolean!) {\n    setKnowledgeGraphDeployment(input: { enabled: $enabled }) {\n      desiredEnabled\n      workflowUrl\n      message\n    }\n  }\n":
    types.SettingsSetKnowledgeGraphDeploymentDocument,
  "\n  mutation SettingsSetManagedApplicationDeployment(\n    $key: String!\n    $action: ManagedApplicationDeploymentAction!\n  ) {\n    setManagedApplicationDeployment(input: { key: $key, action: $action }) {\n      key\n      action\n      desiredEnabled\n      provisioned\n      runtimeEnabled\n      workflowUrl\n      message\n    }\n  }\n":
    types.SettingsSetManagedApplicationDeploymentDocument,
  "\n  mutation SettingsInstallManagedApplicationMcpServer($key: String!) {\n    installManagedApplicationMcpServer(key: $key) {\n      key\n      serverId\n      installed\n      status\n      message\n    }\n  }\n":
    types.SettingsInstallManagedApplicationMcpServerDocument,
  "\n  query SettingsManagedApplications {\n    managedApplications {\n      id\n      key\n      displayName\n      desiredStatus\n      currentStatus\n      selectedReleaseVersion\n      selectedManifestDigest\n      lastJobId\n      updatedAt\n    }\n  }\n":
    types.SettingsManagedApplicationsDocument,
  "\n  query SettingsManagedApplicationDeployment($jobId: ID!) {\n    managedApplicationDeployment(jobId: $jobId) {\n      id\n      appKey\n      operation\n      status\n      releaseVersion\n      manifestDigest\n      desiredConfigVersion\n      stateMachineArn\n      planExecutionArn\n      applyExecutionArn\n      codebuildBuildArn\n      planDigest\n      planSummary\n      dataImpact\n      evidenceBucket\n      evidencePrefix\n      approvalRequired\n      approvedAt\n      rejectedAt\n      errorMessage\n      createdAt\n      updatedAt\n      events {\n        id\n        eventType\n        message\n        payload\n        createdAt\n      }\n    }\n  }\n":
    types.SettingsManagedApplicationDeploymentDocument,
  "\n  query SettingsDeploymentEvidence($jobId: ID!) {\n    deploymentEvidence(jobId: $jobId) {\n      jobId\n      bucket\n      prefix\n      urls\n    }\n  }\n":
    types.SettingsDeploymentEvidenceDocument,
  "\n  mutation SettingsStartManagedApplicationPlan(\n    $input: StartManagedApplicationPlanInput!\n  ) {\n    startManagedApplicationPlan(input: $input) {\n      id\n      appKey\n      operation\n      status\n      releaseVersion\n      manifestDigest\n      desiredConfigVersion\n      stateMachineArn\n      planExecutionArn\n      applyExecutionArn\n      codebuildBuildArn\n      planDigest\n      planSummary\n      dataImpact\n      evidenceBucket\n      evidencePrefix\n      approvalRequired\n      approvedAt\n      rejectedAt\n      errorMessage\n      createdAt\n      updatedAt\n      events {\n        id\n        eventType\n        message\n        payload\n        createdAt\n      }\n    }\n  }\n":
    types.SettingsStartManagedApplicationPlanDocument,
  "\n  mutation SettingsApproveManagedApplicationDeployment(\n    $input: ApproveManagedApplicationDeploymentInput!\n  ) {\n    approveManagedApplicationDeployment(input: $input) {\n      id\n      appKey\n      operation\n      status\n      releaseVersion\n      manifestDigest\n      desiredConfigVersion\n      stateMachineArn\n      planExecutionArn\n      applyExecutionArn\n      codebuildBuildArn\n      planDigest\n      planSummary\n      dataImpact\n      evidenceBucket\n      evidencePrefix\n      approvalRequired\n      approvedAt\n      rejectedAt\n      errorMessage\n      createdAt\n      updatedAt\n      events {\n        id\n        eventType\n        message\n        payload\n        createdAt\n      }\n    }\n  }\n":
    types.SettingsApproveManagedApplicationDeploymentDocument,
  "\n  mutation SettingsRejectManagedApplicationDeployment(\n    $input: RejectManagedApplicationDeploymentInput!\n  ) {\n    rejectManagedApplicationDeployment(input: $input) {\n      id\n      appKey\n      operation\n      status\n      releaseVersion\n      manifestDigest\n      desiredConfigVersion\n      stateMachineArn\n      planExecutionArn\n      applyExecutionArn\n      codebuildBuildArn\n      planDigest\n      planSummary\n      dataImpact\n      evidenceBucket\n      evidencePrefix\n      approvalRequired\n      approvedAt\n      rejectedAt\n      errorMessage\n      createdAt\n      updatedAt\n      events {\n        id\n        eventType\n        message\n        payload\n        createdAt\n      }\n    }\n  }\n":
    types.SettingsRejectManagedApplicationDeploymentDocument,
  "\n  query SettingsKnowledgeGraphHealthCheck {\n    knowledgeGraphHealthCheck {\n      healthy\n      statusCode\n      latencyMs\n      endpoint\n      checkedAt\n      message\n    }\n  }\n":
    types.SettingsKnowledgeGraphHealthCheckDocument,
  "\n  query SettingsManagedApplicationHealthCheck($key: String!) {\n    managedApplicationHealthCheck(key: $key) {\n      key\n      healthy\n      statusCode\n      latencyMs\n      endpoint\n      checkedAt\n      message\n    }\n  }\n":
    types.SettingsManagedApplicationHealthCheckDocument,
  "\n  query SettingsKnowledgeGraphOntology($tenantId: ID!) {\n    ontologyDefinitions(tenantId: $tenantId) {\n      activeVersion {\n        id\n        versionNumber\n        status\n        activatedAt\n      }\n      entityTypes {\n        id\n        slug\n        name\n        description\n        broadType\n        aliases\n        lifecycleStatus\n        externalMappings {\n          id\n          mappingKind\n          vocabulary\n          externalUri\n          externalLabel\n        }\n      }\n      relationshipTypes {\n        id\n        slug\n        name\n        description\n        sourceTypeSlugs\n        targetTypeSlugs\n        aliases\n        lifecycleStatus\n        externalMappings {\n          id\n          mappingKind\n          vocabulary\n          externalUri\n          externalLabel\n        }\n      }\n      externalMappings {\n        id\n        subjectKind\n        subjectId\n        mappingKind\n        vocabulary\n        externalUri\n        externalLabel\n      }\n    }\n  }\n":
    types.SettingsKnowledgeGraphOntologyDocument,
  "\n  query SettingsKnowledgeGraphThreadCandidates(\n    $tenantId: ID!\n    $query: String\n    $limit: Int\n  ) {\n    knowledgeGraphThreadCandidates(\n      tenantId: $tenantId\n      query: $query\n      limit: $limit\n    ) {\n      threadId\n      tenantId\n      title\n      number\n      requesterUserId\n      requesterName\n      spaceId\n      spaceName\n      messageCount\n      lastMessageAt\n      lastIngestRun {\n        id\n        threadId\n        status\n        entityCount\n        relationshipCount\n        evidenceCount\n        diagnosticCount\n        messageCount\n        metrics\n        durationMs\n        error\n        createdAt\n        startedAt\n        finishedAt\n      }\n    }\n  }\n":
    types.SettingsKnowledgeGraphThreadCandidatesDocument,
  "\n  query SettingsKnowledgeGraphIngestRuns(\n    $tenantId: ID!\n    $threadId: ID\n    $limit: Int\n  ) {\n    knowledgeGraphIngestRuns(\n      tenantId: $tenantId\n      threadId: $threadId\n      limit: $limit\n    ) {\n      id\n      threadId\n      status\n      trigger\n      cogneeDatasetName\n      cogneeDatasetId\n      entityCount\n      relationshipCount\n      evidenceCount\n      diagnosticCount\n      messageCount\n      metrics\n      durationMs\n      error\n      createdAt\n      updatedAt\n      startedAt\n      finishedAt\n    }\n  }\n":
    types.SettingsKnowledgeGraphIngestRunsDocument,
  "\n  query SettingsKnowledgeGraphEntities(\n    $tenantId: ID!\n    $threadId: ID\n    $runId: ID\n    $search: String\n    $ontologyType: String\n    $groundingStatus: KnowledgeGraphGroundingStatus\n    $provenanceStatus: KnowledgeGraphProvenanceStatus\n    $limit: Int\n  ) {\n    knowledgeGraphEntities(\n      tenantId: $tenantId\n      threadId: $threadId\n      runId: $runId\n      search: $search\n      ontologyType: $ontologyType\n      groundingStatus: $groundingStatus\n      provenanceStatus: $provenanceStatus\n      limit: $limit\n    ) {\n      id\n      label\n      normalizedLabel\n      typeLabel\n      ontologyTypeSlug\n      groundingStatus\n      provenanceStatus\n      summary\n      aliases\n      relationshipCount\n      evidenceCount\n      lastSeenAt\n      createdAt\n      updatedAt\n    }\n  }\n":
    types.SettingsKnowledgeGraphEntitiesDocument,
  "\n  query SettingsKnowledgeGraphEntity($tenantId: ID!, $entityId: ID!) {\n    knowledgeGraphEntity(tenantId: $tenantId, entityId: $entityId) {\n      id\n      label\n      normalizedLabel\n      typeLabel\n      ontologyTypeSlug\n      groundingStatus\n      provenanceStatus\n      summary\n      aliases\n      properties\n      diagnostics\n      relationshipCount\n      evidenceCount\n      lastSeenAt\n      relationships {\n        id\n        sourceEntityId\n        targetEntityId\n        label\n        ontologyTypeSlug\n        groundingStatus\n        provenanceStatus\n        confidence\n        evidenceCount\n        lastSeenAt\n        evidence {\n          id\n          snippet\n          messageId\n          messageRole\n          messageCreatedAt\n          speakerLabel\n        }\n      }\n      evidence {\n        id\n        snippet\n        messageId\n        messageRole\n        messageCreatedAt\n        speakerLabel\n      }\n    }\n  }\n":
    types.SettingsKnowledgeGraphEntityDocument,
  "\n  mutation SettingsStartKnowledgeGraphThreadIngest(\n    $input: StartKnowledgeGraphThreadIngestInput!\n  ) {\n    startKnowledgeGraphThreadIngest(input: $input) {\n      id\n      status\n      threadId\n      entityCount\n      relationshipCount\n      evidenceCount\n      diagnosticCount\n      messageCount\n      metrics\n      durationMs\n      error\n      createdAt\n      startedAt\n      finishedAt\n    }\n  }\n":
    types.SettingsStartKnowledgeGraphThreadIngestDocument,
  "\n  mutation SettingsRenameTenantSlug($tenantId: ID!, $newSlug: String!) {\n    renameTenantSlug(tenantId: $tenantId, newSlug: $newSlug) {\n      id\n      slug\n      updatedAt\n    }\n  }\n":
    types.SettingsRenameTenantSlugDocument,
  "\n  query SettingsTenantFeatures($id: ID!) {\n    tenant(id: $id) {\n      id\n      settings {\n        id\n        features\n      }\n    }\n  }\n":
    types.SettingsTenantFeaturesDocument,
  "\n  mutation SettingsUpdateTenantArtifactStyle(\n    $tenantId: ID!\n    $input: UpdateTenantSettingsInput!\n  ) {\n    updateTenantSettings(tenantId: $tenantId, input: $input) {\n      id\n      features\n      updatedAt\n    }\n  }\n":
    types.SettingsUpdateTenantArtifactStyleDocument,
  "\n  query SettingsSpacesList($tenantId: ID!) {\n    spaces(tenantId: $tenantId, status: ACTIVE, includeAllForAdmin: true) {\n      id\n      tenantId\n      name\n      description\n      status\n      accessMode\n      updatedAt\n    }\n  }\n":
    types.SettingsSpacesListDocument,
  "\n  mutation SettingsCreateSpace($input: CreateSpaceInput!) {\n    createSpace(input: $input) {\n      id\n      tenantId\n      name\n      description\n      status\n      accessMode\n      updatedAt\n    }\n  }\n":
    types.SettingsCreateSpaceDocument,
  "\n  query SettingsSpace($id: ID!) {\n    space(id: $id) {\n      id\n      tenantId\n      name\n      description\n      status\n      accessMode\n      slug\n      config\n      renderDiagnostics\n      toolPolicy\n      mcpPolicy\n      builtInTools\n    }\n  }\n":
    types.SettingsSpaceDocument,
  "\n  mutation SettingsUpdateSpace($input: UpdateSpaceInput!) {\n    updateSpace(input: $input) {\n      id\n      name\n      description\n      accessMode\n    }\n  }\n":
    types.SettingsUpdateSpaceDocument,
  "\n  query SettingsTenantAgent($tenantId: ID!) {\n    agent: tenantAgent(tenantId: $tenantId) {\n      id\n      tenantId\n      name\n      runtime\n      model\n      blockedTools\n      sandbox\n      browser\n      webSearch\n      webExtract\n      sendEmail\n      contextEngine\n    }\n  }\n":
    types.SettingsTenantAgentDocument,
  "\n  query SettingsTenantSandboxStatus($id: ID!) {\n    tenant(id: $id) {\n      id\n      sandboxEnabled\n      complianceTier\n      sandboxInterpreterPublicId\n      sandboxInterpreterInternalId\n    }\n  }\n":
    types.SettingsTenantSandboxStatusDocument,
  "\n  query SettingsModelCatalog {\n    modelCatalog {\n      id\n      modelId\n      displayName\n      provider\n    }\n  }\n":
    types.SettingsModelCatalogDocument,
  "\n  query SettingsTenantModelCatalog(\n    $tenantId: ID!\n    $includeDisabled: Boolean = true\n  ) {\n    tenantModelCatalog(tenantId: $tenantId, includeDisabled: $includeDisabled) {\n      tenantId\n      modelId\n      provider\n      displayName\n      canonicalDisplayName\n      inputCostPerMillion\n      outputCostPerMillion\n      contextWindow\n      maxOutputTokens\n      supportsVision\n      supportsTools\n      enabled\n      pricingStatus\n      pricingSource\n      pricingDiagnostics\n      lastPricedAt\n      importSource\n      importPayload\n      importedByUserId\n      importedAt\n      createdAt\n      updatedAt\n    }\n  }\n":
    types.SettingsTenantModelCatalogDocument,
  "\n  query SettingsBedrockModelImportCandidates($tenantId: ID!) {\n    bedrockModelImportCandidates(tenantId: $tenantId) {\n      provider\n      providerName\n      modelName\n      modelId\n      displayName\n      inputModalities\n      outputModalities\n      supportsStreaming\n      supportsVision\n      supportsTools\n      customizationsSupported\n      inferenceTypesSupported\n      lifecycleStatus\n      inputCostPerMillion\n      outputCostPerMillion\n      pricingStatus\n      pricingSource\n      pricingDiagnostics\n      alreadyImported\n      enabled\n    }\n  }\n":
    types.SettingsBedrockModelImportCandidatesDocument,
  "\n  mutation SettingsImportTenantBedrockModels(\n    $input: ImportTenantBedrockModelsInput!\n  ) {\n    importTenantBedrockModels(input: $input) {\n      tenantId\n      modelId\n      provider\n      displayName\n      canonicalDisplayName\n      inputCostPerMillion\n      outputCostPerMillion\n      contextWindow\n      maxOutputTokens\n      supportsVision\n      supportsTools\n      enabled\n      pricingStatus\n      pricingSource\n      pricingDiagnostics\n      lastPricedAt\n      importSource\n      importPayload\n      importedByUserId\n      importedAt\n      createdAt\n      updatedAt\n    }\n  }\n":
    types.SettingsImportTenantBedrockModelsDocument,
  "\n  mutation SettingsUpdateTenantModelCatalogEntry(\n    $input: UpdateTenantModelCatalogEntryInput!\n  ) {\n    updateTenantModelCatalogEntry(input: $input) {\n      tenantId\n      modelId\n      provider\n      displayName\n      canonicalDisplayName\n      inputCostPerMillion\n      outputCostPerMillion\n      contextWindow\n      maxOutputTokens\n      supportsVision\n      supportsTools\n      enabled\n      pricingStatus\n      pricingSource\n      pricingDiagnostics\n      lastPricedAt\n      importSource\n      importPayload\n      importedByUserId\n      importedAt\n      createdAt\n      updatedAt\n    }\n  }\n":
    types.SettingsUpdateTenantModelCatalogEntryDocument,
  "\n  mutation SettingsUpdateTenantAgent(\n    $tenantId: ID!\n    $input: UpdateTenantAgentInput!\n  ) {\n    updateTenantAgent(tenantId: $tenantId, input: $input) {\n      id\n      runtime\n      model\n      updatedAt\n    }\n  }\n":
    types.SettingsUpdateTenantAgentDocument,
  "\n  query SettingsAgentProfiles($tenantId: ID!) {\n    agentProfiles(tenantId: $tenantId, includeDisabled: true) {\n      id\n      tenantId\n      slug\n      name\n      description\n      routingGuidance\n      instructions\n      modelId\n      model {\n        id\n        modelId\n        provider\n        displayName\n        inputCostPerMillion\n        outputCostPerMillion\n      }\n      enabled\n      builtInKey\n      toolPolicy\n      skillPolicy\n      executionControls\n      spaces {\n        id\n        name\n        slug\n      }\n      createdAt\n      updatedAt\n    }\n    agentProfileEditorCatalog(tenantId: $tenantId) {\n      models {\n        id\n        modelId\n        provider\n        displayName\n        inputCostPerMillion\n        outputCostPerMillion\n      }\n      spaces {\n        id\n        name\n        slug\n      }\n      skills {\n        slug\n        displayName\n        description\n        category\n      }\n      builtInTools\n      mcpServers {\n        id\n        name\n        slug\n        enabled\n        status\n        tools\n      }\n    }\n  }\n":
    types.SettingsAgentProfilesDocument,
  "\n  mutation SettingsCreateAgentProfile(\n    $tenantId: ID!\n    $input: AgentProfileInput!\n  ) {\n    createAgentProfile(tenantId: $tenantId, input: $input) {\n      id\n      slug\n      name\n      updatedAt\n    }\n  }\n":
    types.SettingsCreateAgentProfileDocument,
  "\n  mutation SettingsUpdateAgentProfile(\n    $tenantId: ID!\n    $id: ID!\n    $input: UpdateAgentProfileInput!\n  ) {\n    updateAgentProfile(tenantId: $tenantId, id: $id, input: $input) {\n      id\n      slug\n      name\n      enabled\n      updatedAt\n    }\n  }\n":
    types.SettingsUpdateAgentProfileDocument,
  "\n  mutation SettingsDeleteAgentProfile($tenantId: ID!, $id: ID!) {\n    deleteAgentProfile(tenantId: $tenantId, id: $id)\n  }\n":
    types.SettingsDeleteAgentProfileDocument,
  "\n  query SettingsTenantMembers($tenantId: ID!) {\n    tenantMembers(tenantId: $tenantId) {\n      id\n      principalType\n      principalId\n      role\n      status\n      cognitoStatus\n      createdAt\n      user {\n        id\n        name\n        email\n        profile {\n          id\n          title\n          timezone\n          pronouns\n          callBy\n          notes\n        }\n      }\n    }\n  }\n":
    types.SettingsTenantMembersDocument,
  "\n  mutation SettingsUpdateUser($id: ID!, $input: UpdateUserInput!) {\n    updateUser(id: $id, input: $input) {\n      id\n      name\n      updatedAt\n    }\n  }\n":
    types.SettingsUpdateUserDocument,
  "\n  mutation SettingsUpdateUserProfile(\n    $userId: ID!\n    $input: UpdateUserProfileInput!\n  ) {\n    updateUserProfile(userId: $userId, input: $input) {\n      id\n      title\n      timezone\n      pronouns\n      callBy\n      notes\n      updatedAt\n    }\n  }\n":
    types.SettingsUpdateUserProfileDocument,
  "\n  query SettingsUserBudgetStatus($tenantId: ID!, $userId: ID!) {\n    userBudgetStatus(tenantId: $tenantId, userId: $userId) {\n      policy {\n        id\n        tenantId\n        userId\n        scope\n        period\n        limitUsd\n        actionOnExceed\n        enabled\n      }\n      spentUsd\n      remainingUsd\n      percentUsed\n      status\n    }\n  }\n":
    types.SettingsUserBudgetStatusDocument,
  "\n  mutation SettingsUpsertBudgetPolicy(\n    $tenantId: ID!\n    $input: UpsertBudgetPolicyInput!\n  ) {\n    upsertBudgetPolicy(tenantId: $tenantId, input: $input) {\n      id\n      tenantId\n      userId\n      scope\n      period\n      limitUsd\n      actionOnExceed\n      enabled\n      updatedAt\n    }\n  }\n":
    types.SettingsUpsertBudgetPolicyDocument,
  "\n  mutation SettingsDeleteBudgetPolicy($id: ID!) {\n    deleteBudgetPolicy(id: $id)\n  }\n":
    types.SettingsDeleteBudgetPolicyDocument,
  "\n  mutation SettingsUpdateTenantMember(\n    $id: ID!\n    $input: UpdateTenantMemberInput!\n  ) {\n    updateTenantMember(id: $id, input: $input) {\n      id\n      role\n      status\n      updatedAt\n    }\n  }\n":
    types.SettingsUpdateTenantMemberDocument,
  "\n  mutation SettingsRemoveTenantMember($id: ID!) {\n    removeTenantMember(id: $id)\n  }\n":
    types.SettingsRemoveTenantMemberDocument,
  "\n  mutation SettingsInviteMember($tenantId: ID!, $input: InviteMemberInput!) {\n    inviteMember(tenantId: $tenantId, input: $input) {\n      id\n      principalType\n      principalId\n      role\n      status\n      createdAt\n      user {\n        id\n        name\n        email\n      }\n    }\n  }\n":
    types.SettingsInviteMemberDocument,
  "\n  query SettingsCostSummary($tenantId: ID!) {\n    costSummary(tenantId: $tenantId) {\n      totalUsd\n      llmUsd\n      computeUsd\n      toolsUsd\n      totalInputTokens\n      totalOutputTokens\n      eventCount\n    }\n  }\n":
    types.SettingsCostSummaryDocument,
  "\n  query SettingsCostByUser($tenantId: ID!) {\n    costByUser(tenantId: $tenantId) {\n      userId\n      userName\n      userEmail\n      totalUsd\n      eventCount\n      isSystem\n    }\n  }\n":
    types.SettingsCostByUserDocument,
  "\n  query SettingsBudgetStatus($tenantId: ID!) {\n    budgetStatus(tenantId: $tenantId) {\n      policy {\n        id\n        tenantId\n        userId\n        scope\n        period\n        limitUsd\n        actionOnExceed\n        enabled\n      }\n      spentUsd\n      remainingUsd\n      percentUsed\n      status\n    }\n  }\n":
    types.SettingsBudgetStatusDocument,
  "\n  query SettingsCostByModel($tenantId: ID!) {\n    costByModel(tenantId: $tenantId) {\n      model\n      totalUsd\n      inputTokens\n      outputTokens\n    }\n  }\n":
    types.SettingsCostByModelDocument,
  "\n  query SettingsCostTimeSeries($tenantId: ID!, $days: Int) {\n    costTimeSeries(tenantId: $tenantId, days: $days) {\n      day\n      totalUsd\n      llmUsd\n      computeUsd\n      toolsUsd\n      eventCount\n    }\n  }\n":
    types.SettingsCostTimeSeriesDocument,
  "\n  query SettingsRoutines($tenantId: ID!) {\n    routines(tenantId: $tenantId) {\n      id\n      name\n      description\n      status\n      lastRunAt\n      engine\n      createdAt\n    }\n  }\n":
    types.SettingsRoutinesDocument,
  "\n  query SettingsWebhooks($tenantId: ID!) {\n    webhooks(tenantId: $tenantId) {\n      id\n      name\n      description\n      targetType\n      enabled\n      invocationCount\n      lastInvokedAt\n      createdAt\n    }\n  }\n":
    types.SettingsWebhooksDocument,
  "\n  query SettingsWebhook($id: ID!) {\n    webhook(id: $id) {\n      id\n      name\n      description\n      token\n      targetType\n      prompt\n      enabled\n      rateLimit\n      invocationCount\n      lastInvokedAt\n      createdAt\n    }\n  }\n":
    types.SettingsWebhookDocument,
  "\n  query SettingsWebhookDeliveries($webhookId: ID!, $limit: Int) {\n    webhookDeliveries(webhookId: $webhookId, limit: $limit) {\n      id\n      receivedAt\n      providerName\n      normalizedKind\n      signatureStatus\n      resolutionStatus\n      statusCode\n      threadCreated\n    }\n  }\n":
    types.SettingsWebhookDeliveriesDocument,
  "\n  mutation SettingsUpdateWebhook($id: ID!, $input: UpdateWebhookInput!) {\n    updateWebhook(id: $id, input: $input) {\n      id\n      name\n      description\n      prompt\n      enabled\n      rateLimit\n    }\n  }\n":
    types.SettingsUpdateWebhookDocument,
  "\n  mutation SettingsDeleteWebhook($id: ID!) {\n    deleteWebhook(id: $id)\n  }\n":
    types.SettingsDeleteWebhookDocument,
  "\n  mutation SettingsRegenerateWebhookToken($id: ID!) {\n    regenerateWebhookToken(id: $id) {\n      id\n      token\n    }\n  }\n":
    types.SettingsRegenerateWebhookTokenDocument,
  "\n  query SettingsPluginCatalog {\n    pluginCatalog {\n      pluginKey\n      displayName\n      description\n      latestVersion\n      updateAvailable\n      versions {\n        version\n        payloadSha256\n        requiredOauthScopes\n        components {\n          key\n          type\n          displayName\n        }\n      }\n      install {\n        id\n        pluginKey\n        pinnedVersion\n        state\n        lastTransitionAt\n        lastError\n        activatedUserCount\n        components {\n          id\n          componentKey\n          componentType\n          state\n          handlerRef\n          lastError\n        }\n      }\n    }\n  }\n":
    types.SettingsPluginCatalogDocument,
  "\n  query SettingsPluginInstalls {\n    pluginInstalls {\n      id\n      pluginKey\n      pinnedVersion\n      state\n      lastTransitionAt\n      lastError\n      activatedUserCount\n      components {\n        id\n        componentKey\n        componentType\n        state\n        handlerRef\n        lastError\n      }\n    }\n  }\n":
    types.SettingsPluginInstallsDocument,
  "\n  query SettingsMyPluginActivations {\n    myPluginActivations {\n      id\n      pluginInstallId\n      pluginKey\n      status\n      grantedScopes\n      grantedAt\n      revokedAt\n    }\n  }\n":
    types.SettingsMyPluginActivationsDocument,
  "\n  mutation SettingsInstallPlugin($input: InstallPluginInput!) {\n    installPlugin(input: $input) {\n      id\n      pluginKey\n      pinnedVersion\n      state\n    }\n  }\n":
    types.SettingsInstallPluginDocument,
  "\n  mutation SettingsUpgradePlugin($input: UpgradePluginInput!) {\n    upgradePlugin(input: $input) {\n      id\n      pluginKey\n      pinnedVersion\n      state\n    }\n  }\n":
    types.SettingsUpgradePluginDocument,
  "\n  mutation SettingsUninstallPlugin($input: UninstallPluginInput!) {\n    uninstallPlugin(input: $input) {\n      id\n      pluginKey\n      state\n    }\n  }\n":
    types.SettingsUninstallPluginDocument,
  "\n  mutation SettingsRetryPluginComponent($input: RetryPluginComponentInput!) {\n    retryPluginComponent(input: $input) {\n      id\n      state\n      components {\n        id\n        componentKey\n        componentType\n        state\n        lastError\n      }\n    }\n  }\n":
    types.SettingsRetryPluginComponentDocument,
  "\n  mutation SettingsActivatePlugin($input: ActivatePluginInput!) {\n    activatePlugin(input: $input) {\n      authorizeUrl\n    }\n  }\n":
    types.SettingsActivatePluginDocument,
  "\n  mutation SettingsDeactivatePlugin($input: DeactivatePluginInput!) {\n    deactivatePlugin(input: $input) {\n      id\n      status\n      revokedAt\n    }\n  }\n":
    types.SettingsDeactivatePluginDocument,
  "\n  query TenantSkillCatalog($agentId: ID) {\n    tenantSkillCatalog(agentId: $agentId) {\n      slug\n      displayName\n      description\n      icon\n      installed\n    }\n  }\n":
    types.TenantSkillCatalogDocument,
  "\n  mutation AnswerUserQuestion($questionId: ID!, $answers: AWSJSON!) {\n    answerUserQuestion(questionId: $questionId, answers: $answers) {\n      id\n      threadId\n      messageId\n      status\n      answers\n      answeredVia\n      answeredBy\n      answeredAt\n    }\n  }\n":
    types.AnswerUserQuestionDocument,
  "\n  mutation OnboardingBootstrapUser {\n    bootstrapUser {\n      tenant {\n        id\n        name\n        slug\n        plan\n      }\n    }\n  }\n":
    types.OnboardingBootstrapUserDocument,
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
  source: "\n  query AppletState($appId: ID!, $instanceId: ID!, $key: String!) {\n    appletState(appId: $appId, instanceId: $instanceId, key: $key) {\n      appId\n      instanceId\n      key\n      value\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  query AppletState($appId: ID!, $instanceId: ID!, $key: String!) {\n    appletState(appId: $appId, instanceId: $instanceId, key: $key) {\n      appId\n      instanceId\n      key\n      value\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SaveAppletState($input: SaveAppletStateInput!) {\n    saveAppletState(input: $input) {\n      appId\n      instanceId\n      key\n      value\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation SaveAppletState($input: SaveAppletStateInput!) {\n    saveAppletState(input: $input) {\n      appId\n      instanceId\n      key\n      value\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  subscription SpacesThreadActivity($userId: ID!) {\n    onThreadActivity(userId: $userId) {\n      userId\n      tenantId\n      threadId\n      messageId\n      authorId\n      authorType\n      snippet\n      threadTitle\n      createdAt\n    }\n  }\n",
): (typeof documents)["\n  subscription SpacesThreadActivity($userId: ID!) {\n    onThreadActivity(userId: $userId) {\n      userId\n      tenantId\n      threadId\n      messageId\n      authorId\n      authorType\n      snippet\n      threadTitle\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query AdminApplets(\n    $tenantId: ID!\n    $userId: ID\n    $cursor: String\n    $limit: Int\n  ) {\n    adminApplets(\n      tenantId: $tenantId\n      userId: $userId\n      cursor: $cursor\n      limit: $limit\n    ) {\n      nodes {\n        appId\n        name\n        version\n        tenantId\n        threadId\n        prompt\n        agentVersion\n        modelId\n        generatedAt\n        stdlibVersionAtGeneration\n        artifact {\n          id\n          favoritedAt\n        }\n      }\n      nextCursor\n    }\n  }\n",
): (typeof documents)["\n  query AdminApplets(\n    $tenantId: ID!\n    $userId: ID\n    $cursor: String\n    $limit: Int\n  ) {\n    adminApplets(\n      tenantId: $tenantId\n      userId: $userId\n      cursor: $cursor\n      limit: $limit\n    ) {\n      nodes {\n        appId\n        name\n        version\n        tenantId\n        threadId\n        prompt\n        agentVersion\n        modelId\n        generatedAt\n        stdlibVersionAtGeneration\n        artifact {\n          id\n          favoritedAt\n        }\n      }\n      nextCursor\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation AdminUpdateAppletSource($input: AdminUpdateAppletSourceInput!) {\n    adminUpdateAppletSource(input: $input) {\n      ok\n      appId\n      version\n      validated\n      persisted\n      errors\n    }\n  }\n",
): (typeof documents)["\n  mutation AdminUpdateAppletSource($input: AdminUpdateAppletSourceInput!) {\n    adminUpdateAppletSource(input: $input) {\n      ok\n      appId\n      version\n      validated\n      persisted\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query EvalSummary($tenantId: ID!) {\n    evalSummary(tenantId: $tenantId) {\n      totalRuns\n      latestPassRate\n      avgPassRate\n      regressionCount\n    }\n  }\n",
): (typeof documents)["\n  query EvalSummary($tenantId: ID!) {\n    evalSummary(tenantId: $tenantId) {\n      totalRuns\n      latestPassRate\n      avgPassRate\n      regressionCount\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query EvalRuns($tenantId: ID!, $limit: Int, $offset: Int) {\n    evalRuns(tenantId: $tenantId, limit: $limit, offset: $offset) {\n      items {\n        id\n        status\n        model\n        categories\n        totalTests\n        passed\n        failed\n        passRate\n        regression\n        costUsd\n        agentId\n        agentName\n        scheduledJobId\n        executionTarget\n        runtimeHost\n        startedAt\n        completedAt\n        createdAt\n      }\n      totalCount\n    }\n  }\n",
): (typeof documents)["\n  query EvalRuns($tenantId: ID!, $limit: Int, $offset: Int) {\n    evalRuns(tenantId: $tenantId, limit: $limit, offset: $offset) {\n      items {\n        id\n        status\n        model\n        categories\n        totalTests\n        passed\n        failed\n        passRate\n        regression\n        costUsd\n        agentId\n        agentName\n        scheduledJobId\n        executionTarget\n        runtimeHost\n        startedAt\n        completedAt\n        createdAt\n      }\n      totalCount\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query EvalRun($id: ID!) {\n    evalRun(id: $id) {\n      id\n      status\n      model\n      categories\n      totalTests\n      passed\n      failed\n      passRate\n      regression\n      costUsd\n      errorMessage\n      agentId\n      agentName\n      scheduledJobId\n      executionTarget\n      runtimeHost\n      startedAt\n      completedAt\n      createdAt\n    }\n  }\n",
): (typeof documents)["\n  query EvalRun($id: ID!) {\n    evalRun(id: $id) {\n      id\n      status\n      model\n      categories\n      totalTests\n      passed\n      failed\n      passRate\n      regression\n      costUsd\n      errorMessage\n      agentId\n      agentName\n      scheduledJobId\n      executionTarget\n      runtimeHost\n      startedAt\n      completedAt\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query EvalRunResults($runId: ID!) {\n    evalRunResults(runId: $runId) {\n      id\n      testCaseId\n      testCaseName\n      category\n      status\n      score\n      durationMs\n      agentSessionId\n      input\n      actualOutput\n      systemPrompt\n      evaluatorResults\n      assertions\n      errorMessage\n      createdAt\n    }\n  }\n",
): (typeof documents)["\n  query EvalRunResults($runId: ID!) {\n    evalRunResults(runId: $runId) {\n      id\n      testCaseId\n      testCaseName\n      category\n      status\n      score\n      durationMs\n      agentSessionId\n      input\n      actualOutput\n      systemPrompt\n      evaluatorResults\n      assertions\n      errorMessage\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query EvalResultSpans($runId: ID!, $testCaseId: ID!) {\n    evalResultSpans(runId: $runId, testCaseId: $testCaseId) {\n      timestamp\n      name\n      attributes\n    }\n  }\n",
): (typeof documents)["\n  query EvalResultSpans($runId: ID!, $testCaseId: ID!) {\n    evalResultSpans(runId: $runId, testCaseId: $testCaseId) {\n      timestamp\n      name\n      attributes\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query EvalTimeSeries($tenantId: ID!, $days: Int) {\n    evalTimeSeries(tenantId: $tenantId, days: $days) {\n      day\n      passRate\n      runCount\n      passed\n      failed\n    }\n  }\n",
): (typeof documents)["\n  query EvalTimeSeries($tenantId: ID!, $days: Int) {\n    evalTimeSeries(tenantId: $tenantId, days: $days) {\n      day\n      passRate\n      runCount\n      passed\n      failed\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query EvalTestCases($tenantId: ID!, $category: String, $search: String) {\n    evalTestCases(tenantId: $tenantId, category: $category, search: $search) {\n      id\n      name\n      category\n      query\n      systemPrompt\n      assertions\n      agentcoreEvaluatorIds\n      tags\n      enabled\n      source\n      createdAt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  query EvalTestCases($tenantId: ID!, $category: String, $search: String) {\n    evalTestCases(tenantId: $tenantId, category: $category, search: $search) {\n      id\n      name\n      category\n      query\n      systemPrompt\n      assertions\n      agentcoreEvaluatorIds\n      tags\n      enabled\n      source\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query EvalTestCase($id: ID!) {\n    evalTestCase(id: $id) {\n      id\n      name\n      category\n      query\n      systemPrompt\n      assertions\n      agentcoreEvaluatorIds\n      tags\n      enabled\n      source\n      createdAt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  query EvalTestCase($id: ID!) {\n    evalTestCase(id: $id) {\n      id\n      name\n      category\n      query\n      systemPrompt\n      assertions\n      agentcoreEvaluatorIds\n      tags\n      enabled\n      source\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query EvalTestCaseHistory($testCaseId: ID!, $limit: Int) {\n    evalTestCaseHistory(testCaseId: $testCaseId, limit: $limit) {\n      id\n      runId\n      testCaseName\n      category\n      status\n      score\n      durationMs\n      input\n      expected\n      actualOutput\n      assertions\n      evaluatorResults\n      errorMessage\n      createdAt\n    }\n  }\n",
): (typeof documents)["\n  query EvalTestCaseHistory($testCaseId: ID!, $limit: Int) {\n    evalTestCaseHistory(testCaseId: $testCaseId, limit: $limit) {\n      id\n      runId\n      testCaseName\n      category\n      status\n      score\n      durationMs\n      input\n      expected\n      actualOutput\n      assertions\n      evaluatorResults\n      errorMessage\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation StartEvalRun($tenantId: ID!, $input: StartEvalRunInput!) {\n    startEvalRun(tenantId: $tenantId, input: $input) {\n      id\n      status\n      categories\n      createdAt\n    }\n  }\n",
): (typeof documents)["\n  mutation StartEvalRun($tenantId: ID!, $input: StartEvalRunInput!) {\n    startEvalRun(tenantId: $tenantId, input: $input) {\n      id\n      status\n      categories\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation CreateEvalTestCase(\n    $tenantId: ID!\n    $input: CreateEvalTestCaseInput!\n  ) {\n    createEvalTestCase(tenantId: $tenantId, input: $input) {\n      id\n      name\n      category\n      query\n      systemPrompt\n      assertions\n      agentcoreEvaluatorIds\n      enabled\n      createdAt\n    }\n  }\n",
): (typeof documents)["\n  mutation CreateEvalTestCase(\n    $tenantId: ID!\n    $input: CreateEvalTestCaseInput!\n  ) {\n    createEvalTestCase(tenantId: $tenantId, input: $input) {\n      id\n      name\n      category\n      query\n      systemPrompt\n      assertions\n      agentcoreEvaluatorIds\n      enabled\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation UpdateEvalTestCase($id: ID!, $input: UpdateEvalTestCaseInput!) {\n    updateEvalTestCase(id: $id, input: $input) {\n      id\n      name\n      category\n      query\n      systemPrompt\n      assertions\n      agentcoreEvaluatorIds\n      enabled\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation UpdateEvalTestCase($id: ID!, $input: UpdateEvalTestCaseInput!) {\n    updateEvalTestCase(id: $id, input: $input) {\n      id\n      name\n      category\n      query\n      systemPrompt\n      assertions\n      agentcoreEvaluatorIds\n      enabled\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SeedEvalTestCases($tenantId: ID!, $categories: [String!]) {\n    seedEvalTestCases(tenantId: $tenantId, categories: $categories)\n  }\n",
): (typeof documents)["\n  mutation SeedEvalTestCases($tenantId: ID!, $categories: [String!]) {\n    seedEvalTestCases(tenantId: $tenantId, categories: $categories)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation DeleteEvalTestCase($id: ID!) {\n    deleteEvalTestCase(id: $id)\n  }\n",
): (typeof documents)["\n  mutation DeleteEvalTestCase($id: ID!) {\n    deleteEvalTestCase(id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation DeleteEvalRun($id: ID!) {\n    deleteEvalRun(id: $id)\n  }\n",
): (typeof documents)["\n  mutation DeleteEvalRun($id: ID!) {\n    deleteEvalRun(id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation CancelEvalRun($id: ID!) {\n    cancelEvalRun(id: $id) {\n      id\n      status\n      completedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation CancelEvalRun($id: ID!) {\n    cancelEvalRun(id: $id) {\n      id\n      status\n      completedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  subscription OnEvalRunUpdated($tenantId: ID!) {\n    onEvalRunUpdated(tenantId: $tenantId) {\n      runId\n      tenantId\n      agentId\n      status\n      totalTests\n      passed\n      failed\n      passRate\n      errorMessage\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  subscription OnEvalRunUpdated($tenantId: ID!) {\n    onEvalRunUpdated(tenantId: $tenantId) {\n      runId\n      tenantId\n      agentId\n      status\n      totalTests\n      passed\n      failed\n      passRate\n      errorMessage\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query KnowledgeBasesList($tenantId: ID!) {\n    knowledgeBases(tenantId: $tenantId) {\n      id\n      name\n      description\n      status\n      documentCount\n      lastSyncAt\n    }\n  }\n",
): (typeof documents)["\n  query KnowledgeBasesList($tenantId: ID!) {\n    knowledgeBases(tenantId: $tenantId) {\n      id\n      name\n      description\n      status\n      documentCount\n      lastSyncAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query KnowledgeBaseDetail($id: ID!) {\n    knowledgeBase(id: $id) {\n      id\n      tenantId\n      name\n      slug\n      description\n      embeddingModel\n      chunkingStrategy\n      chunkSizeTokens\n      chunkOverlapPercent\n      status\n      awsKbId\n      lastSyncAt\n      lastSyncStatus\n      documentCount\n      errorMessage\n    }\n  }\n",
): (typeof documents)["\n  query KnowledgeBaseDetail($id: ID!) {\n    knowledgeBase(id: $id) {\n      id\n      tenantId\n      name\n      slug\n      description\n      embeddingModel\n      chunkingStrategy\n      chunkSizeTokens\n      chunkOverlapPercent\n      status\n      awsKbId\n      lastSyncAt\n      lastSyncStatus\n      documentCount\n      errorMessage\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query TestKnowledgeBaseRetrieval($id: ID!, $query: String!) {\n    testKnowledgeBaseRetrieval(id: $id, query: $query) {\n      status\n      hits {\n        snippet\n        score\n        source\n      }\n    }\n  }\n",
): (typeof documents)["\n  query TestKnowledgeBaseRetrieval($id: ID!, $query: String!) {\n    testKnowledgeBaseRetrieval(id: $id, query: $query) {\n      status\n      hits {\n        snippet\n        score\n        source\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation CreateKnowledgeBase($input: CreateKnowledgeBaseInput!) {\n    createKnowledgeBase(input: $input) {\n      id\n      name\n      status\n    }\n  }\n",
): (typeof documents)["\n  mutation CreateKnowledgeBase($input: CreateKnowledgeBaseInput!) {\n    createKnowledgeBase(input: $input) {\n      id\n      name\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation UpdateKnowledgeBase($id: ID!, $input: UpdateKnowledgeBaseInput!) {\n    updateKnowledgeBase(id: $id, input: $input) {\n      id\n      name\n      description\n      chunkingStrategy\n      chunkSizeTokens\n      chunkOverlapPercent\n      status\n    }\n  }\n",
): (typeof documents)["\n  mutation UpdateKnowledgeBase($id: ID!, $input: UpdateKnowledgeBaseInput!) {\n    updateKnowledgeBase(id: $id, input: $input) {\n      id\n      name\n      description\n      chunkingStrategy\n      chunkSizeTokens\n      chunkOverlapPercent\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SyncKnowledgeBase($id: ID!) {\n    syncKnowledgeBase(id: $id) {\n      id\n      status\n      lastSyncStatus\n    }\n  }\n",
): (typeof documents)["\n  mutation SyncKnowledgeBase($id: ID!) {\n    syncKnowledgeBase(id: $id) {\n      id\n      status\n      lastSyncStatus\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation RetryKnowledgeBase($id: ID!) {\n    retryKnowledgeBase(id: $id) {\n      id\n      status\n      errorMessage\n    }\n  }\n",
): (typeof documents)["\n  mutation RetryKnowledgeBase($id: ID!) {\n    retryKnowledgeBase(id: $id) {\n      id\n      status\n      errorMessage\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation DeleteKnowledgeBase($id: ID!) {\n    deleteKnowledgeBase(id: $id)\n  }\n",
): (typeof documents)["\n  mutation DeleteKnowledgeBase($id: ID!) {\n    deleteKnowledgeBase(id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query KnowledgeBaseBindings($tenantId: ID!) {\n    tenantAgent(tenantId: $tenantId) {\n      id\n      knowledgeBases {\n        knowledgeBaseId\n      }\n    }\n    spaces(tenantId: $tenantId, status: ACTIVE) {\n      id\n      name\n      knowledgeBases {\n        knowledgeBaseId\n      }\n    }\n  }\n",
): (typeof documents)["\n  query KnowledgeBaseBindings($tenantId: ID!) {\n    tenantAgent(tenantId: $tenantId) {\n      id\n      knowledgeBases {\n        knowledgeBaseId\n      }\n    }\n    spaces(tenantId: $tenantId, status: ACTIVE) {\n      id\n      name\n      knowledgeBases {\n        knowledgeBaseId\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SetAgentKnowledgeBases(\n    $agentId: ID!\n    $knowledgeBases: [AgentKnowledgeBaseInput!]!\n  ) {\n    setAgentKnowledgeBases(agentId: $agentId, knowledgeBases: $knowledgeBases) {\n      id\n      knowledgeBaseId\n    }\n  }\n",
): (typeof documents)["\n  mutation SetAgentKnowledgeBases(\n    $agentId: ID!\n    $knowledgeBases: [AgentKnowledgeBaseInput!]!\n  ) {\n    setAgentKnowledgeBases(agentId: $agentId, knowledgeBases: $knowledgeBases) {\n      id\n      knowledgeBaseId\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SetSpaceKnowledgeBases($input: SetSpaceKnowledgeBasesInput!) {\n    setSpaceKnowledgeBases(input: $input) {\n      id\n      knowledgeBaseId\n    }\n  }\n",
): (typeof documents)["\n  mutation SetSpaceKnowledgeBases($input: SetSpaceKnowledgeBasesInput!) {\n    setSpaceKnowledgeBases(input: $input) {\n      id\n      knowledgeBaseId\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query RoutineDetail($id: ID!) {\n    routine(id: $id) {\n      id\n      tenantId\n      name\n      description\n      type\n      status\n      schedule\n      engine\n      currentVersion\n      config\n      lastRunAt\n      nextRunAt\n      agentId\n      agent {\n        id\n        name\n        avatarUrl\n      }\n      triggers {\n        id\n        triggerType\n        config\n        enabled\n      }\n      createdAt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  query RoutineDetail($id: ID!) {\n    routine(id: $id) {\n      id\n      tenantId\n      name\n      description\n      type\n      status\n      schedule\n      engine\n      currentVersion\n      config\n      lastRunAt\n      nextRunAt\n      agentId\n      agent {\n        id\n        name\n        avatarUrl\n      }\n      triggers {\n        id\n        triggerType\n        config\n        enabled\n      }\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query RoutineRecipeCatalog($tenantId: ID!) {\n    routineRecipeCatalog(tenantId: $tenantId) {\n      id\n      displayName\n      description\n      category\n      hitlCapable\n      defaultArgs\n      configFields {\n        key\n        label\n        value\n        inputType\n        control\n        required\n        editable\n        options\n        placeholder\n        helpText\n        min\n        max\n        pattern\n      }\n    }\n  }\n",
): (typeof documents)["\n  query RoutineRecipeCatalog($tenantId: ID!) {\n    routineRecipeCatalog(tenantId: $tenantId) {\n      id\n      displayName\n      description\n      category\n      hitlCapable\n      defaultArgs\n      configFields {\n        key\n        label\n        value\n        inputType\n        control\n        required\n        editable\n        options\n        placeholder\n        helpText\n        min\n        max\n        pattern\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query TenantCredentials($tenantId: ID!, $status: TenantCredentialStatus) {\n    tenantCredentials(tenantId: $tenantId, status: $status) {\n      id\n      tenantId\n      displayName\n      slug\n      kind\n      status\n      metadataJson\n      schemaJson\n      eventbridgeConnectionArn\n      lastUsedAt\n      lastValidatedAt\n      createdAt\n      updatedAt\n      deletedAt\n    }\n  }\n",
): (typeof documents)["\n  query TenantCredentials($tenantId: ID!, $status: TenantCredentialStatus) {\n    tenantCredentials(tenantId: $tenantId, status: $status) {\n      id\n      tenantId\n      displayName\n      slug\n      kind\n      status\n      metadataJson\n      schemaJson\n      eventbridgeConnectionArn\n      lastUsedAt\n      lastValidatedAt\n      createdAt\n      updatedAt\n      deletedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation TriggerRoutineRun($routineId: ID!, $input: AWSJSON) {\n    triggerRoutineRun(routineId: $routineId, input: $input) {\n      id\n      status\n      triggerSource\n      startedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation TriggerRoutineRun($routineId: ID!, $input: AWSJSON) {\n    triggerRoutineRun(routineId: $routineId, input: $input) {\n      id\n      status\n      triggerSource\n      startedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query RoutineDefinition($routineId: ID!) {\n    routineDefinition(routineId: $routineId) {\n      routineId\n      currentVersion\n      versionId\n      title\n      description\n      kind\n      steps {\n        nodeId\n        recipeId\n        recipeName\n        label\n        args\n        configFields {\n          key\n          label\n          value\n          inputType\n          control\n          required\n          editable\n          options\n          placeholder\n          helpText\n          min\n          max\n          pattern\n        }\n      }\n    }\n  }\n",
): (typeof documents)["\n  query RoutineDefinition($routineId: ID!) {\n    routineDefinition(routineId: $routineId) {\n      routineId\n      currentVersion\n      versionId\n      title\n      description\n      kind\n      steps {\n        nodeId\n        recipeId\n        recipeName\n        label\n        args\n        configFields {\n          key\n          label\n          value\n          inputType\n          control\n          required\n          editable\n          options\n          placeholder\n          helpText\n          min\n          max\n          pattern\n        }\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query RoutineDefinitionArtifacts($routineId: ID!) {\n    routineDefinition(routineId: $routineId) {\n      routineId\n      versionId\n      aslJson\n      markdownSummary\n      stepManifestJson\n    }\n  }\n",
): (typeof documents)["\n  query RoutineDefinitionArtifacts($routineId: ID!) {\n    routineDefinition(routineId: $routineId) {\n      routineId\n      versionId\n      aslJson\n      markdownSummary\n      stepManifestJson\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation UpdateRoutineDefinition($input: UpdateRoutineDefinitionInput!) {\n    updateRoutineDefinition(input: $input) {\n      routineId\n      currentVersion\n      versionId\n      description\n      steps {\n        nodeId\n        args\n        configFields {\n          key\n          value\n          editable\n        }\n      }\n    }\n  }\n",
): (typeof documents)["\n  mutation UpdateRoutineDefinition($input: UpdateRoutineDefinitionInput!) {\n    updateRoutineDefinition(input: $input) {\n      routineId\n      currentVersion\n      versionId\n      description\n      steps {\n        nodeId\n        args\n        configFields {\n          key\n          value\n          editable\n        }\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query RoutineExecutionsList(\n    $routineId: ID!\n    $status: RoutineExecutionStatus\n    $limit: Int\n    $cursor: String\n  ) {\n    routineExecutions(\n      routineId: $routineId\n      status: $status\n      limit: $limit\n      cursor: $cursor\n    ) {\n      id\n      status\n      triggerSource\n      startedAt\n      finishedAt\n      totalLlmCostUsdCents\n      errorCode\n      createdAt\n    }\n  }\n",
): (typeof documents)["\n  query RoutineExecutionsList(\n    $routineId: ID!\n    $status: RoutineExecutionStatus\n    $limit: Int\n    $cursor: String\n  ) {\n    routineExecutions(\n      routineId: $routineId\n      status: $status\n      limit: $limit\n      cursor: $cursor\n    ) {\n      id\n      status\n      triggerSource\n      startedAt\n      finishedAt\n      totalLlmCostUsdCents\n      errorCode\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query RoutineExecutionDetail($id: ID!) {\n    routineExecution(id: $id) {\n      id\n      tenantId\n      routineId\n      stateMachineArn\n      aliasArn\n      versionArn\n      sfnExecutionArn\n      triggerSource\n      inputJson\n      outputJson\n      status\n      startedAt\n      finishedAt\n      errorCode\n      errorMessage\n      totalLlmCostUsdCents\n      stepEvents {\n        id\n        nodeId\n        recipeType\n        status\n        startedAt\n        finishedAt\n        inputJson\n        outputJson\n        errorJson\n        llmCostUsdCents\n        retryCount\n        stdoutS3Uri\n        stderrS3Uri\n        stdoutPreview\n        truncated\n        createdAt\n      }\n      routine {\n        id\n        name\n        description\n        currentVersion\n        documentationMd\n      }\n      aslVersion {\n        id\n        versionNumber\n        aslJson\n        markdownSummary\n        stepManifestJson\n      }\n      createdAt\n    }\n  }\n",
): (typeof documents)["\n  query RoutineExecutionDetail($id: ID!) {\n    routineExecution(id: $id) {\n      id\n      tenantId\n      routineId\n      stateMachineArn\n      aliasArn\n      versionArn\n      sfnExecutionArn\n      triggerSource\n      inputJson\n      outputJson\n      status\n      startedAt\n      finishedAt\n      errorCode\n      errorMessage\n      totalLlmCostUsdCents\n      stepEvents {\n        id\n        nodeId\n        recipeType\n        status\n        startedAt\n        finishedAt\n        inputJson\n        outputJson\n        errorJson\n        llmCostUsdCents\n        retryCount\n        stdoutS3Uri\n        stderrS3Uri\n        stdoutPreview\n        truncated\n        createdAt\n      }\n      routine {\n        id\n        name\n        description\n        currentVersion\n        documentationMd\n      }\n      aslVersion {\n        id\n        versionNumber\n        aslJson\n        markdownSummary\n        stepManifestJson\n      }\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsTenantDetail($id: ID!) {\n    tenant(id: $id) {\n      id\n      name\n      slug\n      plan\n      issuePrefix\n      issueCounter\n      settings {\n        id\n        defaultModel\n      }\n      createdAt\n    }\n  }\n",
): (typeof documents)["\n  query SettingsTenantDetail($id: ID!) {\n    tenant(id: $id) {\n      id\n      name\n      slug\n      plan\n      issuePrefix\n      issueCounter\n      settings {\n        id\n        defaultModel\n      }\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SidebarDeployedRelease {\n    deploymentStatus {\n      releaseVersion\n    }\n  }\n",
): (typeof documents)["\n  query SidebarDeployedRelease {\n    deploymentStatus {\n      releaseVersion\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsDeploymentStatus {\n    deploymentStatus {\n      stage\n      source\n      region\n      accountId\n      releaseVersion\n      releaseManifestUrl\n      releaseManifestSha256\n      deploymentControllerArn\n      deploymentRunnerProjectName\n      deploymentEvidenceBucket\n      bucketName\n      databaseEndpoint\n      ecrUrl\n      adminUrl\n      docsUrl\n      apiEndpoint\n      appsyncUrl\n      appsyncRealtimeUrl\n      hindsightEndpoint\n      agentcoreStatus\n      hindsightEnabled\n      managedMemoryEnabled\n      cogneeEnabled\n      cogneeEndpoint\n      cogneeLogGroupName\n      cogneeBackendMode\n      cogneeClusterArn\n      cogneeServiceName\n      twentyProvisioned\n      twentyRuntimeEnabled\n      twentyUrl\n      twentyClusterArn\n      twentyServerServiceName\n      twentyWorkerServiceName\n      twentyServerLogGroupName\n      twentyWorkerLogGroupName\n      twentyAlbArn\n      twentyTargetGroupArn\n      managedApplications {\n        key\n        displayName\n        description\n        status\n        enabled\n        provisioned\n        runtimeEnabled\n        url\n        endpoint\n        backendMode\n        logGroupName\n        logGroupNames\n        clusterArn\n        serviceName\n        serviceNames\n        albArn\n        targetGroupArn\n        storageBucketName\n        databaseName\n        message\n        managedMcpServerId\n        managedMcpStatus\n        managedMcpInstalled\n        managedMcpInstallAvailable\n        managedMcpMessage\n      }\n    }\n  }\n",
): (typeof documents)["\n  query SettingsDeploymentStatus {\n    deploymentStatus {\n      stage\n      source\n      region\n      accountId\n      releaseVersion\n      releaseManifestUrl\n      releaseManifestSha256\n      deploymentControllerArn\n      deploymentRunnerProjectName\n      deploymentEvidenceBucket\n      bucketName\n      databaseEndpoint\n      ecrUrl\n      adminUrl\n      docsUrl\n      apiEndpoint\n      appsyncUrl\n      appsyncRealtimeUrl\n      hindsightEndpoint\n      agentcoreStatus\n      hindsightEnabled\n      managedMemoryEnabled\n      cogneeEnabled\n      cogneeEndpoint\n      cogneeLogGroupName\n      cogneeBackendMode\n      cogneeClusterArn\n      cogneeServiceName\n      twentyProvisioned\n      twentyRuntimeEnabled\n      twentyUrl\n      twentyClusterArn\n      twentyServerServiceName\n      twentyWorkerServiceName\n      twentyServerLogGroupName\n      twentyWorkerLogGroupName\n      twentyAlbArn\n      twentyTargetGroupArn\n      managedApplications {\n        key\n        displayName\n        description\n        status\n        enabled\n        provisioned\n        runtimeEnabled\n        url\n        endpoint\n        backendMode\n        logGroupName\n        logGroupNames\n        clusterArn\n        serviceName\n        serviceNames\n        albArn\n        targetGroupArn\n        storageBucketName\n        databaseName\n        message\n        managedMcpServerId\n        managedMcpStatus\n        managedMcpInstalled\n        managedMcpInstallAvailable\n        managedMcpMessage\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsDeploymentReleases($limit: Int) {\n    deploymentReleases(limit: $limit) {\n      version\n      name\n      prerelease\n      draft\n      publishedAt\n      htmlUrl\n      manifestUrl\n      manifestSha256\n      signatureUrl\n      signed\n      deployable\n    }\n  }\n",
): (typeof documents)["\n  query SettingsDeploymentReleases($limit: Int) {\n    deploymentReleases(limit: $limit) {\n      version\n      name\n      prerelease\n      draft\n      publishedAt\n      htmlUrl\n      manifestUrl\n      manifestSha256\n      signatureUrl\n      signed\n      deployable\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsStartDeploymentReleaseUpdate(\n    $input: StartDeploymentReleaseUpdateInput!\n  ) {\n    startDeploymentReleaseUpdate(input: $input) {\n      executionArn\n      stateMachineArn\n      evidenceBucket\n      evidencePrefix\n      message\n      release {\n        version\n        manifestUrl\n        manifestSha256\n        signed\n        deployable\n      }\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsStartDeploymentReleaseUpdate(\n    $input: StartDeploymentReleaseUpdateInput!\n  ) {\n    startDeploymentReleaseUpdate(input: $input) {\n      executionArn\n      stateMachineArn\n      evidenceBucket\n      evidencePrefix\n      message\n      release {\n        version\n        manifestUrl\n        manifestSha256\n        signed\n        deployable\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsSetKnowledgeGraphDeployment($enabled: Boolean!) {\n    setKnowledgeGraphDeployment(input: { enabled: $enabled }) {\n      desiredEnabled\n      workflowUrl\n      message\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsSetKnowledgeGraphDeployment($enabled: Boolean!) {\n    setKnowledgeGraphDeployment(input: { enabled: $enabled }) {\n      desiredEnabled\n      workflowUrl\n      message\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsSetManagedApplicationDeployment(\n    $key: String!\n    $action: ManagedApplicationDeploymentAction!\n  ) {\n    setManagedApplicationDeployment(input: { key: $key, action: $action }) {\n      key\n      action\n      desiredEnabled\n      provisioned\n      runtimeEnabled\n      workflowUrl\n      message\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsSetManagedApplicationDeployment(\n    $key: String!\n    $action: ManagedApplicationDeploymentAction!\n  ) {\n    setManagedApplicationDeployment(input: { key: $key, action: $action }) {\n      key\n      action\n      desiredEnabled\n      provisioned\n      runtimeEnabled\n      workflowUrl\n      message\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsInstallManagedApplicationMcpServer($key: String!) {\n    installManagedApplicationMcpServer(key: $key) {\n      key\n      serverId\n      installed\n      status\n      message\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsInstallManagedApplicationMcpServer($key: String!) {\n    installManagedApplicationMcpServer(key: $key) {\n      key\n      serverId\n      installed\n      status\n      message\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsManagedApplications {\n    managedApplications {\n      id\n      key\n      displayName\n      desiredStatus\n      currentStatus\n      selectedReleaseVersion\n      selectedManifestDigest\n      lastJobId\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  query SettingsManagedApplications {\n    managedApplications {\n      id\n      key\n      displayName\n      desiredStatus\n      currentStatus\n      selectedReleaseVersion\n      selectedManifestDigest\n      lastJobId\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsManagedApplicationDeployment($jobId: ID!) {\n    managedApplicationDeployment(jobId: $jobId) {\n      id\n      appKey\n      operation\n      status\n      releaseVersion\n      manifestDigest\n      desiredConfigVersion\n      stateMachineArn\n      planExecutionArn\n      applyExecutionArn\n      codebuildBuildArn\n      planDigest\n      planSummary\n      dataImpact\n      evidenceBucket\n      evidencePrefix\n      approvalRequired\n      approvedAt\n      rejectedAt\n      errorMessage\n      createdAt\n      updatedAt\n      events {\n        id\n        eventType\n        message\n        payload\n        createdAt\n      }\n    }\n  }\n",
): (typeof documents)["\n  query SettingsManagedApplicationDeployment($jobId: ID!) {\n    managedApplicationDeployment(jobId: $jobId) {\n      id\n      appKey\n      operation\n      status\n      releaseVersion\n      manifestDigest\n      desiredConfigVersion\n      stateMachineArn\n      planExecutionArn\n      applyExecutionArn\n      codebuildBuildArn\n      planDigest\n      planSummary\n      dataImpact\n      evidenceBucket\n      evidencePrefix\n      approvalRequired\n      approvedAt\n      rejectedAt\n      errorMessage\n      createdAt\n      updatedAt\n      events {\n        id\n        eventType\n        message\n        payload\n        createdAt\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsDeploymentEvidence($jobId: ID!) {\n    deploymentEvidence(jobId: $jobId) {\n      jobId\n      bucket\n      prefix\n      urls\n    }\n  }\n",
): (typeof documents)["\n  query SettingsDeploymentEvidence($jobId: ID!) {\n    deploymentEvidence(jobId: $jobId) {\n      jobId\n      bucket\n      prefix\n      urls\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsStartManagedApplicationPlan(\n    $input: StartManagedApplicationPlanInput!\n  ) {\n    startManagedApplicationPlan(input: $input) {\n      id\n      appKey\n      operation\n      status\n      releaseVersion\n      manifestDigest\n      desiredConfigVersion\n      stateMachineArn\n      planExecutionArn\n      applyExecutionArn\n      codebuildBuildArn\n      planDigest\n      planSummary\n      dataImpact\n      evidenceBucket\n      evidencePrefix\n      approvalRequired\n      approvedAt\n      rejectedAt\n      errorMessage\n      createdAt\n      updatedAt\n      events {\n        id\n        eventType\n        message\n        payload\n        createdAt\n      }\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsStartManagedApplicationPlan(\n    $input: StartManagedApplicationPlanInput!\n  ) {\n    startManagedApplicationPlan(input: $input) {\n      id\n      appKey\n      operation\n      status\n      releaseVersion\n      manifestDigest\n      desiredConfigVersion\n      stateMachineArn\n      planExecutionArn\n      applyExecutionArn\n      codebuildBuildArn\n      planDigest\n      planSummary\n      dataImpact\n      evidenceBucket\n      evidencePrefix\n      approvalRequired\n      approvedAt\n      rejectedAt\n      errorMessage\n      createdAt\n      updatedAt\n      events {\n        id\n        eventType\n        message\n        payload\n        createdAt\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsApproveManagedApplicationDeployment(\n    $input: ApproveManagedApplicationDeploymentInput!\n  ) {\n    approveManagedApplicationDeployment(input: $input) {\n      id\n      appKey\n      operation\n      status\n      releaseVersion\n      manifestDigest\n      desiredConfigVersion\n      stateMachineArn\n      planExecutionArn\n      applyExecutionArn\n      codebuildBuildArn\n      planDigest\n      planSummary\n      dataImpact\n      evidenceBucket\n      evidencePrefix\n      approvalRequired\n      approvedAt\n      rejectedAt\n      errorMessage\n      createdAt\n      updatedAt\n      events {\n        id\n        eventType\n        message\n        payload\n        createdAt\n      }\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsApproveManagedApplicationDeployment(\n    $input: ApproveManagedApplicationDeploymentInput!\n  ) {\n    approveManagedApplicationDeployment(input: $input) {\n      id\n      appKey\n      operation\n      status\n      releaseVersion\n      manifestDigest\n      desiredConfigVersion\n      stateMachineArn\n      planExecutionArn\n      applyExecutionArn\n      codebuildBuildArn\n      planDigest\n      planSummary\n      dataImpact\n      evidenceBucket\n      evidencePrefix\n      approvalRequired\n      approvedAt\n      rejectedAt\n      errorMessage\n      createdAt\n      updatedAt\n      events {\n        id\n        eventType\n        message\n        payload\n        createdAt\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsRejectManagedApplicationDeployment(\n    $input: RejectManagedApplicationDeploymentInput!\n  ) {\n    rejectManagedApplicationDeployment(input: $input) {\n      id\n      appKey\n      operation\n      status\n      releaseVersion\n      manifestDigest\n      desiredConfigVersion\n      stateMachineArn\n      planExecutionArn\n      applyExecutionArn\n      codebuildBuildArn\n      planDigest\n      planSummary\n      dataImpact\n      evidenceBucket\n      evidencePrefix\n      approvalRequired\n      approvedAt\n      rejectedAt\n      errorMessage\n      createdAt\n      updatedAt\n      events {\n        id\n        eventType\n        message\n        payload\n        createdAt\n      }\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsRejectManagedApplicationDeployment(\n    $input: RejectManagedApplicationDeploymentInput!\n  ) {\n    rejectManagedApplicationDeployment(input: $input) {\n      id\n      appKey\n      operation\n      status\n      releaseVersion\n      manifestDigest\n      desiredConfigVersion\n      stateMachineArn\n      planExecutionArn\n      applyExecutionArn\n      codebuildBuildArn\n      planDigest\n      planSummary\n      dataImpact\n      evidenceBucket\n      evidencePrefix\n      approvalRequired\n      approvedAt\n      rejectedAt\n      errorMessage\n      createdAt\n      updatedAt\n      events {\n        id\n        eventType\n        message\n        payload\n        createdAt\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsKnowledgeGraphHealthCheck {\n    knowledgeGraphHealthCheck {\n      healthy\n      statusCode\n      latencyMs\n      endpoint\n      checkedAt\n      message\n    }\n  }\n",
): (typeof documents)["\n  query SettingsKnowledgeGraphHealthCheck {\n    knowledgeGraphHealthCheck {\n      healthy\n      statusCode\n      latencyMs\n      endpoint\n      checkedAt\n      message\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsManagedApplicationHealthCheck($key: String!) {\n    managedApplicationHealthCheck(key: $key) {\n      key\n      healthy\n      statusCode\n      latencyMs\n      endpoint\n      checkedAt\n      message\n    }\n  }\n",
): (typeof documents)["\n  query SettingsManagedApplicationHealthCheck($key: String!) {\n    managedApplicationHealthCheck(key: $key) {\n      key\n      healthy\n      statusCode\n      latencyMs\n      endpoint\n      checkedAt\n      message\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsKnowledgeGraphOntology($tenantId: ID!) {\n    ontologyDefinitions(tenantId: $tenantId) {\n      activeVersion {\n        id\n        versionNumber\n        status\n        activatedAt\n      }\n      entityTypes {\n        id\n        slug\n        name\n        description\n        broadType\n        aliases\n        lifecycleStatus\n        externalMappings {\n          id\n          mappingKind\n          vocabulary\n          externalUri\n          externalLabel\n        }\n      }\n      relationshipTypes {\n        id\n        slug\n        name\n        description\n        sourceTypeSlugs\n        targetTypeSlugs\n        aliases\n        lifecycleStatus\n        externalMappings {\n          id\n          mappingKind\n          vocabulary\n          externalUri\n          externalLabel\n        }\n      }\n      externalMappings {\n        id\n        subjectKind\n        subjectId\n        mappingKind\n        vocabulary\n        externalUri\n        externalLabel\n      }\n    }\n  }\n",
): (typeof documents)["\n  query SettingsKnowledgeGraphOntology($tenantId: ID!) {\n    ontologyDefinitions(tenantId: $tenantId) {\n      activeVersion {\n        id\n        versionNumber\n        status\n        activatedAt\n      }\n      entityTypes {\n        id\n        slug\n        name\n        description\n        broadType\n        aliases\n        lifecycleStatus\n        externalMappings {\n          id\n          mappingKind\n          vocabulary\n          externalUri\n          externalLabel\n        }\n      }\n      relationshipTypes {\n        id\n        slug\n        name\n        description\n        sourceTypeSlugs\n        targetTypeSlugs\n        aliases\n        lifecycleStatus\n        externalMappings {\n          id\n          mappingKind\n          vocabulary\n          externalUri\n          externalLabel\n        }\n      }\n      externalMappings {\n        id\n        subjectKind\n        subjectId\n        mappingKind\n        vocabulary\n        externalUri\n        externalLabel\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsKnowledgeGraphThreadCandidates(\n    $tenantId: ID!\n    $query: String\n    $limit: Int\n  ) {\n    knowledgeGraphThreadCandidates(\n      tenantId: $tenantId\n      query: $query\n      limit: $limit\n    ) {\n      threadId\n      tenantId\n      title\n      number\n      requesterUserId\n      requesterName\n      spaceId\n      spaceName\n      messageCount\n      lastMessageAt\n      lastIngestRun {\n        id\n        threadId\n        status\n        entityCount\n        relationshipCount\n        evidenceCount\n        diagnosticCount\n        messageCount\n        metrics\n        durationMs\n        error\n        createdAt\n        startedAt\n        finishedAt\n      }\n    }\n  }\n",
): (typeof documents)["\n  query SettingsKnowledgeGraphThreadCandidates(\n    $tenantId: ID!\n    $query: String\n    $limit: Int\n  ) {\n    knowledgeGraphThreadCandidates(\n      tenantId: $tenantId\n      query: $query\n      limit: $limit\n    ) {\n      threadId\n      tenantId\n      title\n      number\n      requesterUserId\n      requesterName\n      spaceId\n      spaceName\n      messageCount\n      lastMessageAt\n      lastIngestRun {\n        id\n        threadId\n        status\n        entityCount\n        relationshipCount\n        evidenceCount\n        diagnosticCount\n        messageCount\n        metrics\n        durationMs\n        error\n        createdAt\n        startedAt\n        finishedAt\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsKnowledgeGraphIngestRuns(\n    $tenantId: ID!\n    $threadId: ID\n    $limit: Int\n  ) {\n    knowledgeGraphIngestRuns(\n      tenantId: $tenantId\n      threadId: $threadId\n      limit: $limit\n    ) {\n      id\n      threadId\n      status\n      trigger\n      cogneeDatasetName\n      cogneeDatasetId\n      entityCount\n      relationshipCount\n      evidenceCount\n      diagnosticCount\n      messageCount\n      metrics\n      durationMs\n      error\n      createdAt\n      updatedAt\n      startedAt\n      finishedAt\n    }\n  }\n",
): (typeof documents)["\n  query SettingsKnowledgeGraphIngestRuns(\n    $tenantId: ID!\n    $threadId: ID\n    $limit: Int\n  ) {\n    knowledgeGraphIngestRuns(\n      tenantId: $tenantId\n      threadId: $threadId\n      limit: $limit\n    ) {\n      id\n      threadId\n      status\n      trigger\n      cogneeDatasetName\n      cogneeDatasetId\n      entityCount\n      relationshipCount\n      evidenceCount\n      diagnosticCount\n      messageCount\n      metrics\n      durationMs\n      error\n      createdAt\n      updatedAt\n      startedAt\n      finishedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsKnowledgeGraphEntities(\n    $tenantId: ID!\n    $threadId: ID\n    $runId: ID\n    $search: String\n    $ontologyType: String\n    $groundingStatus: KnowledgeGraphGroundingStatus\n    $provenanceStatus: KnowledgeGraphProvenanceStatus\n    $limit: Int\n  ) {\n    knowledgeGraphEntities(\n      tenantId: $tenantId\n      threadId: $threadId\n      runId: $runId\n      search: $search\n      ontologyType: $ontologyType\n      groundingStatus: $groundingStatus\n      provenanceStatus: $provenanceStatus\n      limit: $limit\n    ) {\n      id\n      label\n      normalizedLabel\n      typeLabel\n      ontologyTypeSlug\n      groundingStatus\n      provenanceStatus\n      summary\n      aliases\n      relationshipCount\n      evidenceCount\n      lastSeenAt\n      createdAt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  query SettingsKnowledgeGraphEntities(\n    $tenantId: ID!\n    $threadId: ID\n    $runId: ID\n    $search: String\n    $ontologyType: String\n    $groundingStatus: KnowledgeGraphGroundingStatus\n    $provenanceStatus: KnowledgeGraphProvenanceStatus\n    $limit: Int\n  ) {\n    knowledgeGraphEntities(\n      tenantId: $tenantId\n      threadId: $threadId\n      runId: $runId\n      search: $search\n      ontologyType: $ontologyType\n      groundingStatus: $groundingStatus\n      provenanceStatus: $provenanceStatus\n      limit: $limit\n    ) {\n      id\n      label\n      normalizedLabel\n      typeLabel\n      ontologyTypeSlug\n      groundingStatus\n      provenanceStatus\n      summary\n      aliases\n      relationshipCount\n      evidenceCount\n      lastSeenAt\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsKnowledgeGraphEntity($tenantId: ID!, $entityId: ID!) {\n    knowledgeGraphEntity(tenantId: $tenantId, entityId: $entityId) {\n      id\n      label\n      normalizedLabel\n      typeLabel\n      ontologyTypeSlug\n      groundingStatus\n      provenanceStatus\n      summary\n      aliases\n      properties\n      diagnostics\n      relationshipCount\n      evidenceCount\n      lastSeenAt\n      relationships {\n        id\n        sourceEntityId\n        targetEntityId\n        label\n        ontologyTypeSlug\n        groundingStatus\n        provenanceStatus\n        confidence\n        evidenceCount\n        lastSeenAt\n        evidence {\n          id\n          snippet\n          messageId\n          messageRole\n          messageCreatedAt\n          speakerLabel\n        }\n      }\n      evidence {\n        id\n        snippet\n        messageId\n        messageRole\n        messageCreatedAt\n        speakerLabel\n      }\n    }\n  }\n",
): (typeof documents)["\n  query SettingsKnowledgeGraphEntity($tenantId: ID!, $entityId: ID!) {\n    knowledgeGraphEntity(tenantId: $tenantId, entityId: $entityId) {\n      id\n      label\n      normalizedLabel\n      typeLabel\n      ontologyTypeSlug\n      groundingStatus\n      provenanceStatus\n      summary\n      aliases\n      properties\n      diagnostics\n      relationshipCount\n      evidenceCount\n      lastSeenAt\n      relationships {\n        id\n        sourceEntityId\n        targetEntityId\n        label\n        ontologyTypeSlug\n        groundingStatus\n        provenanceStatus\n        confidence\n        evidenceCount\n        lastSeenAt\n        evidence {\n          id\n          snippet\n          messageId\n          messageRole\n          messageCreatedAt\n          speakerLabel\n        }\n      }\n      evidence {\n        id\n        snippet\n        messageId\n        messageRole\n        messageCreatedAt\n        speakerLabel\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsStartKnowledgeGraphThreadIngest(\n    $input: StartKnowledgeGraphThreadIngestInput!\n  ) {\n    startKnowledgeGraphThreadIngest(input: $input) {\n      id\n      status\n      threadId\n      entityCount\n      relationshipCount\n      evidenceCount\n      diagnosticCount\n      messageCount\n      metrics\n      durationMs\n      error\n      createdAt\n      startedAt\n      finishedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsStartKnowledgeGraphThreadIngest(\n    $input: StartKnowledgeGraphThreadIngestInput!\n  ) {\n    startKnowledgeGraphThreadIngest(input: $input) {\n      id\n      status\n      threadId\n      entityCount\n      relationshipCount\n      evidenceCount\n      diagnosticCount\n      messageCount\n      metrics\n      durationMs\n      error\n      createdAt\n      startedAt\n      finishedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsRenameTenantSlug($tenantId: ID!, $newSlug: String!) {\n    renameTenantSlug(tenantId: $tenantId, newSlug: $newSlug) {\n      id\n      slug\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsRenameTenantSlug($tenantId: ID!, $newSlug: String!) {\n    renameTenantSlug(tenantId: $tenantId, newSlug: $newSlug) {\n      id\n      slug\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsTenantFeatures($id: ID!) {\n    tenant(id: $id) {\n      id\n      settings {\n        id\n        features\n      }\n    }\n  }\n",
): (typeof documents)["\n  query SettingsTenantFeatures($id: ID!) {\n    tenant(id: $id) {\n      id\n      settings {\n        id\n        features\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsUpdateTenantArtifactStyle(\n    $tenantId: ID!\n    $input: UpdateTenantSettingsInput!\n  ) {\n    updateTenantSettings(tenantId: $tenantId, input: $input) {\n      id\n      features\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsUpdateTenantArtifactStyle(\n    $tenantId: ID!\n    $input: UpdateTenantSettingsInput!\n  ) {\n    updateTenantSettings(tenantId: $tenantId, input: $input) {\n      id\n      features\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsSpacesList($tenantId: ID!) {\n    spaces(tenantId: $tenantId, status: ACTIVE, includeAllForAdmin: true) {\n      id\n      tenantId\n      name\n      description\n      status\n      accessMode\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  query SettingsSpacesList($tenantId: ID!) {\n    spaces(tenantId: $tenantId, status: ACTIVE, includeAllForAdmin: true) {\n      id\n      tenantId\n      name\n      description\n      status\n      accessMode\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsCreateSpace($input: CreateSpaceInput!) {\n    createSpace(input: $input) {\n      id\n      tenantId\n      name\n      description\n      status\n      accessMode\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsCreateSpace($input: CreateSpaceInput!) {\n    createSpace(input: $input) {\n      id\n      tenantId\n      name\n      description\n      status\n      accessMode\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsSpace($id: ID!) {\n    space(id: $id) {\n      id\n      tenantId\n      name\n      description\n      status\n      accessMode\n      slug\n      config\n      renderDiagnostics\n      toolPolicy\n      mcpPolicy\n      builtInTools\n    }\n  }\n",
): (typeof documents)["\n  query SettingsSpace($id: ID!) {\n    space(id: $id) {\n      id\n      tenantId\n      name\n      description\n      status\n      accessMode\n      slug\n      config\n      renderDiagnostics\n      toolPolicy\n      mcpPolicy\n      builtInTools\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsUpdateSpace($input: UpdateSpaceInput!) {\n    updateSpace(input: $input) {\n      id\n      name\n      description\n      accessMode\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsUpdateSpace($input: UpdateSpaceInput!) {\n    updateSpace(input: $input) {\n      id\n      name\n      description\n      accessMode\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsTenantAgent($tenantId: ID!) {\n    agent: tenantAgent(tenantId: $tenantId) {\n      id\n      tenantId\n      name\n      runtime\n      model\n      blockedTools\n      sandbox\n      browser\n      webSearch\n      webExtract\n      sendEmail\n      contextEngine\n    }\n  }\n",
): (typeof documents)["\n  query SettingsTenantAgent($tenantId: ID!) {\n    agent: tenantAgent(tenantId: $tenantId) {\n      id\n      tenantId\n      name\n      runtime\n      model\n      blockedTools\n      sandbox\n      browser\n      webSearch\n      webExtract\n      sendEmail\n      contextEngine\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsTenantSandboxStatus($id: ID!) {\n    tenant(id: $id) {\n      id\n      sandboxEnabled\n      complianceTier\n      sandboxInterpreterPublicId\n      sandboxInterpreterInternalId\n    }\n  }\n",
): (typeof documents)["\n  query SettingsTenantSandboxStatus($id: ID!) {\n    tenant(id: $id) {\n      id\n      sandboxEnabled\n      complianceTier\n      sandboxInterpreterPublicId\n      sandboxInterpreterInternalId\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsModelCatalog {\n    modelCatalog {\n      id\n      modelId\n      displayName\n      provider\n    }\n  }\n",
): (typeof documents)["\n  query SettingsModelCatalog {\n    modelCatalog {\n      id\n      modelId\n      displayName\n      provider\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsTenantModelCatalog(\n    $tenantId: ID!\n    $includeDisabled: Boolean = true\n  ) {\n    tenantModelCatalog(tenantId: $tenantId, includeDisabled: $includeDisabled) {\n      tenantId\n      modelId\n      provider\n      displayName\n      canonicalDisplayName\n      inputCostPerMillion\n      outputCostPerMillion\n      contextWindow\n      maxOutputTokens\n      supportsVision\n      supportsTools\n      enabled\n      pricingStatus\n      pricingSource\n      pricingDiagnostics\n      lastPricedAt\n      importSource\n      importPayload\n      importedByUserId\n      importedAt\n      createdAt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  query SettingsTenantModelCatalog(\n    $tenantId: ID!\n    $includeDisabled: Boolean = true\n  ) {\n    tenantModelCatalog(tenantId: $tenantId, includeDisabled: $includeDisabled) {\n      tenantId\n      modelId\n      provider\n      displayName\n      canonicalDisplayName\n      inputCostPerMillion\n      outputCostPerMillion\n      contextWindow\n      maxOutputTokens\n      supportsVision\n      supportsTools\n      enabled\n      pricingStatus\n      pricingSource\n      pricingDiagnostics\n      lastPricedAt\n      importSource\n      importPayload\n      importedByUserId\n      importedAt\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsBedrockModelImportCandidates($tenantId: ID!) {\n    bedrockModelImportCandidates(tenantId: $tenantId) {\n      provider\n      providerName\n      modelName\n      modelId\n      displayName\n      inputModalities\n      outputModalities\n      supportsStreaming\n      supportsVision\n      supportsTools\n      customizationsSupported\n      inferenceTypesSupported\n      lifecycleStatus\n      inputCostPerMillion\n      outputCostPerMillion\n      pricingStatus\n      pricingSource\n      pricingDiagnostics\n      alreadyImported\n      enabled\n    }\n  }\n",
): (typeof documents)["\n  query SettingsBedrockModelImportCandidates($tenantId: ID!) {\n    bedrockModelImportCandidates(tenantId: $tenantId) {\n      provider\n      providerName\n      modelName\n      modelId\n      displayName\n      inputModalities\n      outputModalities\n      supportsStreaming\n      supportsVision\n      supportsTools\n      customizationsSupported\n      inferenceTypesSupported\n      lifecycleStatus\n      inputCostPerMillion\n      outputCostPerMillion\n      pricingStatus\n      pricingSource\n      pricingDiagnostics\n      alreadyImported\n      enabled\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsImportTenantBedrockModels(\n    $input: ImportTenantBedrockModelsInput!\n  ) {\n    importTenantBedrockModels(input: $input) {\n      tenantId\n      modelId\n      provider\n      displayName\n      canonicalDisplayName\n      inputCostPerMillion\n      outputCostPerMillion\n      contextWindow\n      maxOutputTokens\n      supportsVision\n      supportsTools\n      enabled\n      pricingStatus\n      pricingSource\n      pricingDiagnostics\n      lastPricedAt\n      importSource\n      importPayload\n      importedByUserId\n      importedAt\n      createdAt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsImportTenantBedrockModels(\n    $input: ImportTenantBedrockModelsInput!\n  ) {\n    importTenantBedrockModels(input: $input) {\n      tenantId\n      modelId\n      provider\n      displayName\n      canonicalDisplayName\n      inputCostPerMillion\n      outputCostPerMillion\n      contextWindow\n      maxOutputTokens\n      supportsVision\n      supportsTools\n      enabled\n      pricingStatus\n      pricingSource\n      pricingDiagnostics\n      lastPricedAt\n      importSource\n      importPayload\n      importedByUserId\n      importedAt\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsUpdateTenantModelCatalogEntry(\n    $input: UpdateTenantModelCatalogEntryInput!\n  ) {\n    updateTenantModelCatalogEntry(input: $input) {\n      tenantId\n      modelId\n      provider\n      displayName\n      canonicalDisplayName\n      inputCostPerMillion\n      outputCostPerMillion\n      contextWindow\n      maxOutputTokens\n      supportsVision\n      supportsTools\n      enabled\n      pricingStatus\n      pricingSource\n      pricingDiagnostics\n      lastPricedAt\n      importSource\n      importPayload\n      importedByUserId\n      importedAt\n      createdAt\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsUpdateTenantModelCatalogEntry(\n    $input: UpdateTenantModelCatalogEntryInput!\n  ) {\n    updateTenantModelCatalogEntry(input: $input) {\n      tenantId\n      modelId\n      provider\n      displayName\n      canonicalDisplayName\n      inputCostPerMillion\n      outputCostPerMillion\n      contextWindow\n      maxOutputTokens\n      supportsVision\n      supportsTools\n      enabled\n      pricingStatus\n      pricingSource\n      pricingDiagnostics\n      lastPricedAt\n      importSource\n      importPayload\n      importedByUserId\n      importedAt\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsUpdateTenantAgent(\n    $tenantId: ID!\n    $input: UpdateTenantAgentInput!\n  ) {\n    updateTenantAgent(tenantId: $tenantId, input: $input) {\n      id\n      runtime\n      model\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsUpdateTenantAgent(\n    $tenantId: ID!\n    $input: UpdateTenantAgentInput!\n  ) {\n    updateTenantAgent(tenantId: $tenantId, input: $input) {\n      id\n      runtime\n      model\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsAgentProfiles($tenantId: ID!) {\n    agentProfiles(tenantId: $tenantId, includeDisabled: true) {\n      id\n      tenantId\n      slug\n      name\n      description\n      routingGuidance\n      instructions\n      modelId\n      model {\n        id\n        modelId\n        provider\n        displayName\n        inputCostPerMillion\n        outputCostPerMillion\n      }\n      enabled\n      builtInKey\n      toolPolicy\n      skillPolicy\n      executionControls\n      spaces {\n        id\n        name\n        slug\n      }\n      createdAt\n      updatedAt\n    }\n    agentProfileEditorCatalog(tenantId: $tenantId) {\n      models {\n        id\n        modelId\n        provider\n        displayName\n        inputCostPerMillion\n        outputCostPerMillion\n      }\n      spaces {\n        id\n        name\n        slug\n      }\n      skills {\n        slug\n        displayName\n        description\n        category\n      }\n      builtInTools\n      mcpServers {\n        id\n        name\n        slug\n        enabled\n        status\n        tools\n      }\n    }\n  }\n",
): (typeof documents)["\n  query SettingsAgentProfiles($tenantId: ID!) {\n    agentProfiles(tenantId: $tenantId, includeDisabled: true) {\n      id\n      tenantId\n      slug\n      name\n      description\n      routingGuidance\n      instructions\n      modelId\n      model {\n        id\n        modelId\n        provider\n        displayName\n        inputCostPerMillion\n        outputCostPerMillion\n      }\n      enabled\n      builtInKey\n      toolPolicy\n      skillPolicy\n      executionControls\n      spaces {\n        id\n        name\n        slug\n      }\n      createdAt\n      updatedAt\n    }\n    agentProfileEditorCatalog(tenantId: $tenantId) {\n      models {\n        id\n        modelId\n        provider\n        displayName\n        inputCostPerMillion\n        outputCostPerMillion\n      }\n      spaces {\n        id\n        name\n        slug\n      }\n      skills {\n        slug\n        displayName\n        description\n        category\n      }\n      builtInTools\n      mcpServers {\n        id\n        name\n        slug\n        enabled\n        status\n        tools\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsCreateAgentProfile(\n    $tenantId: ID!\n    $input: AgentProfileInput!\n  ) {\n    createAgentProfile(tenantId: $tenantId, input: $input) {\n      id\n      slug\n      name\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsCreateAgentProfile(\n    $tenantId: ID!\n    $input: AgentProfileInput!\n  ) {\n    createAgentProfile(tenantId: $tenantId, input: $input) {\n      id\n      slug\n      name\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsUpdateAgentProfile(\n    $tenantId: ID!\n    $id: ID!\n    $input: UpdateAgentProfileInput!\n  ) {\n    updateAgentProfile(tenantId: $tenantId, id: $id, input: $input) {\n      id\n      slug\n      name\n      enabled\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsUpdateAgentProfile(\n    $tenantId: ID!\n    $id: ID!\n    $input: UpdateAgentProfileInput!\n  ) {\n    updateAgentProfile(tenantId: $tenantId, id: $id, input: $input) {\n      id\n      slug\n      name\n      enabled\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsDeleteAgentProfile($tenantId: ID!, $id: ID!) {\n    deleteAgentProfile(tenantId: $tenantId, id: $id)\n  }\n",
): (typeof documents)["\n  mutation SettingsDeleteAgentProfile($tenantId: ID!, $id: ID!) {\n    deleteAgentProfile(tenantId: $tenantId, id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsTenantMembers($tenantId: ID!) {\n    tenantMembers(tenantId: $tenantId) {\n      id\n      principalType\n      principalId\n      role\n      status\n      cognitoStatus\n      createdAt\n      user {\n        id\n        name\n        email\n        profile {\n          id\n          title\n          timezone\n          pronouns\n          callBy\n          notes\n        }\n      }\n    }\n  }\n",
): (typeof documents)["\n  query SettingsTenantMembers($tenantId: ID!) {\n    tenantMembers(tenantId: $tenantId) {\n      id\n      principalType\n      principalId\n      role\n      status\n      cognitoStatus\n      createdAt\n      user {\n        id\n        name\n        email\n        profile {\n          id\n          title\n          timezone\n          pronouns\n          callBy\n          notes\n        }\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsUpdateUser($id: ID!, $input: UpdateUserInput!) {\n    updateUser(id: $id, input: $input) {\n      id\n      name\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsUpdateUser($id: ID!, $input: UpdateUserInput!) {\n    updateUser(id: $id, input: $input) {\n      id\n      name\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsUpdateUserProfile(\n    $userId: ID!\n    $input: UpdateUserProfileInput!\n  ) {\n    updateUserProfile(userId: $userId, input: $input) {\n      id\n      title\n      timezone\n      pronouns\n      callBy\n      notes\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsUpdateUserProfile(\n    $userId: ID!\n    $input: UpdateUserProfileInput!\n  ) {\n    updateUserProfile(userId: $userId, input: $input) {\n      id\n      title\n      timezone\n      pronouns\n      callBy\n      notes\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsUserBudgetStatus($tenantId: ID!, $userId: ID!) {\n    userBudgetStatus(tenantId: $tenantId, userId: $userId) {\n      policy {\n        id\n        tenantId\n        userId\n        scope\n        period\n        limitUsd\n        actionOnExceed\n        enabled\n      }\n      spentUsd\n      remainingUsd\n      percentUsed\n      status\n    }\n  }\n",
): (typeof documents)["\n  query SettingsUserBudgetStatus($tenantId: ID!, $userId: ID!) {\n    userBudgetStatus(tenantId: $tenantId, userId: $userId) {\n      policy {\n        id\n        tenantId\n        userId\n        scope\n        period\n        limitUsd\n        actionOnExceed\n        enabled\n      }\n      spentUsd\n      remainingUsd\n      percentUsed\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsUpsertBudgetPolicy(\n    $tenantId: ID!\n    $input: UpsertBudgetPolicyInput!\n  ) {\n    upsertBudgetPolicy(tenantId: $tenantId, input: $input) {\n      id\n      tenantId\n      userId\n      scope\n      period\n      limitUsd\n      actionOnExceed\n      enabled\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsUpsertBudgetPolicy(\n    $tenantId: ID!\n    $input: UpsertBudgetPolicyInput!\n  ) {\n    upsertBudgetPolicy(tenantId: $tenantId, input: $input) {\n      id\n      tenantId\n      userId\n      scope\n      period\n      limitUsd\n      actionOnExceed\n      enabled\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsDeleteBudgetPolicy($id: ID!) {\n    deleteBudgetPolicy(id: $id)\n  }\n",
): (typeof documents)["\n  mutation SettingsDeleteBudgetPolicy($id: ID!) {\n    deleteBudgetPolicy(id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsUpdateTenantMember(\n    $id: ID!\n    $input: UpdateTenantMemberInput!\n  ) {\n    updateTenantMember(id: $id, input: $input) {\n      id\n      role\n      status\n      updatedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsUpdateTenantMember(\n    $id: ID!\n    $input: UpdateTenantMemberInput!\n  ) {\n    updateTenantMember(id: $id, input: $input) {\n      id\n      role\n      status\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsRemoveTenantMember($id: ID!) {\n    removeTenantMember(id: $id)\n  }\n",
): (typeof documents)["\n  mutation SettingsRemoveTenantMember($id: ID!) {\n    removeTenantMember(id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsInviteMember($tenantId: ID!, $input: InviteMemberInput!) {\n    inviteMember(tenantId: $tenantId, input: $input) {\n      id\n      principalType\n      principalId\n      role\n      status\n      createdAt\n      user {\n        id\n        name\n        email\n      }\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsInviteMember($tenantId: ID!, $input: InviteMemberInput!) {\n    inviteMember(tenantId: $tenantId, input: $input) {\n      id\n      principalType\n      principalId\n      role\n      status\n      createdAt\n      user {\n        id\n        name\n        email\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsCostSummary($tenantId: ID!) {\n    costSummary(tenantId: $tenantId) {\n      totalUsd\n      llmUsd\n      computeUsd\n      toolsUsd\n      totalInputTokens\n      totalOutputTokens\n      eventCount\n    }\n  }\n",
): (typeof documents)["\n  query SettingsCostSummary($tenantId: ID!) {\n    costSummary(tenantId: $tenantId) {\n      totalUsd\n      llmUsd\n      computeUsd\n      toolsUsd\n      totalInputTokens\n      totalOutputTokens\n      eventCount\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsCostByUser($tenantId: ID!) {\n    costByUser(tenantId: $tenantId) {\n      userId\n      userName\n      userEmail\n      totalUsd\n      eventCount\n      isSystem\n    }\n  }\n",
): (typeof documents)["\n  query SettingsCostByUser($tenantId: ID!) {\n    costByUser(tenantId: $tenantId) {\n      userId\n      userName\n      userEmail\n      totalUsd\n      eventCount\n      isSystem\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsBudgetStatus($tenantId: ID!) {\n    budgetStatus(tenantId: $tenantId) {\n      policy {\n        id\n        tenantId\n        userId\n        scope\n        period\n        limitUsd\n        actionOnExceed\n        enabled\n      }\n      spentUsd\n      remainingUsd\n      percentUsed\n      status\n    }\n  }\n",
): (typeof documents)["\n  query SettingsBudgetStatus($tenantId: ID!) {\n    budgetStatus(tenantId: $tenantId) {\n      policy {\n        id\n        tenantId\n        userId\n        scope\n        period\n        limitUsd\n        actionOnExceed\n        enabled\n      }\n      spentUsd\n      remainingUsd\n      percentUsed\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsCostByModel($tenantId: ID!) {\n    costByModel(tenantId: $tenantId) {\n      model\n      totalUsd\n      inputTokens\n      outputTokens\n    }\n  }\n",
): (typeof documents)["\n  query SettingsCostByModel($tenantId: ID!) {\n    costByModel(tenantId: $tenantId) {\n      model\n      totalUsd\n      inputTokens\n      outputTokens\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsCostTimeSeries($tenantId: ID!, $days: Int) {\n    costTimeSeries(tenantId: $tenantId, days: $days) {\n      day\n      totalUsd\n      llmUsd\n      computeUsd\n      toolsUsd\n      eventCount\n    }\n  }\n",
): (typeof documents)["\n  query SettingsCostTimeSeries($tenantId: ID!, $days: Int) {\n    costTimeSeries(tenantId: $tenantId, days: $days) {\n      day\n      totalUsd\n      llmUsd\n      computeUsd\n      toolsUsd\n      eventCount\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsRoutines($tenantId: ID!) {\n    routines(tenantId: $tenantId) {\n      id\n      name\n      description\n      status\n      lastRunAt\n      engine\n      createdAt\n    }\n  }\n",
): (typeof documents)["\n  query SettingsRoutines($tenantId: ID!) {\n    routines(tenantId: $tenantId) {\n      id\n      name\n      description\n      status\n      lastRunAt\n      engine\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsWebhooks($tenantId: ID!) {\n    webhooks(tenantId: $tenantId) {\n      id\n      name\n      description\n      targetType\n      enabled\n      invocationCount\n      lastInvokedAt\n      createdAt\n    }\n  }\n",
): (typeof documents)["\n  query SettingsWebhooks($tenantId: ID!) {\n    webhooks(tenantId: $tenantId) {\n      id\n      name\n      description\n      targetType\n      enabled\n      invocationCount\n      lastInvokedAt\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsWebhook($id: ID!) {\n    webhook(id: $id) {\n      id\n      name\n      description\n      token\n      targetType\n      prompt\n      enabled\n      rateLimit\n      invocationCount\n      lastInvokedAt\n      createdAt\n    }\n  }\n",
): (typeof documents)["\n  query SettingsWebhook($id: ID!) {\n    webhook(id: $id) {\n      id\n      name\n      description\n      token\n      targetType\n      prompt\n      enabled\n      rateLimit\n      invocationCount\n      lastInvokedAt\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsWebhookDeliveries($webhookId: ID!, $limit: Int) {\n    webhookDeliveries(webhookId: $webhookId, limit: $limit) {\n      id\n      receivedAt\n      providerName\n      normalizedKind\n      signatureStatus\n      resolutionStatus\n      statusCode\n      threadCreated\n    }\n  }\n",
): (typeof documents)["\n  query SettingsWebhookDeliveries($webhookId: ID!, $limit: Int) {\n    webhookDeliveries(webhookId: $webhookId, limit: $limit) {\n      id\n      receivedAt\n      providerName\n      normalizedKind\n      signatureStatus\n      resolutionStatus\n      statusCode\n      threadCreated\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsUpdateWebhook($id: ID!, $input: UpdateWebhookInput!) {\n    updateWebhook(id: $id, input: $input) {\n      id\n      name\n      description\n      prompt\n      enabled\n      rateLimit\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsUpdateWebhook($id: ID!, $input: UpdateWebhookInput!) {\n    updateWebhook(id: $id, input: $input) {\n      id\n      name\n      description\n      prompt\n      enabled\n      rateLimit\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsDeleteWebhook($id: ID!) {\n    deleteWebhook(id: $id)\n  }\n",
): (typeof documents)["\n  mutation SettingsDeleteWebhook($id: ID!) {\n    deleteWebhook(id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsRegenerateWebhookToken($id: ID!) {\n    regenerateWebhookToken(id: $id) {\n      id\n      token\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsRegenerateWebhookToken($id: ID!) {\n    regenerateWebhookToken(id: $id) {\n      id\n      token\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsPluginCatalog {\n    pluginCatalog {\n      pluginKey\n      displayName\n      description\n      latestVersion\n      updateAvailable\n      versions {\n        version\n        payloadSha256\n        requiredOauthScopes\n        components {\n          key\n          type\n          displayName\n        }\n      }\n      install {\n        id\n        pluginKey\n        pinnedVersion\n        state\n        lastTransitionAt\n        lastError\n        activatedUserCount\n        components {\n          id\n          componentKey\n          componentType\n          state\n          handlerRef\n          lastError\n        }\n      }\n    }\n  }\n",
): (typeof documents)["\n  query SettingsPluginCatalog {\n    pluginCatalog {\n      pluginKey\n      displayName\n      description\n      latestVersion\n      updateAvailable\n      versions {\n        version\n        payloadSha256\n        requiredOauthScopes\n        components {\n          key\n          type\n          displayName\n        }\n      }\n      install {\n        id\n        pluginKey\n        pinnedVersion\n        state\n        lastTransitionAt\n        lastError\n        activatedUserCount\n        components {\n          id\n          componentKey\n          componentType\n          state\n          handlerRef\n          lastError\n        }\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsPluginInstalls {\n    pluginInstalls {\n      id\n      pluginKey\n      pinnedVersion\n      state\n      lastTransitionAt\n      lastError\n      activatedUserCount\n      components {\n        id\n        componentKey\n        componentType\n        state\n        handlerRef\n        lastError\n      }\n    }\n  }\n",
): (typeof documents)["\n  query SettingsPluginInstalls {\n    pluginInstalls {\n      id\n      pluginKey\n      pinnedVersion\n      state\n      lastTransitionAt\n      lastError\n      activatedUserCount\n      components {\n        id\n        componentKey\n        componentType\n        state\n        handlerRef\n        lastError\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query SettingsMyPluginActivations {\n    myPluginActivations {\n      id\n      pluginInstallId\n      pluginKey\n      status\n      grantedScopes\n      grantedAt\n      revokedAt\n    }\n  }\n",
): (typeof documents)["\n  query SettingsMyPluginActivations {\n    myPluginActivations {\n      id\n      pluginInstallId\n      pluginKey\n      status\n      grantedScopes\n      grantedAt\n      revokedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsInstallPlugin($input: InstallPluginInput!) {\n    installPlugin(input: $input) {\n      id\n      pluginKey\n      pinnedVersion\n      state\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsInstallPlugin($input: InstallPluginInput!) {\n    installPlugin(input: $input) {\n      id\n      pluginKey\n      pinnedVersion\n      state\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsUpgradePlugin($input: UpgradePluginInput!) {\n    upgradePlugin(input: $input) {\n      id\n      pluginKey\n      pinnedVersion\n      state\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsUpgradePlugin($input: UpgradePluginInput!) {\n    upgradePlugin(input: $input) {\n      id\n      pluginKey\n      pinnedVersion\n      state\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsUninstallPlugin($input: UninstallPluginInput!) {\n    uninstallPlugin(input: $input) {\n      id\n      pluginKey\n      state\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsUninstallPlugin($input: UninstallPluginInput!) {\n    uninstallPlugin(input: $input) {\n      id\n      pluginKey\n      state\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsRetryPluginComponent($input: RetryPluginComponentInput!) {\n    retryPluginComponent(input: $input) {\n      id\n      state\n      components {\n        id\n        componentKey\n        componentType\n        state\n        lastError\n      }\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsRetryPluginComponent($input: RetryPluginComponentInput!) {\n    retryPluginComponent(input: $input) {\n      id\n      state\n      components {\n        id\n        componentKey\n        componentType\n        state\n        lastError\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsActivatePlugin($input: ActivatePluginInput!) {\n    activatePlugin(input: $input) {\n      authorizeUrl\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsActivatePlugin($input: ActivatePluginInput!) {\n    activatePlugin(input: $input) {\n      authorizeUrl\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation SettingsDeactivatePlugin($input: DeactivatePluginInput!) {\n    deactivatePlugin(input: $input) {\n      id\n      status\n      revokedAt\n    }\n  }\n",
): (typeof documents)["\n  mutation SettingsDeactivatePlugin($input: DeactivatePluginInput!) {\n    deactivatePlugin(input: $input) {\n      id\n      status\n      revokedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query TenantSkillCatalog($agentId: ID) {\n    tenantSkillCatalog(agentId: $agentId) {\n      slug\n      displayName\n      description\n      icon\n      installed\n    }\n  }\n",
): (typeof documents)["\n  query TenantSkillCatalog($agentId: ID) {\n    tenantSkillCatalog(agentId: $agentId) {\n      slug\n      displayName\n      description\n      icon\n      installed\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation AnswerUserQuestion($questionId: ID!, $answers: AWSJSON!) {\n    answerUserQuestion(questionId: $questionId, answers: $answers) {\n      id\n      threadId\n      messageId\n      status\n      answers\n      answeredVia\n      answeredBy\n      answeredAt\n    }\n  }\n",
): (typeof documents)["\n  mutation AnswerUserQuestion($questionId: ID!, $answers: AWSJSON!) {\n    answerUserQuestion(questionId: $questionId, answers: $answers) {\n      id\n      threadId\n      messageId\n      status\n      answers\n      answeredVia\n      answeredBy\n      answeredAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation OnboardingBootstrapUser {\n    bootstrapUser {\n      tenant {\n        id\n        name\n        slug\n        plan\n      }\n    }\n  }\n",
): (typeof documents)["\n  mutation OnboardingBootstrapUser {\n    bootstrapUser {\n      tenant {\n        id\n        name\n        slug\n        plan\n      }\n    }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> =
  TDocumentNode extends DocumentNode<infer TType, any> ? TType : never;
