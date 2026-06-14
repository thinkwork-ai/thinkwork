import { graphql } from "@/gql";

// Typed graphql() operations for the Evaluations settings surface. Ported from
// apps/web's untyped `graphql-queries.ts` eval blocks into a codegen-included
// file (spaces excludes `graphql-queries.ts` from codegen), exactly like
// `routine-queries.ts`. Backing store is AWS Bedrock AgentCore Evaluations.

export const EvalSummaryQuery = graphql(`
  query EvalSummary($tenantId: ID!) {
    evalSummary(tenantId: $tenantId) {
      totalRuns
      latestPassRate
      avgPassRate
      regressionCount
    }
  }
`);

export const EvalRunsQuery = graphql(`
  query EvalRuns($tenantId: ID!, $limit: Int, $offset: Int) {
    evalRuns(tenantId: $tenantId, limit: $limit, offset: $offset) {
      items {
        id
        status
        model
        categories
        totalTests
        passed
        failed
        errored
        scoringVersion
        isLegacyScoring
        datasetId
        datasetVersion
        passRate
        regression
        costUsd
        agentId
        agentName
        scheduledJobId
        executionTarget
        runtimeHost
        startedAt
        completedAt
        createdAt
      }
      totalCount
    }
  }
`);

export const EvalRunQuery = graphql(`
  query EvalRun($id: ID!) {
    evalRun(id: $id) {
      id
      status
      model
      categories
      totalTests
      passed
      failed
      errored
      scoringVersion
      isLegacyScoring
      datasetId
      datasetVersion
      passRate
      regression
      costUsd
      errorMessage
      agentId
      agentName
      scheduledJobId
      executionTarget
      runtimeHost
      startedAt
      completedAt
      createdAt
    }
  }
`);

export const EvalRunResultsQuery = graphql(`
  query EvalRunResults($runId: ID!) {
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
      actualOutput
      systemPrompt
      evaluatorResults
      assertions
      errorMessage
      errorCause
      overrideStatus
      overriddenBy
      overriddenAt
      overrideReason
      effectiveStatus
      createdAt
    }
  }
`);

// Operator verdict override (Trust Core U9). The override never mutates
// the judge's verdict — it's a separate field aggregation reads last.
// overriddenBy is derived server-side from the authenticated caller.
export const OverrideEvalResultMutation = graphql(`
  mutation OverrideEvalResult($input: OverrideEvalResultInput!) {
    overrideEvalResult(input: $input) {
      id
      status
      overrideStatus
      overriddenBy
      overriddenAt
      overrideReason
      effectiveStatus
    }
  }
`);

export const EvalResultSpansQuery = graphql(`
  query EvalResultSpans($runId: ID!, $testCaseId: ID!) {
    evalResultSpans(runId: $runId, testCaseId: $testCaseId) {
      timestamp
      name
      attributes
    }
  }
`);

export const EvalTimeSeriesQuery = graphql(`
  query EvalTimeSeries($tenantId: ID!, $days: Int) {
    evalTimeSeries(tenantId: $tenantId, days: $days) {
      day
      passRate
      runCount
      passed
      failed
    }
  }
`);

export const EvalTestCasesQuery = graphql(`
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
`);

export const EvalTestCaseQuery = graphql(`
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
`);

export const EvalTestCaseHistoryQuery = graphql(`
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
`);

export const StartEvalRunMutation = graphql(`
  mutation StartEvalRun($tenantId: ID!, $input: StartEvalRunInput!) {
    startEvalRun(tenantId: $tenantId, input: $input) {
      id
      status
      categories
      createdAt
    }
  }
`);

export const CreateEvalTestCaseMutation = graphql(`
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
      assertions
      agentcoreEvaluatorIds
      enabled
      createdAt
    }
  }
`);

export const UpdateEvalTestCaseMutation = graphql(`
  mutation UpdateEvalTestCase($id: ID!, $input: UpdateEvalTestCaseInput!) {
    updateEvalTestCase(id: $id, input: $input) {
      id
      name
      category
      query
      systemPrompt
      assertions
      agentcoreEvaluatorIds
      enabled
      updatedAt
    }
  }
`);

export const SeedEvalTestCasesMutation = graphql(`
  mutation SeedEvalTestCases($tenantId: ID!, $categories: [String!]) {
    seedEvalTestCases(tenantId: $tenantId, categories: $categories)
  }
`);

export const DeleteEvalTestCaseMutation = graphql(`
  mutation DeleteEvalTestCase($id: ID!) {
    deleteEvalTestCase(id: $id)
  }
`);

export const DeleteEvalRunMutation = graphql(`
  mutation DeleteEvalRun($id: ID!) {
    deleteEvalRun(id: $id)
  }
`);

