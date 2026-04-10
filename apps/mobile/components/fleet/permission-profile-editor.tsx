import { useState } from "react";
import { View, Switch } from "react-native";
import { Text, Muted } from "@/components/ui/typography";
import { Button } from "@/components/ui/button";

interface PermissionProfileEditorProps {
  stackName: string;
  tenantId: string;
  initialProfile?: {
    profile: string;
    tools: string[];
    data_permissions?: Record<string, string[]>;
  };
  onSave: (profile: any) => Promise<void>;
}

const TOOL_DEFINITIONS = [
  { name: "web_search", label: "Web Search", description: "Search the web" },
  { name: "shell", label: "Shell", description: "Execute shell commands" },
  { name: "browser", label: "Browser", description: "Browse web pages" },
  { name: "file", label: "File Read", description: "Read files" },
  { name: "file_write", label: "File Write", description: "Write files" },
  {
    name: "code_execution",
    label: "Code Execution",
    description: "Execute code",
  },
];

export function PermissionProfileEditor({
  stackName,
  tenantId,
  initialProfile,
  onSave,
}: PermissionProfileEditorProps) {
  const [tools, setTools] = useState<string[]>(
    initialProfile?.tools ?? ["web_search"],
  );
  const [saving, setSaving] = useState(false);

  const toggleTool = (toolName: string) => {
    setTools((prev) =>
      prev.includes(toolName)
        ? prev.filter((t) => t !== toolName)
        : [...prev, toolName],
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        profile: tools.length > 1 ? "advanced" : "basic",
        tools,
        data_permissions: initialProfile?.data_permissions ?? {},
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <View className="gap-4">
      <View>
        <Text className="mb-2 text-sm font-semibold">
          Stack: {stackName} / Tenant: {tenantId}
        </Text>
      </View>

      <View className="gap-2">
        {TOOL_DEFINITIONS.map((tool) => (
          <View
            key={tool.name}
            className="flex-row items-center justify-between rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <View className="flex-1">
              <Text className="text-sm font-medium">{tool.label}</Text>
              <Muted className="text-xs">{tool.description}</Muted>
            </View>
            <Switch
              value={tools.includes(tool.name)}
              onValueChange={() => toggleTool(tool.name)}
            />
          </View>
        ))}
      </View>

      <Button onPress={handleSave} disabled={saving}>
        <Text className="text-white">
          {saving ? "Saving..." : "Save Profile"}
        </Text>
      </Button>
    </View>
  );
}
