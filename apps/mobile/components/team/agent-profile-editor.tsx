import { useState, useEffect, useCallback } from "react";
import { View, Pressable, TextInput, Platform } from "react-native";
import { useAgent, useUpdateAgent } from "@/lib/hooks/use-agents";
import { useColorScheme } from "nativewind";
import { Sparkles, X } from "lucide-react-native";
import { Text, Muted } from "@/components/ui/typography";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { COLORS } from "@/lib/theme";

const COMMON_DOMAINS = [
  "compliance", "dispatch", "engineering", "finance", "fleet",
  "hr", "inventory", "legal", "logistics", "marketing",
  "operations", "research", "sales", "support",
];

interface AgentProfileEditorProps {
  agentId: string;
  onSaveReady?: (saveFn: () => Promise<void>) => void;
  onSaveStateChange?: (state: { saving: boolean; canEdit: boolean }) => void;
}

export function AgentProfileEditor({ agentId, onSaveReady, onSaveStateChange }: AgentProfileEditorProps) {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  // TODO: assistantCapabilities.getCapabilities not yet available via GraphQL
  const capabilities: any = undefined;
  const [{ data: agentData }] = useAgent(agentId);
  const agent = agentData?.agent ?? undefined;
  const [, executeUpdateAgent] = useUpdateAgent();
  // TODO: saveProfile and generateDescription actions not yet available via GraphQL
  const saveProfile = async (args: any) => {
    // Fallback: use updateAgent for basic fields
    await executeUpdateAgent({ id: agentId, name: args.agentName });
  };
  const generateDescription = async (_args: any): Promise<string> => {
    // TODO: Replace with GraphQL action when available
    return "Description generation not yet available via GraphQL";
  };

  const [agentName, setAgentName] = useState("");
  const [domains, setDomains] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [humanRole, setHumanRole] = useState("");
  const [scope, setScope] = useState("");
  const [availability, setAvailability] = useState("");
  const [delegationNotes, setDelegationNotes] = useState("");
  const [creature, setCreature] = useState("");
  const [vibe, setVibe] = useState("");
  const [emoji, setEmoji] = useState("");
  const [avatar, setAvatar] = useState("");
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (agent?.name) {
      setAgentName(agent.name);
    }
  }, [agent?.name]);

  // Seed form from existing capabilities
  useEffect(() => {
    if (capabilities) {
      setDomains(capabilities.domains ?? []);
      setDescription(capabilities.description ?? "");
      setHumanRole(capabilities.humanRole ?? "");
      setScope(capabilities.scope ?? "");
      setAvailability(capabilities.availability ?? "");
      setDelegationNotes(capabilities.delegationNotes ?? "");
      setCreature(capabilities.creature ?? "");
      setVibe(capabilities.vibe ?? "");
      setEmoji(capabilities.emoji ?? "");
      setAvatar(capabilities.avatar ?? "");
    }
  }, [capabilities]);

  const toggleDomain = (domain: string) => {
    setDomains((prev) =>
      prev.includes(domain) ? prev.filter((d) => d !== domain) : [...prev, domain]
    );
  };

  const handleGenerate = async () => {
    if (!humanRole.trim() && domains.length === 0) {
      setError("Add a role or domains first to auto-generate");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const result = await generateDescription({
        humanRole: humanRole.trim() || "Team Member",
        domains,
        scope: scope.trim() || undefined,
      });
      setDescription(result);
    } catch (err: any) {
      setError(err.message || "Failed to generate description");
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = useCallback(async () => {
    if (!agentName.trim()) {
      setError("Agent name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveProfile({
        agentId,
        agentName: agentName.trim(),
        domains,
        description: description.trim(),
        humanRole: humanRole.trim() || undefined,
        scope: scope.trim() || undefined,
        availability: availability.trim() || undefined,
        delegationNotes: delegationNotes.trim() || undefined,
        creature: creature.trim() || undefined,
        vibe: vibe.trim() || undefined,
        emoji: emoji.trim() || undefined,
        avatar: avatar.trim() || undefined,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      setError(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [
    agentId,
    agentName,
    domains,
    description,
    humanRole,
    scope,
    availability,
    delegationNotes,
    creature,
    vibe,
    emoji,
    avatar,
    saveProfile,
  ]);

  useEffect(() => {
    onSaveReady?.(handleSave);
  }, [handleSave, onSaveReady]);

  useEffect(() => {
    onSaveStateChange?.({
      saving,
      canEdit: agent?.capabilities?.canEdit !== false,
    });
  }, [saving, agent?.capabilities?.canEdit, onSaveStateChange]);

  const placeholderColor = colorScheme === "dark" ? "#a3a3a3" : "#737373";

  return (
    <View className="mt-2">
      <View className="gap-5">
          <Input
            label="Name"
            placeholder="e.g. Manny"
            value={agentName}
            onChangeText={setAgentName}
            autoCapitalize="words"
          />

          {/* Domain Tags */}
          <View>
            <Text className="mb-2 text-base font-medium text-neutral-900 dark:text-neutral-100">
              Domains
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {COMMON_DOMAINS.map((domain) => {
                const isSelected = domains.includes(domain);
                return (
                  <Pressable key={domain} onPress={() => toggleDomain(domain)}>
                    <Badge
                      variant={isSelected ? "default" : "outline"}
                      className={isSelected ? "" : "opacity-60"}
                    >
                      {domain}
                    </Badge>
                  </Pressable>
                );
              })}
              {/* Custom domains inline with common domains */}
              {domains
                .filter((d) => !COMMON_DOMAINS.includes(d))
                .map((d) => (
                  <Pressable
                    key={d}
                    onPress={() => toggleDomain(d)}
                    className="flex-row items-center rounded-full bg-orange-500 px-2.5 py-0.5 gap-1"
                  >
                    <Text className="text-xs font-medium text-white">{d}</Text>
                    <X size={10} color="#fff" />
                  </Pressable>
                ))}
            </View>
          </View>

          {/* Description with auto-generate */}
          <View>
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-base font-medium text-neutral-900 dark:text-neutral-100">
                Description
              </Text>
              <Pressable
                onPress={handleGenerate}
                disabled={generating}
                className="flex-row items-center gap-1"
              >
                <Sparkles size={14} color={colors.primary} />
                <Text style={{ color: colors.primary }} className="text-sm font-medium">
                  {generating ? "Generating..." : "Auto-generate"}
                </Text>
              </Pressable>
            </View>
            <TextInput
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={5}
              placeholder="Describe what this person and their agent handle..."
              placeholderTextColor={placeholderColor}
              className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-4 py-3 text-neutral-900 dark:text-neutral-100"
              style={[
                { height: 120, textAlignVertical: "top", fontSize: 16, lineHeight: 22 },
                Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : undefined,
              ].filter(Boolean)}
            />
          </View>

          <Input
            label="Human Role"
            placeholder="e.g. Operations Manager"
            value={humanRole}
            onChangeText={setHumanRole}
            autoCapitalize="words"
          />

          <Input
            label="Scope"
            placeholder="e.g. Austin and San Antonio regions"
            value={scope}
            onChangeText={setScope}
          />

          <Input
            label="Availability"
            placeholder="e.g. M-F 6am-4pm CT"
            value={availability}
            onChangeText={setAvailability}
          />

          <Input
            label="Delegation Notes"
            placeholder="e.g. After-hours: route to Mike"
            value={delegationNotes}
            onChangeText={setDelegationNotes}
          />

          <Input
            label="Creature"
            placeholder="e.g. AI agent"
            value={creature}
            onChangeText={setCreature}
          />

          <Input
            label="Vibe"
            placeholder="e.g. Professional, clear, efficient -- no fluff"
            value={vibe}
            onChangeText={setVibe}
          />

          <Input
            label="Emoji"
            placeholder="e.g. robot"
            value={emoji}
            onChangeText={setEmoji}
          />

          <Input
            label="Avatar"
            placeholder="e.g. *(not yet set)*"
            value={avatar}
            onChangeText={setAvatar}
          />

          {error && (
            <View className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
              <Text size="sm" className="text-destructive text-center">
                {error}
              </Text>
            </View>
          )}

          {saved && (
            <View className="rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 px-4 py-3">
              <Text size="sm" className="text-green-700 dark:text-green-300 text-center">
                Profile saved!
              </Text>
            </View>
          )}

        </View>
    </View>
  );
}
