import { useEffect, useRef } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import {
  SettingsCapabilities,
  type ComposerSheetId,
} from "@/components/settings/SettingsCapabilities";

// Settings → Agent (THINK-132 U7): this route IS the Composer surface — the
// single agent-configuration page. Sheet identity and target are URL state
// (KTD-1) so profile deep links, refresh, and Back behave consistently:
//   ?sheet=config|profiles|extensions|inspector, ?profile=<id>, ?focus=<row>.
// The legacy `?view=workspace&file=…` grace shape and its redirect routes were
// removed in U10; only the sheet/profile/focus params remain.

const SHEET_IDS = ["config", "profiles", "extensions", "inspector"] as const;

export type SettingsAgentsSearch = {
  sheet?: ComposerSheetId;
  /** Profiles-sheet target (used by the $profileId redirect + deep links). */
  profile?: string;
  /** Inspector row focus (gate-badge deep links). */
  focus?: string;
};

export const Route = createFileRoute("/_authed/settings/agents/")({
  validateSearch: (search: Record<string, unknown>): SettingsAgentsSearch => ({
    sheet: SHEET_IDS.includes(search.sheet as ComposerSheetId)
      ? (search.sheet as ComposerSheetId)
      : undefined,
    profile: typeof search.profile === "string" ? search.profile : undefined,
    focus: typeof search.focus === "string" ? search.focus : undefined,
  }),
  component: AgentPage,
});

function AgentPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  // Deep-link history normalization (KTD-1): arriving with sheet params as
  // the FIRST entry would make Back leave the page instead of closing the
  // sheet. Replace with the sheet-less URL, then push the sheet params back,
  // so Back always lands on the page with the sheet closed (AE2).
  const normalized = useRef(false);
  useEffect(() => {
    if (normalized.current) return;
    normalized.current = true;
    if (!search.sheet) return;
    const { sheet, profile, focus, ...rest } = search;
    void navigate({
      to: "/settings/agents",
      search: rest,
      replace: true,
    }).then(() =>
      navigate({
        to: "/settings/agents",
        search: { ...rest, sheet, profile, focus },
        replace: false,
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <OperatorGuard>
      <SettingsCapabilities
        urlSheet={search.sheet ?? null}
        urlProfileId={search.profile ?? null}
        urlFocus={search.focus ?? null}
        onUrlSheetChange={(sheet, target) =>
          void navigate({
            to: "/settings/agents",
            search: {
              ...search,
              sheet: sheet ?? undefined,
              profile:
                sheet === "profiles"
                  ? (target?.profileId ?? undefined)
                  : undefined,
              focus:
                sheet === "inspector"
                  ? (target?.focus ?? undefined)
                  : undefined,
            },
            // Opening pushes a history entry (Back closes the sheet);
            // closing replaces so the stack doesn't accumulate.
            replace: sheet == null,
          })
        }
      />
    </OperatorGuard>
  );
}
