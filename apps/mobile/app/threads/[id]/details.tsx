import { View, Text, ScrollView, Pressable } from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { DetailLayout } from "@/components/layout/detail-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "urql";
import { ThreadQuery } from "@/lib/graphql-queries";
import { useState } from "react";

function MetaValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <Text className="text-sm text-neutral-400 italic">null</Text>;
  }
  if (typeof value === "object") {
    return (
      <Text className="text-sm text-neutral-600 dark:text-neutral-400 font-mono">
        {JSON.stringify(value, null, 2)}
      </Text>
    );
  }
  return (
    <Text className="text-sm text-neutral-900 dark:text-neutral-100 text-right flex-shrink ml-4">
      {String(value)}
    </Text>
  );
}

export default function DetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [copied, setCopied] = useState(false);

  const [{ data: threadResult, fetching }] = useQuery({ query: ThreadQuery, variables: { id: id! }, pause: !id });
  const thread = threadResult?.thread ?? undefined;

  const handleCopy = async () => {
    if (!(thread as any)?.metadata) return;
    await Clipboard.setStringAsync(JSON.stringify((thread as any).metadata, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (fetching && !thread) {
    return (
      <DetailLayout showSidebar={false} title="Details">
        <View className="px-4 mt-4 gap-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </View>
      </DetailLayout>
    );
  }

  const meta = (thread as any)?.metadata;
  const hasMeta = meta != null && typeof meta === "object" && Object.keys(meta).length > 0;

  return (
    <DetailLayout showSidebar={false} title="Details">
      <ScrollView className="flex-1" contentContainerClassName="pb-8">
        {!hasMeta ? (
          <View className="flex-1 items-center justify-center px-4 mt-16">
            <Text className="text-neutral-400 dark:text-neutral-500 text-center">
              No details available
            </Text>
          </View>
        ) : (
          <>
            <View className="mx-4 mt-4 bg-white dark:bg-neutral-900 rounded-xl overflow-hidden border border-neutral-100 dark:border-neutral-800">
              {Object.entries(meta as Record<string, unknown>).map(([key, value], i, arr) => {
                const isComplex = value !== null && typeof value === "object";
                return (
                  <View
                    key={key}
                    className={`px-4 py-3 ${
                      i < arr.length - 1 ? "border-b border-neutral-100 dark:border-neutral-800" : ""
                    } ${isComplex ? "" : "flex-row items-start justify-between"}`}
                  >
                    <Text className="text-sm font-medium text-neutral-500 dark:text-neutral-400 capitalize">
                      {key.replace(/_/g, " ")}
                    </Text>
                    {isComplex ? (
                      <View className="mt-1 bg-neutral-50 dark:bg-neutral-800 rounded-lg p-2">
                        <MetaValue value={value} />
                      </View>
                    ) : (
                      <MetaValue value={value} />
                    )}
                  </View>
                );
              })}
            </View>

            <View className="mx-4 mt-4">
              <Pressable
                onPress={handleCopy}
                className="border border-neutral-200 dark:border-neutral-700 rounded-xl py-3 items-center active:bg-neutral-50 dark:active:bg-neutral-800"
              >
                <Text className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
                  {copied ? "Copied!" : "Copy JSON"}
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </DetailLayout>
  );
}
