/**
 * Routine Repo settings (deterministic routines v1, R2/KTD-8).
 *
 * Operators configure the single tenant GitHub repository that holds
 * deterministic routine code: URL + fine-grained token + branch. The token
 * is stored in Secrets Manager via the tenant-credentials substrate and is
 * never displayed back; repo URL and branch are mirrored into the
 * credential's metadata for display. Save and rotate validate the
 * connection server-side (repo reachable with the token, branch exists)
 * before anything is stored.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import { Button, Input } from "@thinkwork/ui";
import { Loader2, ShieldCheck } from "lucide-react";
import { useTenant } from "@/context/TenantContext";
import { TenantCredentialKind, TenantCredentialStatus } from "@/gql/graphql";
import {
  SettingsCreateTenantCredentialMutation,
  SettingsRotateTenantCredentialMutation,
  SettingsTenantCredentialsQuery,
  SettingsUpdateTenantCredentialMutation,
} from "@/lib/settings-queries";
import {
  SettingsHeader,
  SettingsPane,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";

/** Fixed slug so the executor and agent tools resolve the repo credential
 *  deterministically — one routine repo per tenant. */
export const ROUTINE_REPO_CREDENTIAL_SLUG = "routine-repo";

function stringFromMetadata(raw: unknown, key: string): string | null {
  if (!raw) return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const value = (parsed as Record<string, unknown>)[key];
    return typeof value === "string" && value ? value : null;
  } catch {
    return null;
  }
}

export function SettingsRoutineRepo() {
  const { tenantId } = useTenant();
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [token, setToken] = useState("");

  const [credentialResult, refreshCredentials] = useQuery({
    query: SettingsTenantCredentialsQuery,
    variables: {
      tenantId: tenantId ?? "",
      status: TenantCredentialStatus.Active,
    },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [createState, createCredential] = useMutation(
    SettingsCreateTenantCredentialMutation,
  );
  const [rotateState, rotateCredential] = useMutation(
    SettingsRotateTenantCredentialMutation,
  );
  const [, updateCredential] = useMutation(
    SettingsUpdateTenantCredentialMutation,
  );

  const credential = useMemo(
    () =>
      credentialResult.data?.tenantCredentials.find(
        (c) => c.slug === ROUTINE_REPO_CREDENTIAL_SLUG,
      ) ?? null,
    [credentialResult.data],
  );
  const savedRepoUrl = stringFromMetadata(credential?.metadataJson, "repoUrl");
  const savedBranch = stringFromMetadata(credential?.metadataJson, "branch");
  const saving = createState.fetching || rotateState.fetching;

  useEffect(() => {
    if (savedRepoUrl) setRepoUrl((current) => current || savedRepoUrl);
    if (savedBranch) setBranch((current) => current || savedBranch);
  }, [savedRepoUrl, savedBranch]);

  const canSave =
    Boolean(tenantId) &&
    repoUrl.trim().length > 0 &&
    branch.trim().length > 0 &&
    token.trim().length > 0 &&
    !saving;

  async function handleSave() {
    if (!tenantId) return;
    const secretJson = JSON.stringify({
      repoUrl: repoUrl.trim(),
      token: token.trim(),
      branch: branch.trim(),
    });
    const metadataJson = JSON.stringify({
      repoUrl: repoUrl.trim(),
      branch: branch.trim(),
    });

    const result = credential
      ? await rotateCredential({
          input: { id: credential.id, secretJson },
        })
      : await createCredential({
          input: {
            tenantId,
            displayName: "Routine Repo",
            slug: ROUTINE_REPO_CREDENTIAL_SLUG,
            kind: TenantCredentialKind.GithubRepo,
            metadataJson,
            secretJson,
          },
        });

    if (result.error) {
      toast.error(
        result.error.graphQLErrors[0]?.message ?? result.error.message,
      );
      return;
    }
    // Rotate replaces only the secret; keep the display metadata in step so
    // the page reflects the URL/branch that was just validated.
    if (credential) {
      await updateCredential({
        id: credential.id,
        input: { metadataJson },
      });
    }
    setToken("");
    refreshCredentials({ requestPolicy: "network-only" });
    toast.success(
      credential ? "Routine repo connection updated" : "Routine repo connected",
    );
  }

  return (
    <SettingsPane>
      <SettingsHeader
        title="Routine Repo"
        description="The GitHub repository that holds this workspace's deterministic routine code. Routines are pulled from here at execution time — the repo is the single source of truth."
      />
      <SettingsSection label="Connection">
        <SettingsRow
          label="Repository URL"
          description="https://github.com/<owner>/<repo> — GitHub only for now."
          layout="stacked"
        >
          <Input
            value={repoUrl}
            onChange={(event) => setRepoUrl(event.target.value)}
            placeholder="https://github.com/acme/routines"
            autoComplete="off"
            className="w-full"
          />
        </SettingsRow>
        <SettingsRow
          label="Branch"
          description="Executions pull this branch's latest commit."
          layout="stacked"
        >
          <Input
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            placeholder="main"
            autoComplete="off"
            className="w-full"
          />
        </SettingsRow>
        <SettingsRow
          label="Fine-grained access token"
          description={
            credential
              ? "A token is configured. Paste a new one to rotate it — the stored token is never shown."
              : "Needs Contents read/write on the repository. Stored in AWS Secrets Manager."
          }
          layout="stacked"
        >
          <Input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={credential ? "••••••••  (rotate)" : "github_pat_…"}
            autoComplete="new-password"
            className="w-full"
          />
        </SettingsRow>
        <SettingsRow
          label={
            credential ? (
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="size-4 text-emerald-500" />
                Connected
              </span>
            ) : (
              "Not connected"
            )
          }
          description={
            credential && savedRepoUrl
              ? `${savedRepoUrl} @ ${savedBranch ?? "main"} — validated at save`
              : "The connection is validated when you save: repository reachable with the token and the branch exists."
          }
        >
          <Button type="button" onClick={handleSave} disabled={!canSave}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {credential ? "Rotate & validate" : "Connect & validate"}
          </Button>
        </SettingsRow>
      </SettingsSection>
    </SettingsPane>
  );
}
