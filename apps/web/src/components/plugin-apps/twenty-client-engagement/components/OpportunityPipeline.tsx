import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@thinkwork/ui";

import type {
  PipelineLayerDraft,
  StrategicPipelineOpportunity,
  UseCasePipelineAccount,
} from "../data/model";
import { LAYERS, LAYER_STATUSES } from "../fixtures/prototype-pages";

const DEFAULT_USE_CASE_ACCOUNTS: UseCasePipelineAccount[] = [
  {
    id: "account-1",
    client: "McPherson Companies",
    champion: "Chad Logan",
    dateSurfaced: "2026-06-11",
    sourceSession: "Weekly POC Checkpoint - June 11, 2026",
    urgency:
      "API access is the timing trigger. Chad needs the integration running before executive patience fades.",
    layers: [
      {
        instanceName: "CorePay Integration",
        status: "IN_DISCOVERY",
        whatWeKnow:
          "Fleet card collections data arrives through manual PayClick drops today.",
        openQuestions:
          "Confirm PayClick API documentation, BuildTrust ingestion path, and the phase-one scope boundary.",
        businessValue:
          "Compress a multi-month integration into a short delivery cycle and recover collections margin.",
        nextSteps:
          "Request PayClick API docs, document the manual collections process, and draft the executive business case.",
      },
      {
        instanceName: "Fuel Routing + Driver Rewards",
        status: "IDENTIFIED",
        whatWeKnow:
          "Higher-discount fuel stations exist, but drivers do not have a strong incentive to use them.",
        openQuestions:
          "Quantify discount differentials and identify whether a driver-facing workflow exists.",
        businessValue:
          "Improve margin per gallon and create a repeatable fleet-efficiency story.",
        nextSteps:
          "Scope reward mechanics and decide whether this belongs in phase two.",
      },
      {
        instanceName: "Card On/Off API",
        status: "IDENTIFIED",
        whatWeKnow:
          "McPherson cannot currently shut off cards for non-payment without PayClick involvement.",
        openQuestions:
          "Confirm API access, compliance constraints, and the collections workflow owner.",
        businessValue:
          "Reduce bad debt exposure and create real-time financial control.",
        nextSteps: "Track PayClick negotiation and document escalation rules.",
      },
    ],
  },
];

const DEFAULT_STRATEGIC_OPPORTUNITIES: StrategicPipelineOpportunity[] = [
  {
    id: "strategic-1",
    name: "JDE Strategic Partnership",
    type: "Partner",
    company: "JD Edwards (Oracle)",
    contact: "Oracle/JDE ISV Program",
    surfacedVia: "McPherson POC Checkpoint, June 11, 2026",
    status: "IDENTIFIED",
    rationale:
      "A certified JDE integration path turns McPherson into a proof point for the broader JDE customer base.",
    whatWeKnow:
      "JDE has a large industrial customer base and little visible AI integration competition.",
    whatWeNeed:
      "Partner-program requirements, the right Oracle contact, and certification expectations.",
    nextSteps:
      "Research the ISV path and draft a partnership brief after the McPherson proof point is stronger.",
  },
  {
    id: "strategic-2",
    name: "TEI Integration Opportunity",
    type: "New Customer",
    company: "TEI",
    contact: "TBD",
    surfacedVia: "Chad Logan referral",
    status: "IDENTIFIED",
    rationale:
      "TEI appears to have similar integration pain and is already warm through the McPherson relationship.",
    whatWeKnow:
      "The pain category is cross-system data access and integration friction.",
    whatWeNeed:
      "ERP system, champion, timeline, budget signal, and current workflow specifics.",
    nextSteps:
      "Debrief internal meetings and schedule a formal value-alignment session.",
  },
  {
    id: "strategic-3",
    name: "Birmingham Area Referrals",
    type: "New Customer",
    company: "Multiple Birmingham-area companies",
    contact: "Chad Logan",
    surfacedVia: "McPherson referral offer",
    status: "IDENTIFIED",
    rationale:
      "Warm referrals in McPherson's network can expand the same integration narrative quickly.",
    whatWeKnow: "Chad offered five potential company names.",
    whatWeNeed:
      "Company names, ERP stacks, relationship map, and pain signals.",
    nextSteps: "Ask Chad for names at the next checkpoint.",
  },
];

