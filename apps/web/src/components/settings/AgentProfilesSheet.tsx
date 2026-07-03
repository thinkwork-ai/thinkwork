// Profiles sheet (Agent page merge, THINK-132 U2): Agent Profile list → detail
// editing relocated from the Agents page into a side sheet on the Composer
// surface. Detail is Basic (Profile fields + Spaces + Instructions) plus an
// Advanced disclosure (Loop/Review + Execution + Built-in tools). The
// Skills/MCP chip multiselects are gone by contract (R8): profile-scoped
// skill/MCP shaping is tree-first via the unified mutations. Saves preserve
// the policy JSON keys this editor no longer owns — `skillPolicy` passes
// through verbatim and `toolPolicy` merges only `builtInTools` — so a sheet
// save can never clobber tree-written grants while `updateAgentProfile`
// still replace-writes whole policy fields (retires in U11).
import { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Switch,
  Textarea,
  cn,
} from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import {
  SettingsAgentProfilesQuery,
  SettingsCreateAgentProfileMutation,
  SettingsDeleteAgentProfileMutation,
  SettingsUpdateAgentProfileMutation,
} from "@/lib/settings-queries";
import {
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";

type JsonRecord = Record<string, unknown>;

type ModelOption = {
  id: string;
  modelId: string;
  displayName: string;
};

type SpaceOption = {
  id: string;
  name: string;
  slug?: string | null;
};

type AgentProfileRow = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  routingGuidance?: string | null;
  instructions: string;
  modelId: string;
  model?: { displayName?: string | null } | null;
  enabled: boolean;
  builtInKey?: string | null;
  toolPolicy: unknown;
  skillPolicy: unknown;
  executionControls: unknown;
  spaces: SpaceOption[];
};

type ExternalReviewerPolicy =
  | "never"
  | "explicit"
  | "profile_required"
  | "always";

type LoopFailBehavior = "return_blocker" | "best_effort_with_warning";

type ProfileDraft = {
  name: string;
  description: string;
  routingGuidance: string;
  instructions: string;
  modelId: string;
  enabled: boolean;
  builtInTools: string[];
  spaceIds: string[];
  clarify: boolean;
  maxRuntimeMs: string;
  maxTokens: string;
  thinking: string;
  loopEnabled: boolean;
  loopMode: "closed";
  loopMaxIterations: string;
  loopReviewGate: boolean;
  loopExternalReviewerPolicy: ExternalReviewerPolicy;
  loopMaxReviewLoops: string;
  loopFailBehavior: LoopFailBehavior;
};

const EXTERNAL_REVIEWER_OPTIONS: Array<{
  value: ExternalReviewerPolicy;
  label: string;
}> = [
  { value: "explicit", label: "Explicit request" },
  { value: "profile_required", label: "Profile required" },
  { value: "always", label: "Always" },
  { value: "never", label: "Never" },
];

const LOOP_FAIL_BEHAVIOR_OPTIONS: Array<{
  value: LoopFailBehavior;
  label: string;
}> = [
  { value: "return_blocker", label: "Return blocker" },
  { value: "best_effort_with_warning", label: "Best effort with warning" },
];

