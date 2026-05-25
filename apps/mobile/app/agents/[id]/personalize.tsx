import { useState, useEffect, useCallback } from "react";
import {
  View,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useColorScheme } from "nativewind";
import { Save, Code, FormInput } from "lucide-react-native";
import { DetailLayout } from "@/components/layout/detail-layout";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { useAgent } from "@/lib/hooks/use-agents";
import { getWorkspaceFile, putWorkspaceFile } from "@/lib/workspace-api";
import {
  DEFAULT_PERSONALIZATION_FORM,
  parseFormFromMarkdown,
  renderAgentsMd,
  renderUserMd,
  type PersonalizationForm,
} from "@/lib/personalization-markdown";

// ---------------------------------------------------------------------------
// Style options
// ---------------------------------------------------------------------------

const STYLE_OPTIONS: {
  value: PersonalizationForm["communicationStyle"];
  label: string;
}[] = [
  { value: "formal", label: "Formal" },
  { value: "balanced", label: "Balanced" },
  { value: "casual", label: "Casual" },
];

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function PersonalizeAgentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const [{ data: agentData }] = useAgent(id);
  const agent = agentData?.agent;
  const isPersonalAgent = !!agent?.humanPairId;

  const [form, setForm] = useState<PersonalizationForm>(
    DEFAULT_PERSONALIZATION_FORM,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [advancedMode, setAdvancedMode] = useState(false);

  // Raw markdown for advanced mode
  const [rawAgentsMd, setRawAgentsMd] = useState("");
  const [rawUser, setRawUser] = useState("");

  const loadFiles = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const target = { agentId: id };
      const [agentsRes, userRes] = await Promise.all([
        getWorkspaceFile(target, "AGENTS.md"),
        getWorkspaceFile(target, "USER.md"),
      ]);
      const agentsMd = agentsRes.content ?? "";
      const user = userRes.content ?? "";
      setRawAgentsMd(agentsMd);
      setRawUser(user);
      setForm(parseFormFromMarkdown(agentsMd, user));
    } catch (err) {
      console.error("Failed to load workspace files:", err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    try {
      const target = { agentId: id };
      if (advancedMode) {
        await Promise.all([
          putWorkspaceFile(target, "AGENTS.md", rawAgentsMd),
          putWorkspaceFile(target, "USER.md", rawUser),
        ]);
      } else {
        const nextAgentsMd = renderAgentsMd(rawAgentsMd, form);
        const nextUserMd = renderUserMd(form);
        await Promise.all([
          putWorkspaceFile(target, "AGENTS.md", nextAgentsMd),
          putWorkspaceFile(target, "USER.md", nextUserMd),
        ]);
        // Update raw values for advanced mode consistency
        setRawAgentsMd(nextAgentsMd);
        setRawUser(nextUserMd);
      }
    } catch (err) {
      console.error("Failed to save:", err);
    } finally {
      setSaving(false);
    }
  };

  const updateField = (key: keyof PersonalizationForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <DetailLayout title="Personalize">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      </DetailLayout>
    );
  }

  if (!isPersonalAgent) {
    return (
      <DetailLayout title="Personalize">
        <View className="flex-1 items-center justify-center px-6">
          <Muted className="text-center">
            This is a team agent. Personality is managed by your admin in the
            Team dashboard.
          </Muted>
        </View>
      </DetailLayout>
    );
  }

  return (
    <DetailLayout
      title="Personalize"
      rightAction={
        <Pressable
          onPress={handleSave}
          disabled={saving}
          className="active:opacity-70"
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Save size={22} color={colors.primary} />
          )}
        </Pressable>
      }
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Mode toggle */}
        <View className="flex-row items-center justify-end px-4 py-2">
          <Pressable
            onPress={() => {
              if (!advancedMode) {
                // Switching to advanced: render form to markdown
                setRawAgentsMd(renderAgentsMd(rawAgentsMd, form));
                setRawUser(renderUserMd(form));
              } else {
                // Switching to form: parse markdown to form
                setForm(parseFormFromMarkdown(rawAgentsMd, rawUser));
              }
              setAdvancedMode(!advancedMode);
            }}
            className="flex-row items-center gap-1.5 active:opacity-70"
          >
            {advancedMode ? (
              <FormInput size={16} color={colors.mutedForeground} />
            ) : (
              <Code size={16} color={colors.mutedForeground} />
            )}
            <Muted className="text-xs">
              {advancedMode ? "Form Mode" : "Advanced Mode"}
            </Muted>
          </Pressable>
        </View>

        {advancedMode ? (
          <View className="px-4 gap-4">
            <View>
              <Text className="text-sm font-medium mb-1">AGENTS.md</Text>
              <TextInput
                value={rawAgentsMd}
                onChangeText={setRawAgentsMd}
                multiline
                style={{
                  minHeight: 180,
                  fontFamily: "monospace",
                  fontSize: 13,
                  color: colors.foreground,
                  backgroundColor: colors.muted,
                  borderRadius: 8,
                  padding: 12,
                  textAlignVertical: "top",
                }}
              />
            </View>
            <View>
              <Text className="text-sm font-medium mb-1">USER.md</Text>
              <TextInput
                value={rawUser}
                onChangeText={setRawUser}
                multiline
                style={{
                  minHeight: 120,
                  fontFamily: "monospace",
                  fontSize: 13,
                  color: colors.foreground,
                  backgroundColor: colors.muted,
                  borderRadius: 8,
                  padding: 12,
                  textAlignVertical: "top",
                }}
              />
            </View>
          </View>
        ) : (
          <View className="px-4 gap-5">
            {/* Agent Identity */}
            <View>
              <Text className="text-lg font-semibold mb-3">Agent Identity</Text>
              <FormField
                label="Agent Name"
                value={form.agentName}
                onChangeText={(v) => updateField("agentName", v)}
                placeholder="e.g. Nova"
              />
              <FormField
                label="Personality"
                value={form.personalityTraits}
                onChangeText={(v) => updateField("personalityTraits", v)}
                placeholder="e.g. friendly, concise, technical"
                multiline
              />

              <Text className="text-sm font-medium mb-1.5 mt-3">
                Communication Style
              </Text>
              <View className="flex-row gap-2">
                {STYLE_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.value}
                    onPress={() => updateField("communicationStyle", opt.value)}
                    className={`flex-1 items-center py-2 rounded-lg border ${
                      form.communicationStyle === opt.value
                        ? "border-primary bg-primary/10"
                        : "border-neutral-300 dark:border-neutral-700"
                    }`}
                  >
                    <Text
                      className={`text-sm ${
                        form.communicationStyle === opt.value
                          ? "font-semibold"
                          : ""
                      }`}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* About You */}
            <View>
              <Text className="text-lg font-semibold mb-3">About You</Text>
              <FormField
                label="Your Name"
                value={form.preferredName}
                onChangeText={(v) => updateField("preferredName", v)}
                placeholder="What should the agent call you?"
              />
              <FormField
                label="Your Role"
                value={form.roleDescription}
                onChangeText={(v) => updateField("roleDescription", v)}
                placeholder="e.g. Senior Engineer, Product Manager"
              />
              <FormField
                label="About You"
                value={form.aboutMe}
                onChangeText={(v) => updateField("aboutMe", v)}
                placeholder="Anything the agent should know about you"
                multiline
              />
              <FormField
                label="Topics of Interest"
                value={form.topicsOfInterest}
                onChangeText={(v) => updateField("topicsOfInterest", v)}
                placeholder="e.g. AI, distributed systems, product strategy"
              />
              <FormField
                label="Things to Remember"
                value={form.thingsToRemember}
                onChangeText={(v) => updateField("thingsToRemember", v)}
                placeholder="Persistent notes for the agent"
                multiline
              />
              <FormField
                label="Timezone"
                value={form.timezone}
                onChangeText={(v) => updateField("timezone", v)}
                placeholder="e.g. America/Chicago"
              />
            </View>
          </View>
        )}
      </ScrollView>
    </DetailLayout>
  );
}

// ---------------------------------------------------------------------------
// Form field component
// ---------------------------------------------------------------------------

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  return (
    <View className="mb-3">
      <Text className="text-sm font-medium mb-1.5">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        multiline={multiline}
        style={{
          minHeight: multiline ? 80 : 40,
          fontSize: 14,
          color: colors.foreground,
          backgroundColor: colors.muted,
          borderRadius: 8,
          paddingHorizontal: 12,
          paddingVertical: multiline ? 10 : 0,
          textAlignVertical: multiline ? "top" : "center",
        }}
      />
    </View>
  );
}
