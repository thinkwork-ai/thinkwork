/**
 * Operator-only safe metadata reconciliation for Cognito federation.
 *
 * The Terraform/deployment path describes already-created AWS resources. This
 * endpoint stores only identifiers, ARNs, lifecycle status, and revisioned
 * desired state. It never accepts secret values and never publishes a login
 * option; public policy is a separate control plane.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import {
  CognitoIdentityProviderClient,
  DescribeIdentityProviderCommand,
  DescribeUserPoolClientCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import {
  authProviderResources,
  authReconciliationSets,
  authRouteClients,
  tenantAuthHosts,
  tenantAuthProviderReferences,
} from "@thinkwork/database-pg/schema";
import type { Database } from "@thinkwork/database-pg";
import { db } from "../lib/db.js";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { error, json, unauthorized } from "../lib/response.js";
import {
  AuthProviderValidationError,
  type SafeAuthReconcilePayload,
  validateAuthProviderMetadata,
} from "../lib/auth-provider-validation.js";
import { emitAuthControlEvent } from "../lib/compliance/emit.js";

export class AuthReconciliationConflict extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthReconciliationConflict";
  }
}

export interface ReconciliationTransitionInput {
  latestRevision: number;
  latestFingerprint?: string;
  replayFingerprint?: string;
  expectedPreviousRevision: number;
  revision: number;
  manifestFingerprint: string;
  existingConnectionKeys: string[];
  desiredConnectionKeys: string[];
}

export function assertReconciliationTransition(
  input: ReconciliationTransitionInput,
): "apply" | "replay" {
  if (input.replayFingerprint !== undefined) {
    if (input.replayFingerprint !== input.manifestFingerprint) {
      throw new AuthReconciliationConflict(
        "idempotency_mismatch",
        "The idempotency key was already used for different metadata.",
      );
    }
    return "replay";
  }
  if (
    input.expectedPreviousRevision !== input.latestRevision ||
    input.revision !== input.latestRevision + 1
  ) {
    throw new AuthReconciliationConflict(
      "revision_conflict",
      `Expected revision ${input.latestRevision + 1} after ${input.latestRevision}.`,
    );
  }
  const desired = new Set(input.desiredConnectionKeys);
  const omitted = input.existingConnectionKeys.filter(
    (key) => !desired.has(key),
  );
  if (omitted.length > 0) {
    throw new AuthReconciliationConflict(
      "incomplete_desired_set",
      `Desired state omitted existing connections: ${omitted.sort().join(", ")}. Submit them with lifecycleState=denied to retire them.`,
    );
  }
  return "apply";
}

interface CognitoDescribeClient {
  send(command: unknown): Promise<any>;
}

function sameSet(
  actual: readonly string[] = [],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    [...actual]
      .sort()
      .every((value, index) => value === [...expected].sort()[index])
  );
}

function normalizedIssuer(value: string | undefined): string | undefined {
  return value?.replace(/\/+$/, "");
}

/** Independently reads Cognito and rejects submitted metadata on any mismatch. */
export async function verifyReconciledAwsMetadata(
  payload: SafeAuthReconcilePayload,
  client: CognitoDescribeClient,
): Promise<void> {
  try {
    for (const connection of payload.connections) {
      if (
        connection.lifecycleState === "denied" ||
        connection.cognitoIdentityProviderName === "COGNITO"
      ) {
        continue;
      }
      const response = await client.send(
        new DescribeIdentityProviderCommand({
          UserPoolId: connection.cognitoUserPoolId,
          ProviderName: connection.cognitoIdentityProviderName,
        }),
      );
      const identityProvider = response.IdentityProvider;
      const expectedType =
        connection.providerKind === "google" ? "Google" : "OIDC";
      if (
        identityProvider?.ProviderName !==
          connection.cognitoIdentityProviderName ||
        identityProvider?.ProviderType !== expectedType ||
        (connection.clientId !== undefined &&
          identityProvider?.ProviderDetails?.client_id !==
            connection.clientId) ||
        (connection.issuerUrl !== undefined &&
          normalizedIssuer(identityProvider?.ProviderDetails?.oidc_issuer) !==
            normalizedIssuer(connection.issuerUrl))
      ) {
        throw new AuthReconciliationConflict(
          "aws_metadata_mismatch",
          `Cognito identity provider ${connection.connectionKey} does not match submitted safe metadata.`,
        );
      }
    }

    for (const route of payload.routeClients) {
      if (route.lifecycleState === "denied") continue;
      const response = await client.send(
        new DescribeUserPoolClientCommand({
          UserPoolId: route.cognitoUserPoolId,
          ClientId: route.cognitoAppClientId,
        }),
      );
      const appClient = response.UserPoolClient;
      if (
        appClient?.ClientId !== route.cognitoAppClientId ||
        !sameSet(appClient?.SupportedIdentityProviders, route.providerNames) ||
        !sameSet(appClient?.ExplicitAuthFlows, route.explicitAuthFlows) ||
        !sameSet(appClient?.CallbackURLs, route.redirectUris) ||
        !sameSet(appClient?.LogoutURLs, route.logoutUris)
      ) {
        throw new AuthReconciliationConflict(
          "aws_metadata_mismatch",
          `Cognito app-client route ${route.routeKey}:${route.clientFamily} does not match submitted safe metadata.`,
        );
      }
    }
  } catch (cause) {
    if (cause instanceof AuthReconciliationConflict) throw cause;
    throw new AuthReconciliationConflict(
      "aws_describe_failed",
      "Cognito resources could not be independently described.",
    );
  }
}