export function OpportunityPipeline({
  overlayBySection,
  overlayError,
  onSaveOverlay,
}: {
  overlayBySection: Map<string, Record<string, unknown>>;
  overlayError: string | null;
  onSaveOverlay: (
    sectionKey: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
}) {
  const [activeTab, setActiveTab] = useState<"use-cases" | "strategic">(
    "use-cases",
  );
  const [accounts, setAccounts] = useState<UseCasePipelineAccount[]>(
    DEFAULT_USE_CASE_ACCOUNTS,
  );
  const [strategic, setStrategic] = useState<StrategicPipelineOpportunity[]>(
    DEFAULT_STRATEGIC_OPPORTUNITIES,
  );
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAccounts(
      useCaseAccountsFromPayload(overlayBySection.get("use-case-pipeline")),
    );
    setStrategic(
      strategicFromPayload(overlayBySection.get("strategic-pipeline")),
    );
  }, [overlayBySection]);

  async function saveUseCases() {
    setSaving("use-case-pipeline");
    setError(null);
    try {
      await onSaveOverlay("use-case-pipeline", { accounts });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(null);
    }
  }

  async function saveStrategic() {
    setSaving("strategic-pipeline");
    setError(null);
    try {
      await onSaveOverlay("strategic-pipeline", { opportunities: strategic });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="max-w-6xl space-y-4">
      <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-card p-5">
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            Opportunity Pipeline
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Track client use-case layers and strategic opportunities in one
            ThinkWork-owned app overlay instead of the prototype localStorage
            bucket.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={saveUseCases}
          >
            {saving === "use-case-pipeline" ? "Saving..." : "Save use cases"}
          </Button>
          <Button type="button" size="sm" onClick={saveStrategic}>
            {saving === "strategic-pipeline" ? "Saving..." : "Save strategic"}
          </Button>
        </div>
      </div>

      {error || overlayError ? (
        <p className="text-sm text-destructive">{error ?? overlayError}</p>
      ) : null}

      <div className="flex gap-1 border-b border-border">
        <PipelineTab
          active={activeTab === "use-cases"}
          label={`Use Case Pipeline ${accounts.length}`}
          onClick={() => setActiveTab("use-cases")}
        />
        <PipelineTab
          active={activeTab === "strategic"}
          label={`Strategic Pipeline ${strategic.length}`}
          onClick={() => setActiveTab("strategic")}
        />
      </div>

      {activeTab === "use-cases" ? (
        <UseCasePipeline
          accounts={accounts}
          onChange={setAccounts}
          onAdd={() =>
            setAccounts((current) => [...current, newUseCaseAccount()])
          }
        />
      ) : (
        <StrategicPipeline
          opportunities={strategic}
          onChange={setStrategic}
          onAdd={() =>
            setStrategic((current) => [...current, newStrategicOpportunity()])
          }
        />
      )}
    </section>
  );
}

