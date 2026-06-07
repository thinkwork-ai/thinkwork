/**
 * Client/schema contract guard.
 *
 * Validates the mention-target query documents this app sends against the
 * canonical GraphQL schema in packages/database-pg/graphql. This catches the
 * class of bug where a client query references a field that does not exist on
 * the server (e.g. `allTenantAgents`): GraphQL rejects the whole operation, the
 * urql error is easy to swallow, and the feature silently renders empty.
 */
import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { buildSchema, validate, type DocumentNode } from "graphql";
import { describe, expect, it } from "vitest";
import {
  NewThreadMentionTargetsQuery,
  ThreadMentionTargetsQuery,
} from "./graphql-queries";
import {
  SettingsApproveManagedApplicationDeploymentMutation,
  SettingsDeploymentEvidenceQuery,
  SettingsDeploymentStatusQuery,
  SettingsManagedApplicationDeploymentQuery,
  SettingsManagedApplicationsQuery,
  SettingsRejectManagedApplicationDeploymentMutation,
  SettingsStartManagedApplicationPlanMutation,
} from "./settings-queries";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const SCHEMA_DIR = join(REPO_ROOT, "packages/database-pg/graphql");
const TYPES_DIR = join(SCHEMA_DIR, "types");

// AppSync custom directives the canonical SDL references — needed so
// buildSchema doesn't reject @aws_subscribe et al.
const APPSYNC_DIRECTIVES = `
directive @aws_subscribe(mutations: [String!]!) on FIELD_DEFINITION
directive @aws_auth(cognito_groups: [String!]!) on FIELD_DEFINITION
directive @aws_api_key on FIELD_DEFINITION | OBJECT
directive @aws_iam on FIELD_DEFINITION | OBJECT
directive @aws_cognito_user_pools(cognito_groups: [String!]) on FIELD_DEFINITION | OBJECT
`;

function loadCanonicalSchema() {
  const base = readFileSync(join(SCHEMA_DIR, "schema.graphql"), "utf-8");
  const types = readdirSync(TYPES_DIR)
    .filter((f) => f.endsWith(".graphql"))
    .sort()
    .map((f) => readFileSync(join(TYPES_DIR, f), "utf-8"));
  return buildSchema([APPSYNC_DIRECTIVES, base, ...types].join("\n\n"));
}

describe("spaces mention-target queries vs canonical schema", () => {
  const schema = loadCanonicalSchema();

  it.each([
    ["NewThreadMentionTargetsQuery", NewThreadMentionTargetsQuery],
    ["ThreadMentionTargetsQuery", ThreadMentionTargetsQuery],
  ] as const)("%s validates against the schema", (_name, doc) => {
    const errors = validate(schema, doc as DocumentNode);
    expect(errors.map((e) => e.message)).toEqual([]);
  });
});

describe("spaces settings deployment queries vs canonical schema", () => {
  const schema = loadCanonicalSchema();

  it.each([
    ["SettingsDeploymentStatusQuery", SettingsDeploymentStatusQuery],
    ["SettingsManagedApplicationsQuery", SettingsManagedApplicationsQuery],
    [
      "SettingsManagedApplicationDeploymentQuery",
      SettingsManagedApplicationDeploymentQuery,
    ],
    ["SettingsDeploymentEvidenceQuery", SettingsDeploymentEvidenceQuery],
    [
      "SettingsStartManagedApplicationPlanMutation",
      SettingsStartManagedApplicationPlanMutation,
    ],
    [
      "SettingsApproveManagedApplicationDeploymentMutation",
      SettingsApproveManagedApplicationDeploymentMutation,
    ],
    [
      "SettingsRejectManagedApplicationDeploymentMutation",
      SettingsRejectManagedApplicationDeploymentMutation,
    ],
  ] as const)("%s validates against the schema", (_name, doc) => {
    const errors = validate(schema, doc as DocumentNode);
    expect(errors.map((e) => e.message)).toEqual([]);
  });
});
