import { useEffect, useMemo, useState } from "react";
import { ChevronRight, FileCode, Plus, Trash2 } from "lucide-react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Input,
  MultiSelect,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  cn,
} from "@thinkwork/ui";
import { AgentRuntime } from "@/gql/graphql";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import {
  SettingsAgentProfilesQuery,
  SettingsCreateAgentProfileMutation,
  SettingsDeleteAgentProfileMutation,
  SettingsModelCatalogQuery,
  SettingsTenantAgentQuery,
  SettingsUpdateAgentProfileMutation,
  SettingsUpdateTenantAgentMutation,
} from "@/lib/settings-queries";
import {
  SettingsHeader,
  SettingsPageTitle,
  SettingsPane,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";

const RUNTIME_OPTIONS: { value: AgentRuntime; label: string }[] = [
  // FLUE is the Pi runtime; surfaced as "Pi" per product naming.
  { value: AgentRuntime.Flue, label: "Pi" },
];

type JsonRecord = Record<string, unknown>;

type ModelOption = {
  id: string;
  modelId: string;
  displayName: string;
  provider?: string | null;
  inputCostPerMillion?: number | null;
  outputCostPerMillion?: number | null;
};

type SpaceOption = {
  id: string;
  name: string;
  slug?: string | null;
};

type SkillOption = {
  slug: string;
  displayName?: string | null;
  description?: string | null;
  category?: string | null;
};

type McpServerOption = {
  id: string;
  name: string;
  slug: string;
  enabled: boolean;
  status: string;
  tools?: unknown;
};

type AgentProfileRow = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  routingGuidance?: string | null;
  instructions: string;
  modelId: string;
  model?: ModelOption | null;
  enabled: boolean;
  builtInKey?: string | null;
  toolPolicy: unknown;
  skillPolicy: unknown;
  executionControls: unknown;
  spaces: SpaceOption[];
};

type ProfileDraft = {
  name: string;
  description: string;
  routingGuidance: string;
  instructions: string;
  modelId: string;
  enabled: boolean;
  builtInTools: string[];
  mcpServers: string[];
  skillSlugs: string[];
  spaceIds: string[];
  clarify: boolean;
  maxRuntimeMs: string;
  maxTokens: string;
  thinking: string;
};

export function SettingsAgents() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [profilesResult, refetchProfiles] = useQuery({
    query: SettingsAgentProfilesQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [, createProfile] = useMutation(SettingsCreateAgentProfileMutation);

  const profiles = useMemo(
    () => sortProfiles(profilesResult.data?.agentProfiles ?? []),
    [profilesResult.data?.agentProfiles],
  );
  const catalog = profilesResult.data?.agentProfileEditorCatalog;

  async function onCreateProfile() {
    if (!tenantId) return;
    const modelId = catalog?.models[0]?.modelId ?? profiles[0]?.modelId ?? null;
    if (!modelId) {
      toast.error("Model catalog unavailable");
      return;
    }
    const result = await createProfile({
      tenantId,
      input: {
        name: "New Agent Profile",
        description: "Custom task profile.",
        routingGuidance: "Use for focused delegated work.",
        instructions:
          "Complete the assigned task and return a concise result with relevant context.",
        modelId,
        enabled: true,
        toolPolicy: { builtInTools: [], mcpServers: [] },
        skillPolicy: { skillSlugs: [] },
        executionControls: {
          foreground: true,
          clarify: false,
          maxSubagentDepth: 0,
        },
        spaceIds: [],
      },
    });
    if (result.error) {
      toast.error("Could not create Agent Profile", {
        description: result.error.message,
      });
      return;
    }
    const id = result.data?.createAgentProfile.id;
    refetchProfiles({ requestPolicy: "network-only" });
    toast.success("Agent Profile created");
    if (id) {
      navigate({
        to: "/settings/agents/$profileId",
        params: { profileId: id },
      });
    }
  }

  return (
    <SettingsPane className="max-w-none">
      <SettingsHeader
        title="Agents"
        description="Configure the default Agent and reusable task profiles delegated through Pi subagents."
        actions={
          <Button
            asChild
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            aria-label="Open AGENTS.md"
            title="Open AGENTS.md"
          >
            <Link
              to="/settings/local-workspace"
              search={{ file: "Agent/AGENTS.md" }}
            >
              <FileCode className="h-4 w-4" />
              <span className="sr-only">Open AGENTS.md</span>
            </Link>
          </Button>
        }
      />

      <AgentConfigSection />

      <SettingsSection
        label="Agent Profiles"
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCreateProfile}
          >
            <Plus className="mr-2 h-4 w-4" />
            New profile
          </Button>
        }
      >
        {profilesResult.error ? (
          <div className="p-4 text-sm text-destructive">
            {profilesResult.error.message}
          </div>
        ) : profilesResult.fetching && profiles.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            Loading Agent Profiles…
          </div>
        ) : (
          <div className="divide-y divide-border">
            {profiles.map((profile) => (
              <ProfileListItem
                key={profile.id}
                profile={profile}
                onSelect={() =>
                  navigate({
                    to: "/settings/agents/$profileId",
                    params: { profileId: profile.id },
                  })
                }
              />
            ))}
            {profiles.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">
                No Agent Profiles configured.
              </div>
            ) : null}
          </div>
        )}
      </SettingsSection>
    </SettingsPane>
  );
}

