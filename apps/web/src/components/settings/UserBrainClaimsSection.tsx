/**
 * Brain access — per-user Company Brain claims (THINK-625).
 *
 * Rendered from SettingsUserDetail, whose route is already OperatorGuard-
 * wrapped. The extra `isOperator` gate here is not belt-and-braces: this
 * section is authorization data, and an embedded render from a
 * non-operator-guarded surface later must not leak it. `roleResolved` keeps
 * the section from flashing while the role is still loading.
 *
 * The sync footer is the point of the whole component. Claims live in the
 * database but only take effect once the tenant manifest reaches S3 and the
 * Brain's ≤60s cache turns over, so "Saved" alone would be a lie. Three
 * states, each actionable:
 *   - published        → saved and live within ~60s
 *   - claims_disabled  → saved, but the tenant's publish flag is off
 *   - anything else    → destructive banner with the reason and a Retry
 *     that calls republishUserClaimsManifest
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { AlertTriangleIcon } from "lucide-react";
import { Button, Input, Switch, Textarea } from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import {
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";
import {
  SettingsRepublishUserClaimsManifestMutation,
  SettingsSetUserBrainClaimsMutation,
  SettingsUserBrainClaimsQuery,
} from "@/lib/settings-queries";

/** Grant value meaning "every group" / "every collection". */
const WILDCARD = "*";

export interface ManifestSyncState {
  published: boolean;
  key?: string | null;
  reason?: string | null;
}

