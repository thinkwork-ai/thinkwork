import { graphql } from "../../gql/index.js";

export const EvalRunsDoc = graphql(`
  query CliEvalRuns($tenantId: ID!, $agentId: ID, $limit: Int, $offset: Int) {
    evalRuns(
      tenantId: $tenantId
      agentId: $agentId
      limit: $limit
      offset: $offset
    ) {
      totalCount
      items {
        id
        status
        model
        categories
        agentId
        agentName
        agentTemplateId
        agentTemplateName
        totalTests
        passed
        failed
        passRate
        regression
        costUsd
        errorMessage
        startedAt
        completedAt
        createdAt
      }
    }
  }
`);

export const EvalRunDoc = graphql(`
  query CliEvalRun($id: ID!) {
    evalRun(id: $id) {
      id
      status
      model
      categories
      agentId
      agentName
      agentTemplateId
      agentTemplateName
      totalTests
      passed
      failed
      passRate
      regression
      costUsd
      errorMessage
      startedAt
      completedAt
      createdAt
    }
  }
`);

export const EvalRunResultsDoc = graphql(`
  query CliEvalRunResults($runId: ID!) {
    evalRunResults(runId: $runId) {
      id
      testCaseId
      testCaseName
      category
      status
      score
      durationMs
      agentSessionId
      input
      expected
      actualOutput
      evaluatorResults
      assertions
      errorMessage
      createdAt
    }
  }
`);

export const EvalTestCasesDoc = graphql(`
  query CliEvalTestCases($tenantId: ID!, $category: String, $search: String) {
    evalTestCases(tenantId: $tenantId, category: $category, search: $search) {
      id
      name
      category
      query
      systemPrompt
      agentTemplateId
      agentTemplateName
      agentcoreEvaluatorIds
      tags
      enabled
      source
      createdAt
      updatedAt
    }
  }
`);

export const EvalTestCaseDoc = graphql(`
  query CliEvalTestCase($id: ID!) {
    evalTestCase(id: $id) {
      id
      tenantId
      name
      category
      query
      systemPrompt
      agentTemplateId
      agentTemplateName
      assertions
      agentcoreEvaluatorIds
      tags
      enabled
      source
      createdAt
      updatedAt
    }
  }
`);

export const ComputersForEvalDoc = graphql(`
  query CliComputersForEval($tenantId: ID!) {
    computers(tenantId: $tenantId) {
      id
      name
      slug
      runtimeStatus
    }
  }
`);

export const AgentTemplatesForEvalDoc = graphql(`
  query CliAgentTemplatesForEval($tenantId: ID!) {
    agentTemplates(tenantId: $tenantId) {
      id
      name
      slug
      model
      isPublished
    }
  }
`);

export const TenantBySlugDoc = graphql(`
  query CliTenantBySlug($slug: String!) {
    tenantBySlug(slug: $slug) {
      id
      slug
      name
    }
  }
`);

export const StartEvalRunDoc = graphql(`
  mutation CliStartEvalRun($tenantId: ID!, $input: StartEvalRunInput!) {
    startEvalRun(tenantId: $tenantId, input: $input) {
      id
      status
      model
      categories
      agentTemplateId
      agentTemplateName
      totalTests
      createdAt
    }
  }
`);

export const CancelEvalRunDoc = graphql(`
  mutation CliCancelEvalRun($id: ID!) {
    cancelEvalRun(id: $id) {
      id
      status
      completedAt
    }
  }
`);

export const DeleteEvalRunDoc = graphql(`
  mutation CliDeleteEvalRun($id: ID!) {
    deleteEvalRun(id: $id)
  }
`);

export const CreateEvalTestCaseDoc = graphql(`
  mutation CliCreateEvalTestCase(
    $tenantId: ID!
    $input: CreateEvalTestCaseInput!
  ) {
    createEvalTestCase(tenantId: $tenantId, input: $input) {
      id
      name
      category
    }
  }
`);

export const UpdateEvalTestCaseDoc = graphql(`
  mutation CliUpdateEvalTestCase($id: ID!, $input: UpdateEvalTestCaseInput!) {
    updateEvalTestCase(id: $id, input: $input) {
      id
      name
      category
      enabled
    }
  }
`);

export const DeleteEvalTestCaseDoc = graphql(`
  mutation CliDeleteEvalTestCase($id: ID!) {
    deleteEvalTestCase(id: $id)
  }
`);

export const SeedEvalTestCasesDoc = graphql(`
  mutation CliSeedEvalTestCases($tenantId: ID!, $categories: [String!]) {
    seedEvalTestCases(tenantId: $tenantId, categories: $categories)
  }
`);
