/**
 * Credentials Locker — single screen that rolls up every credential the user
 * has configured for their agents: first-party OAuth integrations (Google
 * Workspace, Microsoft 365) and external MCP servers.
 *
 * Replaces the prior two-screen split (`settings/integrations.tsx` +
 * `settings/mcp-servers.tsx`) and their two separate entries in the kebab
 * menu. Per-section rendering lives in `apps/mobile/components/credentials/`
 * so each section stays focused and this screen is just the shell + one
 * top-level ScrollView/RefreshControl that drives both.
 */

import { useState } from "react";
import { View, ScrollView, RefreshControl } from "react-native";
import { DetailLayout } from "@/components/layout/detail-layout";
import { IntegrationsSection } from "@/components/credentials/IntegrationsSection";
import { McpServersSection } from "@/components/credentials/McpServersSection";

export default function CredentialsScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);

  const onRefresh = async () => {
    setRefreshing(true);
    // Bump the signal; both sections re-fetch via their own useEffect.
    // Release the spinner after a beat so pull-to-refresh feels responsive
    // even if one section's fetch is slow — each section owns its own loading
    // state from there.
    setRefreshSignal((n) => n + 1);
    setTimeout(() => setRefreshing(false), 400);
  };

  return (
    <DetailLayout title="Credential Locker">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={{ maxWidth: 600, gap: 24 }}>
          <IntegrationsSection refreshSignal={refreshSignal} />
          <McpServersSection refreshSignal={refreshSignal} />
        </View>
      </ScrollView>
    </DetailLayout>
  );
}
