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
    "\n  query CliEvalRuns($tenantId: ID!, $agentId: ID, $limit: Int, $offset: Int) {\n    evalRuns(tenantId: $tenantId, agentId: $agentId, limit: $limit, offset: $offset) {\n      totalCount\n      items {\n        id\n        status\n        model\n        categories\n        agentId\n        agentName\n        agentTemplateId\n        agentTemplateName\n        totalTests\n        passed\n        failed\n        passRate\n        regression\n        costUsd\n        errorMessage\n        startedAt\n        completedAt\n        createdAt\n      }\n    }\n  }\n": typeof types.CliEvalRunsDocument,
    "\n  query CliEvalRun($id: ID!) {\n    evalRun(id: $id) {\n      id\n      status\n      model\n      categories\n      agentId\n      agentName\n      agentTemplateId\n      agentTemplateName\n      totalTests\n      passed\n      failed\n      passRate\n      regression\n      costUsd\n      errorMessage\n      startedAt\n      completedAt\n      createdAt\n    }\n  }\n": typeof types.CliEvalRunDocument,
    "\n  query CliEvalRunResults($runId: ID!) {\n    evalRunResults(runId: $runId) {\n      id\n      testCaseId\n      testCaseName\n      category\n      status\n      score\n      durationMs\n      agentSessionId\n      input\n      expected\n      actualOutput\n      evaluatorResults\n      assertions\n      errorMessage\n      createdAt\n    }\n  }\n": typeof types.CliEvalRunResultsDocument,
    "\n  query CliEvalTestCases($tenantId: ID!, $category: String, $search: String) {\n    evalTestCases(tenantId: $tenantId, category: $category, search: $search) {\n      id\n      name\n      category\n      query\n      systemPrompt\n      agentTemplateId\n      agentTemplateName\n      agentcoreEvaluatorIds\n      tags\n      enabled\n      source\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.CliEvalTestCasesDocument,
    "\n  query CliEvalTestCase($id: ID!) {\n    evalTestCase(id: $id) {\n      id\n      tenantId\n      name\n      category\n      query\n      systemPrompt\n      agentTemplateId\n      agentTemplateName\n      assertions\n      agentcoreEvaluatorIds\n      tags\n      enabled\n      source\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.CliEvalTestCaseDocument,
    "\n  query CliAgentTemplatesForEval($tenantId: ID!) {\n    agentTemplates(tenantId: $tenantId) {\n      id\n      name\n      slug\n      model\n      isPublished\n    }\n  }\n": typeof types.CliAgentTemplatesForEvalDocument,
    "\n  query CliTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n": typeof types.CliTenantBySlugDocument,
    "\n  mutation CliStartEvalRun($tenantId: ID!, $input: StartEvalRunInput!) {\n    startEvalRun(tenantId: $tenantId, input: $input) {\n      id\n      status\n      model\n      categories\n      agentTemplateId\n      agentTemplateName\n      totalTests\n      createdAt\n    }\n  }\n": typeof types.CliStartEvalRunDocument,
    "\n  mutation CliCancelEvalRun($id: ID!) {\n    cancelEvalRun(id: $id) {\n      id\n      status\n      completedAt\n    }\n  }\n": typeof types.CliCancelEvalRunDocument,
    "\n  mutation CliDeleteEvalRun($id: ID!) {\n    deleteEvalRun(id: $id)\n  }\n": typeof types.CliDeleteEvalRunDocument,
    "\n  mutation CliCreateEvalTestCase($tenantId: ID!, $input: CreateEvalTestCaseInput!) {\n    createEvalTestCase(tenantId: $tenantId, input: $input) {\n      id\n      name\n      category\n    }\n  }\n": typeof types.CliCreateEvalTestCaseDocument,
    "\n  mutation CliUpdateEvalTestCase($id: ID!, $input: UpdateEvalTestCaseInput!) {\n    updateEvalTestCase(id: $id, input: $input) {\n      id\n      name\n      category\n      enabled\n    }\n  }\n": typeof types.CliUpdateEvalTestCaseDocument,
    "\n  mutation CliDeleteEvalTestCase($id: ID!) {\n    deleteEvalTestCase(id: $id)\n  }\n": typeof types.CliDeleteEvalTestCaseDocument,
    "\n  mutation CliSeedEvalTestCases($tenantId: ID!, $categories: [String!]) {\n    seedEvalTestCases(tenantId: $tenantId, categories: $categories)\n  }\n": typeof types.CliSeedEvalTestCasesDocument,
    "\n  query CliMe {\n    me {\n      id\n      email\n      name\n      tenantId\n    }\n  }\n": typeof types.CliMeDocument,
};
const documents: Documents = {
    "\n  query CliEvalRuns($tenantId: ID!, $agentId: ID, $limit: Int, $offset: Int) {\n    evalRuns(tenantId: $tenantId, agentId: $agentId, limit: $limit, offset: $offset) {\n      totalCount\n      items {\n        id\n        status\n        model\n        categories\n        agentId\n        agentName\n        agentTemplateId\n        agentTemplateName\n        totalTests\n        passed\n        failed\n        passRate\n        regression\n        costUsd\n        errorMessage\n        startedAt\n        completedAt\n        createdAt\n      }\n    }\n  }\n": types.CliEvalRunsDocument,
    "\n  query CliEvalRun($id: ID!) {\n    evalRun(id: $id) {\n      id\n      status\n      model\n      categories\n      agentId\n      agentName\n      agentTemplateId\n      agentTemplateName\n      totalTests\n      passed\n      failed\n      passRate\n      regression\n      costUsd\n      errorMessage\n      startedAt\n      completedAt\n      createdAt\n    }\n  }\n": types.CliEvalRunDocument,
    "\n  query CliEvalRunResults($runId: ID!) {\n    evalRunResults(runId: $runId) {\n      id\n      testCaseId\n      testCaseName\n      category\n      status\n      score\n      durationMs\n      agentSessionId\n      input\n      expected\n      actualOutput\n      evaluatorResults\n      assertions\n      errorMessage\n      createdAt\n    }\n  }\n": types.CliEvalRunResultsDocument,
    "\n  query CliEvalTestCases($tenantId: ID!, $category: String, $search: String) {\n    evalTestCases(tenantId: $tenantId, category: $category, search: $search) {\n      id\n      name\n      category\n      query\n      systemPrompt\n      agentTemplateId\n      agentTemplateName\n      agentcoreEvaluatorIds\n      tags\n      enabled\n      source\n      createdAt\n      updatedAt\n    }\n  }\n": types.CliEvalTestCasesDocument,
    "\n  query CliEvalTestCase($id: ID!) {\n    evalTestCase(id: $id) {\n      id\n      tenantId\n      name\n      category\n      query\n      systemPrompt\n      agentTemplateId\n      agentTemplateName\n      assertions\n      agentcoreEvaluatorIds\n      tags\n      enabled\n      source\n      createdAt\n      updatedAt\n    }\n  }\n": types.CliEvalTestCaseDocument,
    "\n  query CliAgentTemplatesForEval($tenantId: ID!) {\n    agentTemplates(tenantId: $tenantId) {\n      id\n      name\n      slug\n      model\n      isPublished\n    }\n  }\n": types.CliAgentTemplatesForEvalDocument,
    "\n  query CliTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n": types.CliTenantBySlugDocument,
    "\n  mutation CliStartEvalRun($tenantId: ID!, $input: StartEvalRunInput!) {\n    startEvalRun(tenantId: $tenantId, input: $input) {\n      id\n      status\n      model\n      categories\n      agentTemplateId\n      agentTemplateName\n      totalTests\n      createdAt\n    }\n  }\n": types.CliStartEvalRunDocument,
    "\n  mutation CliCancelEvalRun($id: ID!) {\n    cancelEvalRun(id: $id) {\n      id\n      status\n      completedAt\n    }\n  }\n": types.CliCancelEvalRunDocument,
    "\n  mutation CliDeleteEvalRun($id: ID!) {\n    deleteEvalRun(id: $id)\n  }\n": types.CliDeleteEvalRunDocument,
    "\n  mutation CliCreateEvalTestCase($tenantId: ID!, $input: CreateEvalTestCaseInput!) {\n    createEvalTestCase(tenantId: $tenantId, input: $input) {\n      id\n      name\n      category\n    }\n  }\n": types.CliCreateEvalTestCaseDocument,
    "\n  mutation CliUpdateEvalTestCase($id: ID!, $input: UpdateEvalTestCaseInput!) {\n    updateEvalTestCase(id: $id, input: $input) {\n      id\n      name\n      category\n      enabled\n    }\n  }\n": types.CliUpdateEvalTestCaseDocument,
    "\n  mutation CliDeleteEvalTestCase($id: ID!) {\n    deleteEvalTestCase(id: $id)\n  }\n": types.CliDeleteEvalTestCaseDocument,
    "\n  mutation CliSeedEvalTestCases($tenantId: ID!, $categories: [String!]) {\n    seedEvalTestCases(tenantId: $tenantId, categories: $categories)\n  }\n": types.CliSeedEvalTestCasesDocument,
    "\n  query CliMe {\n    me {\n      id\n      email\n      name\n      tenantId\n    }\n  }\n": types.CliMeDocument,
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
export function graphql(source: "\n  query CliEvalRuns($tenantId: ID!, $agentId: ID, $limit: Int, $offset: Int) {\n    evalRuns(tenantId: $tenantId, agentId: $agentId, limit: $limit, offset: $offset) {\n      totalCount\n      items {\n        id\n        status\n        model\n        categories\n        agentId\n        agentName\n        agentTemplateId\n        agentTemplateName\n        totalTests\n        passed\n        failed\n        passRate\n        regression\n        costUsd\n        errorMessage\n        startedAt\n        completedAt\n        createdAt\n      }\n    }\n  }\n"): (typeof documents)["\n  query CliEvalRuns($tenantId: ID!, $agentId: ID, $limit: Int, $offset: Int) {\n    evalRuns(tenantId: $tenantId, agentId: $agentId, limit: $limit, offset: $offset) {\n      totalCount\n      items {\n        id\n        status\n        model\n        categories\n        agentId\n        agentName\n        agentTemplateId\n        agentTemplateName\n        totalTests\n        passed\n        failed\n        passRate\n        regression\n        costUsd\n        errorMessage\n        startedAt\n        completedAt\n        createdAt\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliEvalRun($id: ID!) {\n    evalRun(id: $id) {\n      id\n      status\n      model\n      categories\n      agentId\n      agentName\n      agentTemplateId\n      agentTemplateName\n      totalTests\n      passed\n      failed\n      passRate\n      regression\n      costUsd\n      errorMessage\n      startedAt\n      completedAt\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  query CliEvalRun($id: ID!) {\n    evalRun(id: $id) {\n      id\n      status\n      model\n      categories\n      agentId\n      agentName\n      agentTemplateId\n      agentTemplateName\n      totalTests\n      passed\n      failed\n      passRate\n      regression\n      costUsd\n      errorMessage\n      startedAt\n      completedAt\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliEvalRunResults($runId: ID!) {\n    evalRunResults(runId: $runId) {\n      id\n      testCaseId\n      testCaseName\n      category\n      status\n      score\n      durationMs\n      agentSessionId\n      input\n      expected\n      actualOutput\n      evaluatorResults\n      assertions\n      errorMessage\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  query CliEvalRunResults($runId: ID!) {\n    evalRunResults(runId: $runId) {\n      id\n      testCaseId\n      testCaseName\n      category\n      status\n      score\n      durationMs\n      agentSessionId\n      input\n      expected\n      actualOutput\n      evaluatorResults\n      assertions\n      errorMessage\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliEvalTestCases($tenantId: ID!, $category: String, $search: String) {\n    evalTestCases(tenantId: $tenantId, category: $category, search: $search) {\n      id\n      name\n      category\n      query\n      systemPrompt\n      agentTemplateId\n      agentTemplateName\n      agentcoreEvaluatorIds\n      tags\n      enabled\n      source\n      createdAt\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  query CliEvalTestCases($tenantId: ID!, $category: String, $search: String) {\n    evalTestCases(tenantId: $tenantId, category: $category, search: $search) {\n      id\n      name\n      category\n      query\n      systemPrompt\n      agentTemplateId\n      agentTemplateName\n      agentcoreEvaluatorIds\n      tags\n      enabled\n      source\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliEvalTestCase($id: ID!) {\n    evalTestCase(id: $id) {\n      id\n      tenantId\n      name\n      category\n      query\n      systemPrompt\n      agentTemplateId\n      agentTemplateName\n      assertions\n      agentcoreEvaluatorIds\n      tags\n      enabled\n      source\n      createdAt\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  query CliEvalTestCase($id: ID!) {\n    evalTestCase(id: $id) {\n      id\n      tenantId\n      name\n      category\n      query\n      systemPrompt\n      agentTemplateId\n      agentTemplateName\n      assertions\n      agentcoreEvaluatorIds\n      tags\n      enabled\n      source\n      createdAt\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliAgentTemplatesForEval($tenantId: ID!) {\n    agentTemplates(tenantId: $tenantId) {\n      id\n      name\n      slug\n      model\n      isPublished\n    }\n  }\n"): (typeof documents)["\n  query CliAgentTemplatesForEval($tenantId: ID!) {\n    agentTemplates(tenantId: $tenantId) {\n      id\n      name\n      slug\n      model\n      isPublished\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n"): (typeof documents)["\n  query CliTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliStartEvalRun($tenantId: ID!, $input: StartEvalRunInput!) {\n    startEvalRun(tenantId: $tenantId, input: $input) {\n      id\n      status\n      model\n      categories\n      agentTemplateId\n      agentTemplateName\n      totalTests\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  mutation CliStartEvalRun($tenantId: ID!, $input: StartEvalRunInput!) {\n    startEvalRun(tenantId: $tenantId, input: $input) {\n      id\n      status\n      model\n      categories\n      agentTemplateId\n      agentTemplateName\n      totalTests\n      createdAt\n    }\n  }\n"];
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
export function graphql(source: "\n  mutation CliCreateEvalTestCase($tenantId: ID!, $input: CreateEvalTestCaseInput!) {\n    createEvalTestCase(tenantId: $tenantId, input: $input) {\n      id\n      name\n      category\n    }\n  }\n"): (typeof documents)["\n  mutation CliCreateEvalTestCase($tenantId: ID!, $input: CreateEvalTestCaseInput!) {\n    createEvalTestCase(tenantId: $tenantId, input: $input) {\n      id\n      name\n      category\n    }\n  }\n"];
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
export function graphql(source: "\n  query CliMe {\n    me {\n      id\n      email\n      name\n      tenantId\n    }\n  }\n"): (typeof documents)["\n  query CliMe {\n    me {\n      id\n      email\n      name\n      tenantId\n    }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;