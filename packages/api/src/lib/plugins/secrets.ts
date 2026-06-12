/**
 * Plugin token secret storage (plan 2026-06-12-001 U6).
 *
 * Thin Secrets Manager port shared by the activation flow (mint/refresh),
 * dispatch-time token resolution, and the engine's uninstall teardown.
 * Secrets live at:
 *
 *   thinkwork/{stage}/plugin-tokens/{userId}/{pluginInstallId}/{resourceKey}
 *
 * The path is named explicitly in the grouped lambda-api IAM policy
 * (terraform/modules/app/lambda-api/iam-grouped.tf) alongside the
 * `thinkwork/*` wildcard so it survives any future narrowing.
 *
 * Deletion uses ForceDeleteWithoutRecovery (matches the managed-MCP
 * destroy path): a deactivated user must not leave a recoverable token
 * behind. ResourceNotFound is swallowed so deletes are idempotent.
 */

import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
  UpdateSecretCommand,
} from "@aws-sdk/client-secrets-manager";

export interface PluginSecretsClient {
  /** Returns the secret string, or null when the secret does not exist. */
  getSecret(name: string): Promise<string | null>;
  /** Create-or-update (the skills.ts callback idiom: Update → Create on 404). */
  putSecret(name: string, value: string): Promise<void>;
  /** Hard delete (no recovery window); idempotent on missing secrets. */
  deleteSecret(name: string): Promise<void>;
}

type SmLike = Pick<SecretsManagerClient, "send">;

export function createSecretsManagerPluginSecrets(
  client?: SmLike,
): PluginSecretsClient {
  const sm =
    client ??
    new SecretsManagerClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
  return {
    async getSecret(name) {
      try {
        const res = await sm.send(
          new GetSecretValueCommand({ SecretId: name }),
        );
        return res.SecretString ?? null;
      } catch (error) {
        if (error instanceof ResourceNotFoundException) return null;
        throw error;
      }
    },

    async putSecret(name, value) {
      try {
        await sm.send(
          new UpdateSecretCommand({ SecretId: name, SecretString: value }),
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundException) {
          await sm.send(
            new CreateSecretCommand({ Name: name, SecretString: value }),
          );
          return;
        }
        throw error;
      }
    },

    async deleteSecret(name) {
      try {
        await sm.send(
          new DeleteSecretCommand({
            SecretId: name,
            ForceDeleteWithoutRecovery: true,
          }),
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundException) return;
        throw error;
      }
    },
  };
}

/**
 * Real Secrets Manager implementation of the engine's `deleteSecrets`
 * port (replaces U5's log-only placeholder now that U6 mints plugin
 * token secrets). Sequential, idempotent, throws on the first
 * non-NotFound failure so uninstall holds and can re-drive.
 */
export function createSecretsManagerDeleteSecrets(
  secrets: PluginSecretsClient = createSecretsManagerPluginSecrets(),
): (secretRefs: string[]) => Promise<void> {
  return async (secretRefs) => {
    for (const ref of secretRefs) {
      await secrets.deleteSecret(ref);
    }
  };
}
