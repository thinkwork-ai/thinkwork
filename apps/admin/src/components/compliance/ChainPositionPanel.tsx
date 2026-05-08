import { useEffect, useRef, useState } from "react";
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

interface ChainEventNode {
  eventId: string;
  eventType: string;
  recordedAt: string;
  eventHash: string;
  prevHash?: string | null;
}

type LookupResult =
  | { ok: true; event: ChainEventNode }
  | { ok: false; reason: "missing" | "error" };

export function ChainPositionPanel({
  eventHash,
  prevHash,
}: ChainPositionPanelProps) {
  const client = useClient();
  const navigate = useNavigate();
  const [walking, setWalking] = useState(false);
  const [hops, setHops] = useState<ChainHop[]>([]);
  const [reachedGenesis, setReachedGenesis] = useState(false);
  const [walkError, setWalkError] = useState<string | null>(null);
  // Generation counter: each walk_back / prev-hash click increments. State
  // writes are gated on the generation matching to suppress stale awaits
  // when the user navigates mid-walk or kicks off a second walk.
  const walkGenRef = useRef(0);

  // Reset the panel when the parent navigates to a different event. Without
  // this, a fresh detail page renders the previous event's accumulated hops.
  useEffect(() => {
    walkGenRef.current++;
    setHops([]);
    setReachedGenesis(false);
    setWalking(false);
    setWalkError(null);
  }, [eventHash]);

  const lookupByHash = async (hash: string): Promise<LookupResult> => {
    const result = await client
      .query(
        ComplianceEventByHashQuery,
        { eventHash: hash },
        { requestPolicy: "cache-first" },
      )
      .toPromise();
    if (result.error) return { ok: false, reason: "error" };
    const event = result.data?.complianceEventByHash;
    if (!event) return { ok: false, reason: "missing" };
    return { ok: true, event };
  };

  const handlePrevHashClick = async () => {
    if (!prevHash || walking) return;
    const out = await lookupByHash(prevHash);
    if (!out.ok) {
      toast.error(
        out.reason === "missing"
          ? "Previous event not visible to your tenant scope."
          : "Failed to load previous event. Try again.",
      );
      return;
    }
    navigate({
      to: "/compliance/events/$eventId",
      params: { eventId: out.event.eventId },
      search: (prev) => prev,
    });
  };

  const handleWalkBack = async () => {
    if (!prevHash) {
      setReachedGenesis(true);
      return;
    }
    const myGen = ++walkGenRef.current;
    setWalking(true);
    setHops([]);
    setReachedGenesis(false);
    setWalkError(null);
    try {
      let nextHash: string | null = prevHash;
      const collected: ChainHop[] = [];
      // Detect cycles defensively. The chain is structurally a Merkle list
      // and shouldn't loop, but if a malformed import or hash collision
      // produces one, surface it explicitly rather than rendering 10
      // identical hops with duplicate React keys.
      const seen = new Set<string>();
      let cycleDetected = false;
      let lookupFailedAt: number | null = null;
      for (let i = 0; i < WALK_BACK_LIMIT && nextHash; i++) {
        if (seen.has(nextHash)) {
          cycleDetected = true;
          break;
        }
        seen.add(nextHash);
        const out = await lookupByHash(nextHash);
        if (!out.ok) {
          if (out.reason === "error") lookupFailedAt = i + 1;
          break;
        }
        const ev = out.event;
        collected.push({
          eventId: ev.eventId,
          eventType: ev.eventType,
          recordedAt: ev.recordedAt,
          eventHash: ev.eventHash,
        });
        if (!ev.prevHash) {
          if (walkGenRef.current === myGen) setReachedGenesis(true);
          break;
        }
        nextHash = ev.prevHash;
      }
      // Suppress writes if a newer walk superseded this one.
      if (walkGenRef.current !== myGen) return;
      setHops(collected);
      if (cycleDetected) setWalkError("Chain cycle detected — stopping walk.");
      else if (lookupFailedAt !== null)
        setWalkError(`Failed to load hop ${lookupFailedAt}. Partial chain shown.`);
    } finally {
      if (walkGenRef.current === myGen) setWalking(false);
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

        {walkError ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            {walkError}
          </div>
        ) : null}

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
