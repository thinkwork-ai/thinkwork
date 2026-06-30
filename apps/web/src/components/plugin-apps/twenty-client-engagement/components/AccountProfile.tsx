import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@thinkwork/ui";

import type {
  EngagementAccount,
  EngagementStakeholder,
} from "../data/useTwentyEngagementData";
import { OpportunityList } from "./OpportunityList";

const STAKEHOLDER_ROLES = [
  "Executive Sponsor",
  "Technical Champion",
  "Economic Decision Maker",
  "Internal Advocate",
  "DBA / Data",
  "Network / Cloud",
  "Finance",
  "Operations",
  "Other",
];

const ADVOCATE_STATUSES = [
  "Unknown",
  "Potential champion",
  "Champion",
  "Blocker",
  "Neutral",
];

type StakeholderDraft = {
  id: string | null;
  name: string;
  title: string;
  department: string;
  role: string;
  email: string;
};

type AccountOverlay = {
  companyName?: string;
  industry?: string;
  primarySystem?: string;
  companySize?: string;
  headquarters?: string;
  departments?: string;
  summary?: string;
  technicalChampion?: {
    name?: string;
    title?: string;
    budget?: string;
    needs?: string;
  };
  advocates?: Array<{
    name?: string;
    role?: string;
    concern?: string;
    status?: string;
  }>;
  economicDecisionMakers?: Array<{
    name?: string;
    cares?: string;
    sees?: string;
  }>;
};

