import { type FormEvent, useState } from "react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@thinkwork/ui";
import { CheckCircle2, KeyRound } from "lucide-react";
import {
  EmailAllowlistType,
  EmailChannelProvider,
  EmailDomainOwnershipType,
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
    resendApiKey: "",
    sendGridApiKey: "",
    sendGridDomain: "",
  });
  const [editingCredential, setEditingCredential] = useState<
    Partial<Record<"resend" | "sendgrid", boolean>>
  >({});
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
  const sendGridProvider = summary?.providers.find(
    (provider) => provider.provider === "SENDGRID",
  );
  const resendDomain = summary?.domains.find(
    (domain) => domain.providerInstallId === resendProvider?.id,
  );
  const sendGridDomain = summary?.domains.find(
    (domain) => domain.providerInstallId === sendGridProvider?.id,
  );
  const sendGridChoices = sendGridDomainChoices(sendGridProvider?.metadata);
  const resendCredentialConfigured = Boolean(
    resendProvider?.credentialConfigured,
  );
  const sendGridCredentialConfigured = Boolean(
    sendGridProvider?.credentialConfigured,
  );
  const showResendCredentialInput =
    !resendCredentialConfigured || editingCredential.resend;
  const showSendGridCredentialInput =
    !sendGridCredentialConfigured || editingCredential.sendgrid;

  function refetch() {
    refresh({ requestPolicy: "network-only" });
  }

  async function submitCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const apiKey = form.resendApiKey.trim();
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
    setForm((current) => ({ ...current, resendApiKey: "" }));
    setEditingCredential((current) => ({ ...current, resend: false }));
    toast.success("Resend API key stored and checks updated.");
    refetch();
  }

  async function submitSendGridCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const apiKey = form.sendGridApiKey.trim();
    if (!apiKey) {
      toast.error("Enter a SendGrid API key.");
      return;
    }
    const response = await saveCredential({
      input: {
        providerInstallId: sendGridProvider?.id,
        provider: EmailChannelProvider.Sendgrid,
        apiKey,
        displayName: "SendGrid",
        ...(form.sendGridDomain
          ? {
              domain: {
                domain: form.sendGridDomain,
                ownershipType: EmailDomainOwnershipType.CustomerOwned,
              },
            }
          : {}),
      },
    });
    if (response.error) {
      toast.error(
        `Could not save SendGrid credential: ${response.error.message}`,
      );
      return;
    }
    setForm((current) => ({
      ...current,
      sendGridApiKey: "",
      sendGridDomain: "",
    }));
    setEditingCredential((current) => ({ ...current, sendgrid: false }));
    toast.success("SendGrid API key stored and checks updated.");
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
      <SettingsSection label="Provider plugins">
        <SettingsRow
          label="Resend"
          description="The key is stored server-side and never shown again after save."
        >
          <form
            className="grid w-full min-w-[18rem] max-w-md gap-3 text-left"
            onSubmit={submitCredential}
          >
            <ResendApiKeyInstructions />
            <div className="flex items-center justify-between gap-3">
              {resendCredentialConfigured ? (
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <CheckCircle2 className="size-4 text-emerald-400" />
                  API key configured
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Paste a Resend API key to configure production email.
                </p>
              )}
              <Badge
                variant={resendCredentialConfigured ? "outline" : "secondary"}
              >
                {resendCredentialConfigured ? "Stored" : "Not stored"}
              </Badge>
            </div>
            {showResendCredentialInput ? (
              <div className="grid gap-1.5">
                <Label htmlFor="email-channel-resend-api-key">
                  {resendCredentialConfigured
                    ? "New Resend API key"
                    : "Resend API key"}
                </Label>
                <Input
                  id="email-channel-resend-api-key"
                  type="password"
                  autoComplete="off"
                  placeholder={
                    resendCredentialConfigured
                      ? "Paste a replacement key"
                      : "Paste Resend API key"
                  }
                  value={form.resendApiKey}
                  onChange={(event) => {
                    const resendApiKey = event.target.value;
                    setForm((current) => ({
                      ...current,
                      resendApiKey,
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
            {showResendCredentialInput ? (
              <div className="flex gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={credentialState.fetching}
                >
                  <KeyRound className="size-4" />
                  {resendCredentialConfigured
                    ? "Save rotated key"
                    : "Save API key"}
                </Button>
                {resendCredentialConfigured ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setForm((current) => ({
                        ...current,
                        resendApiKey: "",
                      }));
                      setEditingCredential((current) => ({
                        ...current,
                        resend: false,
                      }));
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
                onClick={() =>
                  setEditingCredential((current) => ({
                    ...current,
                    resend: true,
                  }))
                }
              >
                <KeyRound className="size-4" />
                Rotate API key
              </Button>
            )}
          </form>
        </SettingsRow>

        <SettingsRow
          label="SendGrid"
          description="Save a SendGrid API key and choose an authenticated sending domain."
        >
          <form
            className="grid w-full min-w-[18rem] max-w-md gap-3 text-left"
            onSubmit={submitSendGridCredential}
          >
            <div className="flex items-center justify-between gap-3">
              {sendGridCredentialConfigured ? (
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <CheckCircle2 className="size-4 text-emerald-400" />
                  API key configured
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Paste a SendGrid API key to configure invitation email.
                </p>
              )}
              <Badge
                variant={
                  sendGridProvider?.status === "READY" ? "outline" : "secondary"
                }
              >
                {sendGridProvider?.status ?? "Not stored"}
              </Badge>
            </div>
            {showSendGridCredentialInput ? (
              <>
                {sendGridChoices.length > 1 ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor="email-channel-sendgrid-domain">
                      Authenticated domain
                    </Label>
                    <Select
                      value={form.sendGridDomain}
                      onValueChange={(sendGridDomain) =>
                        setForm((current) => ({
                          ...current,
                          sendGridDomain,
                        }))
                      }
                    >
                      <SelectTrigger id="email-channel-sendgrid-domain">
                        <SelectValue placeholder="Choose a SendGrid domain" />
                      </SelectTrigger>
                      <SelectContent>
                        {sendGridChoices.map((choice) => (
                          <SelectItem key={choice.id} value={choice.domain}>
                            {choice.domain}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <div className="grid gap-1.5">
                  <Label htmlFor="email-channel-sendgrid-api-key">
                    {sendGridCredentialConfigured
                      ? "New SendGrid API key"
                      : "SendGrid API key"}
                  </Label>
                  <Input
                    id="email-channel-sendgrid-api-key"
                    type="password"
                    autoComplete="off"
                    placeholder={
                      sendGridCredentialConfigured
                        ? "Paste a replacement key"
                        : "Paste SendGrid API key"
                    }
                    value={form.sendGridApiKey}
                    onChange={(event) => {
                      const sendGridApiKey = event.target.value;
                      setForm((current) => ({
                        ...current,
                        sendGridApiKey,
                      }));
                    }}
                  />
                </div>
              </>
            ) : null}
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              <p>
                ThinkWork checks SendGrid for authenticated domains and stores
                the selected sender server-side.
              </p>
              {sendGridDomain || sendGridProvider?.defaultFromEmail ? (
                <dl className="mt-2 grid gap-1">
                  {sendGridDomain ? (
                    <div className="flex items-center justify-between gap-3">
                      <dt>Domain</dt>
                      <dd className="font-mono text-foreground">
                        {sendGridDomain.domain}
                      </dd>
                    </div>
                  ) : null}
                  {sendGridProvider?.defaultFromEmail ? (
                    <div className="flex items-center justify-between gap-3">
                      <dt>Default sender</dt>
                      <dd className="font-mono text-foreground">
                        {sendGridProvider.defaultFromEmail}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
            </div>
            {showSendGridCredentialInput ? (
              <div className="flex gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={credentialState.fetching}
                >
                  <KeyRound className="size-4" />
                  {sendGridCredentialConfigured
                    ? "Save rotated SendGrid key"
                    : "Save SendGrid key"}
                </Button>
                {sendGridCredentialConfigured ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setForm((current) => ({
                        ...current,
                        sendGridApiKey: "",
                        sendGridDomain: "",
                      }));
                      setEditingCredential((current) => ({
                        ...current,
                        sendgrid: false,
                      }));
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
                onClick={() =>
                  setEditingCredential((current) => ({
                    ...current,
                    sendgrid: true,
                  }))
                }
              >
                <KeyRound className="size-4" />
                Rotate SendGrid key
              </Button>
            )}
          </form>
        </SettingsRow>
      </SettingsSection>

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
            description="Production sending opens after the Resend key, ThinkWork domain, receiving, and webhook checks pass. Provider events and loop evidence update after live traffic."
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

function sendGridDomainChoices(metadata: string | null | undefined) {
  try {
    const parsed = metadata ? JSON.parse(metadata) : {};
    const choices = parsed?.sendgridDomains?.choices;
    return Array.isArray(choices)
      ? choices
          .map((choice) => ({
            id: String(choice.id ?? choice.domain ?? ""),
            domain: String(choice.domain ?? ""),
          }))
          .filter((choice) => choice.id && choice.domain)
      : [];
  } catch {
    return [];
  }
}
