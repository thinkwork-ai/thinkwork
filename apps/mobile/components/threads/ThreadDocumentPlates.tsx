import { useMemo } from "react";
import { View } from "react-native";
import { useQuery } from "urql";
import { ArtifactsForThreadQuery } from "@/lib/graphql-queries";
import { isDocumentArtifactMetadata } from "@/lib/document-frame";
import { DocumentPlateCard } from "@/components/chat/DocumentPlateCard";

/**
 * The thread's document deliverables (compiled HTML plates — reports, QBRs,
 * …) rendered at the bottom of the thread, mirroring web's in-transcript
 * document cards. Web folds `document.card` turn events; mobile reaches the
 * same set through `artifacts(threadId)` filtered to document-kind rows,
 * which avoids per-turn event fan-out on a phone. Bound automation runs that
 * home their artifact in a different thread are the known gap (same rows web
 * self-heals via documentId, #3524).
 */
export function ThreadDocumentPlates({
  tenantId,
  threadId,
}: {
  tenantId: string | null | undefined;
  threadId: string | null | undefined;
}) {
  const [{ data }] = useQuery({
    query: ArtifactsForThreadQuery,
    variables: { tenantId: tenantId!, threadId: threadId!, limit: 20 },
    pause: !tenantId || !threadId,
    // A report emitted moments ago must show up when the user lands here.
    requestPolicy: "cache-and-network",
  });

  const documents = useMemo(() => {
    const rows = ((data as any)?.artifacts ?? []) as Array<{
      id: string;
      title: string;
      type?: string | null;
      status?: string | null;
      summary?: string | null;
      metadata?: unknown;
      createdAt?: string;
    }>;
    return rows
      .filter((a) => isDocumentArtifactMetadata(a.metadata))
      .sort((a, b) =>
        String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")),
      );
  }, [data]);

  if (documents.length === 0) return null;

  return (
    <View className="px-4 pt-2 pb-1 gap-3">
      {documents.map((doc) => (
        <DocumentPlateCard
          key={doc.id}
          artifactId={doc.id}
          title={doc.title}
          type={doc.type?.toLowerCase()}
          status={doc.status?.toLowerCase()}
        />
      ))}
    </View>
  );
}