export function AccountProfile({
  account,
  overlay,
  onSaveOverlay,
  onSaveStakeholder,
  onSelectOpportunity,
}: {
  account: EngagementAccount;
  overlay: Record<string, unknown>;
  onSaveOverlay: (payload: Record<string, unknown>) => Promise<unknown>;
  onSaveStakeholder: (input: {
    stakeholderId?: string | null;
    companyId: string;
    name: string;
    title?: string | null;
    department?: string | null;
    role?: string | null;
    email?: string | null;
  }) => Promise<unknown>;
  onSelectOpportunity: (opportunityId: string) => void;
}) {
  const [activeTab, setActiveTab] = useState("profile");
  const metrics = accountMetrics(account);
  const displayName = account.company.name;
  const overlayValue = useMemo(() => normalizeOverlay(overlay), [overlay]);
  const [profile, setProfile] = useState<AccountOverlay>(overlayValue);
  const [stakeholders, setStakeholders] = useState<StakeholderDraft[]>(
    stakeholderDrafts(account.stakeholders),
  );

  useEffect(() => {
    setProfile(overlayValue);
  }, [overlayValue]);

  useEffect(() => {
    setStakeholders(stakeholderDrafts(account.stakeholders));
  }, [account.stakeholders]);

  const saveProfile = async (next: AccountOverlay) => {
    setProfile(next);
    await onSaveOverlay(next as Record<string, unknown>);
  };
  const updateProfile = (patch: Partial<AccountOverlay>) => {
    setProfile((current) => ({ ...current, ...patch }));
  };
  const persistProfilePatch = (patch: Partial<AccountOverlay>) =>
    saveProfile({ ...profile, ...patch });

  return (
    <div className="min-h-full">
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="min-h-0"
      >
        <div>
          <div className="grid gap-3 px-6 py-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center">
            <h2 className="min-w-0 truncate text-2xl font-semibold tracking-tight text-foreground">
              {displayName}
            </h2>
            <TabsList>
              <TabsTrigger
                value="profile"
                className="px-3"
                onClick={() => setActiveTab("profile")}
              >
                Account Profile
              </TabsTrigger>
              <TabsTrigger
                value="opportunities"
                className="px-3"
                onClick={() => setActiveTab("opportunities")}
              >
                Opportunities ({metrics.opportunities})
              </TabsTrigger>
            </TabsList>
            <div className="hidden md:block" aria-hidden="true" />
          </div>
        </div>

        <TabsContent value="profile" className="mt-0 px-6 pb-5 pt-2">
          <div className="space-y-5">
            <Section number="01" title="Client Profile">
              <div className="grid gap-4 md:grid-cols-2">
                <EditableField
                  label="Company name"
                  value={profile.companyName ?? displayName}
                  onChange={(companyName) => updateProfile({ companyName })}
                  onSave={(companyName) => persistProfilePatch({ companyName })}
                />
                <EditableField
                  label="Industry"
                  value={profile.industry ?? ""}
                  placeholder="Oil & Gas / Petroleum Distribution"
                  onChange={(industry) => updateProfile({ industry })}
                  onSave={(industry) => persistProfilePatch({ industry })}
                />
                <EditableField
                  label="Primary ERP / System"
                  value={profile.primarySystem ?? ""}
                  placeholder="JD Edwards (Oracle 19c)"
                  onChange={(primarySystem) => updateProfile({ primarySystem })}
                  onSave={(primarySystem) =>
                    persistProfilePatch({ primarySystem })
                  }
                />
                <EditableField
                  label="Company size (employees)"
                  value={profile.companySize ?? ""}
                  placeholder="Mid-Market"
                  onChange={(companySize) => updateProfile({ companySize })}
                  onSave={(companySize) => persistProfilePatch({ companySize })}
                />
                <EditableField
                  label="Headquarters / Location"
                  value={profile.headquarters ?? ""}
                  placeholder="Birmingham, AL"
                  onChange={(headquarters) => updateProfile({ headquarters })}
                  onSave={(headquarters) =>
                    persistProfilePatch({ headquarters })
                  }
                />
                <EditableField
                  label="Departments in scope"
                  value={profile.departments ?? ""}
                  placeholder="Finance, IT, Operations"
                  onChange={(departments) => updateProfile({ departments })}
                  onSave={(departments) => persistProfilePatch({ departments })}
                />
                <div className="md:col-span-2">
                  <FieldLabel>Engagement summary / context</FieldLabel>
                  <Textarea
                    value={profile.summary ?? ""}
                    placeholder="Key background, commitments, urgency anchors..."
                    className="min-h-24"
                    onChange={(event) =>
                      updateProfile({ summary: event.target.value })
                    }
                    onBlur={(event) =>
                      persistProfilePatch({ summary: event.target.value })
                    }
                  />
                </div>
              </div>
            </Section>

            <Section
              number="02"
              title="Stakeholder Roster"
              action={
                <span className="text-xs text-muted-foreground">
                  Saves to Twenty CRM
                </span>
              }
            >
              <div className="overflow-x-auto">
                <div className="grid min-w-[960px] grid-cols-[1fr_1fr_1fr_1.1fr_1.1fr_auto] gap-3 px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <div>Name</div>
                  <div>Title</div>
                  <div>Department</div>
                  <div>Role</div>
                  <div>Email / Contact</div>
                  <div />
                </div>
                <div className="space-y-2">
                  {stakeholders.map((stakeholder, index) => (
                    <div
                      key={stakeholder.id ?? `draft-${index}`}
                      className="grid min-w-[960px] grid-cols-[1fr_1fr_1fr_1.1fr_1.1fr_auto] gap-3"
                    >
                      <Input
                        value={stakeholder.name}
                        placeholder="Name"
                        onChange={(event) =>
                          setStakeholder(index, { name: event.target.value })
                        }
                        onBlur={() => persistStakeholder(index)}
                      />
                      <Input
                        value={stakeholder.title}
                        placeholder="Title"
                        onChange={(event) =>
                          setStakeholder(index, { title: event.target.value })
                        }
                        onBlur={() => persistStakeholder(index)}
                      />
                      <Input
                        value={stakeholder.department}
                        placeholder="Department"
                        onChange={(event) =>
                          setStakeholder(index, {
                            department: event.target.value,
                          })
                        }
                        onBlur={() => persistStakeholder(index)}
                      />
                      <Select
                        value={stakeholder.role || "Other"}
                        onValueChange={(role) => {
                          setStakeholder(index, { role });
                          void persistStakeholder(index, { role });
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STAKEHOLDER_ROLES.map((role) => (
                            <SelectItem key={role} value={role}>
                              {role}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        value={stakeholder.email}
                        placeholder="email@company.com"
                        onChange={(event) =>
                          setStakeholder(index, { email: event.target.value })
                        }
                        onBlur={() => persistStakeholder(index)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remove stakeholder row"
                        onClick={() =>
                          setStakeholders((current) =>
                            current.filter((_, rowIndex) => rowIndex !== index),
                          )
                        }
                      >
                        x
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() =>
                  setStakeholders((current) => [
                    ...current,
                    {
                      id: null,
                      name: "",
                      title: "",
                      department: "",
                      role: "Other",
                      email: "",
                    },
                  ])
                }
              >
                + Add Stakeholder
              </Button>
            </Section>

            <Section number="03" title="Decision Maker Map">
              <div className="grid gap-4 lg:grid-cols-3">
                <DecisionCard title="Technical Champion">
                  <EditableField
                    label="Name"
                    value={profile.technicalChampion?.name ?? ""}
                    onChange={(name) =>
                      updateProfile({
                        technicalChampion: {
                          ...profile.technicalChampion,
                          name,
                        },
                      })
                    }
                    onSave={(name) =>
                      persistProfilePatch({
                        technicalChampion: {
                          ...profile.technicalChampion,
                          name,
                        },
                      })
                    }
                  />
                  <EditableField
                    label="Title"
                    value={profile.technicalChampion?.title ?? ""}
                    onChange={(title) =>
                      updateProfile({
                        technicalChampion: {
                          ...profile.technicalChampion,
                          title,
                        },
                      })
                    }
                    onSave={(title) =>
                      persistProfilePatch({
                        technicalChampion: {
                          ...profile.technicalChampion,
                          title,
                        },
                      })
                    }
                  />
                  <EditableField
                    label="Budget authority"
                    value={profile.technicalChampion?.budget ?? ""}
                    onChange={(budget) =>
                      updateProfile({
                        technicalChampion: {
                          ...profile.technicalChampion,
                          budget,
                        },
                      })
                    }
                    onSave={(budget) =>
                      persistProfilePatch({
                        technicalChampion: {
                          ...profile.technicalChampion,
                          budget,
                        },
                      })
                    }
                  />
                  <FieldLabel>What they need to win internally</FieldLabel>
                  <Textarea
                    value={profile.technicalChampion?.needs ?? ""}
                    className="min-h-24"
                    onChange={(event) =>
                      updateProfile({
                        technicalChampion: {
                          ...profile.technicalChampion,
                          needs: event.target.value,
                        },
                      })
                    }
                    onBlur={(event) =>
                      persistProfilePatch({
                        technicalChampion: {
                          ...profile.technicalChampion,
                          needs: event.target.value,
                        },
                      })
                    }
                  />
                </DecisionCard>

                <DecisionCard title="Internal Advocates">
                  {(profile.advocates?.length ? profile.advocates : [{}]).map(
                    (advocate, index) => (
                      <div key={index} className="space-y-2 rounded-md border border-border p-3">
                        <EditableField
                          label="Name"
                          value={advocate.name ?? ""}
                          onChange={(name) =>
                            updateAdvocate(index, { name })
                          }
                          onSave={(name) =>
                            persistAdvocate(index, { name })
                          }
                        />
                        <EditableField
                          label="Role"
                          value={advocate.role ?? ""}
                          onChange={(role) =>
                            updateAdvocate(index, { role })
                          }
                          onSave={(role) =>
                            persistAdvocate(index, { role })
                          }
                        />
                        <EditableField
                          label="Concern / what they need"
                          value={advocate.concern ?? ""}
                          onChange={(concern) =>
                            updateAdvocate(index, { concern })
                          }
                          onSave={(concern) =>
                            persistAdvocate(index, { concern })
                          }
                        />
                        <Select
                          value={advocate.status ?? "Unknown"}
                          onValueChange={(status) =>
                            void persistAdvocate(index, { status })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ADVOCATE_STATUSES.map((status) => (
                              <SelectItem key={status} value={status}>
                                {status}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ),
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      saveProfile({
                        ...profile,
                        advocates: [...(profile.advocates ?? []), {}],
                      })
                    }
                  >
                    + Add Advocate
                  </Button>
                </DecisionCard>

                <DecisionCard title="Economic Decision Makers">
                  {(
                    profile.economicDecisionMakers?.length
                      ? profile.economicDecisionMakers
                      : [{}]
                  ).map((maker, index) => (
                    <div key={index} className="space-y-2 rounded-md border border-border p-3">
                      <EditableField
                        label="Name / Title"
                        value={maker.name ?? ""}
                        onChange={(name) => updateDecisionMaker(index, { name })}
                        onSave={(name) => persistDecisionMaker(index, { name })}
                      />
                      <EditableField
                        label="What they care about"
                        value={maker.cares ?? ""}
                        onChange={(cares) =>
                          updateDecisionMaker(index, { cares })
                        }
                        onSave={(cares) =>
                          persistDecisionMaker(index, { cares })
                        }
                      />
                      <EditableField
                        label="How they'll see this decision"
                        value={maker.sees ?? ""}
                        onChange={(sees) =>
                          updateDecisionMaker(index, { sees })
                        }
                        onSave={(sees) =>
                          persistDecisionMaker(index, { sees })
                        }
                      />
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      saveProfile({
                        ...profile,
                        economicDecisionMakers: [
                          ...(profile.economicDecisionMakers ?? []),
                          {},
                        ],
                      })
                    }
                  >
                    + Add Decision Maker
                  </Button>
                </DecisionCard>
              </div>
            </Section>
          </div>
        </TabsContent>

        <TabsContent value="opportunities" className="mt-0 px-6 pb-5 pt-2">
          <OpportunityList
            opportunities={account.opportunities}
            onSelectOpportunity={onSelectOpportunity}
          />
        </TabsContent>
      </Tabs>
    </div>
  );

  function setStakeholder(index: number, patch: Partial<StakeholderDraft>) {
    setStakeholders((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  }

  async function persistStakeholder(
    index: number,
    patch: Partial<StakeholderDraft> = {},
  ) {
    const row = { ...stakeholders[index], ...patch };
    if (!row.name.trim()) return;
    await onSaveStakeholder({
      stakeholderId: row.id,
      companyId: account.company.id,
      name: row.name,
      title: row.title || null,
      department: row.department || null,
      role: row.role || null,
      email: row.email || null,
    });
  }

  function updateAdvocate(
    index: number,
    patch: NonNullable<AccountOverlay["advocates"]>[number],
  ) {
    const advocates = updateArray(profile.advocates, index, patch);
    setProfile({ ...profile, advocates });
  }

  function persistAdvocate(
    index: number,
    patch: NonNullable<AccountOverlay["advocates"]>[number],
  ) {
    const advocates = updateArray(profile.advocates, index, patch);
    return saveProfile({ ...profile, advocates });
  }

  function updateDecisionMaker(
    index: number,
    patch: NonNullable<AccountOverlay["economicDecisionMakers"]>[number],
  ) {
    const economicDecisionMakers = updateArray(
      profile.economicDecisionMakers,
      index,
      patch,
    );
    setProfile({ ...profile, economicDecisionMakers });
  }

  function persistDecisionMaker(
    index: number,
    patch: NonNullable<AccountOverlay["economicDecisionMakers"]>[number],
  ) {
    const economicDecisionMakers = updateArray(
      profile.economicDecisionMakers,
      index,
      patch,
    );
    return saveProfile({ ...profile, economicDecisionMakers });
  }
}

function Section({
  number,
  title,
  action,
  children,
}: {
  number: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-primary">
          {number} {title}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function DecisionCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-background/40 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

function EditableField({
  label,
  value,
  placeholder,
  onChange,
  onSave,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onSave: (value: string) => void | Promise<void>;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <Input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => void onSave(event.target.value)}
      />
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

function stakeholderDrafts(
  stakeholders: EngagementStakeholder[],
): StakeholderDraft[] {
  const drafts = stakeholders.map((stakeholder) => ({
    id: stakeholder.id,
    name: stakeholder.name,
    title: stakeholder.title ?? "",
    department: stakeholder.department ?? "",
    role: stakeholder.role ?? "Other",
    email: stakeholder.email ?? "",
  }));
  return drafts.length > 0
    ? drafts
    : [
        {
          id: null,
          name: "",
          title: "",
          department: "",
          role: "Other",
          email: "",
        },
      ];
}

function normalizeOverlay(value: Record<string, unknown>): AccountOverlay {
  return value as AccountOverlay;
}

function updateArray<T extends Record<string, unknown>>(
  value: T[] | undefined,
  index: number,
  patch: Partial<T>,
): T[] {
  const next = value && value.length > 0 ? [...value] : ([{}] as T[]);
  next[index] = { ...(next[index] ?? ({} as T)), ...patch };
  return next;
}

function accountMetrics(account: EngagementAccount) {
  return {
    opportunities: account.opportunities.length,
    mappedLayers: account.opportunities.reduce(
      (total, item) => total + item.layers.length,
      0,
    ),
    readyLayers: account.opportunities.reduce(
      (total, item) =>
        total +
        item.layers.filter(
          (layer) =>
            layer.layerStatus === "READY_FOR_SOW" ||
            layer.layerStatus === "APPROVED",
        ).length,
      0,
    ),
  };
}