function UseCasePipeline({
  accounts,
  onChange,
  onAdd,
}: {
  accounts: UseCasePipelineAccount[];
  onChange: (accounts: UseCasePipelineAccount[]) => void;
  onAdd: () => void;
}) {
  if (accounts.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <h4 className="text-sm font-semibold text-foreground">
          No client accounts yet
        </h4>
        <Button type="button" size="sm" className="mt-3" onClick={onAdd}>
          Add client
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={onAdd}>
          Add client
        </Button>
      </div>
      {accounts.map((account, accountIndex) => (
        <article
          key={account.id}
          className="overflow-hidden rounded-md border border-border bg-card"
        >
          <div className="border-b border-border bg-muted/20 p-4">
            <Input
              aria-label="Pipeline client name"
              value={account.client}
              onChange={(event) =>
                onChange(
                  replaceAt(accounts, accountIndex, {
                    ...account,
                    client: event.target.value,
                  }),
                )
              }
              className="max-w-xl text-base font-semibold"
            />
            <div className="mt-3 grid grid-cols-4 gap-3">
              <Input
                aria-label="Pipeline champion"
                value={account.champion}
                onChange={(event) =>
                  onChange(
                    replaceAt(accounts, accountIndex, {
                      ...account,
                      champion: event.target.value,
                    }),
                  )
                }
                placeholder="Champion"
              />
              <Input
                aria-label="Pipeline date surfaced"
                value={account.dateSurfaced}
                onChange={(event) =>
                  onChange(
                    replaceAt(accounts, accountIndex, {
                      ...account,
                      dateSurfaced: event.target.value,
                    }),
                  )
                }
                placeholder="YYYY-MM-DD"
              />
              <Input
                aria-label="Pipeline source session"
                value={account.sourceSession}
                onChange={(event) =>
                  onChange(
                    replaceAt(accounts, accountIndex, {
                      ...account,
                      sourceSession: event.target.value,
                    }),
                  )
                }
                className="col-span-2"
                placeholder="Source session"
              />
            </div>
            <Textarea
              aria-label="Pipeline urgency"
              value={account.urgency}
              onChange={(event) =>
                onChange(
                  replaceAt(accounts, accountIndex, {
                    ...account,
                    urgency: event.target.value,
                  }),
                )
              }
              className="mt-3 min-h-20"
              placeholder="Urgency and timing notes"
            />
          </div>
          <div className="grid gap-3 p-4">
            {account.layers.map((layer, layerIndex) => (
              <LayerEditor
                key={`${account.id}-${layerIndex}`}
                layer={layer}
                layerIndex={layerIndex}
                onChange={(nextLayer) => {
                  const nextLayers = replaceAt(
                    account.layers,
                    layerIndex,
                    nextLayer,
                  );
                  onChange(
                    replaceAt(accounts, accountIndex, {
                      ...account,
                      layers: nextLayers,
                    }),
                  );
                }}
              />
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function StrategicPipeline({
  opportunities,
  onChange,
  onAdd,
}: {
  opportunities: StrategicPipelineOpportunity[];
  onChange: (opportunities: StrategicPipelineOpportunity[]) => void;
  onAdd: () => void;
}) {
  if (opportunities.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <h4 className="text-sm font-semibold text-foreground">
          No strategic opportunities yet
        </h4>
        <Button type="button" size="sm" className="mt-3" onClick={onAdd}>
          Add opportunity
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={onAdd}>
          Add opportunity
        </Button>
      </div>
      {opportunities.map((opportunity, index) => (
        <article
          key={opportunity.id}
          className="rounded-md border border-border bg-card p-4"
        >
          <div className="grid grid-cols-[minmax(0,1fr)_160px_160px] gap-3">
            <Input
              aria-label="Strategic opportunity name"
              value={opportunity.name}
              onChange={(event) =>
                onChange(
                  replaceAt(opportunities, index, {
                    ...opportunity,
                    name: event.target.value,
                  }),
                )
              }
            />
            <Select
              value={opportunity.type}
              onValueChange={(value) =>
                onChange(
                  replaceAt(opportunities, index, {
                    ...opportunity,
                    type: value,
                  }),
                )
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Partner">Partner</SelectItem>
                <SelectItem value="New Customer">New Customer</SelectItem>
                <SelectItem value="Expansion">Expansion</SelectItem>
              </SelectContent>
            </Select>
            <StatusSelect
              value={opportunity.status}
              onChange={(status) =>
                onChange(
                  replaceAt(opportunities, index, { ...opportunity, status }),
                )
              }
            />
          </div>
          <div className="mt-3 grid grid-cols-4 gap-3">
            <Input
              aria-label="Strategic company"
              value={opportunity.company}
              onChange={(event) =>
                onChange(
                  replaceAt(opportunities, index, {
                    ...opportunity,
                    company: event.target.value,
                  }),
                )
              }
              placeholder="Company"
            />
            <Input
              aria-label="Strategic contact"
              value={opportunity.contact}
              onChange={(event) =>
                onChange(
                  replaceAt(opportunities, index, {
                    ...opportunity,
                    contact: event.target.value,
                  }),
                )
              }
              placeholder="Contact"
            />
            <Input
              aria-label="Strategic surfaced via"
              value={opportunity.surfacedVia}
              onChange={(event) =>
                onChange(
                  replaceAt(opportunities, index, {
                    ...opportunity,
                    surfacedVia: event.target.value,
                  }),
                )
              }
              className="col-span-2"
              placeholder="How surfaced"
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Textarea
              aria-label="Strategic rationale"
              value={opportunity.rationale}
              onChange={(event) =>
                onChange(
                  replaceAt(opportunities, index, {
                    ...opportunity,
                    rationale: event.target.value,
                  }),
                )
              }
              className="min-h-28"
              placeholder="Strategic rationale"
            />
            <Textarea
              aria-label="Strategic next steps"
              value={opportunity.nextSteps}
              onChange={(event) =>
                onChange(
                  replaceAt(opportunities, index, {
                    ...opportunity,
                    nextSteps: event.target.value,
                  }),
                )
              }
              className="min-h-28"
              placeholder="Next steps"
            />
          </div>
        </article>
      ))}
    </div>
  );
}

function LayerEditor({
  layer,
  layerIndex,
  onChange,
}: {
  layer: PipelineLayerDraft;
  layerIndex: number;
  onChange: (layer: PipelineLayerDraft) => void;
}) {
  const definition = LAYERS[layerIndex];

  return (
    <section className="rounded-md border border-border">
      <div className="flex items-start justify-between gap-3 border-b border-border bg-muted/20 p-3">
        <div>
          <Badge variant="outline">{definition?.label ?? "Layer"}</Badge>
          <p className="mt-2 text-xs text-muted-foreground">
            {definition?.description}
          </p>
        </div>
        <StatusSelect
          value={layer.status}
          onChange={(status) => onChange({ ...layer, status })}
        />
      </div>
      <div className="grid gap-3 p-3">
        <Input
          aria-label={`${definition?.label ?? "Layer"} instance name`}
          value={layer.instanceName}
          onChange={(event) =>
            onChange({ ...layer, instanceName: event.target.value })
          }
          placeholder="Name this specific opportunity"
        />
        <div className="grid grid-cols-2 gap-3">
          <Textarea
            aria-label={`${definition?.label ?? "Layer"} what we know`}
            value={layer.whatWeKnow}
            onChange={(event) =>
              onChange({ ...layer, whatWeKnow: event.target.value })
            }
            className="min-h-24"
            placeholder="What we know"
          />
          <Textarea
            aria-label={`${definition?.label ?? "Layer"} open questions`}
            value={layer.openQuestions}
            onChange={(event) =>
              onChange({ ...layer, openQuestions: event.target.value })
            }
            className="min-h-24"
            placeholder="Open questions and gaps"
          />
          <Textarea
            aria-label={`${definition?.label ?? "Layer"} business value`}
            value={layer.businessValue}
            onChange={(event) =>
              onChange({ ...layer, businessValue: event.target.value })
            }
            className="min-h-24"
            placeholder="Business value"
          />
          <Textarea
            aria-label={`${definition?.label ?? "Layer"} next steps`}
            value={layer.nextSteps}
            onChange={(event) =>
              onChange({ ...layer, nextSteps: event.target.value })
            }
            className="min-h-24"
            placeholder="Next steps"
          />
        </div>
      </div>
    </section>
  );
}

function StatusSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const normalized = LAYER_STATUSES.some((status) => status.value === value)
    ? value
    : "IDENTIFIED";
  return (
    <Select value={normalized} onValueChange={onChange}>
      <SelectTrigger className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LAYER_STATUSES.map((status) => (
          <SelectItem key={status.value} value={status.value}>
            {status.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PipelineTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "h-10 border-b-2 border-primary px-3 text-xs font-medium text-foreground"
          : "h-10 border-b-2 border-transparent px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
      }
    >
      {label}
    </button>
  );
}

function useCaseAccountsFromPayload(
  payload: Record<string, unknown> | undefined,
): UseCasePipelineAccount[] {
  const accounts = payload?.accounts;
  return Array.isArray(accounts) && accounts.length > 0
    ? accounts.map(coerceUseCaseAccount)
    : DEFAULT_USE_CASE_ACCOUNTS;
}

function strategicFromPayload(
  payload: Record<string, unknown> | undefined,
): StrategicPipelineOpportunity[] {
  const opportunities = payload?.opportunities;
  return Array.isArray(opportunities) && opportunities.length > 0
    ? opportunities.map(coerceStrategicOpportunity)
    : DEFAULT_STRATEGIC_OPPORTUNITIES;
}

function coerceUseCaseAccount(value: unknown): UseCasePipelineAccount {
  const input = objectRecord(value);
  const layers = Array.isArray(input.layers)
    ? input.layers.map(coerceLayerDraft)
    : newUseCaseAccount().layers;
  return {
    id: stringValue(input.id, crypto.randomUUID()),
    client: stringValue(input.client, ""),
    champion: stringValue(input.champion, ""),
    dateSurfaced: stringValue(input.dateSurfaced, ""),
    sourceSession: stringValue(input.sourceSession, ""),
    urgency: stringValue(input.urgency, ""),
    layers,
  };
}

function coerceLayerDraft(value: unknown): PipelineLayerDraft {
  const input = objectRecord(value);
  return {
    instanceName: stringValue(input.instanceName, ""),
    status: stringValue(input.status, "IDENTIFIED"),
    whatWeKnow: stringValue(input.whatWeKnow, ""),
    openQuestions: stringValue(input.openQuestions, ""),
    businessValue: stringValue(input.businessValue, ""),
    nextSteps: stringValue(input.nextSteps, ""),
  };
}

function coerceStrategicOpportunity(
  value: unknown,
): StrategicPipelineOpportunity {
  const input = objectRecord(value);
  return {
    id: stringValue(input.id, crypto.randomUUID()),
    name: stringValue(input.name, ""),
    type: stringValue(input.type, "New Customer"),
    company: stringValue(input.company, ""),
    contact: stringValue(input.contact, ""),
    surfacedVia: stringValue(input.surfacedVia, ""),
    status: stringValue(input.status, "IDENTIFIED"),
    rationale: stringValue(input.rationale, ""),
    whatWeKnow: stringValue(input.whatWeKnow, ""),
    whatWeNeed: stringValue(input.whatWeNeed, ""),
    nextSteps: stringValue(input.nextSteps, ""),
  };
}

function newUseCaseAccount(): UseCasePipelineAccount {
  return {
    id: crypto.randomUUID(),
    client: "New Client",
    champion: "",
    dateSurfaced: new Date().toISOString().slice(0, 10),
    sourceSession: "",
    urgency: "",
    layers: LAYERS.map(() => ({
      instanceName: "",
      status: "IDENTIFIED",
      whatWeKnow: "",
      openQuestions: "",
      businessValue: "",
      nextSteps: "",
    })),
  };
}

function newStrategicOpportunity(): StrategicPipelineOpportunity {
  return {
    id: crypto.randomUUID(),
    name: "New Strategic Opportunity",
    type: "New Customer",
    company: "",
    contact: "",
    surfacedVia: "",
    status: "IDENTIFIED",
    rationale: "",
    whatWeKnow: "",
    whatWeNeed: "",
    nextSteps: "",
  };
}

function replaceAt<T>(items: T[], index: number, next: T): T[] {
  return items.map((item, itemIndex) => (itemIndex === index ? next : item));
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
