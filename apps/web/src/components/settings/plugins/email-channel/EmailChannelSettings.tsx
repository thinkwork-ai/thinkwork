import { type FormEvent, useState } from "react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import { Badge, Button, Input, Label } from "@thinkwork/ui";
import { CheckCircle2, KeyRound } from "lucide-react";
import { EmailAllowlistType, EmailChannelProvider } from "@/gql/graphql";
import {
  SettingsAddEmailSpaceSenderAllowlistMutation,
  SettingsEmailChannelQuery,
  SettingsRemoveEmailSpaceSenderAllowlistMutation,
  SettingsRunEmailReadinessProbeMutation,
  SettingsSaveEmailProviderCredentialMutation,
  SettingsUpsertEmailSpacePolicyMutation,
} from "@/lib/settings-queries";
import {
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";
import { EmailLedgerPanel } from "./EmailLedgerPanel";
import { EmailReadinessPanel } from "./EmailReadinessPanel";
import { ResendApiKeyInstructions } from "./ResendApiKeyInstructions";
import { SpaceEmailPolicyPanel } from "./SpaceEmailPolicyPanel";

export function EmailChannelSettings() {
  const [form, setForm] = useState({
    apiKey: "",
  });
  const [editingCredential, setEditingCredential] = useState(false);
  const [result, refresh] = useQuery({
    query: SettingsEmailChannelQuery,
    requestPolicy: "cache-and-network",
  });
  const [credentialState, saveCredential] = useMutation(
    SettingsSaveEmailProviderCredentialMutation,
  );
  const [probeState, runProbe] = useMutation(
    SettingsRunEmailReadinessProbeMutation,
  );
  const [policyState, upsertPolicy] = useMutation(
    SettingsUpsertEmailSpacePolicyMutation,
  );
  const [allowlistState, addAllowlist] = useMutation(
    SettingsAddEmailSpaceSenderAllowlistMutation,
  );
  const [removeState, removeAllowlist] = useMutation(
    SettingsRemoveEmailSpaceSenderAllowlistMutation,
  );

  const summary = result.data?.emailChannelSummary;
  const resendProvider = summary?.providers.find(
    (provider) => provider.provider === "RESEND",
  );
  const resendDomain = summary?.domains.find(
    (domain) => domain.providerInstallId === resendProvider?.id,
  );
  const credentialConfigured = Boolean(resendProvider?.credentialConfigured);
  const showCredentialInput = !credentialConfigured || editingCredential;

  function refetch() {
    refresh({ requestPolicy: "network-only" });
  }

  async function submitCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const apiKey = form.apiKey.trim();
    if (!apiKey) {
      toast.error("Enter a Resend API key.");
      return;
    }
    const response = await saveCredential({
      input: {
        providerInstallId: resendProvider?.id,
        provider: EmailChannelProvider.Resend,
        apiKey,
        displayName: "Resend",
      },
    });
    if (response.error) {
      toast.error(
        `Could not save Resend credential: ${response.error.message}`,
      );
      return;
    }
    setForm((current) => ({ ...current, apiKey: "" }));
    setEditingCredential(false);
    toast.success("Resend credential stored.");
    refetch();
  }

  async function runChecks(providerInstallId: string) {
    const response = await runProbe({ providerInstallId });
    if (response.error) {
      toast.error(`Could not run readiness checks: ${response.error.message}`);
      return;
    }
    toast.success("Readiness checks updated.");
    refetch();
  }

  async function savePolicy(input: {
    spaceId: string;
    providerInstallId?: string;
    enabled: boolean;
  }) {
    const response = await upsertPolicy({
      input: {
        ...input,
        registeredUsersAllowed: true,
        privateSpaceMembershipRequired: true,
        outsideSenderDefault: "deny",
        firstSendReviewRequired: true,
      },
    });
    if (response.error) {
      toast.error(`Could not save Space policy: ${response.error.message}`);
      return;
    }
    toast.success("Space email policy saved.");
    refetch();
  }

  async function addPolicyAllowlist(input: {
    spaceId: string;
    valueType: EmailAllowlistType;
    value: string;
    reason?: string;
  }) {
    const response = await addAllowlist({ input });
    if (response.error) {
      toast.error(`Could not add allowlist entry: ${response.error.message}`);
      return;
    }
    toast.success("Allowlist entry added.");
    refetch();
  }

  async function removePolicyAllowlist(id: string) {
    const response = await removeAllowlist({ id });
    if (response.error) {
      toast.error(
        `Could not remove allowlist entry: ${response.error.message}`,
      );
      return;
    }
    toast.success("Allowlist entry removed.");
    refetch();
  }

  return (
    <>
      <SettingsSection label="Resend channel">
        {result.fetching && !summary ? (
          <p className="p-4 text-sm text-muted-foreground">
            Loading Resend channel...
          </p>
        ) : result.error ? (
          <p className="p-4 text-sm text-destructive">
            Resend channel settings could not be loaded.
          </p>
        ) : summary ? (
          <SettingsRow
            label="Production readiness"
            description="Production agent email remains closed until credentials, DNS, receiving, webhooks, provider events, and loop test are green."
            layout="stacked"
          >
            <EmailReadinessPanel
              summary={summary}
              probing={probeState.fetching}
              onRunProbe={(providerInstallId) =>
                void runChecks(providerInstallId)
              }
            />
          </SettingsRow>
        ) : null}
      </SettingsSection>

      <SettingsSection label="Resend provider">
        <SettingsRow
          label="Credential"
          description="The key is stored server-side and never shown again after save."
        >
          <form
            className="grid w-full min-w-[18rem] max-w-md gap-3 text-left"
            onSubmit={submitCredential}
          >
            <ResendApiKeyInstructions />
            <div className="flex items-center justify-between gap-3">
              {credentialConfigured ? (
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <CheckCircle2 className="size-4 text-emerald-400" />
                  API key configured
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Paste a Resend API key to configure production email.
                </p>
              )}
              <Badge variant={credentialConfigured ? "outline" : "secondary"}>
                {credentialConfigured ? "Stored" : "Not stored"}
              </Badge>
            </div>
            {showCredentialInput ? (
              <div className="grid gap-1.5">
                <Label htmlFor="email-channel-resend-api-key">
                  {credentialConfigured
                    ? "New Resend API key"
                    : "Resend API key"}
                </Label>
                <Input
                  id="email-channel-resend-api-key"
                  type="password"
                  autoComplete="off"
                  placeholder={
                    credentialConfigured
                      ? "Paste a replacement key"
                      : "Paste Resend API key"
                  }
                  value={form.apiKey}
                  onChange={(event) => {
                    const apiKey = event.target.value;
                    setForm((current) => ({
                      ...current,
                      apiKey,
                    }));
                  }}
                />
              </div>
            ) : null}
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              <p>
                ThinkWork will automatically use the tenant&apos;s{" "}
                <span className="font-medium text-foreground">
                  *.thinkwork.ai
                </span>{" "}
                email domain, create the Resend webhook, and store the webhook
                signing secret server-side.
              </p>
              {resendDomain || resendProvider?.defaultFromEmail ? (
                <dl className="mt-2 grid gap-1">
                  {resendDomain ? (
                    <div className="flex items-center justify-between gap-3">
                      <dt>Domain</dt>
                      <dd className="font-mono text-foreground">
                        {resendDomain.domain}
                      </dd>
                    </div>
                  ) : null}
                  {resendProvider?.defaultFromEmail ? (
                    <div className="flex items-center justify-between gap-3">
                      <dt>Default sender</dt>
                      <dd className="font-mono text-foreground">
                        {resendProvider.defaultFromEmail}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
            </div>
            {showCredentialInput ? (
              <div className="flex gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={credentialState.fetching}
                >
                  <KeyRound className="size-4" />
                  {credentialConfigured ? "Save rotated key" : "Save API key"}
                </Button>
                {credentialConfigured ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setForm((current) => ({ ...current, apiKey: "" }));
                      setEditingCredential(false);
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setEditingCredential(true)}
              >
                <KeyRound className="size-4" />
                Rotate API key
              </Button>
            )}
          </form>
        </SettingsRow>
      </SettingsSection>

      {summary ? (
        <SettingsSection label="Space policy">
          <SettingsRow
            label="Inbound allowlists"
            description="Registered tenant users are allowed by default; outside senders must be explicitly allowlisted per Space."
          >
            <SpaceEmailPolicyPanel
              summary={summary}
              saving={policyState.fetching}
              adding={allowlistState.fetching}
              removing={removeState.fetching}
              onSavePolicy={(input) => void savePolicy(input)}
              onAddAllowlist={(input) => void addPolicyAllowlist(input)}
              onRemoveAllowlist={(id) => void removePolicyAllowlist(id)}
            />
          </SettingsRow>
          <SettingsRow
            label="Audit"
            description="Ledger metadata is retained separately from raw message bodies and redaction state."
          >
            <EmailLedgerPanel summary={summary} />
          </SettingsRow>
        </SettingsSection>
      ) : null}
    </>
  );
}
