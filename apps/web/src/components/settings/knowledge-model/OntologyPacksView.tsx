import { useState } from "react";
import { useMutation, useQuery } from "urql";
import { Loader2 } from "lucide-react";
import { Badge, Button } from "@thinkwork/ui";
import {
  OntologyChangeSetStatus,
  OntologyPackTypeState,
  type SettingsOntologyPacksQuery as SettingsOntologyPacksData,
} from "@/gql/graphql";
import {
  SettingsInstallOntologyPackMutation,
  SettingsOntologyPacksQuery,
} from "@/lib/settings-queries";
import { useTenant } from "@/context/TenantContext";
import type { OntologyFocus } from "./OntologyCandidateSheet";

type OntologyPackCard = SettingsOntologyPacksData["ontologyPacks"][number];

/** AWSJSON dual wire shape (THINK-188): object via Yoga, string via AppSync. */
function parseAwsJson(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

const STATE_BADGES: Record<
  OntologyPackTypeState,
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  [OntologyPackTypeState.Approved]: { label: "approved", variant: "default" },
  [OntologyPackTypeState.Pending]: { label: "pending", variant: "secondary" },
  [OntologyPackTypeState.Available]: {
    label: "available",
    variant: "outline",
  },
};

/**
 * Starter-pack browser (THINK-320 U7, R11): a card per seed-template bundle
 * with per-type install state from the ontologyPacks query. Install stages
 * the pack as a pending change set through the governed path and hands the
 * first staged candidate to the host so review opens in the Living Map's
 * rail/sheet flow (AE4) — nothing applies without approval.
 */
export function OntologyPacksView({
  onOpenChangeSet,
}: {
  /** Focus the staged change set in the map's review flow after install. */
  onOpenChangeSet: (focus: OntologyFocus) => void;
}) {
  const { tenantId } = useTenant();
  const effectiveTenantId = tenantId ?? null;

  const [packsResult, reexecutePacks] = useQuery({
    query: SettingsOntologyPacksQuery,
    variables: { tenantId: effectiveTenantId ?? "" },
    pause: !effectiveTenantId,
  });
  const [, installPack] = useMutation(SettingsInstallOntologyPackMutation);

  const [installingSlug, setInstallingSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const packs = packsResult.data?.ontologyPacks ?? [];

  const install = async (pack: OntologyPackCard) => {
    if (!effectiveTenantId || installingSlug) return;
    setInstallingSlug(pack.slug);
    setError(null);
    setNotice(null);
    try {
      const result = await installPack({
        input: { tenantId: effectiveTenantId, packSlug: pack.slug },
      });
      if (result.error) {
        setError(result.error.message);
        return;
      }
      const payload = result.data?.installOntologyPack;
      const changeSet = payload?.changeSet ?? null;
      const firstPending =
        changeSet?.items.find(
          (item) => item.status === OntologyChangeSetStatus.PendingReview,
        ) ??
        changeSet?.items[0] ??
        null;
      if (changeSet && firstPending) {
        const value = parseAwsJson(firstPending.proposedValue);
        onOpenChangeSet({
          kind: "candidate",
          itemId: firstPending.id,
          changeSetId: changeSet.id,
          label:
            (typeof value.name === "string" && value.name) ||
            firstPending.title ||
            firstPending.targetSlug ||
            pack.name,
        });
        return;
      }
      // Nothing new staged: every item merged into other pending work,
      // conflicted, or was skipped by a rejection fingerprint (R13/R14).
      const skipped = payload?.skippedRejectedSlugs.length ?? 0;
      setNotice(
        skipped > 0
          ? `Nothing new to review — ${skipped} previously rejected ${
              skipped === 1 ? "type stays" : "types stay"
            } excluded.`
          : "Nothing new to review — this pack's types are already approved or pending.",
      );
      reexecutePacks({ requestPolicy: "network-only" });
    } finally {
      setInstallingSlug(null);
    }
  };

  if (!effectiveTenantId) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Loading tenant...
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      {error ? (
        <p className="text-destructive mb-3 text-sm" role="alert">
          Failed to install pack: {error}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="border-border bg-muted/30 mb-3 rounded-md border px-3 py-2 text-sm"
        >
          {notice}
        </p>
      ) : null}

      {packsResult.fetching && !packsResult.data ? (
        <div className="text-muted-foreground flex items-center gap-2 p-2 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading packs...
        </div>
      ) : packsResult.error ? (
        <p className="text-destructive text-sm" role="alert">
          Failed to load packs: {packsResult.error.message}
        </p>
      ) : (
        <ul
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
          aria-label="Ontology starter packs"
        >
          {packs.map((pack) => {
            const allSettled = pack.types.every(
              (type) => type.state !== OntologyPackTypeState.Available,
            );
            const installing = installingSlug === pack.slug;
            return (
              <li
                key={pack.slug}
                className="border-border flex flex-col rounded-lg border p-4"
              >
                <h3 className="text-sm font-semibold">{pack.name}</h3>
                <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                  {pack.description}
                </p>
                <ul
                  className="mt-3 flex flex-1 flex-wrap content-start items-start gap-1.5"
                  aria-label={`${pack.name} types`}
                >
                  {pack.types.map((type) => {
                    const badge = STATE_BADGES[type.state];
                    return (
                      <li key={type.slug} className="inline-flex">
                        <Badge
                          variant={badge.variant}
                          className="gap-1 font-normal"
                        >
                          {type.name}
                          <span className="opacity-70">· {badge.label}</span>
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-4">
                  <Button
                    size="sm"
                    variant={allSettled ? "outline" : "default"}
                    disabled={installingSlug !== null || allSettled}
                    onClick={() => install(pack)}
                    aria-label={`Install ${pack.name}`}
                  >
                    {installing ? (
                      <Loader2
                        className="mr-1 size-3.5 animate-spin"
                        aria-hidden
                      />
                    ) : null}
                    {allSettled ? "Installed" : "Install"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
