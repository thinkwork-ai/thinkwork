import { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  ScrollView,
  ActivityIndicator,
  Pressable,
  Modal,
  Alert,
  TextInput,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { useMutation } from "urql";
import { useAuth } from "@/lib/auth-context";
import { useAgent } from "@/lib/hooks/use-agents";
import { useTenant } from "@/lib/hooks/use-tenants";
import { SetAgentSkillsMutation } from "@/lib/graphql-queries";
import { DetailLayout } from "@/components/layout/detail-layout";
import { WebContent } from "@/components/layout/web-content";
import { Text, Muted } from "@/components/ui/typography";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";
import {
  Zap,
  Plus,
  X,
  CheckCircle2,
  XCircle,
  ExternalLink,
} from "lucide-react-native";
import {
  listCatalog,
  installSkillToAgent,
  saveSkillCredentials,
  buildOAuthUrl,
  type CatalogSkill,
} from "@/lib/skills-api";

export default function AgentSkillsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const { user } = useAuth();

  // ── Data ──────────────────────────────────────────────────────────────
  const [{ data: agentData }, reexecuteAgent] = useAgent(id);
  const agent = agentData?.agent;
  const [{ data: tenantData }] = useTenant(agent?.tenantId);
  const tenantSlug = tenantData?.tenant?.slug ?? "";

  const [, setSkillsMut] = useMutation(SetAgentSkillsMutation);

  // Local mirror of agent skills for optimistic UI
  const serverSkills = (agent?.skills ?? []) as readonly {
    id: string;
    skillId: string;
    enabled: boolean;
    config?: any;
  }[];
  const [items, setItems] = useState(
    serverSkills.map((s) => ({ skillId: s.skillId, enabled: s.enabled, config: s.config })),
  );
  useEffect(() => {
    setItems(serverSkills.map((s) => ({ skillId: s.skillId, enabled: s.enabled, config: s.config })));
  }, [serverSkills.length]);

  // Catalog
  const [catalog, setCatalog] = useState<CatalogSkill[] | null>(null);
  useEffect(() => {
    listCatalog().then(setCatalog).catch((err) => {
      console.error("[Skills] Failed to load catalog:", err);
      setCatalog([]);
    });
  }, []);
  const catalogMap = useMemo(
    () => new Map((catalog ?? []).map((s) => [s.slug, s])),
    [catalog],
  );

  const availableSkills = useMemo(
    () => (catalog ?? []).filter((s) => !items.some((i) => i.skillId === s.slug)),
    [catalog, items],
  );

  const refresh = useCallback(() => {
    reexecuteAgent({ requestPolicy: "network-only" });
  }, [reexecuteAgent]);

  // ── Persist skills ────────────────────────────────────────────────────
  const persistSkills = useCallback(
    async (list: typeof items) => {
      const res = await setSkillsMut({
        agentId: id!,
        skills: list.map((s) => ({
          skillId: s.skillId,
          enabled: s.enabled,
          config: typeof s.config === "string" ? s.config : s.config ? JSON.stringify(s.config) : undefined,
        })),
      });
      if (!res.error) refresh();
    },
    [id, setSkillsMut, refresh],
  );

  // ── Add skill modal ───────────────────────────────────────────────────
  const [showAddModal, setShowAddModal] = useState(false);
  const [addingSlug, setAddingSlug] = useState<string | null>(null);

  // ── Config modal (OAuth or env vars) ──────────────────────────────────
  const [configSkillId, setConfigSkillId] = useState<string | null>(null);
  const [configIsEdit, setConfigIsEdit] = useState(false);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [savingCreds, setSavingCreds] = useState(false);
  const [oauthConnecting, setOauthConnecting] = useState(false);
  const [oauthConnected, setOauthConnected] = useState(false);

  const configMeta = configSkillId ? catalogMap.get(configSkillId) : null;
  const isOAuthSkill = !!configMeta?.oauth_provider;
  const envFields = configMeta?.requires_env ?? [];
  const skillItem = configSkillId ? items.find((s) => s.skillId === configSkillId) : null;

  const hasConnection = useMemo(() => {
    if (!skillItem?.config) return false;
    let cfg = skillItem.config;
    try { while (typeof cfg === "string") cfg = JSON.parse(cfg); } catch { return false; }
    return !!(cfg as Record<string, unknown>)?.connectionId;
  }, [skillItem?.config]);

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleAddSkill = async (slug: string) => {
    if (!tenantSlug || !agent?.slug) return;
    setAddingSlug(slug);
    try {
      await installSkillToAgent(tenantSlug, agent.slug, slug);
      const meta = catalogMap.get(slug);
      const initialConfig = meta?.mcp_server
        ? JSON.stringify({ mcpServer: meta.mcp_server, skillType: slug })
        : undefined;
      const newItems = [...items, { skillId: slug, enabled: true, config: initialConfig }];
      setItems(newItems);
      await persistSkills(newItems);
      setShowAddModal(false);

      // Open config if needed
      if (meta?.oauth_provider) {
        setConfigIsEdit(false);
        setOauthConnecting(false);
        setOauthConnected(false);
        setConfigSkillId(slug);
      } else if (meta?.requires_env && meta.requires_env.length > 0) {
        const defaults = meta.env_defaults || {};
        setEnvValues(Object.fromEntries(meta.requires_env.map((f) => [f, defaults[f] || ""])));
        setConfigIsEdit(false);
        setConfigSkillId(slug);
      }
    } catch (err) {
      Alert.alert("Install Failed", String(err));
    } finally {
      setAddingSlug(null);
    }
  };

  const openConfigModal = (skillId: string) => {
    const meta = catalogMap.get(skillId);
    if (meta && !meta.oauth_provider) {
      const defaults = meta.env_defaults || {};
      setEnvValues(Object.fromEntries((meta.requires_env || []).map((f) => [f, defaults[f] || ""])));
    }
    setOauthConnecting(false);
    setOauthConnected(false);
    setConfigIsEdit(true);
    setConfigSkillId(skillId);
  };

  const handleOAuth = async () => {
    if (!configSkillId || !configMeta?.oauth_provider || !user?.sub || !agent?.tenantId) return;
    setOauthConnecting(true);
    try {
      const url = buildOAuthUrl({
        provider: configMeta.oauth_provider,
        scopes: configMeta.oauth_scopes ?? [],
        userId: user.sub,
        tenantId: agent.tenantId,
        agentId: id!,
        skillId: configSkillId,
      });
      await WebBrowser.openAuthSessionAsync(url, Linking.createURL("oauth/callback"));
      // Browser closed — refresh to pick up the new connectionId
      refresh();
      setOauthConnecting(false);
      setOauthConnected(true);
      setTimeout(() => {
        setConfigSkillId(null);
        setOauthConnected(false);
      }, 1500);
    } catch (err) {
      console.error("[Skills] OAuth failed:", err);
      setOauthConnecting(false);
    }
  };

  const handleSaveCreds = async () => {
    if (!configSkillId) return;
    setSavingCreds(true);
    try {
      await saveSkillCredentials(id!, configSkillId, envValues);
      refresh();
      setConfigSkillId(null);
    } catch (err) {
      Alert.alert("Save Failed", String(err));
    } finally {
      setSavingCreds(false);
    }
  };

  const handleDeleteSkill = (skillId: string) => {
    Alert.alert("Remove Skill", "Remove this skill from the agent?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          const newItems = items.filter((s) => s.skillId !== skillId);
          setItems(newItems);
          await persistSkills(newItems);
          setConfigSkillId(null);
        },
      },
    ]);
  };

  const providerLabel = (provider?: string) => {
    if (provider === "google_productivity") return "Google";
    if (provider === "microsoft_365") return "Microsoft";
    return "Provider";
  };

  // ── Derived display data ──────────────────────────────────────────────
  const displaySkills = items.map((s) => {
    const meta = catalogMap.get(s.skillId);
    let cfg: Record<string, unknown> = {};
    try {
      let parsed = s.config;
      while (typeof parsed === "string") parsed = JSON.parse(parsed);
      cfg = (parsed as Record<string, unknown>) || {};
    } catch { /* ignore */ }
    const needsConfig = !!(meta?.oauth_provider || meta?.requires_env?.length);
    const isConfigured = needsConfig ? !!(cfg.connectionId || cfg.secretRef) : true;
    return {
      skillId: s.skillId,
      enabled: s.enabled,
      name: meta?.name ?? s.skillId,
      description: meta?.description ?? "",
      needsConfig,
      isConfigured,
    };
  });

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <DetailLayout
      title="Skills"
      onBack={() => router.back()}
      headerRight={
        <Pressable onPress={() => setShowAddModal(true)} className="flex-row items-center gap-1 p-1">
          <Plus size={16} color={colors.primary} />
          <Text style={{ color: colors.primary }} className="font-semibold text-base">Add</Text>
        </Pressable>
      }
    >
      <View className="flex-1">
        <ScrollView className="flex-1">
          <WebContent>
            {!agent ? (
              <View className="p-6 items-center">
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : displaySkills.length === 0 ? (
              <View className="flex-1 items-center justify-center p-8 mt-12">
                <Zap size={48} color={colors.mutedForeground} />
                <Muted className="text-center mt-4 text-base leading-6">
                  No skills installed.{"\n"}Tap Add to expand your agent's capabilities.
                </Muted>
              </View>
            ) : (
              <View className="mx-4 mt-4 rounded-xl overflow-hidden bg-white dark:bg-neutral-900">
                {displaySkills.map((skill, idx, arr) => (
                  <Pressable
                    key={skill.skillId}
                    onPress={() => openConfigModal(skill.skillId)}
                    className={`flex-row items-center px-4 py-4 active:opacity-70${idx < arr.length - 1 ? " border-b border-neutral-100 dark:border-neutral-800" : ""}`}
                  >
                    <View className="flex-1 mr-3">
                      <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                        {skill.name}
                      </Text>
                      <Muted className="text-sm mt-0.5" numberOfLines={2}>
                        {skill.description}
                      </Muted>
                    </View>
                    {skill.needsConfig && (
                      skill.isConfigured ? (
                        <CheckCircle2 size={18} color="#22c55e" />
                      ) : (
                        <XCircle size={18} color={colors.mutedForeground} />
                      )
                    )}
                  </Pressable>
                ))}
              </View>
            )}
          </WebContent>
        </ScrollView>
      </View>

      {/* ── Add Skill Modal ──────────────────────────────────────────────── */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowAddModal(false)}
      >
        <View className="flex-1 bg-white dark:bg-neutral-950">
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
            <Text className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              Add Skill
            </Text>
            <Pressable onPress={() => setShowAddModal(false)} className="p-1">
              <X size={20} color={colors.foreground} />
            </Pressable>
          </View>

          <ScrollView className="flex-1">
            {catalog === null ? (
              <View className="p-6 items-center">
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : availableSkills.length === 0 ? (
              <View className="p-8 items-center">
                <Muted className="text-center">All available skills are installed.</Muted>
              </View>
            ) : (
              availableSkills.map((skill) => (
                <Pressable
                  key={skill.slug}
                  onPress={() => handleAddSkill(skill.slug)}
                  disabled={addingSlug === skill.slug}
                  className="flex-row items-center justify-between px-4 py-4 border-b border-neutral-100 dark:border-neutral-800 active:opacity-70"
                >
                  <View className="flex-1 mr-3">
                    <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                      {skill.name}
                    </Text>
                    <Muted className="text-sm mt-0.5" numberOfLines={2}>
                      {skill.description}
                    </Muted>
                  </View>
                  {addingSlug === skill.slug ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <View className="px-3 py-2 rounded-lg items-center justify-center" style={{ backgroundColor: colors.primary, minWidth: 72 }}>
                      <Text className="text-white font-medium text-sm">Install</Text>
                    </View>
                  )}
                </Pressable>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* ── Config / Credential Modal ────────────────────────────────────── */}
      <Modal
        visible={!!configSkillId}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => { setConfigSkillId(null); setOauthConnecting(false); }}
      >
        <View className="flex-1 bg-white dark:bg-neutral-950">
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
            <Text className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              {isOAuthSkill ? "Connect Account" : "Configure Credentials"}
            </Text>
            <Pressable onPress={() => { setConfigSkillId(null); setOauthConnecting(false); }} className="p-1">
              <X size={20} color={colors.foreground} />
            </Pressable>
          </View>

          <ScrollView className="flex-1 px-4 py-4">
            <Muted className="mb-4">
              {isOAuthSkill
                ? `Connect your ${configMeta?.name || configSkillId} account to enable this skill.`
                : `Enter the environment variables required by ${configMeta?.name || configSkillId}.`}
            </Muted>

            {isOAuthSkill ? (
              <View className="items-center gap-4 py-4">
                {hasConnection || oauthConnected ? (
                  <View className="flex-row items-center gap-2">
                    <CheckCircle2 size={20} color="#22c55e" />
                    <Text className="text-sm font-medium" style={{ color: "#22c55e" }}>
                      {oauthConnected ? "Successfully connected!" : "Account connected"}
                    </Text>
                  </View>
                ) : oauthConnecting ? (
                  <View className="items-center gap-2">
                    <ActivityIndicator color={colors.primary} />
                    <Muted className="text-sm">Complete sign-in in the browser...</Muted>
                  </View>
                ) : (
                  <Pressable
                    onPress={handleOAuth}
                    className="flex-row items-center gap-2 rounded-lg px-6 py-3"
                    style={{ backgroundColor: colors.primary }}
                  >
                    <ExternalLink size={16} color="white" />
                    <Text className="text-white font-semibold text-base">
                      Sign in with {providerLabel(configMeta?.oauth_provider)}
                    </Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <>
                {envFields.map((field) => (
                  <View key={field} className="mb-4">
                    <Text className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1 font-mono">
                      {field}
                    </Text>
                    <TextInput
                      value={envValues[field] ?? ""}
                      onChangeText={(text) => setEnvValues((prev) => ({ ...prev, [field]: text }))}
                      secureTextEntry={field.toLowerCase().includes("password") || field.toLowerCase().includes("secret")}
                      placeholder={field}
                      placeholderTextColor={colors.mutedForeground}
                      autoCapitalize="none"
                      autoCorrect={false}
                      className="border border-neutral-300 dark:border-neutral-700 rounded-lg text-neutral-900 dark:text-neutral-100 bg-white dark:bg-neutral-900"
                      style={{ height: 44, paddingHorizontal: 12, fontSize: 16 }}
                    />
                  </View>
                ))}
                {!isOAuthSkill && envFields.length > 0 && (
                  <Pressable
                    onPress={handleSaveCreds}
                    disabled={savingCreds || envFields.some((f) => !envValues[f]?.trim())}
                    className="rounded-lg py-3 items-center mt-2"
                    style={{ backgroundColor: savingCreds || envFields.some((f) => !envValues[f]?.trim()) ? colors.muted : colors.primary }}
                  >
                    {savingCreds ? (
                      <ActivityIndicator size="small" color="white" />
                    ) : (
                      <Text className="text-white font-semibold text-base">Save Credentials</Text>
                    )}
                  </Pressable>
                )}
              </>
            )}

            {/* Remove Skill button (only in edit mode) */}
            {configIsEdit && configSkillId && (
              <Pressable
                onPress={() => handleDeleteSkill(configSkillId)}
                className="mt-8 py-3 items-center"
              >
                <Text className="text-red-500 font-medium text-base">Remove Skill</Text>
              </Pressable>
            )}
          </ScrollView>
        </View>
      </Modal>
    </DetailLayout>
  );
}
