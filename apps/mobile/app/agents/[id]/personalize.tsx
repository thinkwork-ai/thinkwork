import { useState, useEffect, useCallback } from "react";
import { View, ScrollView, TextInput, ActivityIndicator, Pressable } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useColorScheme } from "nativewind";
import { Save, Code, FormInput } from "lucide-react-native";
import { DetailLayout } from "@/components/layout/detail-layout";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { useAgent } from "@/lib/hooks/use-agents";
import { useTenant } from "@/lib/hooks/use-tenants";
import { workspaceApi } from "@/lib/workspace-api";

// ---------------------------------------------------------------------------
// Form fields → workspace file mapping
// ---------------------------------------------------------------------------

type PersonalizationForm = {
  agentName: string;
  personalityTraits: string;
  communicationStyle: "formal" | "casual" | "balanced";
  preferredName: string;
  roleDescription: string;
  aboutMe: string;
  topicsOfInterest: string;
  thingsToRemember: string;
  timezone: string;
};

const DEFAULT_FORM: PersonalizationForm = {
  agentName: "",
  personalityTraits: "",
  communicationStyle: "balanced",
  preferredName: "",
  roleDescription: "",
  aboutMe: "",
  topicsOfInterest: "",
  thingsToRemember: "",
  timezone: "",
};

