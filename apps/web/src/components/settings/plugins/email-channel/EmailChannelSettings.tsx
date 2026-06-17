import { type FormEvent, useState } from "react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import { Badge, Button, Input, Label } from "@thinkwork/ui";
import { KeyRound } from "lucide-react";
import {
  EmailAllowlistType,
  EmailChannelProvider,
  EmailDomainOwnershipType,
  EmailDomainStatus,
} from "@/gql/graphql";
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
    domain: "",
    defaultFromEmail: "",
    webhookSecretRef: "",
  });
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

  function refetch() {
    refresh({ requestPolicy: "network-only" });
  }

  async function submitCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const apiKey = form.apiKey.trim();
    const domain = form.domain.trim();
    if (!apiKey || !domain) {
      toast.error("Enter a Resend API key and dedicated email domain.");
      return;
    }
    const response = await saveCredential({
      input: {
        providerInstallId: resendProvider?.id,
        provider: EmailChannelProvider.Resend,
        apiKey,
        displayName: "Resend",
        webhookSecretRef: form.webhookSecretRef.trim() || undefined,
        defaultFromEmail: form.defaultFromEmail.trim() || undefined,
        domain: {
          domain,
          ownershipType: EmailDomainOwnershipType.ThinkworkOwned,
          status: EmailDomainStatus.Pending,
        },
      },
    });
    if (response.error) {
      toast.error(
        `Could not save Resend credential: ${response.error.message}`,
      );
      return;
    }
    setForm((current) => ({ ...current, apiKey: "" }));
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
      <SettingsSection label="Email channel">
        {result.fetching && !summary ? (
          <p className="p-4 text-sm text-muted-foreground">
            Loading email channel...
          </p>
        ) : result.error ? (
          <p className="p-4 text-sm text-destructive">
            Email channel settings could not be loaded.
          </p>
        ) : summary ? (
          <SettingsRow
            label="Production readiness"
            description="Production agent email remains closed until credentials, DNS, receiving, webhooks, provider events, and loop test are green."
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
            <div className="flex items-center justify-end gap-2">
              <Badge
                variant={
                  resendProvider?.credentialConfigured ? "outline" : "secondary"
                }
              >
                {resendProvider?.credentialConfigured ? "Stored" : "Not stored"}
              </Badge>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="email-channel-resend-api-key">
                Resend API key
              </Label>
              <Input
                id="email-channel-resend-api-key"
                type="password"
                autoComplete="off"
                value={form.apiKey}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    apiKey: event.currentTarget.value,
                  }))
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="email-channel-domain">Dedicated domain</Label>
              <Input
                id="email-channel-domain"
                value={form.domain}
                placeholder="tenant.mail.thinkwork.ai"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    domain: event.currentTarget.value,
                  }))
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="email-channel-default-from">
                Default from address
              </Label>
              <Input
                id="email-channel-default-from"
                value={form.defaultFromEmail}
                placeholder="space@tenant.mail.thinkwork.ai"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    defaultFromEmail: event.currentTarget.value,
                  }))
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="email-channel-webhook-secret-ref">
                Webhook signing secret reference
              </Label>
              <Input
                id="email-channel-webhook-secret-ref"
                value={form.webhookSecretRef}
                placeholder="Secrets Manager reference"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    webhookSecretRef: event.currentTarget.value,
                  }))
                }
              />
            </div>
            <Button type="submit" size="sm" disabled={credentialState.fetching}>
              <KeyRound className="size-4" />
              Save credential
            </Button>
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
