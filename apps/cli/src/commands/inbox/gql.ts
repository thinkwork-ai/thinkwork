import { graphql } from "../../gql/index.js";

export const InboxItemsDoc = graphql(`
  query CliInboxItems(
    $tenantId: ID!
    $status: InboxItemStatus
    $entityType: String
    $entityId: ID
    $recipientId: ID
  ) {
    inboxItems(
      tenantId: $tenantId
      status: $status
      entityType: $entityType
      entityId: $entityId
      recipientId: $recipientId
    ) {
      id
      type
      status
      title
      description
      requesterType
      requesterId
      recipientId
      entityType
      entityId
      revision
      reviewNotes
      decidedBy
      decidedAt
      expiresAt
      createdAt
      updatedAt
    }
  }
`);

export const InboxItemDoc = graphql(`
  query CliInboxItem($id: ID!) {
    inboxItem(id: $id) {
      id
      type
      status
      title
      description
      requesterType
      requesterId
      recipientId
      entityType
      entityId
      config
      revision
      reviewNotes
      decidedBy
      decidedAt
      expiresAt
      createdAt
      updatedAt
      comments {
        id
        authorType
        authorId
        content
        createdAt
      }
      links {
        id
        linkedType
        linkedId
        createdAt
      }
      linkedThreads {
        id
        number
        identifier
        title
        status
      }
    }
  }
`);

export const ApproveInboxItemDoc = graphql(`
  mutation CliInboxApprove($id: ID!, $input: ApproveInboxItemInput) {
    approveInboxItem(id: $id, input: $input) {
      id
      status
      reviewNotes
      decidedAt
    }
  }
`);

export const RejectInboxItemDoc = graphql(`
  mutation CliInboxReject($id: ID!, $input: RejectInboxItemInput) {
    rejectInboxItem(id: $id, input: $input) {
      id
      status
      reviewNotes
      decidedAt
    }
  }
`);

export const RequestRevisionDoc = graphql(`
  mutation CliInboxRequestRevision($id: ID!, $input: RequestRevisionInput!) {
    requestRevision(id: $id, input: $input) {
      id
      status
      reviewNotes
      revision
    }
  }
`);

export const ResubmitInboxItemDoc = graphql(`
  mutation CliInboxResubmit($id: ID!, $input: ResubmitInboxItemInput) {
    resubmitInboxItem(id: $id, input: $input) {
      id
      status
      revision
    }
  }
`);

export const CancelInboxItemDoc = graphql(`
  mutation CliInboxCancel($id: ID!) {
    cancelInboxItem(id: $id) {
      id
      status
    }
  }
`);

export const AddInboxItemCommentDoc = graphql(`
  mutation CliInboxAddComment($input: AddInboxItemCommentInput!) {
    addInboxItemComment(input: $input) {
      id
      inboxItemId
      authorType
      authorId
      content
      createdAt
    }
  }
`);

export const InboxTenantBySlugDoc = graphql(`
  query CliInboxTenantBySlug($slug: String!) {
    tenantBySlug(slug: $slug) {
      id
      slug
      name
    }
  }
`);