type AuthDb = Database;

export async function reconcileAuthProviderMetadata(
  payload: SafeAuthReconcilePayload,
  database: AuthDb = db,
): Promise<{ status: "applied" | "replayed"; revision: number }> {
  return database.transaction(async (tx) => {
    const [replay] = await tx
      .select({
        fingerprint: authReconciliationSets.manifest_fingerprint,
        revision: authReconciliationSets.revision,
        status: authReconciliationSets.status,
      })
      .from(authReconciliationSets)
      .where(eq(authReconciliationSets.idempotency_key, payload.idempotencyKey))
      .limit(1);

    const [latest] = await tx
      .select({
        revision: authReconciliationSets.revision,
        fingerprint: authReconciliationSets.manifest_fingerprint,
      })
      .from(authReconciliationSets)
      .where(eq(authReconciliationSets.stage, payload.stage))
      .orderBy(desc(authReconciliationSets.revision))
      .limit(1);

    const poolIds = [
      ...new Set(payload.connections.map((entry) => entry.cognitoUserPoolId)),
    ];
    const existing =
      poolIds.length === 0
        ? []
        : await tx
            .select({ connectionKey: authProviderResources.connection_key })
            .from(authProviderResources)
            .where(
              and(
                inArray(authProviderResources.cognito_user_pool_id, poolIds),
                ne(authProviderResources.lifecycle_state, "denied"),
              ),
            );

    const transition = assertReconciliationTransition({
      latestRevision: latest?.revision ?? 0,
      latestFingerprint: latest?.fingerprint,
      replayFingerprint: replay?.fingerprint,
      expectedPreviousRevision: payload.expectedPreviousRevision,
      revision: payload.revision,
      manifestFingerprint: payload.manifestFingerprint,
      existingConnectionKeys: existing.map((entry) => entry.connectionKey),
      desiredConnectionKeys: payload.connections.map(
        (entry) => entry.connectionKey,
      ),
    });
    if (transition === "replay") {
      if (replay?.status !== "applied") {
        throw new AuthReconciliationConflict(
          "replay_not_applied",
          "The matching reconciliation has not reached applied state.",
        );
      }
      return { status: "replayed", revision: replay.revision };
    }

    await tx.insert(authReconciliationSets).values({
      stage: payload.stage,
      revision: payload.revision,
      idempotency_key: payload.idempotencyKey,
      manifest_fingerprint: payload.manifestFingerprint,
      desired_connections: [
        ...payload.connections.map((connection) => ({
          connectionKey: connection.connectionKey,
          providerKind: connection.providerKind,
          lifecycleState: connection.lifecycleState,
          cognitoUserPoolId: connection.cognitoUserPoolId,
          cognitoIdentityProviderName: connection.cognitoIdentityProviderName,
          resourceArn: connection.resourceArn ?? null,
        })),
        ...payload.routeClients.map((route) => ({
          routeKey: route.routeKey,
          clientFamily: route.clientFamily,
          lifecycleState: route.lifecycleState,
          cognitoUserPoolId: route.cognitoUserPoolId,
          cognitoAppClientId: route.cognitoAppClientId,
          resourceArn: route.resourceArn ?? null,
        })),
      ],
      status: "pending",
    });

    for (const connection of payload.connections) {
      const publishesNativeOption =
        connection.lifecycleState === "native" &&
        (connection.providerKind === "google" ||
          connection.providerKind === "microsoft_organizations" ||
          connection.tenantBindings.some(
            (binding) => binding.status === "enabled",
          ));
      const [resource] = await tx
        .insert(authProviderResources)
        .values({
          provider_key: connection.providerKey,
          connection_key: connection.connectionKey,
          provider_kind: connection.providerKind,
          display_name: connection.displayName,
          lifecycle_state: connection.lifecycleState,
          cognito_user_pool_id: connection.cognitoUserPoolId,
          cognito_app_client_ids: payload.routeClients
            .filter((route) =>
              route.providerNames.includes(
                connection.cognitoIdentityProviderName,
              ),
            )
            .map((route) => route.cognitoAppClientId),
          cognito_identity_provider_name:
            connection.cognitoIdentityProviderName,
          issuer_url: connection.issuerUrl ?? null,
          client_id: connection.clientId ?? null,
          client_secret_ref: connection.clientSecretRef ?? null,
          resource_arn: connection.resourceArn ?? null,
          aws_account_id: payload.awsAccountId,
          aws_region: payload.awsRegion,
          authorize_scopes: connection.authorizeScopes,
          desired_revision: payload.revision,
          validation_status:
            connection.lifecycleState === "denied" ? "disabled" : "valid",
          public_options_published: publishesNativeOption,
          diagnostics: {},
          updated_at: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            authProviderResources.cognito_user_pool_id,
            authProviderResources.connection_key,
          ],
          set: {
            provider_key: connection.providerKey,
            provider_kind: connection.providerKind,
            display_name: connection.displayName,
            lifecycle_state: connection.lifecycleState,
            cognito_app_client_ids: payload.routeClients
              .filter((route) =>
                route.providerNames.includes(
                  connection.cognitoIdentityProviderName,
                ),
              )
              .map((route) => route.cognitoAppClientId),
            cognito_identity_provider_name:
              connection.cognitoIdentityProviderName,
            issuer_url: connection.issuerUrl ?? null,
            client_id: connection.clientId ?? null,
            client_secret_ref: connection.clientSecretRef ?? null,
            resource_arn: connection.resourceArn ?? null,
            aws_account_id: payload.awsAccountId,
            aws_region: payload.awsRegion,
            authorize_scopes: connection.authorizeScopes,
            desired_revision: payload.revision,
            validation_status:
              connection.lifecycleState === "denied" ? "disabled" : "valid",
            public_options_published: publishesNativeOption,
            diagnostics: {},
            updated_at: new Date(),
          },
        })
        .returning({ id: authProviderResources.id });

      if (!resource) {
        throw new Error("Auth provider upsert returned no resource id.");
      }

      for (const binding of connection.tenantBindings) {
        await tx
          .insert(tenantAuthProviderReferences)
          .values({
            tenant_id: binding.tenantId,
            auth_provider_resource_id: resource.id,
            status: binding.status,
            hostnames: binding.hostnames,
            public_option_label: binding.label,
            desired_revision: payload.revision,
            metadata: {},
            updated_at: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              tenantAuthProviderReferences.tenant_id,
              tenantAuthProviderReferences.auth_provider_resource_id,
            ],
            set: {
              status: binding.status,
              hostnames: binding.hostnames,
              public_option_label: binding.label,
              desired_revision: payload.revision,
              updated_at: new Date(),
            },
          });

        for (const hostname of binding.hostnames) {
          await tx
            .insert(tenantAuthHosts)
            .values({
              tenant_id: binding.tenantId,
              hostname,
              status: "verified",
              verified_at: new Date(),
            })
            .onConflictDoNothing({ target: tenantAuthHosts.hostname });
        }

        await emitAuthControlEvent(tx, {
          tenantId: binding.tenantId,
          actorId: "auth-provider-reconciler",
          eventType: "auth.provider_reconciled",
          resourceType: "auth_provider_resource",
          resourceId: resource.id,
          action: "reconcile",
          outcome: "success",
          payload: {
            stage: payload.stage,
            revision: payload.revision,
            manifestFingerprint: payload.manifestFingerprint,
            connectionKey: connection.connectionKey,
            providerKind: connection.providerKind,
            lifecycleState: connection.lifecycleState,
            validationStatus:
              connection.lifecycleState === "denied" ? "disabled" : "valid",
            resourceArn: connection.resourceArn,
            outcome: "success",
          },
        });
      }
    }

    for (const route of payload.routeClients) {
      await tx
        .insert(authRouteClients)
        .values({
          route_key: route.routeKey,
          client_family: route.clientFamily,
          cognito_user_pool_id: route.cognitoUserPoolId,
          cognito_app_client_id: route.cognitoAppClientId,
          provider_names: route.providerNames,
          explicit_auth_flows: route.explicitAuthFlows,
          redirect_uris: route.redirectUris,
          logout_uris: route.logoutUris,
          lifecycle_state: route.lifecycleState,
          validation_status:
            route.lifecycleState === "denied" ? "disabled" : "valid",
          desired_revision: payload.revision,
          resource_arn: route.resourceArn ?? null,
          diagnostics: {},
          updated_at: new Date(),
        })
        .onConflictDoUpdate({
          target: [authRouteClients.route_key, authRouteClients.client_family],
          set: {
            cognito_user_pool_id: route.cognitoUserPoolId,
            cognito_app_client_id: route.cognitoAppClientId,
            provider_names: route.providerNames,
            explicit_auth_flows: route.explicitAuthFlows,
            redirect_uris: route.redirectUris,
            logout_uris: route.logoutUris,
            lifecycle_state: route.lifecycleState,
            validation_status:
              route.lifecycleState === "denied" ? "disabled" : "valid",
            desired_revision: payload.revision,
            resource_arn: route.resourceArn ?? null,
            diagnostics: {},
            updated_at: new Date(),
          },
        });
    }

    await tx
      .update(authReconciliationSets)
      .set({ status: "applied", applied_at: new Date() })
      .where(
        and(
          eq(authReconciliationSets.stage, payload.stage),
          eq(authReconciliationSets.revision, payload.revision),
        ),
      );

    return { status: "applied", revision: payload.revision };
  });
}

