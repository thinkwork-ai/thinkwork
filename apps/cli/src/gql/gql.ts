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
    "\n  query CliEvalRuns($tenantId: ID!, $agentId: ID, $limit: Int, $offset: Int) {\n    evalRuns(\n      tenantId: $tenantId\n      agentId: $agentId\n      limit: $limit\n      offset: $offset\n    ) {\n      totalCount\n      items {\n        id\n        status\n        model\n        categories\n        agentId\n        agentName\n        agentTemplateId\n        agentTemplateName\n        totalTests\n        passed\n        failed\n        passRate\n        regression\n        costUsd\n        errorMessage\n        startedAt\n        completedAt\n        createdAt\n      }\n    }\n  }\n": typeof types.CliEvalRunsDocument,
    "\n  query CliEvalRun($id: ID!) {\n    evalRun(id: $id) {\n      id\n      status\n      model\n      categories\n      agentId\n      agentName\n      agentTemplateId\n      agentTemplateName\n      totalTests\n      passed\n      failed\n      passRate\n      regression\n      costUsd\n      errorMessage\n      startedAt\n      completedAt\n      createdAt\n    }\n  }\n": typeof types.CliEvalRunDocument,
    "\n  query CliEvalRunResults($runId: ID!) {\n    evalRunResults(runId: $runId) {\n      id\n      testCaseId\n      testCaseName\n      category\n      status\n      score\n      durationMs\n      agentSessionId\n      input\n      expected\n      actualOutput\n      evaluatorResults\n      assertions\n      errorMessage\n      createdAt\n    }\n  }\n": typeof types.CliEvalRunResultsDocument,
    "\n  query CliEvalTestCases($tenantId: ID!, $category: String, $search: String) {\n    evalTestCases(tenantId: $tenantId, category: $category, search: $search) {\n      id\n      name\n      category\n      query\n      systemPrompt\n      agentTemplateId\n      agentTemplateName\n      agentcoreEvaluatorIds\n      tags\n      enabled\n      source\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.CliEvalTestCasesDocument,
    "\n  query CliEvalTestCase($id: ID!) {\n    evalTestCase(id: $id) {\n      id\n      tenantId\n      name\n      category\n      query\n      systemPrompt\n      agentTemplateId\n      agentTemplateName\n      assertions\n      agentcoreEvaluatorIds\n      tags\n      enabled\n      source\n      createdAt\n      updatedAt\n    }\n  }\n": typeof types.CliEvalTestCaseDocument,
    "\n  query CliComputersForEval($tenantId: ID!) {\n    computers(tenantId: $tenantId) {\n      id\n      name\n      slug\n      runtimeStatus\n    }\n  }\n": typeof types.CliComputersForEvalDocument,
    "\n  query CliAgentTemplatesForEval($tenantId: ID!) {\n    agentTemplates(tenantId: $tenantId) {\n      id\n      name\n      slug\n      model\n      isPublished\n    }\n  }\n": typeof types.CliAgentTemplatesForEvalDocument,
    "\n  query CliTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n": typeof types.CliTenantBySlugDocument,
    "\n  mutation CliStartEvalRun($tenantId: ID!, $input: StartEvalRunInput!) {\n    startEvalRun(tenantId: $tenantId, input: $input) {\n      id\n      status\n      model\n      categories\n      agentTemplateId\n      agentTemplateName\n      totalTests\n      createdAt\n    }\n  }\n": typeof types.CliStartEvalRunDocument,
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
    "\n  mutation CliMsgSendMessage($input: SendMessageInput!) {\n    sendMessage(input: $input) {\n      id\n      threadId\n      role\n      content\n      createdAt\n    }\n  }\n": typeof types.CliMsgSendMessageDocument,
    "\n  query CliMsgMessages($threadId: ID!, $limit: Int, $cursor: String) {\n    messages(threadId: $threadId, limit: $limit, cursor: $cursor) {\n      edges {\n        cursor\n        node {\n          id\n          role\n          senderType\n          senderId\n          content\n          tokenCount\n          createdAt\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n": typeof types.CliMsgMessagesDocument,
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
    "\n  query CliWikiTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n": typeof types.CliWikiTenantBySlugDocument,
    "\n  query CliAllTenantAgentsForWiki($tenantId: ID!) {\n    allTenantAgents(tenantId: $tenantId, includeSystem: false, includeSubAgents: false) {\n      id\n      name\n      slug\n      type\n      status\n    }\n  }\n": typeof types.CliAllTenantAgentsForWikiDocument,
    "\n  mutation CliCompileWikiNow($tenantId: ID!, $ownerId: ID!, $modelId: String) {\n    compileWikiNow(tenantId: $tenantId, ownerId: $ownerId, modelId: $modelId) {\n      id\n      tenantId\n      ownerId\n      status\n      trigger\n      dedupeKey\n      attempt\n      createdAt\n    }\n  }\n": typeof types.CliCompileWikiNowDocument,
    "\n  mutation CliResetWikiCursor($tenantId: ID!, $ownerId: ID!, $force: Boolean) {\n    resetWikiCursor(tenantId: $tenantId, ownerId: $ownerId, force: $force) {\n      tenantId\n      ownerId\n      cursorCleared\n      pagesArchived\n    }\n  }\n": typeof types.CliResetWikiCursorDocument,
    "\n  query CliWikiCompileJobs($tenantId: ID!, $ownerId: ID, $limit: Int) {\n    wikiCompileJobs(tenantId: $tenantId, ownerId: $ownerId, limit: $limit) {\n      id\n      tenantId\n      ownerId\n      status\n      trigger\n      dedupeKey\n      attempt\n      claimedAt\n      startedAt\n      finishedAt\n      error\n      metrics\n      createdAt\n    }\n  }\n": typeof types.CliWikiCompileJobsDocument,
};
const documents: Documents = {
    "\n  query CliEvalRuns($tenantId: ID!, $agentId: ID, $limit: Int, $offset: Int) {\n    evalRuns(\n      tenantId: $tenantId\n      agentId: $agentId\n      limit: $limit\n      offset: $offset\n    ) {\n      totalCount\n      items {\n        id\n        status\n        model\n        categories\n        agentId\n        agentName\n        agentTemplateId\n        agentTemplateName\n        totalTests\n        passed\n        failed\n        passRate\n        regression\n        costUsd\n        errorMessage\n        startedAt\n        completedAt\n        createdAt\n      }\n    }\n  }\n": types.CliEvalRunsDocument,
    "\n  query CliEvalRun($id: ID!) {\n    evalRun(id: $id) {\n      id\n      status\n      model\n      categories\n      agentId\n      agentName\n      agentTemplateId\n      agentTemplateName\n      totalTests\n      passed\n      failed\n      passRate\n      regression\n      costUsd\n      errorMessage\n      startedAt\n      completedAt\n      createdAt\n    }\n  }\n": types.CliEvalRunDocument,
    "\n  query CliEvalRunResults($runId: ID!) {\n    evalRunResults(runId: $runId) {\n      id\n      testCaseId\n      testCaseName\n      category\n      status\n      score\n      durationMs\n      agentSessionId\n      input\n      expected\n      actualOutput\n      evaluatorResults\n      assertions\n      errorMessage\n      createdAt\n    }\n  }\n": types.CliEvalRunResultsDocument,
    "\n  query CliEvalTestCases($tenantId: ID!, $category: String, $search: String) {\n    evalTestCases(tenantId: $tenantId, category: $category, search: $search) {\n      id\n      name\n      category\n      query\n      systemPrompt\n      agentTemplateId\n      agentTemplateName\n      agentcoreEvaluatorIds\n      tags\n      enabled\n      source\n      createdAt\n      updatedAt\n    }\n  }\n": types.CliEvalTestCasesDocument,
    "\n  query CliEvalTestCase($id: ID!) {\n    evalTestCase(id: $id) {\n      id\n      tenantId\n      name\n      category\n      query\n      systemPrompt\n      agentTemplateId\n      agentTemplateName\n      assertions\n      agentcoreEvaluatorIds\n      tags\n      enabled\n      source\n      createdAt\n      updatedAt\n    }\n  }\n": types.CliEvalTestCaseDocument,
    "\n  query CliComputersForEval($tenantId: ID!) {\n    computers(tenantId: $tenantId) {\n      id\n      name\n      slug\n      runtimeStatus\n    }\n  }\n": types.CliComputersForEvalDocument,
    "\n  query CliAgentTemplatesForEval($tenantId: ID!) {\n    agentTemplates(tenantId: $tenantId) {\n      id\n      name\n      slug\n      model\n      isPublished\n    }\n  }\n": types.CliAgentTemplatesForEvalDocument,
    "\n  query CliTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n": types.CliTenantBySlugDocument,
    "\n  mutation CliStartEvalRun($tenantId: ID!, $input: StartEvalRunInput!) {\n    startEvalRun(tenantId: $tenantId, input: $input) {\n      id\n      status\n      model\n      categories\n      agentTemplateId\n      agentTemplateName\n      totalTests\n      createdAt\n    }\n  }\n": types.CliStartEvalRunDocument,
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
    "\n  mutation CliMsgSendMessage($input: SendMessageInput!) {\n    sendMessage(input: $input) {\n      id\n      threadId\n      role\n      content\n      createdAt\n    }\n  }\n": types.CliMsgSendMessageDocument,
    "\n  query CliMsgMessages($threadId: ID!, $limit: Int, $cursor: String) {\n    messages(threadId: $threadId, limit: $limit, cursor: $cursor) {\n      edges {\n        cursor\n        node {\n          id\n          role\n          senderType\n          senderId\n          content\n          tokenCount\n          createdAt\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n": types.CliMsgMessagesDocument,
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
    "\n  query CliWikiTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n": types.CliWikiTenantBySlugDocument,
    "\n  query CliAllTenantAgentsForWiki($tenantId: ID!) {\n    allTenantAgents(tenantId: $tenantId, includeSystem: false, includeSubAgents: false) {\n      id\n      name\n      slug\n      type\n      status\n    }\n  }\n": types.CliAllTenantAgentsForWikiDocument,
    "\n  mutation CliCompileWikiNow($tenantId: ID!, $ownerId: ID!, $modelId: String) {\n    compileWikiNow(tenantId: $tenantId, ownerId: $ownerId, modelId: $modelId) {\n      id\n      tenantId\n      ownerId\n      status\n      trigger\n      dedupeKey\n      attempt\n      createdAt\n    }\n  }\n": types.CliCompileWikiNowDocument,
    "\n  mutation CliResetWikiCursor($tenantId: ID!, $ownerId: ID!, $force: Boolean) {\n    resetWikiCursor(tenantId: $tenantId, ownerId: $ownerId, force: $force) {\n      tenantId\n      ownerId\n      cursorCleared\n      pagesArchived\n    }\n  }\n": types.CliResetWikiCursorDocument,
    "\n  query CliWikiCompileJobs($tenantId: ID!, $ownerId: ID, $limit: Int) {\n    wikiCompileJobs(tenantId: $tenantId, ownerId: $ownerId, limit: $limit) {\n      id\n      tenantId\n      ownerId\n      status\n      trigger\n      dedupeKey\n      attempt\n      claimedAt\n      startedAt\n      finishedAt\n      error\n      metrics\n      createdAt\n    }\n  }\n": types.CliWikiCompileJobsDocument,
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
export function graphql(source: "\n  query CliEvalRuns($tenantId: ID!, $agentId: ID, $limit: Int, $offset: Int) {\n    evalRuns(\n      tenantId: $tenantId\n      agentId: $agentId\n      limit: $limit\n      offset: $offset\n    ) {\n      totalCount\n      items {\n        id\n        status\n        model\n        categories\n        agentId\n        agentName\n        agentTemplateId\n        agentTemplateName\n        totalTests\n        passed\n        failed\n        passRate\n        regression\n        costUsd\n        errorMessage\n        startedAt\n        completedAt\n        createdAt\n      }\n    }\n  }\n"): (typeof documents)["\n  query CliEvalRuns($tenantId: ID!, $agentId: ID, $limit: Int, $offset: Int) {\n    evalRuns(\n      tenantId: $tenantId\n      agentId: $agentId\n      limit: $limit\n      offset: $offset\n    ) {\n      totalCount\n      items {\n        id\n        status\n        model\n        categories\n        agentId\n        agentName\n        agentTemplateId\n        agentTemplateName\n        totalTests\n        passed\n        failed\n        passRate\n        regression\n        costUsd\n        errorMessage\n        startedAt\n        completedAt\n        createdAt\n      }\n    }\n  }\n"];
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
export function graphql(source: "\n  query CliComputersForEval($tenantId: ID!) {\n    computers(tenantId: $tenantId) {\n      id\n      name\n      slug\n      runtimeStatus\n    }\n  }\n"): (typeof documents)["\n  query CliComputersForEval($tenantId: ID!) {\n    computers(tenantId: $tenantId) {\n      id\n      name\n      slug\n      runtimeStatus\n    }\n  }\n"];
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
export function graphql(source: "\n  mutation CliMsgSendMessage($input: SendMessageInput!) {\n    sendMessage(input: $input) {\n      id\n      threadId\n      role\n      content\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  mutation CliMsgSendMessage($input: SendMessageInput!) {\n    sendMessage(input: $input) {\n      id\n      threadId\n      role\n      content\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliMsgMessages($threadId: ID!, $limit: Int, $cursor: String) {\n    messages(threadId: $threadId, limit: $limit, cursor: $cursor) {\n      edges {\n        cursor\n        node {\n          id\n          role\n          senderType\n          senderId\n          content\n          tokenCount\n          createdAt\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n"): (typeof documents)["\n  query CliMsgMessages($threadId: ID!, $limit: Int, $cursor: String) {\n    messages(threadId: $threadId, limit: $limit, cursor: $cursor) {\n      edges {\n        cursor\n        node {\n          id\n          role\n          senderType\n          senderId\n          content\n          tokenCount\n          createdAt\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n"];
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
export function graphql(source: "\n  query CliWikiTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n"): (typeof documents)["\n  query CliWikiTenantBySlug($slug: String!) {\n    tenantBySlug(slug: $slug) {\n      id\n      slug\n      name\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliAllTenantAgentsForWiki($tenantId: ID!) {\n    allTenantAgents(tenantId: $tenantId, includeSystem: false, includeSubAgents: false) {\n      id\n      name\n      slug\n      type\n      status\n    }\n  }\n"): (typeof documents)["\n  query CliAllTenantAgentsForWiki($tenantId: ID!) {\n    allTenantAgents(tenantId: $tenantId, includeSystem: false, includeSubAgents: false) {\n      id\n      name\n      slug\n      type\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliCompileWikiNow($tenantId: ID!, $ownerId: ID!, $modelId: String) {\n    compileWikiNow(tenantId: $tenantId, ownerId: $ownerId, modelId: $modelId) {\n      id\n      tenantId\n      ownerId\n      status\n      trigger\n      dedupeKey\n      attempt\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  mutation CliCompileWikiNow($tenantId: ID!, $ownerId: ID!, $modelId: String) {\n    compileWikiNow(tenantId: $tenantId, ownerId: $ownerId, modelId: $modelId) {\n      id\n      tenantId\n      ownerId\n      status\n      trigger\n      dedupeKey\n      attempt\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CliResetWikiCursor($tenantId: ID!, $ownerId: ID!, $force: Boolean) {\n    resetWikiCursor(tenantId: $tenantId, ownerId: $ownerId, force: $force) {\n      tenantId\n      ownerId\n      cursorCleared\n      pagesArchived\n    }\n  }\n"): (typeof documents)["\n  mutation CliResetWikiCursor($tenantId: ID!, $ownerId: ID!, $force: Boolean) {\n    resetWikiCursor(tenantId: $tenantId, ownerId: $ownerId, force: $force) {\n      tenantId\n      ownerId\n      cursorCleared\n      pagesArchived\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CliWikiCompileJobs($tenantId: ID!, $ownerId: ID, $limit: Int) {\n    wikiCompileJobs(tenantId: $tenantId, ownerId: $ownerId, limit: $limit) {\n      id\n      tenantId\n      ownerId\n      status\n      trigger\n      dedupeKey\n      attempt\n      claimedAt\n      startedAt\n      finishedAt\n      error\n      metrics\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  query CliWikiCompileJobs($tenantId: ID!, $ownerId: ID, $limit: Int) {\n    wikiCompileJobs(tenantId: $tenantId, ownerId: $ownerId, limit: $limit) {\n      id\n      tenantId\n      ownerId\n      status\n      trigger\n      dedupeKey\n      attempt\n      claimedAt\n      startedAt\n      finishedAt\n      error\n      metrics\n      createdAt\n    }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;