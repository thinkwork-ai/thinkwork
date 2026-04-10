import { useLocalSearchParams } from "expo-router";
import { DetailLayout } from "@/components/layout/detail-layout";
import { useAgents, useAgent } from "@/lib/hooks/use-agents";
import { useAuth } from "@/lib/auth-context";
import { AgentDetailContent } from "@/components/agents/agent-detail";
import { Alert, View } from "react-native";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import { Button } from "@/components/ui/button";
import { useRouter } from "expo-router";
import { useRef } from "react";
import { RefreshCw, Trash2, Info } from "lucide-react-native";
import { HeaderContextMenu } from "@/components/ui/header-context-menu";
import { Badge, StatusBadge } from "@/components/ui/badge";

export default function AgentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const deleteRef = useRef<(() => void) | null>(null);
  const infoRef = useRef<(() => void) | null>(null);
  // TODO: restart/startAgent actions not yet available via GraphQL hooks
  const restartAgent = async (_args: { agentId: string }) => {};
  const startAgent = async (_args: { agentId: string }) => {};
  const { user } = useAuth();
  const tenantId = (user as any)?.tenantId;
  const [{ data: agentsData, fetching: agentsFetching }] = useAgents(tenantId);
  const gateways = agentsData?.agents ?? undefined;
  const gateway = gateways?.find((g: any) => g.id === id);
  const [{ data: agentAccessData }] = useAgent(id!);
  const agentAccess = agentAccessData?.agent ?? undefined;
  const canEdit = (agentAccess as any)?.capabilities?.canEdit !== false;
  const gwAny = gateway as any;
  const headerStatusBadge = (() => {
    if (!gwAny) return null;
    const isDigestUpdating = gwAny.targetDigest && gwAny.targetDigest !== gwAny.imageDigest;
    if (isDigestUpdating || gwAny.status === "updating") return <StatusBadge className="self-auto" status="updating" />;
    if (gwAny.status === "provisioning") return <Badge className="self-auto" variant="outline">Starting</Badge>;
    if (gwAny.status === "stopped" || gwAny.status === "failed") return <Badge className="self-auto" variant="outline">Stopped</Badge>;
    return <Badge className="self-auto" variant={gwAny.connectionStatus === "online" ? "success" : "outline"}>{gwAny.connectionStatus === "online" ? "Online" : "Offline"}</Badge>;
  })();

  const isRestartAction = gwAny?.status === "running" || gwAny?.status === "updating";
  const handleLifecycleAction = () => {
    const title = isRestartAction ? "Restart Agent" : "Relaunch Agent";
    const body = isRestartAction
      ? "This will roll the agent container. It may be briefly unavailable."
      : "This agent is failed/terminated/unreachable. Relaunch will request a fresh control-plane start.";
    const confirm = isRestartAction ? "Restart" : "Relaunch";
    Alert.alert(
      title,
      body,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: confirm,
          onPress: async () => {
            try {
              if (isRestartAction) {
                await restartAgent({ agentId: id! });
              } else {
                await startAgent({ agentId: id! });
              }
            } catch (e: any) {
              Alert.alert("Error", e?.message || `Failed to ${confirm.toLowerCase()} agent`);
            }
          },
        },
      ]
    );
  };

  if (gateways === undefined) {
    return (
      <DetailLayout title="Loading...">
        <View className="flex-1 px-4">
          <Skeleton className="h-12 w-full mt-4" />
          <Skeleton className="h-12 w-full mt-2" />
          <Skeleton className="h-12 w-full mt-2" />
          <Skeleton className="h-32 w-full mt-4" />
        </View>
      </DetailLayout>
    );
  }

  if (!gateway) {
    return (
      <DetailLayout title="Not Found">
        <View className="flex-1 items-center justify-center px-4">
          <Text className="text-neutral-500 dark:text-neutral-400 text-center mb-4">
            Agent not found
          </Text>
          <Button onPress={() => router.back()}>Go Back</Button>
        </View>
      </DetailLayout>
    );
  }

  if (agentAccess === null) {
    return (
      <DetailLayout title="No Access">
        <View className="flex-1 items-center justify-center px-4">
          <Text className="text-neutral-500 dark:text-neutral-400 text-center mb-4">
            You don't have access to this agent.
          </Text>
          <Button onPress={() => router.back()}>Go Back</Button>
        </View>
      </DetailLayout>
    );
  }

  return (
    <DetailLayout
      title={gateway.name}
      headerRight={
        <View className="flex-row items-center gap-2">
          {headerStatusBadge}
          {canEdit ? (
            <HeaderContextMenu
              items={[
                {
                  label: "Agent Info",
                  icon: Info,
                  onPress: () => infoRef.current?.(),
                },
                {
                  label: isRestartAction ? "Restart Agent" : "Relaunch Agent",
                  icon: RefreshCw,
                  onPress: handleLifecycleAction,
                },
                {
                  label: "Delete Agent",
                  icon: Trash2,
                  destructive: true,
                  onPress: () => deleteRef.current?.(),
                },
              ]}
            />
          ) : null}
        </View>
      }
    >
      <AgentDetailContent gatewayId={id} onRequestDeleteRef={deleteRef} onRequestInfoRef={infoRef} />
    </DetailLayout>
  );
}
