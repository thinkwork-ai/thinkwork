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
    "\n  query AppletState($appId: ID!, $instanceId: ID!, $key: String!) {\n    appletState(appId: $appId, instanceId: $instanceId, key: $key) {\n      appId\n      instanceId\n      key\n      value\n      updatedAt\n    }\n  }\n": typeof types.AppletStateDocument,
    "\n  mutation SaveAppletState($input: SaveAppletStateInput!) {\n    saveAppletState(input: $input) {\n      appId\n      instanceId\n      key\n      value\n      updatedAt\n    }\n  }\n": typeof types.SaveAppletStateDocument,
    "\n  query SettingsTenantDetail($id: ID!) {\n    tenant(id: $id) {\n      id\n      name\n      slug\n      plan\n      issuePrefix\n      issueCounter\n      settings {\n        id\n        defaultModel\n      }\n      createdAt\n    }\n  }\n": typeof types.SettingsTenantDetailDocument,
    "\n  query SettingsDeploymentStatus {\n    deploymentStatus {\n      stage\n      source\n      region\n      accountId\n      bucketName\n      databaseEndpoint\n      ecrUrl\n      adminUrl\n      docsUrl\n      apiEndpoint\n      appsyncUrl\n      appsyncRealtimeUrl\n      hindsightEndpoint\n      agentcoreStatus\n      hindsightEnabled\n      managedMemoryEnabled\n    }\n  }\n": typeof types.SettingsDeploymentStatusDocument,
    "\n  mutation SettingsRenameTenantSlug($tenantId: ID!, $newSlug: String!) {\n    renameTenantSlug(tenantId: $tenantId, newSlug: $newSlug) {\n      id\n      slug\n      updatedAt\n    }\n  }\n": typeof types.SettingsRenameTenantSlugDocument,
    "\n  query SettingsSpacesList($tenantId: ID!) {\n    spaces(tenantId: $tenantId, status: ACTIVE, includeAllForAdmin: true) {\n      id\n      tenantId\n      name\n      description\n      status\n      accessMode\n      updatedAt\n    }\n  }\n": typeof types.SettingsSpacesListDocument,
    "\n  mutation SettingsCreateSpace($input: CreateSpaceInput!) {\n    createSpace(input: $input) {\n      id\n      tenantId\n      name\n      description\n      status\n      accessMode\n      updatedAt\n    }\n  }\n": typeof types.SettingsCreateSpaceDocument,
    "\n  query SettingsTenantAgent($tenantId: ID!) {\n    agent: tenantAgent(tenantId: $tenantId) {\n      id\n      tenantId\n      runtime\n      model\n    }\n  }\n": typeof types.SettingsTenantAgentDocument,
    "\n  query SettingsModelCatalog {\n    modelCatalog {\n      id\n      modelId\n      displayName\n      provider\n    }\n  }\n": typeof types.SettingsModelCatalogDocument,
    "\n  mutation SettingsUpdateTenantAgent(\n    $tenantId: ID!\n    $input: UpdateTenantAgentInput!\n  ) {\n    updateTenantAgent(tenantId: $tenantId, input: $input) {\n      id\n      runtime\n      model\n      updatedAt\n    }\n  }\n": typeof types.SettingsUpdateTenantAgentDocument,
};
const documents: Documents = {
    "\n  query AppletState($appId: ID!, $instanceId: ID!, $key: String!) {\n    appletState(appId: $appId, instanceId: $instanceId, key: $key) {\n      appId\n      instanceId\n      key\n      value\n      updatedAt\n    }\n  }\n": types.AppletStateDocument,
    "\n  mutation SaveAppletState($input: SaveAppletStateInput!) {\n    saveAppletState(input: $input) {\n      appId\n      instanceId\n      key\n      value\n      updatedAt\n    }\n  }\n": types.SaveAppletStateDocument,
    "\n  query SettingsTenantDetail($id: ID!) {\n    tenant(id: $id) {\n      id\n      name\n      slug\n      plan\n      issuePrefix\n      issueCounter\n      settings {\n        id\n        defaultModel\n      }\n      createdAt\n    }\n  }\n": types.SettingsTenantDetailDocument,
    "\n  query SettingsDeploymentStatus {\n    deploymentStatus {\n      stage\n      source\n      region\n      accountId\n      bucketName\n      databaseEndpoint\n      ecrUrl\n      adminUrl\n      docsUrl\n      apiEndpoint\n      appsyncUrl\n      appsyncRealtimeUrl\n      hindsightEndpoint\n      agentcoreStatus\n      hindsightEnabled\n      managedMemoryEnabled\n    }\n  }\n": types.SettingsDeploymentStatusDocument,
    "\n  mutation SettingsRenameTenantSlug($tenantId: ID!, $newSlug: String!) {\n    renameTenantSlug(tenantId: $tenantId, newSlug: $newSlug) {\n      id\n      slug\n      updatedAt\n    }\n  }\n": types.SettingsRenameTenantSlugDocument,
    "\n  query SettingsSpacesList($tenantId: ID!) {\n    spaces(tenantId: $tenantId, status: ACTIVE, includeAllForAdmin: true) {\n      id\n      tenantId\n      name\n      description\n      status\n      accessMode\n      updatedAt\n    }\n  }\n": types.SettingsSpacesListDocument,
    "\n  mutation SettingsCreateSpace($input: CreateSpaceInput!) {\n    createSpace(input: $input) {\n      id\n      tenantId\n      name\n      description\n      status\n      accessMode\n      updatedAt\n    }\n  }\n": types.SettingsCreateSpaceDocument,
    "\n  query SettingsTenantAgent($tenantId: ID!) {\n    agent: tenantAgent(tenantId: $tenantId) {\n      id\n      tenantId\n      runtime\n      model\n    }\n  }\n": types.SettingsTenantAgentDocument,
    "\n  query SettingsModelCatalog {\n    modelCatalog {\n      id\n      modelId\n      displayName\n      provider\n    }\n  }\n": types.SettingsModelCatalogDocument,
    "\n  mutation SettingsUpdateTenantAgent(\n    $tenantId: ID!\n    $input: UpdateTenantAgentInput!\n  ) {\n    updateTenantAgent(tenantId: $tenantId, input: $input) {\n      id\n      runtime\n      model\n      updatedAt\n    }\n  }\n": types.SettingsUpdateTenantAgentDocument,
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
export function graphql(source: "\n  query AppletState($appId: ID!, $instanceId: ID!, $key: String!) {\n    appletState(appId: $appId, instanceId: $instanceId, key: $key) {\n      appId\n      instanceId\n      key\n      value\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  query AppletState($appId: ID!, $instanceId: ID!, $key: String!) {\n    appletState(appId: $appId, instanceId: $instanceId, key: $key) {\n      appId\n      instanceId\n      key\n      value\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SaveAppletState($input: SaveAppletStateInput!) {\n    saveAppletState(input: $input) {\n      appId\n      instanceId\n      key\n      value\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  mutation SaveAppletState($input: SaveAppletStateInput!) {\n    saveAppletState(input: $input) {\n      appId\n      instanceId\n      key\n      value\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SettingsTenantDetail($id: ID!) {\n    tenant(id: $id) {\n      id\n      name\n      slug\n      plan\n      issuePrefix\n      issueCounter\n      settings {\n        id\n        defaultModel\n      }\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  query SettingsTenantDetail($id: ID!) {\n    tenant(id: $id) {\n      id\n      name\n      slug\n      plan\n      issuePrefix\n      issueCounter\n      settings {\n        id\n        defaultModel\n      }\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SettingsDeploymentStatus {\n    deploymentStatus {\n      stage\n      source\n      region\n      accountId\n      bucketName\n      databaseEndpoint\n      ecrUrl\n      adminUrl\n      docsUrl\n      apiEndpoint\n      appsyncUrl\n      appsyncRealtimeUrl\n      hindsightEndpoint\n      agentcoreStatus\n      hindsightEnabled\n      managedMemoryEnabled\n    }\n  }\n"): (typeof documents)["\n  query SettingsDeploymentStatus {\n    deploymentStatus {\n      stage\n      source\n      region\n      accountId\n      bucketName\n      databaseEndpoint\n      ecrUrl\n      adminUrl\n      docsUrl\n      apiEndpoint\n      appsyncUrl\n      appsyncRealtimeUrl\n      hindsightEndpoint\n      agentcoreStatus\n      hindsightEnabled\n      managedMemoryEnabled\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SettingsRenameTenantSlug($tenantId: ID!, $newSlug: String!) {\n    renameTenantSlug(tenantId: $tenantId, newSlug: $newSlug) {\n      id\n      slug\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  mutation SettingsRenameTenantSlug($tenantId: ID!, $newSlug: String!) {\n    renameTenantSlug(tenantId: $tenantId, newSlug: $newSlug) {\n      id\n      slug\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SettingsSpacesList($tenantId: ID!) {\n    spaces(tenantId: $tenantId, status: ACTIVE, includeAllForAdmin: true) {\n      id\n      tenantId\n      name\n      description\n      status\n      accessMode\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  query SettingsSpacesList($tenantId: ID!) {\n    spaces(tenantId: $tenantId, status: ACTIVE, includeAllForAdmin: true) {\n      id\n      tenantId\n      name\n      description\n      status\n      accessMode\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SettingsCreateSpace($input: CreateSpaceInput!) {\n    createSpace(input: $input) {\n      id\n      tenantId\n      name\n      description\n      status\n      accessMode\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  mutation SettingsCreateSpace($input: CreateSpaceInput!) {\n    createSpace(input: $input) {\n      id\n      tenantId\n      name\n      description\n      status\n      accessMode\n      updatedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SettingsTenantAgent($tenantId: ID!) {\n    agent: tenantAgent(tenantId: $tenantId) {\n      id\n      tenantId\n      runtime\n      model\n    }\n  }\n"): (typeof documents)["\n  query SettingsTenantAgent($tenantId: ID!) {\n    agent: tenantAgent(tenantId: $tenantId) {\n      id\n      tenantId\n      runtime\n      model\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SettingsModelCatalog {\n    modelCatalog {\n      id\n      modelId\n      displayName\n      provider\n    }\n  }\n"): (typeof documents)["\n  query SettingsModelCatalog {\n    modelCatalog {\n      id\n      modelId\n      displayName\n      provider\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SettingsUpdateTenantAgent(\n    $tenantId: ID!\n    $input: UpdateTenantAgentInput!\n  ) {\n    updateTenantAgent(tenantId: $tenantId, input: $input) {\n      id\n      runtime\n      model\n      updatedAt\n    }\n  }\n"): (typeof documents)["\n  mutation SettingsUpdateTenantAgent(\n    $tenantId: ID!\n    $input: UpdateTenantAgentInput!\n  ) {\n    updateTenantAgent(tenantId: $tenantId, input: $input) {\n      id\n      runtime\n      model\n      updatedAt\n    }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;