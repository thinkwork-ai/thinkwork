import { graphql } from "@/gql";

// Typed graphql() operations for the operator-only applet surface ported from
// apps/web (the deprecated Artifacts page). These live separately from the
// legacy untyped `graphql-queries.ts` (which codegen excludes) so the operator
// tooling gets full type-safety from the generated documents.
//
// NOTE: `AdminApplets` selects the same Applet field set as the spaces
// `AppletPreviewFields` fragment — crucially including `artifact { id
// favoritedAt }` — so operator-filtered rows render identically (and stay
// favoritable) to the default tenant-wide list. The admin original omits
// `favoritedAt`; do not drop it here. Both `applets` and `adminApplets`
// resolve through the same `toAppletPreview` shape server-side, so the list
// renderer is field-shape-agnostic once the documents agree.

export const AdminAppletsQuery = graphql(`
  query AdminApplets(
    $tenantId: ID!
    $userId: ID
    $cursor: String
    $limit: Int
  ) {
    adminApplets(
      tenantId: $tenantId
      userId: $userId
      cursor: $cursor
      limit: $limit
    ) {
      nodes {
        appId
        name
        version
        tenantId
        threadId
        prompt
        agentVersion
        modelId
        generatedAt
        stdlibVersionAtGeneration
        artifact {
          id
          favoritedAt
        }
      }
      nextCursor
    }
  }
`);

export const AdminUpdateAppletSourceMutation = graphql(`
  mutation AdminUpdateAppletSource($input: AdminUpdateAppletSourceInput!) {
    adminUpdateAppletSource(input: $input) {
      ok
      appId
      version
      validated
      persisted
      errors
    }
  }
`);
