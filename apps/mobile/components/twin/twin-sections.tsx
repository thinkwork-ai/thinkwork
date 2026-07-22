/**
 * Projected twin-page sections (Company Brain U9 / KTD-8 — AE2 mobile
 * parity). Each section renders its own OK/STALE/TIMEOUT/ERROR state chip
 * and body independently — a failed section degrades in place, the page
 * stays intact. Callers only mount this when the server's dual-read gate
 * returned `projected: true`; otherwise the compiled sections render (AE8).
 */

import React from "react";
import { View } from "react-native";
import { Text, Muted } from "@/components/ui/typography";
import type { COLORS } from "@/lib/theme";
import {
  twinChipLabel,
  twinKnowledgeBody,
  twinSectionEntries,
  labelizeTwinKey,
  formatTwinValue,
  type ProjectedTwinSection,
} from "@/lib/twin/twin-page";

type ThemeColors = (typeof COLORS)["dark"];

const STATE_COLORS: Record<
  ProjectedTwinSection["state"],
  { text: string; background: string }
> = {
  OK: { text: "#059669", background: "rgba(16,185,129,0.15)" },
  STALE: { text: "#d97706", background: "rgba(245,158,11,0.15)" },
  TIMEOUT: { text: "#d97706", background: "rgba(245,158,11,0.15)" },
  ERROR: { text: "#dc2626", background: "rgba(239,68,68,0.15)" },
};

function TwinStateChip({ section }: { section: ProjectedTwinSection }) {
  const palette = STATE_COLORS[section.state];
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        backgroundColor: palette.background,
      }}
    >
      <Text style={{ color: palette.text, fontSize: 10, fontWeight: "600" }}>
        {twinChipLabel(section)}
      </Text>
    </View>
  );
}

function TwinSectionBody({
  section,
  colors,
}: {
  section: ProjectedTwinSection;
  colors: ThemeColors;
}) {
  if (section.state === "ERROR" || section.state === "TIMEOUT") {
    return (
      <Muted style={{ fontSize: 14, lineHeight: 20 }}>
        This section couldn&apos;t load
        {section.detail ? ` (${section.detail})` : ""} — the rest of the page is
        unaffected.
      </Muted>
    );
  }
  if (section.provenance === "knowledge") {
    const body = twinKnowledgeBody(section);
    return body ? (
      <Text style={{ color: colors.foreground, fontSize: 15, lineHeight: 22 }}>
        {body}
      </Text>
    ) : (
      <Muted style={{ fontSize: 14 }}>Nothing captured here yet.</Muted>
    );
  }
  const entries = twinSectionEntries(section);
  if (entries.length === 0) {
    return (
      <Muted style={{ fontSize: 14 }}>
        {section.state === "STALE"
          ? "No synced values yet."
          : "No values for this section."}
      </Muted>
    );
  }
  return (
    <View style={{ gap: 4 }}>
      {entries.map(([key, value]) => (
        <View
          key={key}
          style={{ flexDirection: "row", alignItems: "baseline", gap: 10 }}
        >
          <Muted
            style={{
              fontSize: 11,
              fontWeight: "600",
              textTransform: "uppercase",
              letterSpacing: 0.4,
            }}
          >
            {labelizeTwinKey(key)}
          </Muted>
          <Text
            style={{ color: colors.foreground, fontSize: 14, flexShrink: 1 }}
          >
            {formatTwinValue(value)}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function TwinProjectedSections({
  sections,
  colors,
}: {
  sections: ProjectedTwinSection[];
  colors: ThemeColors;
}) {
  return (
    <>
      {sections.map((section) => (
        <View key={section.slug} style={{ gap: 8 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <Text
              style={{
                color: colors.foreground,
                fontSize: 17,
                fontWeight: "600",
              }}
            >
              {section.heading}
            </Text>
            <TwinStateChip section={section} />
          </View>
          <TwinSectionBody section={section} colors={colors} />
        </View>
      ))}
    </>
  );
}
