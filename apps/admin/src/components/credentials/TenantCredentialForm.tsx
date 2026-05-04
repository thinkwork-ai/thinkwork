import { FormEvent, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { TenantCredentialKind } from "@/gql/graphql";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type TenantCredentialSubmitValues = {
  displayName?: string;
  slug?: string;
  kind: TenantCredentialKind;
  metadataJson?: Record<string, unknown>;
  secretJson: Record<string, unknown>;
};

type SecretField = {
  key: string;
  label: string;
  type?: string;
  placeholder?: string;
};

type TenantCredentialFormProps = {
  mode: "create" | "rotate";
  initialKind?: TenantCredentialKind;
  initialDisplayName?: string;
  initialSlug?: string;
  initialMetadataJson?: unknown;
  submitLabel?: string;
  apiError?: string | null;
  submitting?: boolean;
  onSubmit: (values: TenantCredentialSubmitValues) => Promise<void> | void;
};

const KIND_OPTIONS: Array<{ value: TenantCredentialKind; label: string }> = [
  { value: TenantCredentialKind.ApiKey, label: "API key" },
  { value: TenantCredentialKind.BearerToken, label: "Bearer token" },
  { value: TenantCredentialKind.BasicAuth, label: "Basic auth" },
  { value: TenantCredentialKind.SoapPartner, label: "SOAP partner" },
  {
    value: TenantCredentialKind.WebhookSigningSecret,
    label: "Webhook signing secret",
  },
  { value: TenantCredentialKind.Json, label: "JSON secret" },
];

const SECRET_FIELDS: Record<TenantCredentialKind, SecretField[]> = {
  [TenantCredentialKind.ApiKey]: [
    { key: "apiKey", label: "API key", type: "password" },
  ],
  [TenantCredentialKind.BearerToken]: [
    { key: "token", label: "Bearer token", type: "password" },
  ],
  [TenantCredentialKind.BasicAuth]: [
    { key: "username", label: "Username" },
    { key: "password", label: "Password", type: "password" },
  ],
  [TenantCredentialKind.SoapPartner]: [
    { key: "apiUrl", label: "API URL", placeholder: "https://..." },
    { key: "username", label: "Username" },
    { key: "password", label: "Password", type: "password" },
    { key: "partnerId", label: "Partner ID" },
  ],
  [TenantCredentialKind.WebhookSigningSecret]: [
    { key: "secret", label: "Signing secret", type: "password" },
  ],
  [TenantCredentialKind.Json]: [],
};

export function credentialKindLabel(kind: TenantCredentialKind): string {
  return KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind;
}

export function emptySecretFields(
  kind: TenantCredentialKind,
): Record<string, string> {
  if (kind === TenantCredentialKind.Json) return { json: "{}" };
  return Object.fromEntries(SECRET_FIELDS[kind].map((field) => [field.key, ""]));
}

export function parseOptionalJsonObject(
  value: string,
  fieldName: string,
): Record<string, unknown> | undefined {
  if (!value.trim()) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

export function secretPayloadForKind(
  kind: TenantCredentialKind,
  values: Record<string, string>,
): Record<string, unknown> {
  if (kind === TenantCredentialKind.Json) {
    return parseOptionalJsonObject(values.json ?? "{}", "Secret JSON") ?? {};
  }

  const payload = Object.fromEntries(
    SECRET_FIELDS[kind].map((field) => [field.key, values[field.key]?.trim() ?? ""]),
  );
  const missing = SECRET_FIELDS[kind]
    .filter((field) => !String(payload[field.key] ?? "").trim())
    .map((field) => field.label);

  if (missing.length > 0) {
    throw new Error(`Missing required secret field(s): ${missing.join(", ")}.`);
  }

  return payload;
}

export function prettyJson(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") {
    if (!value.trim()) return "";
    return JSON.stringify(JSON.parse(value), null, 2);
  }
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return "";
}

export function TenantCredentialForm({
  mode,
  initialKind = TenantCredentialKind.ApiKey,
  initialDisplayName = "",
  initialSlug = "",
  initialMetadataJson,
  submitLabel,
  apiError,
  submitting = false,
  onSubmit,
}: TenantCredentialFormProps) {
  const [kind, setKind] = useState(initialKind);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [slug, setSlug] = useState(initialSlug);
  const [metadataJson, setMetadataJson] = useState(() =>
    safeInitialMetadata(initialMetadataJson),
  );
  const [secretFields, setSecretFields] = useState(() =>
    emptySecretFields(initialKind),
  );
  const [localError, setLocalError] = useState<string | null>(null);

  const fields = useMemo(() => SECRET_FIELDS[kind], [kind]);
  const isCreate = mode === "create";
  const resolvedSubmitLabel =
    submitLabel ?? (isCreate ? "Create credential" : "Rotate credential");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    try {
      if (isCreate && !displayName.trim()) {
        throw new Error("Display name is required.");
      }
      const metadata = parseOptionalJsonObject(metadataJson, "Metadata JSON");
      const secretJson = secretPayloadForKind(kind, secretFields);
      await onSubmit({
        displayName: displayName.trim(),
        slug: slug.trim() || undefined,
        kind,
        metadataJson: metadata,
        secretJson,
      });
      setSecretFields(emptySecretFields(kind));
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      {isCreate && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="credential-display-name">Display name</Label>
            <Input
              id="credential-display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="PDI SOAP"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="credential-slug">Slug</Label>
            <Input
              id="credential-slug"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              placeholder="pdi-soap"
              autoComplete="off"
            />
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Kind</Label>
          {isCreate ? (
            <Select
              value={kind}
              onValueChange={(next) => {
                const nextKind = next as TenantCredentialKind;
                setKind(nextKind);
                setSecretFields(emptySecretFields(nextKind));
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="h-8 rounded-md border px-2.5 py-1.5 text-sm">
              {credentialKindLabel(kind)}
            </div>
          )}
        </div>

        {isCreate && (
          <div className="space-y-1.5">
            <Label htmlFor="credential-metadata">Metadata JSON</Label>
            <Textarea
              id="credential-metadata"
              value={metadataJson}
              onChange={(event) => setMetadataJson(event.target.value)}
              placeholder='{"environment":"prod"}'
              rows={3}
              className="font-mono text-xs"
            />
          </div>
        )}
      </div>

      {kind === TenantCredentialKind.Json ? (
        <div className="space-y-1.5">
          <Label htmlFor="credential-secret-json">Secret JSON</Label>
          <Textarea
            id="credential-secret-json"
            value={secretFields.json ?? "{}"}
            onChange={(event) =>
              setSecretFields({ json: event.target.value })
            }
            rows={8}
            className="font-mono text-xs"
            placeholder='{"apiKey":"..."}'
          />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {fields.map((field) => (
            <div className="space-y-1.5" key={field.key}>
              <Label htmlFor={`credential-secret-${field.key}`}>
                {field.label}
              </Label>
              <Input
                id={`credential-secret-${field.key}`}
                type={field.type ?? "text"}
                value={secretFields[field.key] ?? ""}
                onChange={(event) =>
                  setSecretFields((current) => ({
                    ...current,
                    [field.key]: event.target.value,
                  }))
                }
                placeholder={field.placeholder}
                autoComplete="off"
              />
            </div>
          ))}
        </div>
      )}

      {(localError || apiError) && (
        <p className="text-sm text-destructive">{localError ?? apiError}</p>
      )}

      <Button type="submit" disabled={submitting}>
        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {resolvedSubmitLabel}
      </Button>
    </form>
  );
}

function safeInitialMetadata(value: unknown): string {
  try {
    return prettyJson(value);
  } catch {
    return "";
  }
}
