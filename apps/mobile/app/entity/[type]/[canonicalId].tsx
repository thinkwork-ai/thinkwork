import React, { useMemo } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useColorScheme } from "nativewind";
import { useQuery } from "urql";
import { useAuth } from "@/lib/auth-context";
import { DetailLayout } from "@/components/layout/detail-layout";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { TwinEntityPageQuery } from "@/lib/graphql-queries";
import { parseTwinEntityPage } from "@/lib/twin/twin-page";
import { TwinProjectedSections } from "@/components/twin/twin-sections";

/**
 * Slim twin entity screen (THINK-327 U9 / R13): renders the projected
 * living sections for a canonical entity directly from `twinEntityPage` —
 * no wiki page, no graph, no sources sheet. The wiki reader this replaces
 * is gone; deep links land here.
 */
export default function EntityScreen() {
  const { type, canonicalId } = useLocalSearchParams<{
    type: string;
    canonicalId: string;
  }>();
  const { tenantId } = useAuth();
  const { colorScheme } = useColorScheme();
  const colors = COLORS[colorScheme === "dark" ? "dark" : "light"];

  const [{ data, fetching, error }] = useQuery({
    query: TwinEntityPageQuery,
    variables: {
      tenantId,
      entityType: type ?? "",
      canonicalId: canonicalId ?? "",
    },
    pause: !tenantId || !type || !canonicalId,
  });

  const twinPage = useMemo(
    () => parseTwinEntityPage(data?.twinEntityPage),
    [data],
  );
  const sections =
    twinPage?.projected && (twinPage.sections?.length ?? 0) > 0
      ? twinPage.sections!
      : null;

  return (
    <DetailLayout title={canonicalId ?? "Entity"}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}
      >
        {fetching && !data ? (
          <View style={{ paddingVertical: 32, alignItems: "center" }}>
            <ActivityIndicator />
          </View>
        ) : error ? (
          <Muted>This entity couldn&apos;t be loaded: {error.message}</Muted>
        ) : sections ? (
          <TwinProjectedSections sections={sections} colors={colors} />
        ) : twinPage && !twinPage.projected ? (
          <Muted>
            Live sections aren&apos;t available for this entity
            {twinPage.reason ? ` (${twinPage.reason})` : ""}.
          </Muted>
        ) : (
          <Muted>Nothing here yet.</Muted>
        )}
        <Text style={{ fontSize: 12, color: colors.mutedForeground }}>
          {type} · {canonicalId}
        </Text>
      </ScrollView>
    </DetailLayout>
  );
}
