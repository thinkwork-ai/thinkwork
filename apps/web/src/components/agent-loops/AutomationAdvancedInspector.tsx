import type { Dispatch, ReactNode, SetStateAction } from "react";
import {
  Bot,
  CheckCircle2,
  Gauge,
  History,
  ShieldCheck,
  Timer,
} from "lucide-react";
import {
  Button,
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
  Switch,
  Textarea,
} from "@thinkwork/ui";
import type { AgentLoopDraft, AgentLoopWorkerOption } from "./agent-loop-types";

export function AutomationAdvancedInspector({
  open,
  onOpenChange,
  draft,
  setDraft,
  workerOptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: AgentLoopDraft;
  setDraft: Dispatch<SetStateAction<AgentLoopDraft>>;
  workerOptions: AgentLoopWorkerOption[];
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto data-[side=right]:w-[min(560px,calc(100vw-2rem))] data-[side=right]:sm:max-w-none">
        <SheetHeader className="border-b border-border px-6 py-5 pr-14">
          <SheetTitle className="text-lg font-semibold">
            Advanced settings
          </SheetTitle>
          <SheetDescription className="text-sm">
            Goal, judge, policy, evidence, and runtime controls.
          </SheetDescription>
        </SheetHeader>

        <div className="divide-y divide-border">
          <InspectorSection label="Identity">
            <InspectorField label="Name">
              <Input
                aria-label="Automation name"
                className="h-10 w-full"
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Weekly Agent Check-In"
              />
            </InspectorField>
            <InspectorField label="Description">
              <Textarea
                aria-label="Automation description"
                className="min-h-20 w-full resize-y"
                value={draft.description}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="Review open work and summarize next actions."
              />
            </InspectorField>
          </InspectorSection>

          <InspectorSection label="Goal">
            <InspectorField
              label={
                <span className="inline-flex items-center gap-2">
                  <CheckCircle2 className="size-4" />
                  Intent
                </span>
              }
            >
              <Textarea
                aria-label="Goal intent"
                className="min-h-24 w-full resize-y"
                value={draft.objective}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    objective: event.target.value,
                  }))
                }
                placeholder="Review open work and produce a concise status update."
              />
            </InspectorField>
            <InspectorField label="Completion criteria">
              <Textarea
                aria-label="Completion criteria"
                className="min-h-24 w-full resize-y"
                value={draft.completionCriteriaText}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    completionCriteriaText: event.target.value,
                  }))
                }
              />
            </InspectorField>
          </InspectorSection>

          <InspectorSection label="Worker and judge">
            <div className="grid gap-4">
              <InspectorField
                label={
                  <span className="inline-flex items-center gap-2">
                    <Bot className="size-4" />
                    Worker
                  </span>
                }
              >
                <Select
                  value={draft.workerId}
                  onValueChange={(workerId) =>
                    setDraft((current) => ({ ...current, workerId }))
                  }
                >
                  <SelectTrigger className="w-full" aria-label="Worker">
                    <SelectValue placeholder="Choose worker" />
                  </SelectTrigger>
                  <SelectContent>
                    {workerOptions.map((worker) => (
                      <SelectItem key={worker.id} value={worker.id}>
                        {worker.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </InspectorField>
              <InspectorField
                label={
                  <span className="inline-flex items-center gap-2">
                    <ShieldCheck className="size-4" />
                    Judge
                  </span>
                }
              >
                <Select
                  value={draft.judgeMode}
                  onValueChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      judgeMode:
                        value === "human_approval"
                          ? "human_approval"
                          : "self_check",
                    }))
                  }
                >
                  <SelectTrigger className="w-full" aria-label="Judge mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="self_check">Self-check</SelectItem>
                    <SelectItem value="human_approval">
                      Human approval
                    </SelectItem>
                  </SelectContent>
                </Select>
              </InspectorField>
            </div>
            <InspectorField label="Judge criteria">
              <Textarea
                aria-label="Judge criteria"
                className="min-h-20 w-full resize-y"
                value={draft.judgeCriteriaText}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    judgeCriteriaText: event.target.value,
                  }))
                }
              />
            </InspectorField>
          </InspectorSection>

          <InspectorSection label="Policy">
            <div className="grid gap-4 sm:grid-cols-2">
              <CompactNumberRow
                icon={<History className="size-4" />}
                label="Max iterations"
                value={draft.maxIterations}
                onChange={(maxIterations) =>
                  setDraft((current) => ({ ...current, maxIterations }))
                }
              />
              <CompactNumberRow
                icon={<Timer className="size-4" />}
                label="Max runtime minutes"
                value={draft.maxRuntimeMinutes}
                onChange={(maxRuntimeMinutes) =>
                  setDraft((current) => ({ ...current, maxRuntimeMinutes }))
                }
              />
              <CompactNumberRow
                icon={<Gauge className="size-4" />}
                label="Max tokens"
                value={draft.maxTokens}
                onChange={(maxTokens) =>
                  setDraft((current) => ({ ...current, maxTokens }))
                }
              />
              <CompactNumberRow
                label="Cost budget USD"
                value={draft.costBudgetUsd}
                onChange={(costBudgetUsd) =>
                  setDraft((current) => ({ ...current, costBudgetUsd }))
                }
                placeholder="Optional"
              />
              <CompactNumberRow
                label="Retry backoff minutes"
                value={draft.retryBackoffMinutes}
                onChange={(retryBackoffMinutes) =>
                  setDraft((current) => ({ ...current, retryBackoffMinutes }))
                }
              />
              <InspectorField label="Escalate on failure">
                <Switch
                  aria-label="Escalate on failure"
                  checked={draft.escalateOnFailure}
                  onCheckedChange={(escalateOnFailure) =>
                    setDraft((current) => ({
                      ...current,
                      escalateOnFailure,
                    }))
                  }
                />
              </InspectorField>
            </div>
          </InspectorSection>

          <InspectorSection label="Evidence">
            <InspectorField label="Redaction">
              <Select
                value={draft.redactionState}
                onValueChange={(redactionState) =>
                  setDraft((current) => ({
                    ...current,
                    redactionState:
                      redactionState === "redacted" ||
                      redactionState === "offloaded" ||
                      redactionState === "raw_allowed"
                        ? redactionState
                        : "summary_only",
                  }))
                }
              >
                <SelectTrigger
                  className="w-full"
                  aria-label="Evidence redaction"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="summary_only">Summary only</SelectItem>
                  <SelectItem value="redacted">Redacted</SelectItem>
                  <SelectItem value="offloaded">Offloaded</SelectItem>
                  <SelectItem value="raw_allowed">Raw allowed</SelectItem>
                </SelectContent>
              </Select>
            </InspectorField>
            <InspectorField label="Retain raw evidence">
              <Switch
                aria-label="Retain raw evidence"
                checked={draft.retainRawEvidence}
                onCheckedChange={(retainRawEvidence) =>
                  setDraft((current) => ({ ...current, retainRawEvidence }))
                }
              />
            </InspectorField>
            <CompactNumberRow
              label="Retention days"
              value={draft.retentionDays}
              onChange={(retentionDays) =>
                setDraft((current) => ({ ...current, retentionDays }))
              }
            />
          </InspectorSection>

          <div className="flex justify-end px-6 py-5">
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function InspectorSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 px-6 py-5">
      <h2 className="text-sm font-semibold text-foreground">{label}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function InspectorField({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={["grid min-w-0 gap-2", className].filter(Boolean).join(" ")}
    >
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="min-w-0 text-sm text-foreground">{children}</div>
    </div>
  );
}

function CompactNumberRow({
  icon,
  label,
  value,
  onChange,
  placeholder,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <InspectorField
      label={
        <span className="inline-flex items-center gap-2">
          {icon}
          {label}
        </span>
      }
    >
      <Input
        aria-label={label}
        type="number"
        inputMode="numeric"
        min={1}
        className="h-10 w-full"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </InspectorField>
  );
}