// Parse structured sections from markdown files
function parseFormFromMarkdown(
  soul: string,
  identity: string,
  user: string,
): PersonalizationForm {
  const form = { ...DEFAULT_FORM };

  // Parse IDENTITY.md for agent name
  const nameMatch = identity.match(/^#\s+(.+)/m);
  if (nameMatch) form.agentName = nameMatch[1].trim();

  // Parse SOUL.md for personality and style
  const traitsMatch = soul.match(/## Personality\n([\s\S]*?)(?=\n##|\n$|$)/);
  if (traitsMatch) form.personalityTraits = traitsMatch[1].trim();

  const styleMatch = soul.match(/## Communication Style\n([\s\S]*?)(?=\n##|\n$|$)/);
  if (styleMatch) {
    const style = styleMatch[1].trim().toLowerCase();
    if (style.includes("formal")) form.communicationStyle = "formal";
    else if (style.includes("casual")) form.communicationStyle = "casual";
    else form.communicationStyle = "balanced";
  }

  // Parse USER.md for human context
  const prefNameMatch = user.match(/## Name\n(.+)/);
  if (prefNameMatch) form.preferredName = prefNameMatch[1].trim();

  const roleMatch = user.match(/## Role\n([\s\S]*?)(?=\n##|\n$|$)/);
  if (roleMatch) form.roleDescription = roleMatch[1].trim();

  const aboutMatch = user.match(/## About\n([\s\S]*?)(?=\n##|\n$|$)/);
  if (aboutMatch) form.aboutMe = aboutMatch[1].trim();

  const topicsMatch = user.match(/## Topics of Interest\n([\s\S]*?)(?=\n##|\n$|$)/);
  if (topicsMatch) form.topicsOfInterest = topicsMatch[1].trim();

  const rememberMatch = user.match(/## Things to Remember\n([\s\S]*?)(?=\n##|\n$|$)/);
  if (rememberMatch) form.thingsToRemember = rememberMatch[1].trim();

  const tzMatch = user.match(/## Timezone\n(.+)/);
  if (tzMatch) form.timezone = tzMatch[1].trim();

  return form;
}

// Render form back to structured markdown
function renderIdentityMd(form: PersonalizationForm): string {
  return `# ${form.agentName || "Agent"}\n`;
}

function renderSoulMd(form: PersonalizationForm): string {
  const sections: string[] = [];
  sections.push("# Soul\n");
  if (form.personalityTraits) {
    sections.push(`## Personality\n${form.personalityTraits}\n`);
  }
  sections.push(`## Communication Style\n${form.communicationStyle}\n`);
  return sections.join("\n");
}

function renderUserMd(form: PersonalizationForm): string {
  const sections: string[] = [];
  sections.push("# User Context\n");
  if (form.preferredName) sections.push(`## Name\n${form.preferredName}\n`);
  if (form.roleDescription) sections.push(`## Role\n${form.roleDescription}\n`);
  if (form.aboutMe) sections.push(`## About\n${form.aboutMe}\n`);
  if (form.topicsOfInterest) sections.push(`## Topics of Interest\n${form.topicsOfInterest}\n`);
  if (form.thingsToRemember) sections.push(`## Things to Remember\n${form.thingsToRemember}\n`);
  if (form.timezone) sections.push(`## Timezone\n${form.timezone}\n`);
  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Style options
// ---------------------------------------------------------------------------

const STYLE_OPTIONS: { value: PersonalizationForm["communicationStyle"]; label: string }[] = [
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
  const instanceId = agent?.slug ?? id;
  const isPersonalAgent = !!agent?.humanPairId;

  const [{ data: tenantData }] = useTenant(agent?.tenantId);
  const tenantSlug = tenantData?.tenant?.slug ?? "";

  const [form, setForm] = useState<PersonalizationForm>(DEFAULT_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [advancedMode, setAdvancedMode] = useState(false);

  // Raw markdown for advanced mode
  const [rawSoul, setRawSoul] = useState("");
  const [rawIdentity, setRawIdentity] = useState("");
  const [rawUser, setRawUser] = useState("");

  const loadFiles = useCallback(async () => {
    if (!tenantSlug || !instanceId) return;
    setLoading(true);
    try {
      const [soulRes, identityRes, userRes] = await Promise.all([
        workspaceApi({ action: "get", tenantSlug, instanceId, path: "SOUL.md" }),
        workspaceApi({ action: "get", tenantSlug, instanceId, path: "IDENTITY.md" }),
        workspaceApi({ action: "get", tenantSlug, instanceId, path: "USER.md" }),
      ]);
      const soul = soulRes.content ?? "";
      const identity = identityRes.content ?? "";
      const user = userRes.content ?? "";
      setRawSoul(soul);
      setRawIdentity(identity);
      setRawUser(user);
      setForm(parseFormFromMarkdown(soul, identity, user));
    } catch (err) {
      console.error("Failed to load workspace files:", err);
    } finally {
      setLoading(false);
    }
  }, [tenantSlug, instanceId]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const handleSave = async () => {
    if (!tenantSlug || !instanceId) return;
    setSaving(true);
    try {
      if (advancedMode) {
        await Promise.all([
          workspaceApi({ action: "put", tenantSlug, instanceId, path: "SOUL.md", content: rawSoul }),
          workspaceApi({ action: "put", tenantSlug, instanceId, path: "IDENTITY.md", content: rawIdentity }),
          workspaceApi({ action: "put", tenantSlug, instanceId, path: "USER.md", content: rawUser }),
        ]);
      } else {
        await Promise.all([
          workspaceApi({ action: "put", tenantSlug, instanceId, path: "SOUL.md", content: renderSoulMd(form) }),
          workspaceApi({ action: "put", tenantSlug, instanceId, path: "IDENTITY.md", content: renderIdentityMd(form) }),
          workspaceApi({ action: "put", tenantSlug, instanceId, path: "USER.md", content: renderUserMd(form) }),
        ]);
        // Update raw values for advanced mode consistency
        setRawSoul(renderSoulMd(form));
        setRawIdentity(renderIdentityMd(form));
        setRawUser(renderUserMd(form));
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
            This is a team agent. Personality is managed by your admin in the Team dashboard.
          </Muted>
        </View>
      </DetailLayout>
    );
  }

  return (
    <DetailLayout
      title="Personalize"
      rightAction={
        <Pressable onPress={handleSave} disabled={saving} className="active:opacity-70">
          {saving ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Save size={22} color={colors.primary} />
          )}
        </Pressable>
      }
    >
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Mode toggle */}
        <View className="flex-row items-center justify-end px-4 py-2">
          <Pressable
            onPress={() => {
              if (!advancedMode) {
                // Switching to advanced: render form to markdown
                setRawSoul(renderSoulMd(form));
                setRawIdentity(renderIdentityMd(form));
                setRawUser(renderUserMd(form));
              } else {
                // Switching to form: parse markdown to form
                setForm(parseFormFromMarkdown(rawSoul, rawIdentity, rawUser));
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
              <Text className="text-sm font-medium mb-1">SOUL.md</Text>
              <TextInput
                value={rawSoul}
                onChangeText={setRawSoul}
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
            <View>
              <Text className="text-sm font-medium mb-1">IDENTITY.md</Text>
              <TextInput
                value={rawIdentity}
                onChangeText={setRawIdentity}
                multiline
                style={{
                  minHeight: 80,
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
              <FormField label="Agent Name" value={form.agentName}
                onChangeText={(v) => updateField("agentName", v)} placeholder="e.g. Nova" />
              <FormField label="Personality" value={form.personalityTraits}
                onChangeText={(v) => updateField("personalityTraits", v)}
                placeholder="e.g. friendly, concise, technical" multiline />

              <Text className="text-sm font-medium mb-1.5 mt-3">Communication Style</Text>
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
                    <Text className={`text-sm ${
                      form.communicationStyle === opt.value ? "font-semibold" : ""
                    }`}>
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* About You */}
            <View>
              <Text className="text-lg font-semibold mb-3">About You</Text>
              <FormField label="Your Name" value={form.preferredName}
                onChangeText={(v) => updateField("preferredName", v)} placeholder="What should the agent call you?" />
              <FormField label="Your Role" value={form.roleDescription}
                onChangeText={(v) => updateField("roleDescription", v)}
                placeholder="e.g. Senior Engineer, Product Manager" />
              <FormField label="About You" value={form.aboutMe}
                onChangeText={(v) => updateField("aboutMe", v)}
                placeholder="Anything the agent should know about you" multiline />
              <FormField label="Topics of Interest" value={form.topicsOfInterest}
                onChangeText={(v) => updateField("topicsOfInterest", v)}
                placeholder="e.g. AI, distributed systems, product strategy" />
              <FormField label="Things to Remember" value={form.thingsToRemember}
                onChangeText={(v) => updateField("thingsToRemember", v)}
                placeholder="Persistent notes for the agent" multiline />
              <FormField label="Timezone" value={form.timezone}
                onChangeText={(v) => updateField("timezone", v)}
                placeholder="e.g. America/Chicago" />
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
