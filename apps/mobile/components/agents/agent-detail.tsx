import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, Alert, ActivityIndicator, Pressable, Modal, Platform, Linking, Dimensions } from "react-native";
import { useRouter } from "expo-router";
import { useAgents, useAgent, useUpdateAgent, useDeleteAgent } from "@/lib/hooks/use-agents";
import { useTeams } from "@/lib/hooks/use-teams";
import { useAuth } from "@/lib/auth-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { WebContent } from "@/components/layout/web-content";
// Card components removed — using inline layout now
import { AlertTriangle, Folder, ChevronRight, Copy, Check, User, Zap, ArrowUpCircle, Bot, BarChart3, Hash, CircleUser, Server, Tag, Star, Activity, Clock, Github, X } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";
import * as Clipboard from "expo-clipboard";
import * as ExpoLinking from "expo-linking";

function InfoRow({
  label,
  value,
  valueComponent,
  isLast,
  labelIcon,
  valueClassName,
  valueContainerClassName,
}: {
  label: string;
  value?: string;
  valueComponent?: React.ReactNode;
  isLast?: boolean;
  labelIcon?: React.ReactNode;
  valueClassName?: string;
  valueContainerClassName?: string;
}) {
  return (
    <View className={`flex-row items-center justify-between py-3 ${isLast ? "" : "border-b border-neutral-200 dark:border-neutral-800"}`}>
      <View className="flex-1 flex-row items-center gap-2 pr-3 min-w-0">
        {labelIcon}
        <Text className="text-base text-neutral-500 dark:text-neutral-400">{label}</Text>

      </View>
      {valueComponent || (
        <View className={`ml-3 max-w-[55%] items-end ${valueContainerClassName || ""}`}>
          <Text className={`text-base text-right text-neutral-900 dark:text-neutral-100 ${valueClassName || ""}`}>{value}</Text>
        </View>
      )}
    </View>
  );
}

function SectionHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View className="flex-row items-center justify-between py-3">
      <Text className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
        {title}
      </Text>
      {right}
    </View>
  );
}

