import { graphql } from "@/gql";

export const SettingsSkillDraftsQuery = graphql(`
  query SettingsSkillDrafts {
    skillDrafts {
      id
      tenantId
      slug
      title
      displayName
      summary
      status
      currentContentHash
      inboxItemId
      submittedAt
      createdAt
      updatedAt
      requester {
        id
        name
        email
      }
      source {
        kind
        threadId
        messageId
      }
    }
  }
`);

export const PublishSkillDraftMutation = graphql(`
  mutation PublishSkillDraft($input: PublishSkillDraftInput!) {
    publishSkillDraft(input: $input) {
      id
      slug
      displayName
      status
      currentContentHash
      publishedCatalogSlug
      publishedContentHash
      updatedAt
    }
  }
`);
