// Config sheet (Agent page merge, THINK-132 U1): the Default Agent settings —
// runtime, default Space, default model, goal token budget — relocated out of
// the Agents page into a side sheet on the Composer surface. The section body
// is exported separately so the legacy Agents page keeps its mount until the
// route cutover retires it.
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "urql";
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

  const agent = agentResult.data?.agent;

  useEffect(() => {
    if (agent) {
      const config = parseJson<JsonRecord>(agent.runtimeConfig, {});
      setRuntime(
        ["agentcore", "harness"].includes(
          stringOrNull(config.defaultThreadRuntime) ?? "",
        )
          ? AgentRuntime.Agentcore
          : AgentRuntime.Flue,
      );
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
            label: "AgentCore Harness",
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

  async function saveDefaultThreadRuntime(next: AgentRuntime) {
    const nextRuntimeConfig = {
      ...runtimeConfig,
      defaultThreadRuntime:
        next === AgentRuntime.Agentcore ? "agentcore" : "pi",
    };
    const previous = runtime;
    setRuntime(next);
    setRuntimeConfig(nextRuntimeConfig);
    const saved = await persist({ runtimeConfig: nextRuntimeConfig });
    if (!saved || saved.error) {
      setRuntime(previous);
      setRuntimeConfig(runtimeConfig);
      return false;
    }
    toast.success(
      next === AgentRuntime.Agentcore
        ? "New Composer threads will use AgentCore Harness"
        : "New Composer threads will use Pi",
    );
    return true;
  }

  async function activateHarnessDefault() {
    if (!tenantId || !harnessProof?.ready) return;
    setErrorMsg(null);
    await saveDefaultThreadRuntime(AgentRuntime.Agentcore);
    setConfirmHarness(false);
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
        description="Default runtime for new Composer threads. Existing threads keep their pinned runtime."
      >
        <Select
          value={runtime ?? undefined}
          onValueChange={(v) => {
            const next = v as AgentRuntime;
            if (next === AgentRuntime.Agentcore) {
              setConfirmHarness(true);
              return;
            }
            void saveDefaultThreadRuntime(next);
          }}
          disabled={saveState.fetching}
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
              ? `AgentCore Harness ready · version ${harnessProof.liveVersion ?? "unknown"} · ${harnessProof.sessionStrategy ?? "unknown"} sessions`
              : `AgentCore Harness unavailable · ${harnessProof?.reasonCode ?? (deploymentResult.fetching ? "checking" : "status_unavailable")}`}
          </div>
        )}
      </SettingsRow>

      <AlertDialog open={confirmHarness} onOpenChange={setConfirmHarness}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Use AgentCore Harness for new threads?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This changes only the default for future Composer threads.
              Existing Pi and Harness threads keep their pinned runtimes and
              continue in parallel. Create a normal new thread after saving to
              use Harness.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saveState.fetching}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void activateHarnessDefault();
              }}
              disabled={saveState.fetching}
            >
              {saveState.fetching ? "Saving…" : "Save Harness default"}
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