function InlineDropdownMenu({
  items,
  trigger,
}: {
  items: Array<{ label: string; onPress: () => void }>;
  trigger: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const triggerRef = useRef<View>(null);
  const { colorScheme } = useColorScheme();
  const screenWidth = Dimensions.get("window").width;

  const open = useCallback(() => {
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
      setVisible(true);
    });
  }, []);

  const dropdownTop = anchor ? anchor.y + anchor.height + 6 : 0;
  const dropdownRight = anchor ? screenWidth - (anchor.x + anchor.width) : 16;

  return (
    <>
      <Pressable ref={triggerRef} onPress={open}>
        {trigger}
      </Pressable>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <Pressable className="flex-1" onPress={() => setVisible(false)}>
          <View
            style={{
              position: "absolute",
              top: dropdownTop,
              right: dropdownRight,
              minWidth: 200,
              maxWidth: 280,
              backgroundColor: colorScheme === "dark" ? "#1c1c1e" : "#ffffff",
              borderRadius: 12,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: colorScheme === "dark" ? 0.5 : 0.15,
              shadowRadius: 12,
              elevation: 8,
              borderWidth: 1,
              borderColor: colorScheme === "dark" ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)",
            }}
          >
            {items.map((item, index) => {
              const isLast = index === items.length - 1;
              return (
                <Pressable
                  key={item.label}
                  onPress={() => {
                    setVisible(false);
                    item.onPress();
                  }}
                  className="px-4 py-3.5"
                  style={
                    !isLast
                      ? {
                          borderBottomWidth: 0.5,
                          borderBottomColor:
                            colorScheme === "dark"
                              ? "rgba(255,255,255,0.08)"
                              : "rgba(0,0,0,0.06)",
                        }
                      : undefined
                  }
                >
                  <Text className="text-base text-neutral-900 dark:text-neutral-100">{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

function normalizeGitHubRepoInput(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const direct = raw.replace(/^\/+|\/+$/g, "").match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (direct) return `${direct[1]}/${direct[2].replace(/\.git$/i, "")}`.toLowerCase();
  const https = raw.match(/^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)(?:[/?#].*)?$/i);
  if (https) return `${https[1]}/${https[2].replace(/\.git$/i, "")}`.toLowerCase();
  const ssh = raw.match(/^git@github\.com:([^/\s]+)\/([^\s]+?)(?:\.git)?$/i);
  if (ssh) return `${ssh[1]}/${ssh[2].replace(/\.git$/i, "")}`.toLowerCase();
  return null;
}

function digestShort(digest?: string | null): string | null {
  if (!digest) return null;
  const normalized = digest.startsWith("sha256:") ? digest.slice("sha256:".length) : digest;
  return normalized ? normalized.slice(0, 8) : null;
}

function taskRevisionLabel(taskDefinitionArn?: string | null): string | null {
  if (!taskDefinitionArn) return null;
  const last = taskDefinitionArn.split("/").pop() || "";
  return last || null;
}

function versionLabel(taskDefinitionArn?: string | null, imageDigest?: string | null, imageVersion?: string | null): string {
  const revision = taskRevisionLabel(taskDefinitionArn);
  const short = digestShort(imageDigest);
  if (revision && short) return `${revision} · ${short}`;
  if (revision) return revision;
  if (short) return short;
  return imageVersion || "—";
}

/**
 * Shared agent detail content.
 * Used both by the [id] detail page and inline on the Pro plan's Agent tab.
 */
export function AgentDetailContent({
  gatewayId,
  onRequestDeleteRef,
  onRequestInfoRef,
}: {
  gatewayId: string;
  onRequestDeleteRef?: React.MutableRefObject<(() => void) | null>;
  onRequestInfoRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const id = gatewayId;
  const router = useRouter();
  const { user } = useAuth();
  const tenantId = (user as any)?.tenantId;
  const [{ data: agentsData }] = useAgents(tenantId);
  const gateways = agentsData?.agents ?? undefined;
  const [{ data: teamsData }] = useTeams(tenantId);
  const teams = teamsData?.teams ?? undefined;
  // TODO: revoke, terminate, restart, start, deleteLocal, addCodeFactoryRepo, removeCodeFactoryRepo not yet available via GraphQL
  const revokeGateway = async (_args: any) => {};
  const terminateAgent = async (_args: any) => {};
  const restartAgent = async (_args: any) => {};
  const startAgent = async (_args: any) => {};
  const deleteLocalAgent = async (_args: any) => {};
  const addCodeFactoryRepo = async (_args: any) => {};
  const removeCodeFactoryRepo = async (_args: any) => {};
  const [, executeUpdateAgent] = useUpdateAgent();
  const updateAgent = async (args: any) => { await executeUpdateAgent(args); };
  const [terminating, setTerminating] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showStartModal, setShowStartModal] = useState(false);
  const [showTerminateModal, setShowTerminateModal] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showAddRepoModal, setShowAddRepoModal] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [repoToken, setRepoToken] = useState("");
  const [repoError, setRepoError] = useState<string | null>(null);
  const [repoSaving, setRepoSaving] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [copiedUrl, setCopiedUrl] = useState(false);
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const gateway = gateways?.find((g: any) => g.id === id);
  const [{ data: agentDetailData }] = useAgent(id);
  const agentDetail = agentDetailData?.agent ?? undefined;
  // TODO: listRuntimeModels action not yet available via GraphQL
  const [modelCatalog, setModelCatalog] = useState<any[] | null>(null);
  // TODO: agentBudgets, githubApp, codeFactoryRepos, agentSkills, getToken, teamReleases, getMyTeamRole not yet available via GraphQL
  const budgetStatus: any = undefined;
  const githubConnections: any[] | undefined = undefined;
  const startGitHubInstall = async (_args: any) => ({} as any);
  const disconnectGitHubRepo = async (_args: any) => {};
  const codeFactoryRepos: any[] | undefined = undefined;
  const agentSkillsQuery: any[] | undefined = undefined;
  const installedSkillCount = agentSkillsQuery?.length ?? 0;
  const skillsLoading = agentSkillsQuery === undefined;
  const skillsError: string | null = null;
  const canEdit = (agentDetail as any)?.capabilities?.canEdit !== false;
  const gatewayToken: any = undefined;
  const agentInstanceId = (agentDetail as any)?.instanceId ?? (gateway as any)?.instanceId;
  const latestRelease: any = undefined;
  // TODO: getMyTeamRole not available via GraphQL yet
  const myTeamRole: string | undefined = undefined;
  const isTeamAdmin = myTeamRole === "admin" || myTeamRole === "owner";

  useEffect(() => {
    // TODO: Replace with GraphQL model catalog query when available
    setModelCatalog([]);
  }, []);

  if (gateways === undefined) {
    return (
      <View className="flex-1 px-4">
        <Skeleton className="h-12 w-full mt-4" />
        <Skeleton className="h-12 w-full mt-2" />
        <Skeleton className="h-12 w-full mt-2" />
        <Skeleton className="h-32 w-full mt-4" />
      </View>
    );
  }

  if (!gateway) {
    return (
      <View className="flex-1 items-center justify-center px-4">
        <Text className="text-neutral-500 dark:text-neutral-400 text-center mb-4">
          Agent not found
        </Text>
      </View>
    );
  }

  const handleRevoke = async () => {
    await revokeGateway({ id: id as string, reason: "user_removed" });
    router.back();
  };

  const gwAny = gateway as any;
  const isCodeFactory = gwAny.runtimeProfile === "code_factory";
  const repoBindings = (codeFactoryRepos || []) as Array<{ id: string; repoFullName: string; status: "connected" | "needs_reauth" | "revoked" }>;
  const selectedModelId = (agentDetail as any)?.model ?? gwAny.model;
  const selectedCatalogModel = Array.isArray(modelCatalog)
    ? modelCatalog.find((m: any) => m.id === selectedModelId)
    : undefined;
  const selectedModelLabel = selectedCatalogModel?.label ?? selectedModelId ?? "Kimi K2.5";
  const agentTypeLabel = gwAny.type === "ecs" ? "Cloud (Hosted)" : "BYOB (Self-hosted)";
  const currentVersion = gwAny.imageVersion || "—";
  const currentDigest = gwAny.imageDigest as string | undefined;
  const latestDigest = latestRelease?.digest as string | undefined;
  const displayVersion = versionLabel(gwAny.taskDefinitionArn as string | undefined, currentDigest, currentVersion);
  const isRestartable = gwAny.status === "running" || gwAny.status === "updating";
  const isRelaunchable = gwAny.status === "failed" || gwAny.status === "terminated" || (gwAny.status === "stopped" && gwAny.connectionStatus !== "online");
  const isStartable = gwAny.status === "stopped" && !isRelaunchable;
  const hasDigestUpdate = Boolean(latestDigest && currentDigest && latestDigest !== currentDigest);
  const hasUpdate = hasDigestUpdate;
  const showStart = gwAny.type === "ecs" && (isStartable || isRelaunchable);
  const showUpdate = gwAny.type === "ecs" && isRestartable && hasUpdate;
  const lastHeartbeatLabel = gwAny.lastHeartbeatAt ? new Date(gwAny.lastHeartbeatAt).toLocaleString() : "—";
  const statusValueComponent = (() => {
    const isDigestUpdating = gwAny.targetDigest && gwAny.targetDigest !== gwAny.imageDigest;
    const isStarting = gwAny.status === "provisioning";
    if (isDigestUpdating || gwAny.status === "updating") {
      return (
        <View className="flex-row items-center gap-1">
          <ActivityIndicator size="small" color="#f8841d" />
          <Badge variant="outline">Updating</Badge>
        </View>
      );
    }
    if (isStarting) {
      return (
        <View className="flex-row items-center gap-1">
          <ActivityIndicator size="small" color="#f8841d" />
          <Badge variant="outline">Starting</Badge>
        </View>
      );
    }
    if (gwAny.status === "stopped" || gwAny.status === "failed") {
      return <Badge variant="outline">Stopped</Badge>;
    }
    return (
      <Badge variant={gwAny.connectionStatus === "online" ? "success" : "outline"}>
        {gwAny.connectionStatus === "online" ? "Online" : "Offline"}
      </Badge>
    );
  })();

  const handleDeletePress = () => {
    if (gwAny.type === "ecs") {
      setDeleteConfirmText("");
      setShowTerminateModal(true);
    } else if (gwAny.type === "local") {
      Alert.alert(
        "Remove Agent",
        "This will permanently remove this local agent. Continue?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              try {
                await deleteLocalAgent({ agentId: id as string });
                router.back();
              } catch (e: any) {
                Alert.alert("Error", e.message || "Failed to remove agent");
              }
            },
          },
        ]
      );
    } else {
      Alert.alert(
        "Revoke Agent",
        "This will disconnect the agent from team. Continue?",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Revoke", style: "destructive", onPress: handleRevoke },
        ]
      );
    }
  };

  if (onRequestDeleteRef) {
    onRequestDeleteRef.current = handleDeletePress;
  }

  if (onRequestInfoRef) {
    onRequestInfoRef.current = () => setShowInfoModal(true);
  }

  return (
    <ScrollView className="flex-1" contentContainerClassName="pb-4">
      <WebContent>
      <View className="mx-4 mt-3 rounded-lg border border-neutral-200 dark:border-neutral-800 px-4 overflow-hidden">
      {/* Agent ID */}
      {gwAny.type !== "local" && (agentInstanceId || gateway.baseUrl) && (
        <InfoRow
          label="Agent ID"
          labelIcon={<Hash size={16} color="#f8841d" />}
          valueComponent={
            <Pressable
              onPress={async () => {
                await Clipboard.setStringAsync(agentInstanceId ?? gateway.baseUrl);
                setCopiedUrl(true);
                setTimeout(() => setCopiedUrl(false), 2000);
              }}
              className="flex-row items-center gap-2"
            >
              <Text className="text-neutral-900 dark:text-neutral-100 font-mono text-sm" numberOfLines={1}>
                {agentInstanceId ?? gateway.baseUrl.replace(/^https?:\/\//, "").replace(/\.thinkwork\.ai.*$/, "")}
              </Text>
              {copiedUrl ? (
                <Check size={16} color="#22c55e" />
              ) : (
                <Copy size={16} color="#a3a3a3" />
              )}
            </Pressable>
          }
        />
      )}

      {/* Agent Type — dropdown style, directly under Agent ID */}
      {(() => {
        const AGENT_TYPE_OPTIONS: { value: "claude" | "sdk" | "pi"; label: string }[] = [
          { value: "claude", label: "Claude" },
          { value: "sdk", label: "Agent SDK" },
          { value: "pi", label: "Pi" },
        ];
        const agentTypeLabel = AGENT_TYPE_OPTIONS.find((o) => o.value === gwAny.type)?.label ?? gwAny.type ?? "—";
        const isAgentTypeEditable = canEdit && (gwAny.type === "claude" || gwAny.type === "sdk" || gwAny.type === "pi" || !gwAny.type);
        const row = (
          <InfoRow
            label="Agent Type"
            labelIcon={<Tag size={16} color="#f8841d" />}
            valueComponent={
              <View className="flex-row items-center gap-2">
                <Text className="text-base text-neutral-900 dark:text-neutral-100">{agentTypeLabel}</Text>
                {isAgentTypeEditable && <ChevronRight size={20} color="#a3a3a3" />}
              </View>
            }
          />
        );

        if (!isAgentTypeEditable) return row;

        return (
          <InlineDropdownMenu
            items={AGENT_TYPE_OPTIONS.map((opt) => ({
              label: opt.label,
              onPress: async () => {
                try {
                  await updateAgent({ id: id as string, type: opt.value });
                } catch (e: any) {
                  Alert.alert("Failed to update agent type", e?.message || "Please try again");
                }
              },
            }))}
            trigger={row}
          />
        );
      })()}

      {/* Agent Profile — full row tappable */}
      <Pressable onPress={() => router.push(`/agents/${id}/profile`)}>
        <InfoRow
          label="Profile"
          labelIcon={<CircleUser size={16} color="#f8841d" />}
          valueComponent={
            <View className="flex-row items-center gap-2">
              <Text className="text-base text-neutral-900 dark:text-neutral-100">{gateway.name || "—"}</Text>
              <ChevronRight size={20} color="#a3a3a3" />
            </View>
          }
        />
      </Pressable>

      {/* Overview */}
      {gateway.type !== "ecs" && (
        <InfoRow label="Default" labelIcon={<Star size={16} color="#f8841d" />} value={gateway.isDefault ? "Yes" : "No"} />
      )}
      {/* Assigned User — tappable only for team admins/owners */}
      {isTeamAdmin ? (
        <Pressable
          onPress={() => {
            if (gwAny.type === "local") {
              if (Platform.OS === "web") {
                window.alert("BYOB (self-hosted) agents are managed locally. User assignment is only available for cloud-hosted agents.");
              } else {
                Alert.alert("Not Available", "BYOB (self-hosted) agents are managed locally. User assignment is only available for cloud-hosted agents.");
              }
              return;
            }
            const teamId = teams?.[0]?.id;
            if (teamId) {
              router.push(`/team/pick-user?agentId=${id}&teamId=${teamId}`);
            }
          }}
        >
          <InfoRow
            label="Assigned User"
            labelIcon={<User size={16} color="#f8841d" />}
            valueComponent={
              <View className="flex-row items-center gap-2">
                <Text className="text-base text-neutral-900 dark:text-neutral-100">
                  {agentDetail?.ownerName ?? "Unassigned"}
                </Text>
                <ChevronRight size={20} color="#a3a3a3" />
              </View>
            }
          />
        </Pressable>
      ) : (
        <InfoRow
          label="Assigned User"
          labelIcon={<User size={16} color="#f8841d" />}
          valueComponent={
            <View className="flex-row items-center gap-2">
              <Text className="text-base text-neutral-900 dark:text-neutral-100">
                {agentDetail?.ownerName ?? "Unassigned"}
              </Text>
            </View>
          }
        />
      )}

      {/* Model — full row tappable */}
      <Pressable onPress={() => canEdit && router.push(`/agents/${id}/model`)}>
        <InfoRow
          label="Model"
          labelIcon={<Bot size={16} color="#f8841d" />}
          valueComponent={
            <View className="flex-row items-center gap-2">
              <Text className="text-base text-neutral-900 dark:text-neutral-100">
                {selectedModelLabel}
              </Text>
              <ChevronRight size={20} color="#a3a3a3" />
            </View>
          }
        />
      </Pressable>

      {/* Usage & Budget — unified row */}
      <Pressable onPress={() => router.push(`/agents/${id}/usage`)}>
        <InfoRow
          label="Usage"
          labelIcon={<BarChart3 size={16} color="#f8841d" />}
          valueComponent={
            <View className="flex-row items-center gap-2">
              <Text className="text-base text-neutral-900 dark:text-neutral-100">
                {budgetStatus?.policy
                  ? `${budgetStatus.enforcement?.percentUsed?.toFixed?.(0) ?? 0}% used`
                  : "View"}
              </Text>
              <ChevronRight size={20} color="#a3a3a3" />
            </View>
          }
        />
      </Pressable>

      {gwAny.runtimeProfile === "code_factory" && (
        <View className="border-b border-neutral-200 dark:border-neutral-800 py-3">
          <View className="flex-row items-center justify-between">
            <View className="flex-1 pr-3">
              <Text className="text-base text-neutral-900 dark:text-neutral-100">GitHub Repositories</Text>
              <Text className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                Connect via GitHub App (recommended). Personal Access Token remains available as fallback.
              </Text>
            </View>
            <Button
              onPress={async () => {
                try {
                  const result = await startGitHubInstall({
                    agentId: id as string,
                    postInstallRedirectUri: ExpoLinking.createURL(`/agents/${id}`),
                  });
                  if (result?.installUrl) {
                    await Linking.openURL(result.installUrl);
                  }
                } catch (e) {
                  Alert.alert("GitHub App", e?.message || "Failed to start GitHub App install");
                }
              }}
              size="sm"
            >
              <Text className="text-white font-medium">Connect GitHub App</Text>
            </Button>
          </View>

          {!githubConnections || githubConnections.length === 0 ? (
            <View className="mt-3 rounded-md border border-dashed border-neutral-300 dark:border-neutral-700 px-3 py-2">
              <Text className="text-sm text-neutral-500 dark:text-neutral-400">
                No connected repositories yet. Install the app and approve repo access to continue.
              </Text>
            </View>
          ) : (
            <View className="mt-3 gap-2">
              {githubConnections.map((repo) => (
                <View key={String(repo.id)} className="rounded-md border border-neutral-200 dark:border-neutral-800 px-3 py-2 flex-row items-center justify-between">
                  <View className="flex-1 pr-3">
                    <Text className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{repo.repoFullName}</Text>
                    <Text className="text-xs text-neutral-500 dark:text-neutral-400">
                      {repo.authMethod === "github_app" ? "GitHub App" : "PAT fallback"} · {repo.status}
                    </Text>
                  </View>
                  {repo.status === "connected" ? (
                    <Pressable
                      onPress={async () => {
                        try {
                          await disconnectGitHubRepo({ repoId: repo.id });
                        } catch (e) {
                          Alert.alert("GitHub App", e?.message || "Failed to disconnect repo");
                        }
                      }}
                    >
                      <Text className="text-xs text-red-500">Disconnect</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Skills — full row tappable */}
      {gateway.baseUrl && (
        <Pressable onPress={() => router.push(`/agents/${id}/skills`)}>
          <InfoRow
            label="Skills"
            labelIcon={<Zap size={16} color="#f8841d" />}
            valueComponent={
              <View className="flex-row items-center gap-2">
                {skillsLoading ? (
                  <ActivityIndicator size="small" color="#737373" />
                ) : (
                  <View className="bg-neutral-200 dark:bg-neutral-700 rounded-full px-2 py-0.5 min-w-[24px] items-center">
                    <Text className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{skillsError ? "!" : installedSkillCount}</Text>
                  </View>
                )}
                {skillsError ? (
                  <Text className="text-xs text-red-500">Read error</Text>
                ) : null}
                <ChevronRight size={20} color="#a3a3a3" />
              </View>
            }
          />
        </Pressable>
      )}

      {/* Files — full row tappable */}
      {gateway.baseUrl && (
        <Pressable onPress={() => router.push(`/agents/${id}/files`)}>
          <InfoRow
            label="Workspace"
            labelIcon={<Folder size={16} color="#f8841d" />}
            valueComponent={
              <View className="flex-row items-center gap-2">
                <Text className="text-base text-neutral-900 dark:text-neutral-100">Files</Text>
                <ChevronRight size={20} color="#a3a3a3" />
              </View>
            }
          />
        </Pressable>
      )}


      </View>



      {isCodeFactory && (
        <View className="mx-4 mt-4 rounded-lg border border-neutral-200 dark:border-neutral-800 px-4 py-3">
          <SectionHeader
            title="Code Repos"
            right={
              <Button size="sm" onPress={() => {
                setRepoError(null);
                setRepoUrl("");
                setRepoToken("");
                setShowAddRepoModal(true);
              }}>
                Add Code Repo
              </Button>
            }
          />
          <Text className="text-xs text-neutral-500 dark:text-neutral-400 mb-3">
            GitHub App OAuth is coming in v2. Personal Access Token (PAT) is a temporary bootstrap for v1.
          </Text>
          {repoBindings.length === 0 ? (
            <Text className="text-sm text-neutral-500 dark:text-neutral-400">No code repos connected yet.</Text>
          ) : (
            <View className="gap-2 pb-1">
              {repoBindings.map((repo) => (
                <View key={String(repo.id)} className="flex-row items-center justify-between rounded-md border border-neutral-200 dark:border-neutral-700 px-3 py-2">
                  <View className="flex-row items-center gap-2 min-w-0 flex-1">
                    <Github size={15} color="#a3a3a3" />
                    <Text className="text-sm text-neutral-900 dark:text-neutral-100" numberOfLines={1}>{repo.repoFullName}</Text>
                  </View>
                  <View className="flex-row items-center gap-2 ml-3">
                    <Badge variant={repo.status === "connected" ? "success" : "outline"}>
                      {repo.status === "connected" ? "Connected" : repo.status === "needs_reauth" ? "Needs Re-auth" : "Revoked"}
                    </Badge>
                    {repo.status !== "revoked" && canEdit ? (
                      <Pressable onPress={async () => {
                        try {
                          await removeCodeFactoryRepo({ repoId: repo.id });
                        } catch (e) {
                          Alert.alert("Error", e?.message || "Failed to revoke repo");
                        }
                      }}>
                        <X size={16} color="#ef4444" />
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      <Modal visible={showAddRepoModal} transparent animationType="fade" onRequestClose={() => !repoSaving && setShowAddRepoModal(false)}>
        <View className="flex-1 justify-center items-center bg-black/60 px-6">
          <View className="w-full max-w-md rounded-xl p-6 border" style={{ backgroundColor: colors.card, borderColor: colors.border }}>
            <Text className="text-lg font-bold text-neutral-900 dark:text-neutral-100 mb-1">Add Code Repo</Text>
            <Text className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">Connect a GitHub repository for this Code Factory agent.</Text>
            <Input
              label="GitHub repo URL"
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              onChangeText={setRepoUrl}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View className="mt-3">
              <Text className="text-sm text-neutral-500 dark:text-neutral-400 mb-1">Auth method</Text>
              <View className="rounded-md border border-neutral-200 dark:border-neutral-700 px-3 py-2">
                <Text className="text-sm text-neutral-900 dark:text-neutral-100">Personal Access Token (v1)</Text>
              </View>
            </View>
            <View className="mt-3">
              <Input
                label="Personal Access Token"
                placeholder="github_pat_..."
                value={repoToken}
                onChangeText={setRepoToken}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            {repoError ? (
              <View className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 mt-3">
                <Text className="text-sm text-destructive">{repoError}</Text>
              </View>
            ) : null}
            <View className="flex-row gap-2 mt-5">
              <Button variant="outline" className="flex-1" disabled={repoSaving} onPress={() => setShowAddRepoModal(false)}>Cancel</Button>
              <Button className="flex-1" disabled={repoSaving} onPress={async () => {
                const normalized = normalizeGitHubRepoInput(repoUrl);
                if (!normalized) {
                  setRepoError("Enter a valid GitHub repository URL (owner/repo)");
                  return;
                }
                if (!repoToken.trim()) {
                  setRepoError("Personal Access Token is required");
                  return;
                }
                setRepoSaving(true);
                setRepoError(null);
                try {
                  await addCodeFactoryRepo({
                    agentId: id as string,
                    repoUrl: normalized,
                    authMethod: "pat",
                    token: repoToken.trim(),
                  });
                  setShowAddRepoModal(false);
                  setRepoUrl("");
                  setRepoToken("");
                } catch (e) {
                  setRepoError(e?.message || "Failed to add code repo");
                } finally {
                  setRepoSaving(false);
                }
              }}>{repoSaving ? "Saving…" : "Add Repo"}</Button>
            </View>
          </View>
        </View>
      </Modal>


      {/* Agent Info Modal */}
      <Modal
        visible={showInfoModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowInfoModal(false)}
      >
        <View className="flex-1 justify-center items-center bg-black/60 px-6">
          <View
            className="w-full max-w-sm rounded-xl p-6 border"
            style={{
              backgroundColor: colors.card,
              borderColor: colors.border,
            }}
          >
            <Text className="text-lg font-bold text-neutral-900 dark:text-neutral-100 mb-4">Agent Info</Text>

            <InfoRow
              label="Type"
              labelIcon={<Server size={16} color="#f8841d" />}
              value={agentTypeLabel}
            />

            {gateway.type === "ecs" ? (() => {
              const versionRow = (
                <InfoRow
                  label="Team Version"
                  labelIcon={<Tag size={16} color="#f8841d" />}
                  valueComponent={
                    <View className="flex-row items-center gap-2">
                      <Text className="text-base text-neutral-900 dark:text-neutral-100">{displayVersion}</Text>
                      {showStart && (
                        <View className="flex-row items-center rounded-full px-2.5 py-0.5 border border-green-500 dark:border-green-400">
                          <Text className="text-xs font-semibold text-green-600 dark:text-green-400">{isRelaunchable ? "Relaunch" : "Start"}</Text>
                        </View>
                      )}
                      {showUpdate && (
                        <View className="flex-row items-center rounded-full px-2.5 py-0.5 border border-orange-400 dark:border-orange-500">
                          <Text className="text-xs font-semibold text-orange-500 dark:text-orange-400">Update</Text>
                        </View>
                      )}
                    </View>
                  }
                />
              );
              if (showStart) {
                return (
                  <Pressable
                    onPress={() => {
                      setShowInfoModal(false);
                      setShowStartModal(true);
                    }}
                  >
                    {versionRow}
                  </Pressable>
                );
              }
              return showUpdate ? (
                <Pressable
                  onPress={() => {
                    setShowInfoModal(false);
                    setShowUpdateModal(true);
                  }}
                >
                  {versionRow}
                </Pressable>
              ) : versionRow;
            })() : (
              <InfoRow
                label="Team Version"
                labelIcon={<Tag size={16} color="#f8841d" />}
                value="—"
              />
            )}

            <InfoRow
              label="Status"
              labelIcon={<Activity size={16} color="#f8841d" />}
              valueComponent={statusValueComponent}
            />

            <InfoRow
              label="Heartbeat"
              labelIcon={<Clock size={16} color="#f8841d" />}
              value={lastHeartbeatLabel}
              valueClassName="text-sm font-mono"
              isLast
            />

            <Pressable
              onPress={() => setShowInfoModal(false)}
              style={{ paddingVertical: 12, alignItems: "center", marginTop: 12 }}
            >
              <Text className="font-medium text-neutral-500 dark:text-neutral-400">Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Start Modal */}
      <Modal
        visible={showStartModal}
        transparent
        animationType="fade"
        onRequestClose={() => !starting && setShowStartModal(false)}
      >
        <View className="flex-1 justify-center items-center bg-black/60 px-6">
          <View
            className="w-full max-w-sm rounded-xl p-6 border"
            style={{
              backgroundColor: colors.card,
              borderColor: colors.border,
            }}
          >
            <View className="items-center mb-4">
              <ArrowUpCircle size={40} color="#22c55e" />
            </View>
            <Text className="text-lg font-bold text-center text-neutral-900 dark:text-neutral-100 mb-2">
              {isRelaunchable ? "Relaunch Agent" : "Start Agent"}
            </Text>
            <Text className="text-sm text-center text-neutral-600 dark:text-neutral-400 mb-4">
              {isRelaunchable ? "This agent is unreachable/terminated. Relaunch will request a fresh control-plane start. It may take a few minutes to come online." : "This will launch a new container for this agent. It may take a few minutes to come online."}
            </Text>
            <Pressable
              onPress={async () => {
                setStarting(true);
                try {
                  await startAgent({ agentId: id as string });
                  setShowStartModal(false);
                } catch (e) {
                  if (Platform.OS === "web") {
                    window.alert(e.message || "Failed to start agent");
                  } else {
                    Alert.alert("Error", e.message || "Failed to start agent");
                  }
                } finally {
                  setStarting(false);
                }
              }}
              disabled={starting}
              style={{
                backgroundColor: starting ? "#d4d4d4" : "#22c55e",
                paddingVertical: 14,
                borderRadius: 10,
                alignItems: "center",
                marginTop: 4,
                opacity: starting ? 0.5 : 1,
              }}
            >
              {starting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>
                  {isRelaunchable ? "Relaunch" : "Start"}
                </Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => setShowStartModal(false)}
              disabled={starting}
              style={{ paddingVertical: 12, alignItems: "center", marginTop: 8 }}
            >
              <Text className="font-medium text-neutral-500 dark:text-neutral-400">Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Update Modal */}
      <Modal
        visible={showUpdateModal}
        transparent
        animationType="fade"
        onRequestClose={() => !restarting && setShowUpdateModal(false)}
      >
        <View className="flex-1 justify-center items-center bg-black/60 px-6">
          <View
            className="w-full max-w-sm rounded-xl p-6 border"
            style={{
              backgroundColor: colors.card,
              borderColor: colors.border,
            }}
          >
            <View className="items-center mb-4">
              <ArrowUpCircle size={40} color="#f97316" />
            </View>
            <Text className="text-lg font-bold text-center text-neutral-900 dark:text-neutral-100 mb-2">
              Update Available
            </Text>
            <Text className="text-sm text-center text-neutral-600 dark:text-neutral-400 mb-1">
              {versionLabel(undefined, latestRelease?.digest, latestRelease?.version)}
            </Text>
            {latestRelease?.changelog && (
              <View className="bg-neutral-100 dark:bg-neutral-800 rounded-lg px-3 py-2 mt-3 mb-1">
                <Text className="text-xs text-neutral-500 dark:text-neutral-400 font-semibold mb-1">What's new:</Text>
                <Text className="text-sm text-neutral-700 dark:text-neutral-300">{latestRelease.changelog}</Text>
              </View>
            )}
            <Text className="text-xs text-center text-neutral-500 dark:text-neutral-400 mt-3">
              The agent will be briefly unavailable during the update.
            </Text>
            <Pressable
              onPress={async () => {
                setRestarting(true);
                try {
                  await restartAgent({ agentId: id as string });
                  setShowUpdateModal(false);
                } catch (e) {
                  if (Platform.OS === "web") {
                    window.alert(e.message || "Failed to update agent");
                  } else {
                    Alert.alert("Error", e.message || "Failed to update agent");
                  }
                } finally {
                  setRestarting(false);
                }
              }}
              disabled={restarting}
              style={{
                backgroundColor: restarting ? "#d4d4d4" : "#f97316",
                paddingVertical: 14,
                borderRadius: 10,
                alignItems: "center",
                marginTop: 16,
                opacity: restarting ? 0.5 : 1,
              }}
            >
              {restarting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>
                  Update
                </Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => setShowUpdateModal(false)}
              disabled={restarting}
              style={{ paddingVertical: 12, alignItems: "center", marginTop: 8 }}
            >
              <Text className="font-medium text-neutral-500 dark:text-neutral-400">Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Terminate Agent Confirmation Modal */}
      <Modal
        visible={showTerminateModal}
        transparent
        animationType="fade"
        onRequestClose={() => !terminating && setShowTerminateModal(false)}
      >
        <View className="flex-1 justify-center items-center bg-black/60 px-6">
          <View
            className="w-full max-w-sm rounded-xl p-6 border"
            style={{
              backgroundColor: colors.card,
              borderColor: colors.border,
            }}
          >
            <View className="items-center mb-4">
              <AlertTriangle size={40} color="#ef4444" />
            </View>
            <Text className="text-lg font-bold text-center text-neutral-900 dark:text-neutral-100 mb-2">
              Delete Agent?
            </Text>
            <Text className="text-sm text-center text-neutral-600 dark:text-neutral-400 mb-4">
              This will permanently delete this agent and all its data. This action cannot be undone.
            </Text>
            <Text className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
              Type <Text className="font-bold text-red-600 dark:text-red-400">DELETE</Text> to confirm:
            </Text>
            <Input
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              placeholder="DELETE"
              autoFocus
              autoCapitalize="characters"
            />
            <Pressable
              onPress={async () => {
                setTerminating(true);
                try {
                  await terminateAgent({ agentId: id as string });
                  setShowTerminateModal(false);
                  router.back();
                } catch (e) {
                  Alert.alert("Error", e.message || "Failed to delete agent");
                } finally {
                  setTerminating(false);
                }
              }}
              disabled={deleteConfirmText !== "DELETE" || terminating}
              style={{
                backgroundColor: deleteConfirmText === "DELETE" && !terminating ? "#dc2626" : "transparent",
                borderWidth: deleteConfirmText === "DELETE" && !terminating ? 0 : 1,
                borderColor: colors.border,
                paddingVertical: 14,
                borderRadius: 10,
                alignItems: "center",
                marginTop: 16,
              }}
            >
              {terminating ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={{ color: deleteConfirmText === "DELETE" && !terminating ? "#fff" : colors.mutedForeground, fontWeight: "700", fontSize: 15 }}>
                  Delete Agent
                </Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => setShowTerminateModal(false)}
              disabled={terminating}
              style={{
                paddingVertical: 12,
                alignItems: "center",
                marginTop: 8,
              }}
            >
              <Text className="font-medium text-neutral-500 dark:text-neutral-400">
                Cancel
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      </WebContent>
    </ScrollView>
  );
}
