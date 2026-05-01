import React, { useMemo, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import Markdown from "react-native-markdown-display";
import { CheckCircle2, ExternalLink, XCircle } from "lucide-react-native";
import type {
  BrainEnrichmentDraftPage,
  BrainEnrichmentDraftRegion,
} from "@thinkwork/react-native-sdk";
import { Muted, Text } from "@/components/ui/typography";
import type { COLORS } from "@/lib/theme";
import {
  parseDraftSections,
  regionFamilyLabel,
  type ParsedDraftSection,
} from "@/lib/brain-enrichment-draft-review";

interface BrainEnrichmentDraftReviewPanelProps {
  payload: BrainEnrichmentDraftPage;
  colors: (typeof COLORS)["dark"];
  acceptedRegionIds: string[];
  onAcceptedRegionIdsChange: (ids: string[]) => void;
  showChanges: boolean;
  onShowChangesChange: (b: boolean) => void;
  note: string;
  onNoteChange: (value: string) => void;
  showNote?: boolean;
  footer?: React.ReactNode;
}

export function BrainEnrichmentDraftReviewPanel({
  payload,
  colors,
  acceptedRegionIds,
  onAcceptedRegionIdsChange,
  showChanges,
  onShowChangesChange,
  note,
  onNoteChange,
  showNote = true,
  footer,
}: BrainEnrichmentDraftReviewPanelProps) {
  const sections = useMemo(
    () => parseDraftSections(payload.proposedBodyMd),
    [payload.proposedBodyMd],
  );
  const regionsBySlug = useMemo(
    () => new Map(payload.regions.map((r) => [r.sectionSlug, r])),
    [payload.regions],
  );
  const acceptedSet = useMemo(
    () => new Set(acceptedRegionIds),
    [acceptedRegionIds],
  );

  const toggleRegion = (regionId: string) => {
    const next = new Set(acceptedSet);
    if (next.has(regionId)) next.delete(regionId);
    else next.add(regionId);
    onAcceptedRegionIdsChange([...next]);
  };

  const noChanges = payload.regions.length === 0;

  return (
    <View style={{ gap: 14 }}>
      <ToggleRow
        showChanges={showChanges}
        onShowChangesChange={onShowChangesChange}
        regionCount={payload.regions.length}
        colors={colors}
      />

      {noChanges ? (
        <View
          className="rounded-md p-4"
          style={{
            backgroundColor: colors.secondary,
            borderColor: colors.border,
            borderWidth: 1,
          }}
        >
          <Muted style={{ lineHeight: 20 }}>
            No enrichment landed — the draft compile concluded the page already
            covers all the new facts.
          </Muted>
        </View>
      ) : showChanges ? (
        <DiffView
          regions={payload.regions}
          acceptedSet={acceptedSet}
          onToggleRegion={toggleRegion}
          colors={colors}
        />
      ) : (
        <InPlaceView
          sections={sections}
          regionsBySlug={regionsBySlug}
          acceptedSet={acceptedSet}
          onToggleRegion={toggleRegion}
          colors={colors}
        />
      )}

      {showNote ? (
        <TextInput
          value={note}
          onChangeText={onNoteChange}
          placeholder="Review note"
          placeholderTextColor={colors.mutedForeground}
          multiline
          textAlignVertical="top"
          style={{
            minHeight: 84,
            color: colors.foreground,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 10,
            backgroundColor: colors.secondary,
          }}
        />
      ) : null}

      {footer}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ToggleRow({
  showChanges,
  onShowChangesChange,
  regionCount,
  colors,
}: {
  showChanges: boolean;
  onShowChangesChange: (b: boolean) => void;
  regionCount: number;
  colors: BrainEnrichmentDraftReviewPanelProps["colors"];
}) {
  return (
    <View
      className="flex-row items-center justify-between rounded-full px-3 py-1.5"
      style={{
        backgroundColor: colors.secondary,
        borderColor: colors.border,
        borderWidth: 1,
      }}
    >
      <Muted style={{ fontSize: 12 }}>
        {regionCount === 0
          ? "No changes"
          : regionCount === 1
            ? "1 region"
            : `${regionCount} regions`}
      </Muted>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          showChanges ? "Switch to in-place view" : "Show changes"
        }
        onPress={() => onShowChangesChange(!showChanges)}
        className="rounded-full px-2.5 py-1"
        style={{
          backgroundColor: showChanges ? colors.primary : "transparent",
        }}
      >
        <Text
          style={{
            color: showChanges ? colors.background : colors.foreground,
            fontSize: 12,
            fontWeight: "600",
          }}
        >
          {showChanges ? "In-place" : "Show changes"}
        </Text>
      </Pressable>
    </View>
  );
}

function InPlaceView({
  sections,
  regionsBySlug,
  acceptedSet,
  onToggleRegion,
  colors,
}: {
  sections: ParsedDraftSection[];
  regionsBySlug: Map<string, BrainEnrichmentDraftRegion>;
  acceptedSet: Set<string>;
  onToggleRegion: (id: string) => void;
  colors: BrainEnrichmentDraftReviewPanelProps["colors"];
}) {
  if (sections.length === 0) {
    return (
      <Muted style={{ paddingHorizontal: 4 }}>
        Proposed page is empty.
      </Muted>
    );
  }
  return (
    <View style={{ gap: 12 }}>
      {sections.map((section) => {
        const region = regionsBySlug.get(section.slug);
        const accepted = region ? acceptedSet.has(region.id) : true;
        return (
          <SectionBlock
            key={section.slug}
            section={section}
            region={region ?? null}
            accepted={accepted}
            onToggle={
              region ? () => onToggleRegion(region.id) : undefined
            }
            colors={colors}
          />
        );
      })}
    </View>
  );
}

function SectionBlock({
  section,
  region,
  accepted,
  onToggle,
  colors,
}: {
  section: ParsedDraftSection;
  region: BrainEnrichmentDraftRegion | null;
  accepted: boolean;
  onToggle?: () => void;
  colors: BrainEnrichmentDraftReviewPanelProps["colors"];
}) {
  const highlightTint = region
    ? accepted
      ? hexWithAlpha(familyTint(region.sourceFamily, colors), 0.12)
      : hexWithAlpha(colors.destructive ?? "#ef4444", 0.1)
    : "transparent";
  const borderColor = region
    ? accepted
      ? familyTint(region.sourceFamily, colors)
      : colors.destructive ?? "#ef4444"
    : colors.border;

  const heading =
    section.slug === "_preamble" || !section.heading
      ? null
      : section.heading;

  return (
    <Pressable
      accessibilityRole={region ? "button" : undefined}
      accessibilityLabel={
        region
          ? `${accepted ? "Reject" : "Accept"} ${section.heading || "(preamble)"} change`
          : undefined
      }
      onPress={onToggle}
      disabled={!region}
      className="rounded-md p-3"
      style={{
        backgroundColor: highlightTint,
        borderWidth: 1,
        borderColor,
        gap: 8,
      }}
    >
      {region ? (
        <RegionBadgeRow region={region} accepted={accepted} colors={colors} />
      ) : null}
      {heading ? (
        <Text
          style={{
            color: colors.foreground,
            fontSize: 16,
            fontWeight: "700",
          }}
        >
          {heading}
        </Text>
      ) : null}
      <View>
        <Markdown
          style={{
            body: { color: colors.foreground, fontSize: 14, lineHeight: 22 },
            paragraph: { marginTop: 0, marginBottom: 8 },
          }}
        >
          {section.bodyMd || "_(empty section)_"}
        </Markdown>
      </View>
    </Pressable>
  );
}

function RegionBadgeRow({
  region,
  accepted,
  colors,
}: {
  region: BrainEnrichmentDraftRegion;
  accepted: boolean;
  colors: BrainEnrichmentDraftReviewPanelProps["colors"];
}) {
  const tint = familyTint(region.sourceFamily, colors);
  return (
    <View className="flex-row items-center" style={{ gap: 8, flexWrap: "wrap" }}>
      <View
        className="flex-row items-center rounded-full px-2 py-0.5"
        style={{ backgroundColor: hexWithAlpha(tint, 0.18), gap: 4 }}
      >
        {accepted ? (
          <CheckCircle2 size={12} color={tint} />
        ) : (
          <XCircle size={12} color={colors.destructive ?? "#ef4444"} />
        )}
        <Text style={{ color: tint, fontSize: 11, fontWeight: "700" }}>
          {regionFamilyLabel(region.sourceFamily)}
        </Text>
      </View>
      {region.citation?.uri || region.citation?.label ? (
        <View className="flex-row items-center" style={{ gap: 4, flex: 1 }}>
          <ExternalLink size={11} color={colors.mutedForeground} />
          <Muted numberOfLines={1} style={{ flex: 1, fontSize: 11 }}>
            {region.citation.label ?? region.citation.uri ?? ""}
          </Muted>
        </View>
      ) : null}
      <Text
        style={{
          color: accepted ? tint : colors.destructive ?? "#ef4444",
          fontSize: 11,
          fontWeight: "700",
        }}
      >
        {accepted ? "Accepted" : "Rejected"}
      </Text>
    </View>
  );
}

function DiffView({
  regions,
  acceptedSet,
  onToggleRegion,
  colors,
}: {
  regions: BrainEnrichmentDraftRegion[];
  acceptedSet: Set<string>;
  onToggleRegion: (id: string) => void;
  colors: BrainEnrichmentDraftReviewPanelProps["colors"];
}) {
  return (
    <View style={{ gap: 12 }}>
      {regions.map((region) => {
        const accepted = acceptedSet.has(region.id);
        return (
          <View
            key={region.id}
            className="rounded-md"
            style={{
              borderWidth: 1,
              borderColor: accepted
                ? familyTint(region.sourceFamily, colors)
                : colors.destructive ?? "#ef4444",
              gap: 0,
              overflow: "hidden",
            }}
          >
            <View className="px-3 py-2" style={{ backgroundColor: colors.secondary }}>
              <RegionBadgeRow
                region={region}
                accepted={accepted}
                colors={colors}
              />
              <Text
                style={{
                  color: colors.foreground,
                  fontSize: 14,
                  fontWeight: "700",
                  marginTop: 4,
                }}
              >
                {region.sectionHeading || "(preamble)"}
              </Text>
            </View>
            <DiffPane
              label="Before"
              bodyMd={region.beforeMd}
              colors={colors}
              tone="muted"
            />
            <DiffPane
              label="After"
              bodyMd={region.afterMd}
              colors={colors}
              tone="emphasized"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                accepted
                  ? `Reject ${region.sectionHeading} change`
                  : `Accept ${region.sectionHeading} change`
              }
              onPress={() => onToggleRegion(region.id)}
              className="px-3 py-2"
              style={{ backgroundColor: colors.background, alignItems: "center" }}
            >
              <Text
                style={{
                  color: accepted
                    ? colors.destructive ?? "#ef4444"
                    : colors.primary,
                  fontWeight: "600",
                  fontSize: 13,
                }}
              >
                {accepted ? "Reject change" : "Accept change"}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

function DiffPane({
  label,
  bodyMd,
  colors,
  tone,
}: {
  label: string;
  bodyMd: string;
  colors: BrainEnrichmentDraftReviewPanelProps["colors"];
  tone: "muted" | "emphasized";
}) {
  return (
    <View
      className="px-3 py-2"
      style={{
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor:
          tone === "muted" ? "transparent" : hexWithAlpha(colors.primary, 0.06),
      }}
    >
      <Muted style={{ fontSize: 11, textTransform: "uppercase", marginBottom: 4 }}>
        {label}
      </Muted>
      {bodyMd.trim() ? (
        <Markdown
          style={{
            body: {
              color: tone === "muted" ? colors.mutedForeground : colors.foreground,
              fontSize: 13,
              lineHeight: 20,
            },
            paragraph: { marginTop: 0, marginBottom: 6 },
          }}
        >
          {bodyMd}
        </Markdown>
      ) : (
        <Muted style={{ fontStyle: "italic", fontSize: 12 }}>
          (empty)
        </Muted>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function familyTint(
  family: BrainEnrichmentDraftRegion["sourceFamily"],
  colors: BrainEnrichmentDraftReviewPanelProps["colors"],
): string {
  if (family === "WEB") return "#f59e0b"; // amber, mirrors legacy panel
  if (family === "KNOWLEDGE_BASE") return "#22c55e"; // green
  if (family === "MIXED") return "#a855f7"; // purple
  return colors.primary; // BRAIN
}

function hexWithAlpha(hex: string, alpha: number): string {
  // Accept #rgb / #rrggbb / rgba/rgb strings; fall back to the original on
  // anything more exotic so the UI doesn't crash on theme misconfiguration.
  if (!hex.startsWith("#")) return hex;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hex.length === 4) {
    r = parseInt(hex[1]! + hex[1]!, 16);
    g = parseInt(hex[2]! + hex[2]!, 16);
    b = parseInt(hex[3]! + hex[3]!, 16);
  } else if (hex.length === 7) {
    r = parseInt(hex.slice(1, 3), 16);
    g = parseInt(hex.slice(3, 5), 16);
    b = parseInt(hex.slice(5, 7), 16);
  } else {
    return hex;
  }
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