export const CancelEvalRunMutation = graphql(`
  mutation CancelEvalRun($id: ID!) {
    cancelEvalRun(id: $id) {
      id
      status
      completedAt
    }
  }
`);

export const OnEvalRunUpdatedSubscription = graphql(`
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
`);

// ────────────────────────────────────────────────────────────────────
// Flag-thread → dataset case (Trust Core U7)
// ────────────────────────────────────────────────────────────────────

export const EvalDatasetsForFlagQuery = graphql(`
  query EvalDatasetsForFlag($tenantId: ID!) {
    evalDatasets(tenantId: $tenantId) {
      id
      slug
      name
      kind
      archivedAt
    }
  }
`);

// ────────────────────────────────────────────────────────────────────
// Datasets UI (Trust Core U11) — list/detail + CRUD over the U4
// substrate. S3 is canonical; these read the derived index.
// ────────────────────────────────────────────────────────────────────

export const EvalDatasetsQuery = graphql(`
  query EvalDatasets($tenantId: ID!, $includeArchived: Boolean) {
    evalDatasets(tenantId: $tenantId, includeArchived: $includeArchived) {
      id
      slug
      name
      kind
      version
      archivedAt
      createdAt
      updatedAt
    }
  }
`);

export const EvalDatasetQuery = graphql(`
  query EvalDataset($tenantId: ID!, $slug: String!) {
    evalDataset(tenantId: $tenantId, slug: $slug) {
      id
      slug
      name
      kind
      version
      archivedAt
      createdAt
      updatedAt
    }
  }
`);

// Lightweight index read used to count cases per dataset on the list
// page (one query, grouped client-side — no N+1).
export const EvalDatasetCaseIndexQuery = graphql(`
  query EvalDatasetCaseIndex($tenantId: ID!) {
    evalTestCases(tenantId: $tenantId) {
      id
      datasetId
      enabled
    }
  }
`);

export const EvalDatasetCasesQuery = graphql(`
  query EvalDatasetCases($tenantId: ID!, $datasetId: ID) {
    evalTestCases(tenantId: $tenantId, datasetId: $datasetId) {
      id
      name
      category
      tags
      enabled
      source
      datasetId
      datasetCaseId
      createdAt
      updatedAt
    }
  }
`);

export const CreateEvalDatasetMutation = graphql(`
  mutation CreateEvalDataset($tenantId: ID!, $input: CreateEvalDatasetInput!) {
    createEvalDataset(tenantId: $tenantId, input: $input) {
      id
      slug
      name
      kind
      version
      archivedAt
    }
  }
`);

export const UpdateEvalDatasetMutation = graphql(`
  mutation UpdateEvalDataset(
    $tenantId: ID!
    $slug: String!
    $input: UpdateEvalDatasetInput!
  ) {
    updateEvalDataset(tenantId: $tenantId, slug: $slug, input: $input) {
      id
      slug
      name
      kind
      version
      archivedAt
    }
  }
`);

export const ArchiveEvalDatasetMutation = graphql(`
  mutation ArchiveEvalDataset($tenantId: ID!, $slug: String!) {
    archiveEvalDataset(tenantId: $tenantId, slug: $slug) {
      id
      slug
      archivedAt
    }
  }
`);

export const UpdateEvalDatasetCaseMutation = graphql(`
  mutation UpdateEvalDatasetCase(
    $tenantId: ID!
    $datasetSlug: String!
    $caseId: String!
    $input: UpdateEvalDatasetCaseInput!
  ) {
    updateEvalDatasetCase(
      tenantId: $tenantId
      datasetSlug: $datasetSlug
      caseId: $caseId
      input: $input
    ) {
      id
      datasetCaseId
      enabled
      updatedAt
    }
  }
`);

export const RemoveEvalDatasetCaseMutation = graphql(`
  mutation RemoveEvalDatasetCase(
    $tenantId: ID!
    $datasetSlug: String!
    $caseId: String!
  ) {
    removeEvalDatasetCase(
      tenantId: $tenantId
      datasetSlug: $datasetSlug
      caseId: $caseId
    ) {
      id
      slug
      version
    }
  }
`);

// MCP replay tool overrides (Trust Core U14). Default-ALLOW: read-shaped
// tools run on replay by name heuristic with no setup; overrides force-allow
// a write or force-block a read.
export const EvalReplayToolAllowlistQuery = graphql(`
  query EvalReplayToolAllowlist($tenantId: ID!) {
    evalReplayToolAllowlist(tenantId: $tenantId) {
      id
      tenantId
      serverName
      toolName
      mode
      createdAt
    }
  }
`);

