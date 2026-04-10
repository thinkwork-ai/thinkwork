import { memo, useEffect, useRef, useState } from "react";
import { graphql } from "@/gql";
import { useMutation } from "urql";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Identity } from "@/components/Identity";
import { Check, Copy } from "lucide-react";
import { relativeTime } from "@/lib/utils";
import {
  Form,
  FormField,
  FormItem,
  FormControl,
} from "@/components/ui/form";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ThreadComment {
  id: string;
  authorType?: string | null;
  authorId?: string | null;
  content: string;
  createdAt: string;
}

interface AgentRef {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

interface CommentThreadProps {
  comments: ThreadComment[];
  threadId: string;
  threadStatus?: string;
  agentMap?: Map<string, AgentRef>;
  draftKey?: string;
  onCommentAdded?: () => void;
}

// ---------------------------------------------------------------------------
// Mutation
// ---------------------------------------------------------------------------

const AddThreadCommentMutation = graphql(`
  mutation AddThreadCommentThread($input: AddThreadCommentInput!) {
    addThreadComment(input: $input) {
      id
      authorType
      authorId
      content
      createdAt
    }
  }
`);

// ---------------------------------------------------------------------------
// Draft persistence helpers
// ---------------------------------------------------------------------------

const CLOSED_STATUSES = new Set(["done", "cancelled"]);
const DRAFT_DEBOUNCE_MS = 800;

function loadDraft(draftKey: string): string {
  try {
    return localStorage.getItem(draftKey) ?? "";
  } catch {
    return "";
  }
}

function saveDraft(draftKey: string, value: string) {
  try {
    if (value.trim()) {
      localStorage.setItem(draftKey, value);
    } else {
      localStorage.removeItem(draftKey);
    }
  } catch {
    // Ignore localStorage failures.
  }
}

function clearDraft(draftKey: string) {
  try {
    localStorage.removeItem(draftKey);
  } catch {
    // Ignore localStorage failures.
  }
}

// ---------------------------------------------------------------------------
// Copy markdown button
// ---------------------------------------------------------------------------

function CopyMarkdownButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="text-muted-foreground hover:text-foreground transition-colors"
      title="Copy as markdown"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Comment list (memoized)
// ---------------------------------------------------------------------------

const CommentList = memo(function CommentList({
  comments,
  agentMap,
  highlightCommentId,
}: {
  comments: ThreadComment[];
  agentMap?: Map<string, AgentRef>;
  highlightCommentId?: string | null;
}) {
  if (comments.length === 0) {
    return <p className="text-sm text-muted-foreground">No comments yet.</p>;
  }

  return (
    <div className="space-y-3">
      {comments.map((comment) => {
        const isHighlighted = highlightCommentId === comment.id;
        const isAgent = comment.authorType === "agent";
        const isSystem = comment.authorType === "system";
        const agent = isAgent && comment.authorId ? agentMap?.get(comment.authorId) : null;

        let authorName = "You";
        if (isSystem) authorName = "System";
        else if (isAgent) authorName = agent?.name ?? comment.authorId?.slice(0, 8) ?? "Agent";

        return (
          <div
            key={comment.id}
            id={`comment-${comment.id}`}
            className={`border p-3 overflow-hidden min-w-0 rounded-sm transition-colors duration-1000 ${
              isHighlighted
                ? "border-primary/50 bg-primary/5"
                : "border-border"
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <Identity
                name={authorName}
                avatarUrl={agent?.avatarUrl}
                size="sm"
              />
              <span className="flex items-center gap-1.5">
                <a
                  href={`#comment-${comment.id}`}
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors"
                >
                  {relativeTime(comment.createdAt)}
                </a>
                <CopyMarkdownButton text={comment.content} />
              </span>
            </div>
            <p className="text-sm whitespace-pre-wrap">{comment.content}</p>
          </div>
        );
      })}
    </div>
  );
});

// ---------------------------------------------------------------------------
// CommentThread
// ---------------------------------------------------------------------------

const commentSchema = z.object({
  body: z.string().min(1),
  reopen: z.boolean(),
});

type CommentFormValues = z.infer<typeof commentSchema>;

export function CommentThread({
  comments,
  threadId,
  threadStatus,
  agentMap,
  draftKey,
  onCommentAdded,
}: CommentThreadProps) {
  const [highlightCommentId, setHighlightCommentId] = useState<string | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasScrolledRef = useRef(false);

  const [{ fetching }, addComment] = useMutation(AddThreadCommentMutation);

  const isClosed = threadStatus
    ? CLOSED_STATUSES.has(threadStatus.toLowerCase().replace(/ /g, "_"))
    : false;

  const form = useForm<CommentFormValues>({
    resolver: zodResolver(commentSchema),
    defaultValues: { body: "", reopen: true },
  });

  const bodyValue = form.watch("body");

  // Load draft on mount
  useEffect(() => {
    if (!draftKey) return;
    const draft = loadDraft(draftKey);
    if (draft) form.setValue("body", draft);
  }, [draftKey, form]);

  // Auto-save draft
  useEffect(() => {
    if (!draftKey) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      saveDraft(draftKey, bodyValue);
    }, DRAFT_DEBOUNCE_MS);
  }, [bodyValue, draftKey]);

  useEffect(() => {
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, []);

  // Scroll to comment when URL hash matches #comment-{id}
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#comment-") || comments.length === 0) return;
    const commentId = hash.slice("#comment-".length);
    if (hasScrolledRef.current) return;
    const el = document.getElementById(`comment-${commentId}`);
    if (el) {
      hasScrolledRef.current = true;
      setHighlightCommentId(commentId);
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      const timer = setTimeout(() => setHighlightCommentId(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [comments]);

  async function handleSubmit(values: CommentFormValues) {
    const trimmed = values.body.trim();
    if (!trimmed) return;

    const result = await addComment({
      input: {
        threadId: threadId,
        content: trimmed,
      },
    });

    if (!result.error) {
      form.reset({ body: "", reopen: false });
      if (draftKey) clearDraft(draftKey);
      onCommentAdded?.();
    }
  }

  const canSubmit = !fetching && !!bodyValue.trim();

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">
        Comments ({comments.length})
      </h3>

      <CommentList
        comments={comments}
        agentMap={agentMap}
        highlightCommentId={highlightCommentId}
      />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-2">
          <FormField
            control={form.control}
            name="body"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Textarea
                    placeholder="Leave a comment..."
                    rows={3}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void form.handleSubmit(handleSubmit)();
                      }
                    }}
                    {...field}
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <div className="flex items-center justify-end gap-3">
            {isClosed && (
              <FormField
                control={form.control}
                name="reopen"
                render={({ field }) => (
                  <FormItem>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      Re-open
                    </label>
                  </FormItem>
                )}
              />
            )}
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {fetching ? "Posting..." : "Comment"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
