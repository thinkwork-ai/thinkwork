import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@thinkwork/ui";
import {
  DefinitionList,
  InfoCard,
  JsonPreview,
} from "@/components/workflows/workflow-ui";
import type { AgentLoopRow } from "./agent-loop-types";
import { jsonRecord, stringValue, titleize } from "./agent-loop-utils";

export function AutomationDetailAdvancedInspector({
  open,
  onOpenChange,
  loop,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loop: AgentLoopRow;
}) {
  const version = loop.currentVersion;
  const goal = jsonRecord(version?.goalSpec);
  const worker = jsonRecord(version?.workerSpec);
  const judge = jsonRecord(version?.judgeSpec);
  const policy = jsonRecord(version?.loopPolicy);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>Advanced details</SheetTitle>
          <SheetDescription>
            Runtime fields backing this Automation.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4 pb-6">
          <InfoCard title="Goal">
            <JsonPreview value={goal} />
          </InfoCard>
          <InfoCard title="Worker and judge">
            <DefinitionList
              items={[
                {
                  label: "Worker type",
                  value: titleize(stringValue(worker.type)),
                },
                {
                  label: "Worker",
                  value: stringValue(worker.label, stringValue(worker.id)),
                },
                { label: "Judge", value: titleize(stringValue(judge.mode)) },
                {
                  label: "Criteria",
                  value: Array.isArray(judge.criteria)
                    ? `${judge.criteria.length}`
                    : "0",
                },
              ]}
            />
          </InfoCard>
          <InfoCard title="Policy">
            <DefinitionList
              items={[
                {
                  label: "Max iterations",
                  value: String(policy.maxIterations ?? "-"),
                },
                {
                  label: "Max runtime",
                  value: policy.maxRuntimeMs
                    ? `${Math.round(Number(policy.maxRuntimeMs) / 60000)}m`
                    : "-",
                },
                { label: "Max tokens", value: String(policy.maxTokens ?? "-") },
                {
                  label: "Cost budget",
                  value: String(policy.costBudgetUsd ?? "-"),
                },
                {
                  label: "Fail behavior",
                  value: titleize(stringValue(policy.failBehavior)),
                },
                {
                  label: "Escalate",
                  value: policy.escalateOnFailure ? "Yes" : "No",
                },
              ]}
            />
          </InfoCard>
          <InfoCard title="Evidence policy">
            <JsonPreview value={version?.evidencePolicy ?? null} />
          </InfoCard>
          <InfoCard title="Version metadata">
            <JsonPreview value={version?.sourceMetadata ?? null} />
          </InfoCard>
        </div>
      </SheetContent>
    </Sheet>
  );
}
