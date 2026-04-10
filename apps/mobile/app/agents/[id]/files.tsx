import { useState, useCallback, useEffect } from "react";
import { View, Text, ScrollView, ActivityIndicator, Pressable, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAgents } from "@/lib/hooks/use-agents";
import { useAuth } from "@/lib/auth-context";
import { DetailLayout } from "@/components/layout/detail-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { Folder, FileText, ChevronRight, Trash2 } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";

type FileEntry = { name: string; type: "file" | "dir"; size: number; modified: string };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Breadcrumbs({ path, id }: { path: string; id: string }) {
  const router = useRouter();
  const parts = path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);

  const navigateTo = (targetPath: string) => {
    router.push(`/agents/${id}/files?path=${encodeURIComponent(targetPath)}`);
  };

  return (
    <View className="flex-row items-center flex-wrap py-2">
      <Pressable onPress={() => navigateTo("/")}>
        <Text className="text-lg text-orange-500 font-medium">/</Text>
      </Pressable>
      {parts.map((part, i) => {
        const fullPath = "/" + parts.slice(0, i + 1).join("/");
        const isLast = i === parts.length - 1;
        return (
          <View key={fullPath} className="flex-row items-center">
            <ChevronRight size={14} color="#a3a3a3" />
            {isLast ? (
              <Text className="text-lg text-neutral-900 dark:text-neutral-100 font-medium">{part}</Text>
            ) : (
              <Pressable onPress={() => navigateTo(fullPath)}>
                <Text className="text-lg text-orange-500 font-medium">{part}</Text>
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}

function FileRow({
  file,
  onPress,
  editMode,
  onDelete,
  deleting,
}: {
  file: FileEntry;
  onPress: () => void;
  editMode: boolean;
  onDelete: () => void;
  deleting: boolean;
}) {
  const isDir = file.type === "dir";
  return (
    <View className="flex-row items-center border-b border-neutral-100 dark:border-neutral-800">
      {editMode && (
        <Pressable
          onPress={onDelete}
          disabled={deleting}
          className="pl-4 py-3 pr-1"
        >
          {deleting ? (
            <ActivityIndicator size="small" color="#ef4444" />
          ) : (
            <Trash2 size={18} color="#ef4444" />
          )}
        </Pressable>
      )}
      <Pressable
        onPress={onPress}
        className="flex-1 flex-row items-center py-3.5 px-4 active:bg-neutral-50 dark:active:bg-neutral-900"
      >
        {isDir ? (
          <Folder size={22} color="#f8841d" />
        ) : (
          <FileText size={22} color="#737373" />
        )}
        <Text className="flex-1 ml-3 text-lg text-neutral-900 dark:text-neutral-100 font-medium" numberOfLines={1}>
          {file.name}
        </Text>
        {!isDir && (
          <Text className="text-base text-neutral-400 mr-2">
            {formatSize(file.size)}
          </Text>
        )}
        {isDir && <ChevronRight size={18} color="#a3a3a3" />}
      </Pressable>
    </View>
  );
}

export default function AgentFilesScreen() {
  const router = useRouter();
  const { id, path: pathParam } = useLocalSearchParams<{ id: string; path?: string }>();
  const currentPath = pathParam || "/";
  const { user } = useAuth();
  const tenantId = (user as any)?.tenantId;
  const [{ data: agentsData }] = useAgents(tenantId);
  const gateways = agentsData?.agents ?? undefined;
  const gateway = gateways?.find((g: any) => g.id === id);
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  // TODO: files.listFiles and files.deleteFile actions not yet available via GraphQL hooks
  const listFilesAction = async (_args: { agentId: string; path: string }): Promise<{ files?: FileEntry[]; error?: string }> => {
    return { error: "File listing not yet available via GraphQL" };
  };
  const deleteFileAction = async (_args: { agentId: string; path: string }): Promise<{ error?: string }> => {
    return { error: "File deletion not yet available via GraphQL" };
  };
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);

  const agentId = id!;

  const loadFiles = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await listFilesAction({ agentId, path });
      setFiles(result.files ?? []);
      if (result.error) setError(result.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading files");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    loadFiles(currentPath);
    setEditMode(false);
  }, [currentPath]);

  const handleFilePress = useCallback((file: FileEntry) => {
    if (editMode) return; // Don't navigate in edit mode
    if (file.type === "dir") {
      const newPath = currentPath === "/" ? `/${file.name}` : `${currentPath}/${file.name}`;
      router.push(`/agents/${id}/files?path=${encodeURIComponent(newPath)}`);
    } else {
      const filePath = currentPath === "/" ? `/${file.name}` : `${currentPath}/${file.name}`;
      router.push(`/agents/${id}/file-view?path=${encodeURIComponent(filePath)}&name=${encodeURIComponent(file.name)}`);
    }
  }, [currentPath, id, router, editMode]);

  const handleDelete = useCallback((file: FileEntry) => {
    const filePath = currentPath === "/" ? `/${file.name}` : `${currentPath}/${file.name}`;
    const label = file.type === "dir" ? "folder" : "file";

    Alert.alert(
      `Delete ${label}`,
      `Are you sure you want to delete "${file.name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeletingPath(filePath);
            try {
              const result = await deleteFileAction({ agentId, path: filePath });
              if ((result as any)?.error) {
                Alert.alert("Error", (result as any).error);
              } else {
                await loadFiles(currentPath);
              }
            } catch (err) {
              Alert.alert("Error", err instanceof Error ? err.message : "Delete failed");
            } finally {
              setDeletingPath(null);
            }
          },
        },
      ]
    );
  }, [currentPath, agentId, loadFiles]);

  const pathParts = currentPath.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  const title = pathParts.length > 0 ? pathParts[pathParts.length - 1] : "Workspace";

  if (gateways === undefined) {
    return (
      <DetailLayout title="Workspace">
        <View className="flex-1 px-4">
          <Skeleton className="h-12 w-full mt-4" />
          <Skeleton className="h-12 w-full mt-2" />
          <Skeleton className="h-12 w-full mt-2" />
        </View>
      </DetailLayout>
    );
  }

  return (
    <DetailLayout
      title={title}
      headerRight={
        <Pressable onPress={() => setEditMode(!editMode)} className="p-1">
          {editMode ? (
            <Text style={{ color: "#f97316" }} className="font-semibold text-base">Done</Text>
          ) : (
            <Trash2 size={20} color="#ef4444" />
          )}
        </Pressable>
      }
    >
      <View className="flex-1" style={{ maxWidth: 600 }}>
        {/* Breadcrumbs bar */}
        <View className="px-4 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900">
          <View className="flex-row items-center justify-between">
            <View className="flex-1">
              <Breadcrumbs path={currentPath} id={id!} />
            </View>
            <Pressable onPress={() => loadFiles(currentPath)} className="px-3 py-1">
              <Text className="text-base text-orange-500 font-medium">Refresh</Text>
            </Pressable>
          </View>
        </View>

        {/* File list */}
        {loading ? (
          <View className="flex-1 items-center justify-center py-16">
            <ActivityIndicator />
          </View>
        ) : error ? (
          <View className="flex-1 items-center justify-center px-4 py-16">
            <Text className="text-red-500 text-center text-sm">{error}</Text>
            <Pressable onPress={() => loadFiles(currentPath)} className="mt-3">
              <Text className="text-orange-500 font-medium">Retry</Text>
            </Pressable>
          </View>
        ) : files && files.length === 0 ? (
          <View className="flex-1 items-center justify-center py-16">
            <Text className="text-neutral-400 text-sm">Empty directory</Text>
          </View>
        ) : (
          <ScrollView className="flex-1">
            {files?.map((file) => {
              const filePath = currentPath === "/" ? `/${file.name}` : `${currentPath}/${file.name}`;
              return (
                <FileRow
                  key={file.name}
                  file={file}
                  onPress={() => handleFilePress(file)}
                  editMode={editMode}
                  onDelete={() => handleDelete(file)}
                  deleting={deletingPath === filePath}
                />
              );
            })}
          </ScrollView>
        )}
      </View>
    </DetailLayout>
  );
}