export function SettingsAgentProfileDetail() {
  const { profileId } = useParams({
    from: "/_authed/settings/agents/$profileId",
  });
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [profilesResult, refetchProfiles] = useQuery({
    query: SettingsAgentProfilesQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [, deleteProfile] = useMutation(SettingsDeleteAgentProfileMutation);

  const profiles = useMemo(
    () => sortProfiles(profilesResult.data?.agentProfiles ?? []),
    [profilesResult.data?.agentProfiles],
  );
  const profile = profiles.find((candidate) => candidate.id === profileId);
  const catalog = profilesResult.data?.agentProfileEditorCatalog;

  usePageHeaderActions({
    title: profile?.name ?? "Agent Profile",
    breadcrumbs: [
      { label: "Agents", href: "/settings/agents" },
      { label: profile?.name ?? "Agent Profile" },
    ],
    action: profile ? (
      <Button
        asChild
        type="button"
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground hover:text-foreground"
        aria-label="Open Agent Profile markdown"
        title="Open Agent Profile markdown"
      >
        <Link
          to="/settings/local-workspace"
          search={{ file: agentProfileWorkspacePath(profile) }}
        >
          <FileCode className="h-4 w-4" />
          <span className="sr-only">Open Agent Profile markdown</span>
        </Link>
      </Button>
    ) : undefined,
    actionKey: profile ? `agent-profile-editor:${profile.id}` : undefined,
  });

  async function onDeleteProfile(profile: AgentProfileRow) {
    if (!tenantId || profile.builtInKey) return;
    const result = await deleteProfile({ tenantId, id: profile.id });
    if (result.error) {
      toast.error("Could not delete Agent Profile", {
        description: result.error.message,
      });
      return;
    }
    toast.success("Agent Profile deleted");
    navigate({ to: "/settings/agents" });
  }

  if (profilesResult.fetching && !profilesResult.data) {
    return (
      <SettingsPane>
        <div className="flex items-center justify-center py-24">
          <LoadingShimmer />
        </div>
      </SettingsPane>
    );
  }

  if (profilesResult.error) {
    return (
      <SettingsPane>
        <SettingsPageTitle
          title="Agent Profile"
          description="Could not load this Agent Profile."
        />
        <div className="rounded-xl border border-border bg-card p-4 text-sm text-destructive">
          {profilesResult.error.message}
        </div>
      </SettingsPane>
    );
  }

  if (!profile || !catalog) {
    return (
      <SettingsPane>
        <SettingsPageTitle
          title="Agent Profile"
          description="This Agent Profile could not be found."
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate({ to: "/settings/agents" })}
        >
          Back to Agents
        </Button>
      </SettingsPane>
    );
  }

  return (
    <SettingsPane className="max-w-none">
      <SettingsPageTitle
        title={profile.name}
        description={`${profile.slug} · ${
          profile.model?.displayName ?? profile.modelId
        }`}
        badge={
          profile.builtInKey ? (
            <Badge variant="secondary">built-in</Badge>
          ) : (
            <Badge variant="outline">custom</Badge>
          )
        }
      />
      <AgentProfileEditor
        key={profile.id}
        tenantId={tenantId ?? ""}
        profile={profile}
        models={catalog.models as ModelOption[]}
        spaces={catalog.spaces as SpaceOption[]}
        skills={catalog.skills as SkillOption[]}
        builtInTools={catalog.builtInTools}
        mcpServers={catalog.mcpServers as McpServerOption[]}
        onSaved={() => refetchProfiles({ requestPolicy: "network-only" })}
        onDelete={() => onDeleteProfile(profile)}
      />
    </SettingsPane>
  );
}

function AgentConfigSection() {
  const { tenantId } = useTenant();
  const [agentResult] = useQuery({
    query: SettingsTenantAgentQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [catalogResult] = useQuery({ query: SettingsModelCatalogQuery });
  const [saveState, save] = useMutation(SettingsUpdateTenantAgentMutation);

  const [runtime, setRuntime] = useState<AgentRuntime | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const agent = agentResult.data?.agent;

  useEffect(() => {
    if (agent) {
      setRuntime(agent.runtime);
      setModel(agent.model ?? null);
    }
  }, [agent]);

  const catalog = catalogResult.data?.modelCatalog ?? [];
  const catalogFailed = !!catalogResult.error;

  async function persist(input: {
    runtime?: AgentRuntime;
    model?: string | null;
  }) {
    if (!tenantId) return;
    setErrorMsg(null);
    const result = await save({ tenantId, input });
    if (result.error) setErrorMsg(result.error.message);
  }

  return (
    <SettingsSection
      label="Default Agent"
      action={
        saveState.fetching ? (
          <span className="text-sm text-muted-foreground">Saving…</span>
        ) : errorMsg ? (
          <span className="text-sm text-destructive">{errorMsg}</span>
        ) : null
      }
    >
      <SettingsRow
        label="Runtime"
        description="Execution runtime that powers this tenant's parent Agent."
      >
        <Select
          value={runtime ?? undefined}
          onValueChange={(v) => {
            const next = v as AgentRuntime;
            setRuntime(next);
            void persist({ runtime: next });
          }}
        >
          <SelectTrigger className="w-60">
            <SelectValue placeholder="Select runtime" />
          </SelectTrigger>
          <SelectContent>
            {RUNTIME_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>

      <SettingsRow
        label="Default model"
        description="Fallback model used when a thread doesn't specify its own."
      >
        {catalogFailed ? (
          <div className="text-sm text-muted-foreground">
            {model ?? "—"}{" "}
            <span className="text-destructive">
              (model catalog unavailable)
            </span>
          </div>
        ) : (
          <Select
            value={model ?? undefined}
            onValueChange={(v) => {
              setModel(v);
              void persist({ model: v });
            }}
            disabled={catalogResult.fetching}
          >
            <SelectTrigger className="w-60">
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {catalog.map((m) => (
                <SelectItem key={m.id} value={m.modelId}>
                  {m.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </SettingsRow>
    </SettingsSection>
  );
}

function agentProfileWorkspacePath(profile: AgentProfileRow): string {
  return `Agent/agents/${profile.slug}.md`;
}

function ProfileListItem({
  profile,
  onSelect,
}: {
  profile: AgentProfileRow;
  onSelect: () => void;
}) {
  const toolPolicy = parseJson<ToolPolicy>(profile.toolPolicy, {});
  const skillPolicy = parseJson<SkillPolicy>(profile.skillPolicy, {});
  const builtIns = toolPolicy.builtInTools?.length ?? 0;
  const mcps = toolPolicy.mcpServers?.length ?? 0;
  const skills = skillPolicy.skillSlugs?.length ?? 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group flex w-full items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-muted/40",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-[#54a9ff]">
            {profile.name}
          </span>
          <Badge variant="outline">
            {profile.model?.displayName ?? profile.modelId}
          </Badge>
          <Badge variant="outline">{builtIns} Tools</Badge>
          <Badge variant="outline">{mcps} MCP</Badge>
          <Badge variant="outline">{skills} Skills</Badge>
          <Badge variant="outline">
            {profile.spaces.length === 0
              ? "All Spaces"
              : `${profile.spaces.length} Spaces`}
          </Badge>
        </div>
        <p className="mt-1 truncate text-sm text-muted-foreground">
          {profile.description ?? profile.routingGuidance ?? "Custom profile"}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
    </button>
  );
}

function AgentProfileEditor({
  tenantId,
  profile,
  models,
  spaces,
  skills,
  builtInTools,
  mcpServers,
  onSaved,
  onDelete,
}: {
  tenantId: string;
  profile: AgentProfileRow;
  models: ModelOption[];
  spaces: SpaceOption[];
  skills: SkillOption[];
  builtInTools: string[];
  mcpServers: McpServerOption[];
  onSaved: () => void;
  onDelete: () => void;
}) {
  const [saveState, save] = useMutation(SettingsUpdateAgentProfileMutation);
  const [draft, setDraft] = useState(() => profileToDraft(profile));

  const saving = saveState.fetching;
  const custom = !profile.builtInKey;

  async function onSave() {
    if (!tenantId) return;
    const result = await save({
      tenantId,
      id: profile.id,
      input: draftToInput(draft),
    });
    if (result.error) {
      toast.error("Could not save Agent Profile", {
        description: result.error.message,
      });
      return;
    }
    onSaved();
    toast.success("Agent Profile saved");
  }

  return (
    <>
      <SettingsSection label="Profile">
        <SettingsRow
          label="Name"
          description="Display name shown to the parent Agent."
        >
          <Input
            className="w-full max-w-80"
            value={draft.name}
            onChange={(e) => setDraftField(setDraft, "name", e.target.value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Model"
          description="Model used when Pi delegates work to this Agent Profile."
        >
          <Select
            value={draft.modelId}
            onValueChange={(value) => setDraftField(setDraft, "modelId", value)}
          >
            <SelectTrigger className="w-full max-w-80">
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {models.map((option) => (
                <SelectItem key={option.id} value={option.modelId}>
                  {option.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow
          label="Enabled"
          description="Allow the parent Agent to delegate work to this profile."
        >
          <Switch
            checked={draft.enabled}
            onCheckedChange={(value) =>
              setDraftField(setDraft, "enabled", value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Clarify before work"
          description="Ask for clarification before starting delegated work."
        >
          <Switch
            checked={draft.clarify}
            onCheckedChange={(value) =>
              setDraftField(setDraft, "clarify", value)
            }
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection label="Instructions">
        <SettingsRow
          label="Description"
          description="Short summary shown in profile lists."
        >
          <Textarea
            className="w-full max-w-[32rem]"
            value={draft.description}
            onChange={(e) =>
              setDraftField(setDraft, "description", e.target.value)
            }
            rows={3}
          />
        </SettingsRow>
        <SettingsRow
          label="Routing guidance"
          description="When the parent Agent should choose this profile."
        >
          <Textarea
            className="w-full max-w-[32rem]"
            value={draft.routingGuidance}
            onChange={(e) =>
              setDraftField(setDraft, "routingGuidance", e.target.value)
            }
            rows={3}
          />
        </SettingsRow>
        <SettingsRow
          label="Instructions"
          description="Prompt instructions for delegated profile runs."
        >
          <Textarea
            className="w-full max-w-[32rem]"
            value={draft.instructions}
            onChange={(e) =>
              setDraftField(setDraft, "instructions", e.target.value)
            }
            rows={6}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection label="Capabilities">
        <SettingsRow
          label="Spaces"
          description="Spaces where this Agent Profile is available. Empty means every Space."
        >
          <ChipMultiSelect
            options={spaces.map((space) => ({
              value: space.id,
              label: space.name,
            }))}
            values={draft.spaceIds}
            placeholder="All Spaces"
            onChange={(values) => setDraftField(setDraft, "spaceIds", values)}
          />
        </SettingsRow>
        <SettingsRow
          label="Tools"
          description="Built-in tools available to this profile."
        >
          <ChipMultiSelect
            options={builtInTools.map((tool) => ({ value: tool, label: tool }))}
            values={draft.builtInTools}
            placeholder="Select tools"
            onChange={(values) =>
              setDraftField(setDraft, "builtInTools", values)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="MCP Servers"
          description="MCP servers available to this profile."
        >
          <ChipMultiSelect
            options={mcpServers.map((server) => ({
              value: server.slug,
              label: server.name,
            }))}
            values={draft.mcpServers}
            placeholder="Select MCP servers"
            onChange={(values) => setDraftField(setDraft, "mcpServers", values)}
          />
        </SettingsRow>
        <SettingsRow
          label="Skills"
          description="Installed skills bundled with this profile."
        >
          <ChipMultiSelect
            options={skills.map((skill) => ({
              value: skill.slug,
              label: skill.displayName?.trim() || skill.slug,
            }))}
            values={draft.skillSlugs}
            placeholder="Select skills"
            onChange={(values) => setDraftField(setDraft, "skillSlugs", values)}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection label="Execution">
        <SettingsRow
          label="Max runtime"
          description="Optional foreground runtime limit in milliseconds."
        >
          <Input
            className="w-full max-w-80"
            type="number"
            min={0}
            placeholder="No limit"
            value={draft.maxRuntimeMs}
            onChange={(e) =>
              setDraftField(setDraft, "maxRuntimeMs", e.target.value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Max tokens"
          description="Optional token budget for delegated profile work."
        >
          <Input
            className="w-full max-w-80"
            type="number"
            min={0}
            placeholder="No limit"
            value={draft.maxTokens}
            onChange={(e) =>
              setDraftField(setDraft, "maxTokens", e.target.value)
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Thinking"
          description="Reasoning budget preference for this profile."
        >
          <Select
            value={draft.thinking || "default"}
            onValueChange={(value) =>
              setDraftField(
                setDraft,
                "thinking",
                value === "default" ? "" : value,
              )
            }
          >
            <SelectTrigger className="w-full max-w-80">
              <SelectValue placeholder="Thinking" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default thinking</SelectItem>
              <SelectItem value="minimal">Minimal</SelectItem>
              <SelectItem value="standard">Standard</SelectItem>
              <SelectItem value="extended">Extended</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsSection>

      <div className="mb-8 flex justify-end">
        <div className="flex items-center gap-2">
          {custom ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onDelete}
              title="Delete Agent Profile"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
          <Button type="button" onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </>
  );
}

function sortProfiles(profiles: readonly unknown[]): AgentProfileRow[] {
  return [...profiles].sort((a, b) => {
    const profileA = a as AgentProfileRow;
    const profileB = b as AgentProfileRow;
    const builtInA = profileA.builtInKey ? 0 : 1;
    const builtInB = profileB.builtInKey ? 0 : 1;
    if (builtInA !== builtInB) return builtInA - builtInB;
    return profileA.name.localeCompare(profileB.name);
  }) as AgentProfileRow[];
}

function ChipMultiSelect({
  options,
  values,
  onChange,
  placeholder,
}: {
  options: Array<{ value: string; label: string }>;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}) {
  const visibleCount = Math.max(options.length, values.length, 1);
  return (
    <div className="w-full max-w-[32rem] min-w-0">
      <MultiSelect
        options={options}
        defaultValue={values}
        onValueChange={onChange}
        placeholder={placeholder}
        maxCount={visibleCount}
        minWidth="0px"
        maxWidth="32rem"
        searchable
        hideSelectAll
        deduplicateOptions
        className="w-full justify-between border-input bg-transparent shadow-none hover:bg-transparent dark:bg-input/30 dark:hover:bg-input/50"
        popoverClassName="w-[var(--radix-popover-trigger-width)] max-w-[32rem]"
      />
    </div>
  );
}

type ToolPolicy = {
  builtInTools?: string[];
  mcpServers?: string[];
};

type SkillPolicy = {
  skillSlugs?: string[];
};

type ExecutionControls = {
  clarify?: boolean;
  maxRuntimeMs?: number | null;
  maxRunTimeMs?: number | null;
  maxExecutionTimeMs?: number | null;
  maxTokens?: number | null;
  thinking?: string | null;
};

function profileToDraft(profile: AgentProfileRow): ProfileDraft {
  const toolPolicy = parseJson<ToolPolicy>(profile.toolPolicy, {});
  const skillPolicy = parseJson<SkillPolicy>(profile.skillPolicy, {});
  const executionControls = parseJson<ExecutionControls>(
    profile.executionControls,
    {},
  );
  const maxRuntimeMs =
    executionControls.maxRuntimeMs ??
    executionControls.maxRunTimeMs ??
    executionControls.maxExecutionTimeMs ??
    "";
  return {
    name: profile.name,
    description: profile.description ?? "",
    routingGuidance: profile.routingGuidance ?? "",
    instructions: profile.instructions,
    modelId: profile.modelId,
    enabled: profile.enabled,
    builtInTools: normalizeStringArray(toolPolicy.builtInTools),
    mcpServers: normalizeStringArray(toolPolicy.mcpServers),
    skillSlugs: normalizeStringArray(skillPolicy.skillSlugs),
    spaceIds: profile.spaces.map((space) => space.id),
    clarify: executionControls.clarify === true,
    maxRuntimeMs: maxRuntimeMs === "" ? "" : String(maxRuntimeMs),
    maxTokens:
      executionControls.maxTokens == null
        ? ""
        : String(executionControls.maxTokens),
    thinking: executionControls.thinking ?? "",
  };
}

function draftToInput(draft: ProfileDraft): JsonRecord {
  return {
    name: draft.name.trim(),
    description: optionalString(draft.description),
    routingGuidance: optionalString(draft.routingGuidance),
    instructions: draft.instructions.trim(),
    modelId: draft.modelId,
    enabled: draft.enabled,
    toolPolicy: {
      builtInTools: draft.builtInTools,
      mcpServers: draft.mcpServers,
    },
    skillPolicy: { skillSlugs: draft.skillSlugs },
    executionControls: {
      foreground: true,
      clarify: draft.clarify,
      maxSubagentDepth: 0,
      maxRuntimeMs: optionalNumber(draft.maxRuntimeMs),
      maxTokens: optionalNumber(draft.maxTokens),
      thinking: optionalString(draft.thinking),
    },
    spaceIds: draft.spaceIds,
  };
}

function setDraftField<K extends keyof ProfileDraft>(
  setDraft: React.Dispatch<React.SetStateAction<ProfileDraft>>,
  key: K,
  value: ProfileDraft[K],
) {
  setDraft((current) => ({ ...current, [key]: value }));
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  if (typeof value === "object") return value as T;
  return fallback;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function optionalString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function optionalNumber(value: string): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