export const EvalReplayAvailableMcpToolsQuery = graphql(`
  query EvalReplayAvailableMcpTools($tenantId: ID!) {
    evalReplayAvailableMcpTools(tenantId: $tenantId) {
      serverName
      displayName
      tools {
        name
        description
        access
      }
    }
  }
`);

export const AddEvalReplayToolOverrideMutation = graphql(`
  mutation AddEvalReplayToolOverride(
    $tenantId: ID!
    $serverName: String!
    $toolName: String!
    $mode: String!
  ) {
    addEvalReplayToolOverride(
      tenantId: $tenantId
      serverName: $serverName
      toolName: $toolName
      mode: $mode
    ) {
      id
      tenantId
      serverName
      toolName
      mode
      createdAt
    }
  }
`);

export const RemoveEvalReplayToolOverrideMutation = graphql(`
  mutation RemoveEvalReplayToolOverride($id: ID!) {
    removeEvalReplayToolOverride(id: $id)
  }
`);

export const FlagThreadForEvalMutation = graphql(`
  mutation FlagThreadForEval($input: FlagThreadForEvalInput!) {
    flagThreadForEval(input: $input) {
      case {
        id
        datasetId
        datasetCaseId
        name
        category
        tags
      }
      dataset {
        id
        slug
        name
      }
      completeness {
        history
        workspace
        traces
        truncated
      }
    }
  }
`);

// Skill-attribution candidates for a flagged turn (Skill Tests & Evals U8).
// Suggestion only — the dialog renders these + a "not skill-specific" option
// and the operator confirms exactly one. `fallback`/`source: "installed"`
// mark the low-confidence installed-skill suggestions.
export const FlaggedTurnSkillCandidatesQuery = graphql(`
  query FlaggedTurnSkillCandidates(
    $tenantId: ID!
    $threadId: ID!
    $turnId: ID!
  ) {
    flaggedTurnSkillCandidates(
      tenantId: $tenantId
      threadId: $threadId
      turnId: $turnId
    ) {
      candidates {
        skillSlug
        source
      }
      fallback
    }
  }
`);

// ────────────────────────────────────────────────────────────────────
// Skill score + gate (Skill Tests & Evals U5/U6/U9)
// ────────────────────────────────────────────────────────────────────

// Per-skill eval score + regression (U5). Returns an "unrated" score
// (rated: false) for a skill with no enabled cases — never null.
export const SkillEvalScoreQuery = graphql(`
  query SkillEvalScore($tenantId: ID!, $skillSlug: String!) {
    skillEvalScore(tenantId: $tenantId, skillSlug: $skillSlug) {
      skillSlug
      datasetSlug
      rated
      passRate
      regression
      lastRunId
      lastRunAt
      totalCases
    }
  }
`);

// Detail-surface score read (U9 + run-eligibility). Adds the lazy
// `evaluable`/`ineligibleReason` fields (which read catalog WIRING.md) so the
// skill detail can gate "Run evals now" — kept off the list-cell query above so
// the list stays cheap.
export const SkillEvalScoreDetailQuery = graphql(`
  query SkillEvalScoreDetail($tenantId: ID!, $skillSlug: String!) {
    skillEvalScore(tenantId: $tenantId, skillSlug: $skillSlug) {
      skillSlug
      datasetSlug
      rated
      passRate
      regression
      lastRunId
      lastRunAt
      totalCases
      evaluable
      ineligibleReason
    }
  }
`);

// Per-tenant skill-update gate threshold (U6). `enabled` is false
// (threshold null) when no gate is set.
export const SkillEvalGateQuery = graphql(`
  query SkillEvalGate($tenantId: ID!) {
    skillEvalGate(tenantId: $tenantId) {
      enabled
      threshold
    }
  }
`);

// Set or clear the per-tenant skill-update gate (U6). A finite threshold
// in [0, 1] enables the gate; null clears it (the gate goes off).
export const SetSkillEvalGateMutation = graphql(`
  mutation SetSkillEvalGate($tenantId: ID!, $threshold: Float) {
    setSkillEvalGate(tenantId: $tenantId, threshold: $threshold) {
      enabled
      threshold
    }
  }
`);

// Apply (or attempt to apply) a HELD skill update (U6). The gated reinstall
// DEFERS the swap when a candidate scores below the tenant gate; this lets an
// operator apply it once the candidate passes, or override below threshold.
export const ApplySkillUpdateMutation = graphql(`
  mutation ApplySkillUpdate(
    $tenantId: ID!
    $skillSlug: String!
    $agentId: ID!
    $override: Boolean
  ) {
    applySkillUpdate(
      tenantId: $tenantId
      skillSlug: $skillSlug
      agentId: $agentId
      override: $override
    ) {
      applied
      blocked
      overridden
      passRate
      threshold
    }
  }
`);