export function AgentProfilesSheet({
  open,
  onOpenChange,
  initialProfileId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Deep-link target: open directly on this profile's detail. */
  initialProfileId?: string | null;
}) {
  const { tenantId } = useTenant();
  const [profilesResult, refetchProfiles] = useQuery({
    query: SettingsAgentProfilesQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId || !open,
  });
  const [, createProfile] = useMutation(SettingsCreateAgentProfileMutation);
  const [, deleteProfile] = useMutation(SettingsDeleteAgentProfileMutation);

  // null = list view; a profile id = that profile's detail.
  const [detailId, setDetailId] = useState<string | null>(
    initialProfileId ?? null,
  );
  // Re-sync when a new deep-link target arrives while closed.
  const [lastInitial, setLastInitial] = useState(initialProfileId ?? null);
  if ((initialProfileId ?? null) !== lastInitial) {
    setLastInitial(initialProfileId ?? null);
    setDetailId(initialProfileId ?? null);
  }

  const profiles = useMemo(
    () => sortProfiles(profilesResult.data?.agentProfiles ?? []),
    [profilesResult.data?.agentProfiles],
  );
  const catalog = profilesResult.data?.agentProfileEditorCatalog;
  const detail = profiles.find((profile) => profile.id === detailId) ?? null;

  async function onCreateProfile() {
    if (!tenantId) return;
    const modelId =
      catalog?.models?.[0]?.modelId ?? profiles[0]?.modelId ?? null;
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
    // Land on the new profile's detail inside the sheet (R13).
    if (id) setDetailId(id);
  }

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
    refetchProfiles({ requestPolicy: "network-only" });
    setDetailId(null);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="flex w-full flex-col gap-0 overflow-y-auto data-[side=right]:w-[min(680px,calc(100vw-2rem))] data-[side=right]:sm:max-w-none"
        data-testid="agent-profiles-sheet"
      >
        <SheetHeader>
          <SheetTitle>
            {detail ? (
              <span className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setDetailId(null)}
                  aria-label="Back to profile list"
                  data-testid="profiles-sheet-back"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                {detail.name}
                {detail.builtInKey ? (
                  <Badge variant="secondary">built-in</Badge>
                ) : (
                  <Badge variant="outline">custom</Badge>
                )}
              </span>
            ) : (
              "Agent Profiles"
            )}
          </SheetTitle>
          <SheetDescription>
            {detail
              ? `${detail.slug} · ${detail.model?.displayName ?? detail.modelId}`
              : "Reusable task profiles the parent Agent delegates through Pi subagents. Skill and MCP shaping is tree-first — select the profile chip and work the tree."}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pt-2">
          {profilesResult.error ? (
            <p className="p-4 text-sm text-destructive">
              {profilesResult.error.message}
            </p>
          ) : detail && catalog ? (
            <AgentProfileDetailEditor
              key={detail.id}
              tenantId={tenantId ?? ""}
              profile={detail}
              models={(catalog.models ?? []) as ModelOption[]}
              spaces={(catalog.spaces ?? []) as SpaceOption[]}
              builtInTools={catalog.builtInTools ?? []}
              onSaved={() => refetchProfiles({ requestPolicy: "network-only" })}
              onDelete={() => onDeleteProfile(detail)}
            />
          ) : (
            <div data-testid="profiles-sheet-list">
              <div className="mb-2 flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onCreateProfile}
                  data-testid="profiles-sheet-new"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  New profile
                </Button>
              </div>
              {profilesResult.fetching && profiles.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  Loading Agent Profiles…
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {profiles.map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      onClick={() => setDetailId(profile.id)}
                      data-testid={`profiles-sheet-row-${profile.slug}`}
                      className={cn(
                        "group flex w-full items-center gap-4 px-2 py-3 text-left transition-colors hover:bg-muted/40",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {profile.name}
                          </span>
                          <Badge variant="outline">
                            {profile.model?.displayName ?? profile.modelId}
                          </Badge>
                          {profile.builtInKey ? (
                            <Badge variant="secondary">built-in</Badge>
                          ) : null}
                          <Badge variant="outline">
                            {(profile.spaces?.length ?? 0) === 0
                              ? "All Spaces"
                              : `${profile.spaces.length} Spaces`}
                          </Badge>
                        </div>
                        <p className="mt-1 truncate text-sm text-muted-foreground">
                          {profile.description ??
                            profile.routingGuidance ??
                            "Custom profile"}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
                    </button>
                  ))}
                  {profiles.length === 0 ? (
                    <p className="p-6 text-sm text-muted-foreground">
                      No Agent Profiles configured.
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AgentProfileDetailEditor({
  tenantId,
  profile,
  models,
  spaces,
  builtInTools,
  onSaved,
  onDelete,
}: {
  tenantId: string;
  profile: AgentProfileRow;
  models: ModelOption[];
  spaces: SpaceOption[];
  builtInTools: string[];
  onSaved: () => void;
  onDelete: () => void;
}) {
  const [saveState, save] = useMutation(SettingsUpdateAgentProfileMutation);
  const [draft, setDraft] = useState(() => profileToDraft(profile));
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const saving = saveState.fetching;
  const custom = !profile.builtInKey;
  const draftValid =
    validPositiveInteger(draft.loopMaxIterations) &&
    validPositiveInteger(draft.loopMaxReviewLoops);

  async function onSave() {
    if (!tenantId) return;
    if (!draftValid) {
      toast.error("Loop limits must be positive whole numbers");
      return;
    }
    const result = await save({
      tenantId,
      id: profile.id,
      input: draftToInput(draft, profile),
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

      <button
        type="button"
        className="mb-3 flex w-full items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setAdvancedOpen((current) => !current)}
        aria-expanded={advancedOpen}
        data-testid="profiles-sheet-advanced-toggle"
      >
        <ChevronDown
          className={cn(
            "size-4 transition-transform",
            !advancedOpen && "-rotate-90",
          )}
        />
        Advanced
      </button>

      {advancedOpen ? (
        <div data-testid="profiles-sheet-advanced">
          <SettingsSection label="Loop / Review">
            <SettingsRow
              label="Closed loop"
              description="Run discovery, planning, execution, verification, and iteration before handoff."
            >
              <Switch
                checked={draft.loopEnabled}
                onCheckedChange={(value) =>
                  setDraftField(setDraft, "loopEnabled", value)
                }
              />
            </SettingsRow>
            <SettingsRow
              label="Mode"
              description="Bounded operator-authored loop policy for this profile."
            >
              <Select value={draft.loopMode} disabled>
                <SelectTrigger className="w-full max-w-80">
                  <SelectValue placeholder="Loop mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </SettingsRow>
            <SettingsRow
              label="Max iterations"
              description="Maximum self-review repair passes before handoff."
            >
              <Input
                className="w-full max-w-80"
                type="number"
                min={1}
                step={1}
                value={draft.loopMaxIterations}
                onChange={(e) =>
                  setDraftField(setDraft, "loopMaxIterations", e.target.value)
                }
              />
            </SettingsRow>
            <SettingsRow
              label="Review gate"
              description="Require a passing review verdict before this profile can hand off."
            >
              <Switch
                checked={draft.loopReviewGate}
                onCheckedChange={(value) =>
                  setDraftField(setDraft, "loopReviewGate", value)
                }
              />
            </SettingsRow>
            <SettingsRow
              label="External reviewer"
              description="When the parent Agent should ask the Reviewer profile to verify work."
            >
              <Select
                value={draft.loopExternalReviewerPolicy}
                onValueChange={(value) =>
                  setDraftField(
                    setDraft,
                    "loopExternalReviewerPolicy",
                    value as ExternalReviewerPolicy,
                  )
                }
              >
                <SelectTrigger className="w-full max-w-80">
                  <SelectValue placeholder="Reviewer policy" />
                </SelectTrigger>
                <SelectContent>
                  {EXTERNAL_REVIEWER_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsRow>
            <SettingsRow
              label="Max review loops"
              description="Maximum Reviewer-driven repair loops before failure handling."
            >
              <Input
                className="w-full max-w-80"
                type="number"
                min={1}
                step={1}
                value={draft.loopMaxReviewLoops}
                onChange={(e) =>
                  setDraftField(setDraft, "loopMaxReviewLoops", e.target.value)
                }
              />
            </SettingsRow>
            <SettingsRow
              label="Failure behavior"
              description="What the parent Agent should do when the loop cannot pass in budget."
            >
              <Select
                value={draft.loopFailBehavior}
                onValueChange={(value) =>
                  setDraftField(
                    setDraft,
                    "loopFailBehavior",
                    value as LoopFailBehavior,
                  )
                }
              >
                <SelectTrigger className="w-full max-w-80">
                  <SelectValue placeholder="Failure behavior" />
                </SelectTrigger>
                <SelectContent>
                  {LOOP_FAIL_BEHAVIOR_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <SettingsRow
              label="Built-in tools"
              description="Built-in tools available to this profile. Not a unified-mutation class — this structured field is its single write surface."
            >
              <ChipMultiSelect
                options={builtInTools.map((tool) => ({
                  value: tool,
                  label: tool,
                }))}
                values={draft.builtInTools}
                placeholder="Select tools"
                onChange={(values) =>
                  setDraftField(setDraft, "builtInTools", values)
                }
              />
            </SettingsRow>
          </SettingsSection>
        </div>
      ) : null}

      <div className="mb-8 flex justify-end">
        <div className="flex items-center gap-2">
          {custom ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onDelete}
              title="Delete Agent Profile"
              data-testid="profiles-sheet-delete"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
          <Button
            type="button"
            onClick={onSave}
            disabled={saving || !draftValid}
            data-testid="profiles-sheet-save"
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </>
  );
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
  reviewGate?: boolean | null;
  maxReviewLoops?: number | null;
  loopEnabled?: boolean | null;
  loopPolicy?: {
    mode?: string | null;
    enabled?: boolean | null;
    maxIterations?: number | null;
    maxReviewLoops?: number | null;
    reviewGate?: boolean | null;
    externalReviewerPolicy?: string | null;
    failBehavior?: string | null;
  } | null;
};

function profileToDraft(profile: AgentProfileRow): ProfileDraft {
  const toolPolicy = parseJson<ToolPolicy>(profile.toolPolicy, {});
  const executionControls = parseJson<ExecutionControls>(
    profile.executionControls,
    {},
  );
  const builtInLoopDefaults = loopDefaultsForProfile(profile);
  const maxRuntimeMs =
    executionControls.maxRuntimeMs ??
    executionControls.maxRunTimeMs ??
    executionControls.maxExecutionTimeMs ??
    "";
  const loopPolicy = executionControls.loopPolicy ?? {};
  const loopMaxReviewLoops =
    loopPolicy.maxReviewLoops ??
    executionControls.maxReviewLoops ??
    builtInLoopDefaults.maxReviewLoops ??
    1;
  const loopReviewGate =
    loopPolicy.reviewGate ??
    executionControls.reviewGate ??
    builtInLoopDefaults.reviewGate ??
    false;
  return {
    name: profile.name,
    description: profile.description ?? "",
    routingGuidance: profile.routingGuidance ?? "",
    instructions: profile.instructions,
    modelId: profile.modelId,
    enabled: profile.enabled,
    builtInTools: normalizeStringArray(toolPolicy.builtInTools),
    spaceIds: (profile.spaces ?? []).map((space) => space.id),
    clarify: executionControls.clarify === true,
    maxRuntimeMs: maxRuntimeMs === "" ? "" : String(maxRuntimeMs),
    maxTokens:
      executionControls.maxTokens == null
        ? ""
        : String(executionControls.maxTokens),
    thinking: executionControls.thinking ?? "",
    loopEnabled: loopPolicy.enabled ?? executionControls.loopEnabled ?? true,
    loopMode: "closed",
    loopMaxIterations: String(loopPolicy.maxIterations ?? 1),
    loopReviewGate,
    loopExternalReviewerPolicy: asExternalReviewerPolicy(
      loopPolicy.externalReviewerPolicy ??
        builtInLoopDefaults.externalReviewerPolicy,
    ),
    loopMaxReviewLoops: String(loopMaxReviewLoops),
    loopFailBehavior: asLoopFailBehavior(loopPolicy.failBehavior),
  };
}

function loopDefaultsForProfile(profile: AgentProfileRow): {
  reviewGate?: boolean;
  maxReviewLoops?: number;
  externalReviewerPolicy?: ExternalReviewerPolicy;
} {
  if (profile.builtInKey !== "reviewer") {
    return {};
  }
  return {
    reviewGate: true,
    maxReviewLoops: 2,
    externalReviewerPolicy: "never",
  };
}

/**
 * Draft → updateAgentProfile input. The sheet owns identity/behavior fields
 * plus `builtInTools` and Space assignments — it deliberately does NOT own
 * `skillPolicy.skillSlugs` or `toolPolicy.mcpServers` (tree-first, unified
 * mutations). Because the resolver replace-writes whole policy JSON fields,
 * the input carries the profile's CURRENT policy values for everything this
 * editor doesn't own, so a sheet save never clobbers tree-written grants.
 */
function draftToInput(draft: ProfileDraft, profile: AgentProfileRow): JsonRecord {
  const currentToolPolicy = parseJson<ToolPolicy>(profile.toolPolicy, {});
  const currentSkillPolicy = parseJson<SkillPolicy>(profile.skillPolicy, {});
  const maxRuntimeMs = optionalNumber(draft.maxRuntimeMs);
  const maxTokens = optionalNumber(draft.maxTokens);
  const loopPolicy = {
    mode: draft.loopMode,
    enabled: draft.loopEnabled,
    maxIterations: positiveIntegerOrDefault(draft.loopMaxIterations, 1),
    maxReviewLoops: positiveIntegerOrDefault(draft.loopMaxReviewLoops, 1),
    reviewGate: draft.loopReviewGate,
    externalReviewerPolicy: draft.loopExternalReviewerPolicy,
    failBehavior: draft.loopFailBehavior,
    ...(maxRuntimeMs != null ? { maxRuntimeMs } : {}),
    ...(maxTokens != null ? { maxTokens } : {}),
  };
  return {
    name: draft.name.trim(),
    description: optionalString(draft.description),
    routingGuidance: optionalString(draft.routingGuidance),
    instructions: draft.instructions.trim(),
    modelId: draft.modelId,
    enabled: draft.enabled,
    toolPolicy: {
      ...currentToolPolicy,
      builtInTools: draft.builtInTools,
    },
    skillPolicy: currentSkillPolicy,
    executionControls: {
      foreground: true,
      clarify: draft.clarify,
      maxSubagentDepth: 0,
      maxRuntimeMs,
      maxTokens,
      thinking: optionalString(draft.thinking),
      reviewGate: draft.loopReviewGate,
      maxReviewLoops: loopPolicy.maxReviewLoops,
      loopPolicy,
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

function positiveIntegerOrDefault(value: string, fallback: number): number {
  if (!validPositiveInteger(value)) return fallback;
  return Number(value);
}

function validPositiveInteger(value: string): boolean {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0;
}

function asExternalReviewerPolicy(value: unknown): ExternalReviewerPolicy {
  return EXTERNAL_REVIEWER_OPTIONS.some((option) => option.value === value)
    ? (value as ExternalReviewerPolicy)
    : "explicit";
}

function asLoopFailBehavior(value: unknown): LoopFailBehavior {
  return LOOP_FAIL_BEHAVIOR_OPTIONS.some((option) => option.value === value)
    ? (value as LoopFailBehavior)
    : "return_blocker";
}
