// Config sheet (Agent page merge, THINK-132 U1): the Default Agent settings —
// runtime, default Space, default model, goal token budget — relocated out of
// the Agents page into a side sheet on the Composer surface. The section body
// is exported separately so the legacy Agents page keeps its mount until the
// route cutover retires it.
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "urql";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Button,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Input,
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
} from "@thinkwork/ui";
import { AgentRuntime } from "@/gql/graphql";
import { useTenant } from "@/context/TenantContext";
import {
  SettingsTenantAgentQuery,
  SettingsDeploymentStatusQuery,
  SettingsCreateHarnessProofThreadMutation,
  SettingsTenantGoalBudgetQuery,
  SettingsTenantModelCatalogQuery,
  SettingsUpdateTenantAgentMutation,
  SettingsUpdateTenantGoalBudgetMutation,
} from "@/lib/settings-queries";
import {
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";

const DEFAULT_GOAL_TOKEN_BUDGET = 100_000;
const MAX_GOAL_TOKEN_BUDGET = 2_000_000;

type JsonRecord = Record<string, unknown>;

export type AgentConfigSpaceOption = {
  id: string;
  name: string;
  slug?: string | null;
};

export function AgentConfigSection({
  spaces,
}: {
  spaces: AgentConfigSpaceOption[];
}) {
  const { tenantId, isOperator } = useTenant();
  const navigate = useNavigate();
  const [agentResult] = useQuery({
    query: SettingsTenantAgentQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [catalogResult] = useQuery({
    query: SettingsTenantModelCatalogQuery,
    variables: { tenantId: tenantId ?? "", includeDisabled: false },
    pause: !tenantId,
  });
  const [goalBudgetResult] = useQuery({
    query: SettingsTenantGoalBudgetQuery,
    variables: { id: tenantId ?? "" },
    pause: !tenantId,
  });
  const [deploymentResult] = useQuery({
    query: SettingsDeploymentStatusQuery,
    pause: !isOperator,
  });
  const [saveState, save] = useMutation(SettingsUpdateTenantAgentMutation);
  const [proofThreadState, createProofThread] = useMutation(
    SettingsCreateHarnessProofThreadMutation,
  );
  const [goalBudgetSaveState, saveGoalBudget] = useMutation(
    SettingsUpdateTenantGoalBudgetMutation,
  );

  const [runtime, setRuntime] = useState<AgentRuntime | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<JsonRecord>({});
  const [defaultSpaceId, setDefaultSpaceId] = useState<string | null>(null);
  const [goalTokenBudget, setGoalTokenBudget] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmHarness, setConfirmHarness] = useState(false);
  const [proofThreadId, setProofThreadId] = useState<string | null>(null);

  const agent = agentResult.data?.agent;

  useEffect(() => {
    if (agent) {
      const config = parseJson<JsonRecord>(agent.runtimeConfig, {});
      setRuntime(agent.runtime);
      setModel(agent.model ?? null);
      setRuntimeConfig(config);
      setDefaultSpaceId(stringOrNull(config.defaultSpaceId));
    }
  }, [agent]);

  useEffect(() => {
    const value =
      goalBudgetResult.data?.tenant?.settings?.goalDefaultTokenBudget;
    setGoalTokenBudget(value == null ? "" : String(value));
  }, [goalBudgetResult.data?.tenant?.settings?.goalDefaultTokenBudget]);

  const catalog = catalogResult.data?.tenantModelCatalog ?? [];
  const catalogFailed = !!catalogResult.error;
  const goalBudgetValid = validGoalTokenBudgetOrEmpty(goalTokenBudget);
  const harnessProof =
    deploymentResult.data?.deploymentStatus.agentcoreHarnessProof;
  useEffect(() => {
    if (harnessProof?.activeThreadId) {
      setProofThreadId(harnessProof.activeThreadId);
    }
  }, [harnessProof?.activeThreadId]);
  const runtimeOptions: Array<{
    value: AgentRuntime;
    label: string;
    disabled?: boolean;
  }> = [
    { value: AgentRuntime.Flue, label: "Pi" },
    ...(isOperator
      ? [
          {
            value: AgentRuntime.Agentcore,
            label: "AgentCore Harness (proof)",
            disabled: harnessProof?.ready !== true,
          },
        ]
      : []),
  ];

  async function persist(input: {
    runtime?: AgentRuntime;
    model?: string | null;
    runtimeConfig?: JsonRecord;
  }) {
    if (!tenantId) return;
    setErrorMsg(null);
    const result = await save({ tenantId, input });
    if (result.error) setErrorMsg(result.error.message);
    return result;
  }

  async function activateHarnessProof() {
    if (!tenantId || !harnessProof?.ready) return;
    setErrorMsg(null);
    const selected = await persist({ runtime: AgentRuntime.Agentcore });
    if (!selected || selected.error) {
      setRuntime(agent?.runtime ?? AgentRuntime.Flue);
      setConfirmHarness(false);
      return;
    }
    setRuntime(AgentRuntime.Agentcore);
    const bootstrapped = await createProofThread({ tenantId });
    if (bootstrapped.error) {
      const bootstrapMessage = bootstrapped.error.message;
      const restored = await persist({ runtime: AgentRuntime.Flue });
      if (!restored || restored.error) {
        setErrorMsg(
          `${bootstrapMessage}. Automatic Pi restoration also failed; use Restore prior runtime before sending messages.`,
        );
      } else {
        setRuntime(AgentRuntime.Flue);
        setProofThreadId(null);
        setErrorMsg(
          `${bootstrapMessage}. Pi was restored automatically; no tenant messages were routed to Harness.`,
        );
      }
      setConfirmHarness(false);
      return;
    }
    const threadId = bootstrapped.data?.createHarnessProofThread.threadId;
    if (threadId) setProofThreadId(threadId);
    setConfirmHarness(false);
    toast.success(
      bootstrapped.data?.createHarnessProofThread.created
        ? "Harness proof thread created"
        : "Harness proof thread ready",
    );
  }

  async function restorePriorRuntime() {
    setErrorMsg(null);
    const restored = await persist({ runtime: AgentRuntime.Flue });
    if (!restored || restored.error) return;
    setRuntime(AgentRuntime.Flue);
    setProofThreadId(null);
    toast.success("Pi runtime restored");
  }

  async function persistDefaultSpace(spaceId: string) {
    const nextConfig = {
      ...runtimeConfig,
      defaultSpaceId: spaceId,
    };
    setDefaultSpaceId(spaceId);
    setRuntimeConfig(nextConfig);
    await persist({ runtimeConfig: nextConfig });
  }

  async function persistGoalBudget() {
    if (!tenantId) return;
    if (!validGoalTokenBudgetOrEmpty(goalTokenBudget)) {
      toast.error("Goal token budget must be a positive whole number");
      return;
    }
    const parsed =
      goalTokenBudget.trim() === "" ? null : Number(goalTokenBudget);
    const result = await saveGoalBudget({
      tenantId,
      input: { goalDefaultTokenBudget: parsed },
    });
    if (result.error) {
      toast.error("Could not save goal budget", {
        description: result.error.message,
      });
      return;
    }
    toast.success("Goal budget saved");
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
            if (next === AgentRuntime.Agentcore) {
              setConfirmHarness(true);
              return;
            }
            setRuntime(next);
            void persist({ runtime: next });
          }}
          disabled={saveState.fetching || proofThreadState.fetching}
        >
          <SelectTrigger className="w-60">
            <SelectValue placeholder="Select runtime" />
          </SelectTrigger>
          <SelectContent>
            {runtimeOptions.map((opt) => (
              <SelectItem
                key={opt.value}
                value={opt.value}
                disabled={opt.disabled}
              >
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isOperator && (
          <div
            className="mt-2 text-xs text-muted-foreground"
            data-testid="harness-proof-readiness"
          >
            {harnessProof?.ready
              ? `AgentCore Harness (proof) ready · version ${harnessProof.liveVersion ?? "unknown"} · ${harnessProof.sessionStrategy ?? "unknown"} sessions`
              : `AgentCore Harness (proof) unavailable · ${harnessProof?.reasonCode ?? (deploymentResult.fetching ? "checking" : "status_unavailable")}`}
          </div>
        )}
        {isOperator && runtime === AgentRuntime.Agentcore ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {proofThreadId ? (
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  void navigate({
                    to: "/threads/$id",
                    params: { id: proofThreadId },
                  })
                }
              >
                Open proof thread
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void restorePriorRuntime()}
              disabled={saveState.fetching}
            >
              Restore prior runtime
            </Button>
          </div>
        ) : null}
      </SettingsRow>

      <AlertDialog open={confirmHarness} onOpenChange={setConfirmHarness}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Use AgentCore Harness for this tenant?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This temporarily changes the tenant-wide default Agent runtime.
              Only the enrolled direct-chat proof thread is accepted; all
              automation and non-enrolled threads fail closed with no Pi
              fallback. ThinkWork will create or reopen the proof thread after
              selection.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saveState.fetching}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void activateHarnessProof();
              }}
              disabled={saveState.fetching || proofThreadState.fetching}
            >
              {saveState.fetching || proofThreadState.fetching
                ? "Preparing proof…"
                : "Select Harness and create thread"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SettingsRow
        label="Default Space"
        description="Space used for new default Agent and automation conversation threads."
      >
        <Select
          value={defaultSpaceId ?? undefined}
          onValueChange={(value) => void persistDefaultSpace(value)}
          disabled={spaces.length === 0}
        >
          <SelectTrigger className="w-60">
            <SelectValue
              placeholder={spaces.length === 0 ? "No Spaces" : "Select Space"}
            />
          </SelectTrigger>
          <SelectContent>
            {spaces.map((space) => (
              <SelectItem key={space.id} value={space.id}>
                {space.name}
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
                <SelectItem key={m.modelId} value={m.modelId}>
                  {m.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </SettingsRow>

      <SettingsRow
        label="Goal token budget"
        description={`Default token cap for composer Goal mode runs. Blank uses ${formatTokenBudget(DEFAULT_GOAL_TOKEN_BUDGET)}.`}
      >
        <div className="flex w-full max-w-80 min-w-0 items-center gap-2">
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_GOAL_TOKEN_BUDGET}
            step={1}
            value={goalTokenBudget}
            placeholder={formatTokenBudget(DEFAULT_GOAL_TOKEN_BUDGET)}
            onChange={(e) => setGoalTokenBudget(e.target.value)}
            className="min-w-0 flex-1"
            aria-label="Goal token budget"
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => void persistGoalBudget()}
            disabled={
              goalBudgetSaveState.fetching ||
              goalBudgetResult.fetching ||
              !goalBudgetValid
            }
          >
            Save
          </Button>
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}

export function AgentConfigSheet({
  open,
  onOpenChange,
  spaces,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaces: AgentConfigSpaceOption[];
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="flex w-full flex-col gap-0 overflow-y-auto data-[side=right]:w-[min(680px,calc(100vw-2rem))] data-[side=right]:sm:max-w-none"
        data-testid="agent-config-sheet"
      >
        <SheetHeader className="px-6">
          <SheetTitle>Agent configuration</SheetTitle>
          <SheetDescription>
            Default Agent settings for this tenant. Fields save as you change
            them.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-3 pb-8">
          <AgentConfigSection spaces={spaces} />
        </div>
      </SheetContent>
    </Sheet>
  );
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

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function validGoalTokenBudget(value: string): boolean {
  const number = Number(value);
  return (
    Number.isSafeInteger(number) &&
    number > 0 &&
    number <= MAX_GOAL_TOKEN_BUDGET
  );
}

function validGoalTokenBudgetOrEmpty(value: string): boolean {
  return value.trim() === "" || validGoalTokenBudget(value);
}

function formatTokenBudget(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
