import { graphql } from "../../gql/index.js";

export const ThreadsDoc = graphql(`
  query CliThreads(
    $tenantId: ID!
    $status: ThreadStatus
    $channel: ThreadChannel
    $agentId: ID
    $assigneeId: ID
    $search: String
    $limit: Int
  ) {
    threads(
      tenantId: $tenantId
      status: $status
      channel: $channel
      agentId: $agentId
      assigneeId: $assigneeId
      search: $search
      limit: $limit
    ) {
      id
      number
      title
      status
      channel
      assigneeType
      assigneeId
      agentId
      lastActivityAt
      archivedAt
      createdAt
    }
  }
`);

export const ThreadByIdDoc = graphql(`
  query CliThreadById($id: ID!) {
    thread(id: $id) {
      id
      number
      identifier
      title
      status
      channel
      assigneeType
      assigneeId
      agentId
      reporterId
      billingCode
      labels
      dueAt
      startedAt
      completedAt
      archivedAt
      lastActivityAt
      lastResponsePreview
      createdAt
      updatedAt
    }
  }
`);

export const ThreadByNumberDoc = graphql(`
  query CliThreadByNumber($tenantId: ID!, $number: Int!) {
    threadByNumber(tenantId: $tenantId, number: $number) {
      id
      number
      identifier
      title
      status
      channel
      assigneeType
      assigneeId
      agentId
      reporterId
      billingCode
      labels
      dueAt
      startedAt
      completedAt
      archivedAt
      lastActivityAt
      lastResponsePreview
      createdAt
      updatedAt
    }
  }
`);

export const ThreadLabelsForResolveDoc = graphql(`
  query CliThreadLabelsForResolve($tenantId: ID!) {
    threadLabels(tenantId: $tenantId) {
      id
      name
      color
    }
  }
`);

export const CreateThreadDoc = graphql(`
  mutation CliCreateThread($input: CreateThreadInput!) {
    createThread(input: $input) {
      id
      number
      title
      status
    }
  }
`);

export const UpdateThreadDoc = graphql(`
  mutation CliUpdateThread($id: ID!, $input: UpdateThreadInput!) {
    updateThread(id: $id, input: $input) {
      id
      number
      title
      status
      assigneeType
      assigneeId
      dueAt
      archivedAt
    }
  }
`);

export const DeleteThreadDoc = graphql(`
  mutation CliDeleteThread($id: ID!) {
    deleteThread(id: $id)
  }
`);

export const CheckoutThreadDoc = graphql(`
  mutation CliCheckoutThread($id: ID!, $input: CheckoutThreadInput!) {
    checkoutThread(id: $id, input: $input) {
      id
      status
      checkoutRunId
      checkoutVersion
    }
  }
`);

export const ReleaseThreadDoc = graphql(`
  mutation CliReleaseThread($id: ID!, $input: ReleaseThreadInput!) {
    releaseThread(id: $id, input: $input) {
      id
      status
      checkoutRunId
    }
  }
`);

export const AssignThreadLabelDoc = graphql(`
  mutation CliAssignThreadLabel($threadId: ID!, $labelId: ID!) {
    assignThreadLabel(threadId: $threadId, labelId: $labelId) {
      id
      threadId
      labelId
      createdAt
    }
  }
`);

export const RemoveThreadLabelDoc = graphql(`
  mutation CliRemoveThreadLabel($threadId: ID!, $labelId: ID!) {
    removeThreadLabel(threadId: $threadId, labelId: $labelId)
  }
`);

export const EscalateThreadDoc = graphql(`
  mutation CliEscalateThread($input: EscalateThreadInput!) {
    escalateThread(input: $input) {
      id
      status
      assigneeType
      assigneeId
    }
  }
`);

export const DelegateThreadDoc = graphql(`
  mutation CliDelegateThread($input: DelegateThreadInput!) {
    delegateThread(input: $input) {
      id
      status
      assigneeType
      assigneeId
    }
  }
`);

export const SendMessageDoc = graphql(`
  mutation CliSendMessage($input: SendMessageInput!) {
    sendMessage(input: $input) {
      id
      threadId
      role
      content
      createdAt
    }
  }
`);

export const ThreadTenantBySlugDoc = graphql(`
  query CliThreadTenantBySlug($slug: String!) {
    tenantBySlug(slug: $slug) {
      id
      slug
      name
    }
  }
`);
