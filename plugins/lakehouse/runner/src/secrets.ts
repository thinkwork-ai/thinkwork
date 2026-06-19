import { readFile } from "node:fs/promises";
import { redactSensitiveText } from "./redaction";

export type SecretReference =
  | { kind: "env"; name: string }
  | { kind: "file"; path: string };

export interface ResolvedSecret {
  ref: string;
  value: string;
}

export async function resolveSecretReference(
  reference: SecretReference,
  env: Record<string, string | undefined> = process.env,
): Promise<ResolvedSecret> {
  if (reference.kind === "env") {
    const value = env[reference.name];
    if (!value) {
      throw new Error(`Missing local secret reference: env:${reference.name}`);
    }
    return { ref: `env:${reference.name}`, value };
  }

  const value = await readFile(reference.path, "utf8");
  if (!value.trim()) {
    throw new Error(`Missing local secret reference: file:${reference.path}`);
  }
  return { ref: `file:${reference.path}`, value: value.trim() };
}

export function describeResolvedSecret(secret: ResolvedSecret): string {
  return `${secret.ref}=${redactSensitiveText(secret.value)}`;
}
