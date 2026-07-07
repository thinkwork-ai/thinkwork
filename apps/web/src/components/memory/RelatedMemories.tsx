import { useState } from "react";
import { useQuery } from "urql";
import { Link } from "@tanstack/react-router";
import { ComputerMemorySearchQuery } from "@/lib/graphql-queries";
import { stripTopicTags } from "@/lib/memory-strategy";

interface RelatedMemoriesProps {
  tenantId?: string | null;
  userId?: string | null;
  /** Search term — the entity or page the memories should mention. */
  query: string;
  pause?: boolean;
}

/**
 * Top memory excerpts mentioning a node/page, via semantic search.
 * Shows 5 with a show-more toggle; renders nothing while empty.
 */
export function RelatedMemories({
  tenantId,
  userId,
  query,
  pause = false,
}: RelatedMemoriesProps) {
  const [result] = useQuery({
    query: ComputerMemorySearchQuery,
    variables: { tenantId, userId, query, limit: 15 },
    pause: pause || !query || !tenantId,
  });
  const records: any[] = result.data?.memorySearch?.records ?? [];
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? records : records.slice(0, 5);

  if (records.length === 0) return null;

  return (
    <div>
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        Memories
      </h4>
      <div className="space-y-2.5">
        {visible.map((record) => (
          <div key={record.memoryRecordId}>
            <p className="text-xs leading-snug line-clamp-3">
              {stripTopicTags(record.content?.text ?? "")}
            </p>
            <div className="mt-0.5 flex items-center gap-2.5 text-[11px] text-muted-foreground">
              {record.createdAt && (
                <span>
                  {new Date(record.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              )}
              {record.threadId && (
                <Link
                  to="/threads/$id"
                  params={{ id: record.threadId }}
                  className="text-sky-400 hover:text-sky-300 hover:underline"
                >
                  View thread →
                </Link>
              )}
            </div>
          </div>
        ))}
        {records.length > 5 && (
          <button
            type="button"
            className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "Show fewer" : `Show ${records.length - 5} more`}
          </button>
        )}
      </div>
    </div>
  );
}
