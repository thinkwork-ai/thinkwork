import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useSubscription } from "urql";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink, Bot, User, Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ThreadDetailQuery,
  OnNewMessageSubscription,
  OnThreadUpdatedSubscription,
} from "@/lib/graphql-queries";
import { useTenant } from "@/context/TenantContext";
import { relativeTime } from "@/lib/utils";

interface ThreadDetailSheetProps {
  threadId: string | null;
  open: boolean;
  onClose: () => void;
}

export function ThreadDetailSheet({
  threadId,
  open,
  onClose,
}: ThreadDetailSheetProps) {
  const { tenantId } = useTenant();
  const scrollRef = useRef<HTMLDivElement>(null);

  const [{ data, fetching }, reexecute] = useQuery({
    query: ThreadDetailQuery,
    variables: { id: threadId! },
    pause: !threadId || !open,
    requestPolicy: "cache-and-network",
  });

  // Subscribe to new messages for this thread
  const [{ data: msgEvent }] = useSubscription({
    query: OnNewMessageSubscription,
    variables: { threadId: threadId! },
    pause: !threadId || !open,
  });

  // Subscribe to thread status updates
  const [{ data: threadEvent }] = useSubscription({
    query: OnThreadUpdatedSubscription,
    variables: { tenantId: tenantId! },
    pause: !tenantId || !open,
  });

  // Refetch when new messages arrive or thread updates
  useEffect(() => {
    if (msgEvent?.onNewMessage) {
      reexecute({ requestPolicy: "network-only" });
    }
  }, [msgEvent?.onNewMessage?.messageId]);

  useEffect(() => {
    if (threadEvent?.onThreadUpdated?.threadId === threadId) {
      reexecute({ requestPolicy: "network-only" });
    }
  }, [threadEvent?.onThreadUpdated?.updatedAt]);

  // Auto-scroll to bottom when messages change
  const prevMsgCount = useRef(0);
  const thread = data?.thread as any;
  const assistantLabel = thread?.computerId ? "Computer" : "Agent";
  const messages = (thread?.messages?.edges ?? [])
    .map((e: any) => e.node)
    .filter((m: any) => {
      const role = (m.role || "").toLowerCase();
      return role === "user" || role === "assistant";
    })
    .slice(-15); // last 15 messages

  useEffect(() => {
    if (messages.length > prevMsgCount.current) {
      setTimeout(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: "smooth",
        });
      }, 100);
    }
    prevMsgCount.current = messages.length;
  }, [messages.length]);

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent className="flex flex-col sm:max-w-md p-0">
        {/* Header */}
        <SheetHeader className="px-4 pt-4 pb-3 border-b border-border space-y-1.5">
          {fetching && !thread ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading...</span>
            </div>
          ) : thread ? (
            <>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {thread.identifier ?? `#${thread.number}`}
                </span>
                <StatusBadge status={thread.status} />
              </div>
              <SheetTitle className="text-sm leading-snug">
                {thread.title}
              </SheetTitle>
              {thread.computerId ? (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Bot className="h-3 w-3" />
                  Computer-owned
                </div>
              ) : thread.agent ? (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Bot className="h-3 w-3" />
                  {thread.agent.name}
                </div>
              ) : null}
            </>
          ) : (
            <SheetTitle className="text-sm text-muted-foreground">
              Thread not found
            </SheetTitle>
          )}
        </SheetHeader>

        {/* Messages */}
        <ScrollArea ref={scrollRef} className="flex-1 min-h-0">
          <div className="px-4 py-3 space-y-3">
            {messages.length === 0 && !fetching && (
              <p className="text-xs text-muted-foreground text-center py-6">
                No messages yet
              </p>
            )}
            {messages.map((msg: any) => {
              const isUser = msg.role?.toLowerCase() === "user";
              return (
                <div key={msg.id} className={`flex gap-2 ${isUser ? "" : ""}`}>
                  <div className="shrink-0 mt-0.5">
                    {isUser ? (
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-muted">
                        <User className="h-3 w-3 text-muted-foreground" />
                      </div>
                    ) : (
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10">
                        <Bot className="h-3 w-3 text-primary" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[10px] font-medium text-muted-foreground">
                        {isUser ? "User" : assistantLabel}
                      </span>
                      <span className="text-[10px] text-muted-foreground/60">
                        {relativeTime(msg.createdAt)}
                      </span>
                    </div>
                    <div className="text-xs leading-relaxed prose prose-xs dark:prose-invert max-w-none [&_p]:my-0.5 [&_ul]:my-0.5 [&_ol]:my-0.5 [&_pre]:my-1">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content || ""}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {/* Footer */}
        {threadId && (
          <SheetFooter className="border-t border-border px-4 py-3">
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link
                to="/threads/$threadId"
                params={{ threadId }}
                onClick={onClose}
              >
                Open Thread
                <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
              </Link>
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
