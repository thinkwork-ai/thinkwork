import { graphql } from "@/gql";

// Routine queries ported from apps/web for the Settings → Routines detail
// (React Flow / AWS Step Functions ASL workflow editor + executions).

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