export function parseList(value: string): string[] {
  const out: string[] = [];
  for (const raw of value.split(",")) {
    const trimmed = raw.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

export function formatList(values: readonly string[] | null | undefined) {
  return (values ?? []).join(", ");
}

/** True when a grant list hands the user everything in its dimension. */
export function hasWildcard(values: readonly string[] | null | undefined) {
  return (values ?? []).includes(WILDCARD);
}

export function describeSyncState(sync: ManifestSyncState | null): {
  tone: "ok" | "warn" | "error";
  message: string;
} | null {
  if (!sync) return null;
  if (sync.published) {
    return { tone: "ok", message: "Synced — takes effect within ~60s." };
  }
  if (sync.reason === "claims_disabled") {
    return {
      tone: "warn",
      message:
        "Saved, but Brain user claims are turned off for this tenant — nothing was published.",
    };
  }
  return {
    tone: "error",
    message: `Not synced to the Brain: ${sync.reason ?? "unknown error"}. These claims are not in effect yet.`,
  };
}

type ClaimsForm = {
  securityGroups: string;
  kbCollections: string;
  kbBundles: string;
  defaultKbBundle: string;
  toolAllowlist: string;
  useToolAllowlist: boolean;
  isOperator: boolean;
  kbTrace: boolean;
  enabled: boolean;
};

const EMPTY_FORM: ClaimsForm = {
  securityGroups: "",
  kbCollections: "",
  kbBundles: "{}",
  defaultKbBundle: "",
  toolAllowlist: "",
  // Off means "send null" — the Brain's surface default, which is NOT the
  // same as an empty allowlist.
  useToolAllowlist: false,
  isOperator: false,
  kbTrace: false,
  enabled: true,
};

export interface UserBrainClaimsSectionProps {
  userId: string;
}

export function UserBrainClaimsSection({
  userId,
}: UserBrainClaimsSectionProps) {
  const { tenantId, isOperator, roleResolved } = useTenant();
  const gated = !roleResolved || !isOperator || !tenantId;

  const [result, refetch] = useQuery({
    query: SettingsUserBrainClaimsQuery,
    variables: { tenantId: tenantId ?? "", userId },
    pause: gated,
  });
  const [{ fetching: saving }, setClaims] = useMutation(
    SettingsSetUserBrainClaimsMutation,
  );
  const [{ fetching: retrying }, republish] = useMutation(
    SettingsRepublishUserClaimsManifestMutation,
  );

  const claims = result.data?.userBrainClaims ?? null;
  const [form, setForm] = useState<ClaimsForm>(EMPTY_FORM);
  const [sync, setSync] = useState<ManifestSyncState | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!claims) {
      setForm(EMPTY_FORM);
      return;
    }
    setForm({
      securityGroups: formatList(claims.securityGroups),
      kbCollections: formatList(claims.kbCollections),
      kbBundles: claims.kbBundles ?? "{}",
      defaultKbBundle: claims.defaultKbBundle ?? "",
      toolAllowlist: formatList(claims.toolAllowlist),
      useToolAllowlist: claims.toolAllowlist != null,
      isOperator: claims.isOperator,
      kbTrace: claims.kbTrace,
      enabled: claims.enabled,
    });
  }, [claims]);

  const wildcardFields = useMemo(() => {
    const fields: string[] = [];
    if (hasWildcard(parseList(form.securityGroups))) fields.push("groups");
    if (hasWildcard(parseList(form.kbCollections))) fields.push("collections");
    return fields;
  }, [form.securityGroups, form.kbCollections]);

  if (gated) return null;

  const set =
    <K extends keyof ClaimsForm>(key: K) =>
    (value: ClaimsForm[K]) =>
      setForm((f) => ({ ...f, [key]: value }));

  async function onSave() {
    setErrorMsg(null);
    let kbBundles: string;
    try {
      const parsed = JSON.parse(form.kbBundles || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("not an object");
      }
      kbBundles = JSON.stringify(parsed);
    } catch {
      setErrorMsg("KB bundles must be a JSON object.");
      return;
    }

    const response = await setClaims({
      tenantId: tenantId ?? "",
      userId,
      input: {
        securityGroups: parseList(form.securityGroups),
        kbCollections: parseList(form.kbCollections),
        kbBundles,
        defaultKbBundle: form.defaultKbBundle.trim() || null,
        // Null, not [], when the allowlist is off — see EMPTY_FORM.
        toolAllowlist: form.useToolAllowlist
          ? parseList(form.toolAllowlist)
          : null,
        isOperator: form.isOperator,
        kbTrace: form.kbTrace,
        enabled: form.enabled,
      },
    });

    if (response.error) {
      setErrorMsg(
        response.error.graphQLErrors[0]?.message ?? response.error.message,
      );
      return;
    }
    setSync(response.data?.setUserBrainClaims.manifest ?? null);
    refetch({ requestPolicy: "network-only" });
  }

  async function onRetrySync() {
    setErrorMsg(null);
    const response = await republish({ tenantId: tenantId ?? "" });
    if (response.error) {
      setErrorMsg(
        response.error.graphQLErrors[0]?.message ?? response.error.message,
      );
      return;
    }
    setSync(response.data?.republishUserClaimsManifest ?? null);
  }

  const syncState = describeSyncState(sync);

  return (
    <div data-testid="settings-user-brain-claims-section">
      <SettingsSection label="Brain access">
        <SettingsRow
          label="Security groups"
          description={`Graph groups this user may see, comma-separated. "${WILDCARD}" grants every group.`}
        >
          <Input
            className="w-72"
            aria-label="Security groups"
            value={form.securityGroups}
            onChange={(e) => set("securityGroups")(e.target.value)}
          />
        </SettingsRow>
        <SettingsRow
          label="KB collections"
          description={`Knowledge collections this user may retrieve. Empty grants none; "${WILDCARD}" grants every collection.`}
        >
          <Input
            className="w-72"
            aria-label="KB collections"
            value={form.kbCollections}
            onChange={(e) => set("kbCollections")(e.target.value)}
          />
        </SettingsRow>
        {wildcardFields.length > 0 ? (
          <div
            data-testid="brain-claims-wildcard-warning"
            className="flex items-start gap-2 px-4 py-3 text-sm text-amber-600 dark:text-amber-500"
          >
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
            <span>
              This user is granted <strong>every</strong>{" "}
              {wildcardFields.join(" and ")} in the Brain.
            </span>
          </div>
        ) : null}
        <SettingsRow
          label="KB bundles"
          description='Named collection sets as JSON, e.g. {"onboarding": ["handbook"]}.'
        >
          <Textarea
            className="w-72 font-mono text-xs"
            rows={3}
            aria-label="KB bundles"
            value={form.kbBundles}
            onChange={(e) => set("kbBundles")(e.target.value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Default bundle"
          description="Bundle used when the user does not name one. Must be one of the bundles above."
        >
          <Input
            className="w-72"
            aria-label="Default bundle"
            value={form.defaultKbBundle}
            onChange={(e) => set("defaultKbBundle")(e.target.value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Restrict tools"
          description="Off leaves the Brain's default tool surface. On narrows it to the list below — an empty list means no tools at all."
        >
          <div className="flex w-72 items-center gap-3">
            <Switch
              aria-label="Restrict tools"
              checked={form.useToolAllowlist}
              onCheckedChange={(checked) =>
                set("useToolAllowlist")(checked as boolean)
              }
            />
            <Input
              aria-label="Tool allowlist"
              disabled={!form.useToolAllowlist}
              placeholder={
                form.useToolAllowlist
                  ? "brain_ask, brain_search_knowledge"
                  : "Default tools"
              }
              value={form.toolAllowlist}
              onChange={(e) => set("toolAllowlist")(e.target.value)}
            />
          </div>
        </SettingsRow>
        <SettingsRow
          label="Operator"
          description="Enables operator-only Brain tools, still subject to this account's own gates."
        >
          <Switch
            aria-label="Operator"
            checked={form.isOperator}
            onCheckedChange={(checked) => set("isOperator")(checked as boolean)}
          />
        </SettingsRow>
        <SettingsRow
          label="KB trace"
          description="Echo knowledge-retrieval traces back to this user. Diagnostic, not a grant."
        >
          <Switch
            aria-label="KB trace"
            checked={form.kbTrace}
            onCheckedChange={(checked) => set("kbTrace")(checked as boolean)}
          />
        </SettingsRow>
        <SettingsRow
          label="Enabled"
          description="Off revokes this user's Brain access without deleting their claims."
        >
          <Switch
            aria-label="Enabled"
            checked={form.enabled}
            onCheckedChange={(checked) => set("enabled")(checked as boolean)}
          />
        </SettingsRow>

        <div className="flex flex-col gap-3 px-4 py-3.5">
          {errorMsg ? (
            <p className="text-sm text-destructive">{errorMsg}</p>
          ) : null}
          {syncState?.tone === "error" ? (
            <div
              data-testid="brain-claims-sync-failed"
              className="flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3 md:flex-row md:items-center md:justify-between"
            >
              <p className="text-sm text-destructive">{syncState.message}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={retrying}
                onClick={() => void onRetrySync()}
              >
                {retrying ? "Retrying…" : "Retry"}
              </Button>
            </div>
          ) : null}
          <div className="flex items-center justify-end gap-3">
            {syncState && syncState.tone !== "error" ? (
              <span
                data-testid="brain-claims-sync-state"
                className="text-sm text-muted-foreground"
              >
                {syncState.message}
              </span>
            ) : null}
            <Button onClick={() => void onSave()} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}
