import { Bot, UsersRound } from "lucide-react";
import { Badge } from "@thinkwork/ui";

export interface ThreadParticipantSummary {
  id: string;
  participantType?: string | null;
  role?: string | null;
  user?: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  } | null;
  agent?: {
    id: string;
    name?: string | null;
    slug?: string | null;
    avatarUrl?: string | null;
  } | null;
}

export function ThreadParticipantsBar({
  participants,
}: {
  participants: ThreadParticipantSummary[];
}) {
  return (
    <div className="flex min-h-12 items-center gap-2 border-b px-4">
      <UsersRound className="size-4 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
        {participants.length === 0 ? (
          <span className="text-sm text-muted-foreground">No participants</span>
        ) : (
          participants.map((participant) => (
            <Badge
              key={participant.id}
              variant="outline"
              className="shrink-0 gap-1 rounded-full"
            >
              {participant.participantType === "AGENT" ? (
                <Bot className="size-3" />
              ) : null}
              {participant.agent?.name ??
                participant.user?.name ??
                participant.user?.email ??
                "Participant"}
            </Badge>
          ))
        )}
      </div>
    </div>
  );
}