export async function recordRejectedAuthProviderMetadata(
  payload: SafeAuthReconcilePayload,
  rejection: AuthReconciliationConflict,
  database: AuthDb = db,
): Promise<void> {
  await database.transaction(async (tx) => {
    await tx
      .insert(authReconciliationSets)
      .values({
        stage: payload.stage,
        revision: payload.revision,
        idempotency_key: payload.idempotencyKey,
        manifest_fingerprint: payload.manifestFingerprint,
        desired_connections: payload.connections.map((connection) => ({
          connectionKey: connection.connectionKey,
          lifecycleState: connection.lifecycleState,
        })),
        status: "rejected",
      })
      .onConflictDoNothing();

    for (const connection of payload.connections) {
      const resources = await tx
        .update(authProviderResources)
        .set({
          validation_status: "invalid",
          public_options_published: false,
          last_error_code: rejection.code,
          diagnostics: {
            code: rejection.code,
            revision: payload.revision,
          },
          updated_at: new Date(),
        })
        .where(
          and(
            eq(
              authProviderResources.cognito_user_pool_id,
              connection.cognitoUserPoolId,
            ),
            eq(authProviderResources.connection_key, connection.connectionKey),
          ),
        )
        .returning({ id: authProviderResources.id });

      for (const resource of resources) {
        const bindings = await tx
          .select({ tenantId: tenantAuthProviderReferences.tenant_id })
          .from(tenantAuthProviderReferences)
          .where(
            eq(
              tenantAuthProviderReferences.auth_provider_resource_id,
              resource.id,
            ),
          );
        for (const binding of bindings) {
          await emitAuthControlEvent(tx, {
            tenantId: binding.tenantId,
            actorId: "auth-provider-reconciler",
            eventType: "auth.provider_reconciliation_rejected",
            resourceType: "auth_provider_resource",
            resourceId: resource.id,
            action: "reconcile",
            outcome: "rejected",
            payload: {
              stage: payload.stage,
              revision: payload.revision,
              manifestFingerprint: payload.manifestFingerprint,
              reasonCode: rejection.code,
              connectionKey: connection.connectionKey,
              outcome: "rejected",
            },
          });
        }
      }
    }

    for (const route of payload.routeClients) {
      await tx
        .update(authRouteClients)
        .set({
          validation_status: "invalid",
          diagnostics: { code: rejection.code, revision: payload.revision },
          updated_at: new Date(),
        })
        .where(
          and(
            eq(authRouteClients.route_key, route.routeKey),
            eq(authRouteClients.client_family, route.clientFamily),
          ),
        );
    }
  });
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (event.requestContext.http.method !== "POST") {
    return error("Method not allowed", 405);
  }
  if (event.rawPath !== "/api/auth/providers/reconcile") {
    return error("Not found", 404);
  }
  const bearer = extractBearerToken(event);
  if (!bearer || !validateApiSecret(bearer)) return unauthorized();

  let raw: unknown;
  try {
    raw = JSON.parse(event.body ?? "{}");
  } catch {
    return error("Invalid JSON body", 400);
  }

  let payload: SafeAuthReconcilePayload | undefined;
  try {
    payload = validateAuthProviderMetadata(raw);
    await verifyReconciledAwsMetadata(
      payload,
      new CognitoIdentityProviderClient({ region: payload.awsRegion }),
    );
    const result = await reconcileAuthProviderMetadata(payload);
    return json(result, 200);
  } catch (cause) {
    if (cause instanceof AuthProviderValidationError) {
      return json({ error: cause.code, message: cause.message }, 400);
    }
    if (cause instanceof AuthReconciliationConflict) {
      if (payload && cause.code.startsWith("aws_")) {
        try {
          await recordRejectedAuthProviderMetadata(payload, cause);
        } catch (recordCause) {
          console.error(
            "[auth-provider-reconcile] failed to record rejection",
            {
              code: cause.code,
              recordError:
                recordCause instanceof Error ? recordCause.name : "unknown",
            },
          );
          return error("Internal server error", 500);
        }
      }
      return json({ error: cause.code, message: cause.message }, 409);
    }
    console.error("[auth-provider-reconcile] failed", cause);
    return error("Internal server error", 500);
  }
}
