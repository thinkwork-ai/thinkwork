import { useState } from "react";
import { useClient } from "urql";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ArrowDown, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CopyableRow } from "@/components/ui/copyable-row";
import { ComplianceEventByHashQuery } from "@/lib/compliance/queries";
import { relativeTime, formatDateTime } from "@/lib/utils";

const WALK_BACK_LIMIT = 10;

export interface ChainPositionPanelProps {
  eventHash: string;
  prevHash: string | null | undefined;
}

interface ChainHop {
  eventId: string;
  eventType: string;
  recordedAt: string;
  eventHash: string;
}

export function ChainPositionPanel({
  eventHash,
  prevHash,
}: ChainPositionPanelProps) {
  const client = useClient();
  const navigate = useNavigate();
  const [walking, setWalking] = useState(false);
  const [hops, setHops] = useState<ChainHop[]>([]);
  const [reachedGenesis, setReachedGenesis] = useState(false);

  const lookupByHash = async (hash: string) => {
    const result = await client
      .query(ComplianceEventByHashQuery, { eventHash: hash }, { requestPolicy: "cache-first" })
      .toPromise();
    return result.data?.complianceEventByHash ?? null;
  };

  const handlePrevHashClick = async () => {
    if (!prevHash) return;
    const event = await lookupByHash(prevHash);
    if (!event) {
      toast.error("Previous event not visible to your tenant scope.");
      return;
    }
    navigate({
      to: "/compliance/events/$eventId",
      params: { eventId: event.eventId },
      search: (prev) => prev,
    });
  };

  const handleWalkBack = async () => {
    if (!prevHash) {
      setReachedGenesis(true);
      return;
    }
    setWalking(true);
    setHops([]);
    setReachedGenesis(false);
    try {
      let nextHash: string | null = prevHash;
      const collected: ChainHop[] = [];
      for (let i = 0; i < WALK_BACK_LIMIT && nextHash; i++) {
        const event = await lookupByHash(nextHash);
        if (!event) break;
        collected.push({
          eventId: event.eventId,
          eventType: event.eventType,
          recordedAt: event.recordedAt,
          eventHash: event.eventHash,
        });
        if (!event.prevHash) {
          setReachedGenesis(true);
          break;
        }
        nextHash = event.prevHash;
      }
      setHops(collected);
    } finally {
      setWalking(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Chain position</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <CopyableRow label="Event hash" value={eventHash} />
        {prevHash ? (
          <CopyableRow
            label="Previous hash"
            value={prevHash}
            onClick={handlePrevHashClick}
          />
        ) : (
          <div className="flex items-center justify-between text-sm gap-4">
            <span className="text-muted-foreground shrink-0">Previous hash</span>
            <Badge variant="outline">GENESIS</Badge>
          </div>
        )}

        <div className="pt-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!prevHash || walking}
            onClick={handleWalkBack}
          >
            {walking ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Walking…
              </>
            ) : (
              "Walk back 10 events"
            )}
          </Button>
        </div>

        {hops.length > 0 || reachedGenesis ? (
          <div className="space-y-2 pt-2">
            {hops.map((hop, i) => (
              <button
                key={hop.eventId}
                type="button"
                onClick={() =>
                  navigate({
                    to: "/compliance/events/$eventId",
                    params: { eventId: hop.eventId },
                    search: (prev) => prev,
                  })
                }
                className="block w-full text-left rounded-md border bg-card hover:bg-muted/50 px-3 py-2 transition"
              >
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ArrowDown className="size-3" />
                  hop {i + 1}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                  <code className="font-mono text-xs">
                    {hop.eventHash.slice(0, 12)}
                  </code>
                  <Badge variant="secondary">
                    {hop.eventType.replace(/_/g, ".").toLowerCase()}
                  </Badge>
                  <span
                    className="text-xs text-muted-foreground"
                    title={formatDateTime(hop.recordedAt)}
                  >
                    {relativeTime(hop.recordedAt)}
                  </span>
                </div>
              </button>
            ))}
            {reachedGenesis ? (
              <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                Reached chain start (GENESIS).
              </div>
            ) : hops.length === WALK_BACK_LIMIT ? (
              <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                Reached the {WALK_BACK_LIMIT}-event walk-back limit. Click any
                hop to continue from there.
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
