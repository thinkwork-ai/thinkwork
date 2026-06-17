import { createHash } from "node:crypto";
import { createSecretsManagerPluginSecrets } from "../plugins/secrets.js";

export function emailProviderSecretName(input: {
  stage?: string | null;
  tenantId: string;
  provider: string;
}): string {
  const stage = input.stage || process.env.STAGE || "dev";
  return `thinkwork/${stage}/email-channel/${input.tenantId}/${input.provider}/api-key`;
}

export function maskSecretFingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export async function storeEmailProviderApiKey(input: {
  tenantId: string;
  provider: string;
  apiKey: string;
}): Promise<{ secretRef: string; fingerprint: string }> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) {
    throw new Error("API key is required");
  }
  const secretRef = emailProviderSecretName({
    tenantId: input.tenantId,
    provider: input.provider,
  });
  await createSecretsManagerPluginSecrets().putSecret(
    secretRef,
    JSON.stringify({
      apiKey,
      provider: input.provider,
      updatedAt: new Date().toISOString(),
    }),
  );
  return { secretRef, fingerprint: maskSecretFingerprint(apiKey) };
}
