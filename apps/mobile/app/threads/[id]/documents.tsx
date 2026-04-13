import { View, Text, ScrollView, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { DetailLayout } from "@/components/layout/detail-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { FileText, ChevronDown, ChevronUp } from "lucide-react-native";

// TODO: Replace with GraphQL query
// Previously: useQuery(api.documents.listByThread, { threadId })

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function DocumentCard({ doc }: { doc: any }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <View className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-100 dark:border-neutral-800 overflow-hidden">
      <Pressable
        onPress={() => setExpanded(!expanded)}
        className="flex-row items-center px-4 py-3 active:bg-neutral-50 dark:active:bg-neutral-800"
      >
        <View className="w-8 h-8 bg-sky-100 dark:bg-sky-900/40 rounded-lg items-center justify-center mr-3">
          <FileText size={16} color="#0ea5e9" />
        </View>
        <View className="flex-1">
          <Text className="text-base font-medium text-neutral-900 dark:text-neutral-100" numberOfLines={1}>
            {doc.title}
          </Text>
          <Text className="text-xs text-neutral-400 mt-0.5">
            {doc.type} · {formatDate(new Date(doc.createdAt).getTime())}
          </Text>
        </View>
        {expanded ? (
          <ChevronUp size={16} color="#a3a3a3" />
        ) : (
          <ChevronDown size={16} color="#a3a3a3" />
        )}
      </Pressable>
      {expanded && (
        <View className="px-4 pb-4 border-t border-neutral-100 dark:border-neutral-800">
          <Text className="text-sm text-neutral-700 dark:text-neutral-300 mt-3 leading-relaxed">
            {doc.content}
          </Text>
        </View>
      )}
    </View>
  );
}

export default function DocumentsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  // TODO: implement via GraphQL query
  const documents: any[] | undefined = undefined; // TODO: documents.listByThread via GraphQL

  return (
    <DetailLayout showSidebar={false} title="Documents">
      <ScrollView className="flex-1" contentContainerClassName="pb-8">
        {documents === undefined ? (
          <View className="px-4 mt-4 gap-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </View>
        ) : documents.length === 0 ? (
          <View className="flex-1 items-center justify-center px-4 mt-16">
            <Text className="text-neutral-400 dark:text-neutral-500 text-center">
              No documents attached
            </Text>
          </View>
        ) : (
          <View className="px-4 mt-4 gap-3">
            {documents.map((doc: any) => (
              <DocumentCard key={doc.id} doc={doc} />
            ))}
          </View>
        )}
      </ScrollView>
    </DetailLayout>
  );
}
