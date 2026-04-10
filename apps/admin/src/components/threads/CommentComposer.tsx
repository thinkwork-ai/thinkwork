import { useCallback, useState } from "react";
import { graphql } from "@/gql";
import { useMutation } from "urql";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { relativeTime } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Mutation
// ---------------------------------------------------------------------------

const AddThreadCommentMutation = graphql(`
  mutation AddThreadComment($input: AddThreadCommentInput!) {
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
// Comment Composer
// ---------------------------------------------------------------------------

interface CommentComposerProps {
  threadId: string;
  onSubmit?: () => void;
}

export function CommentComposer({ threadId, onSubmit }: CommentComposerProps) {
  const [content, setContent] = useState("");
  const [{ fetching }, addComment] = useMutation(AddThreadCommentMutation);

  const handleSubmit = useCallback(async () => {
    const trimmed = content.trim();
    if (!trimmed) return;

    const result = await addComment({
      input: {
        threadId: threadId,
        content: trimmed,
      },
    });

    if (!result.error) {
      setContent("");
      onSubmit?.();
    }
  }, [content, threadId, addComment, onSubmit]);

  return (
    <div className="space-y-2">
      <Textarea
        placeholder="Write a comment..."
        rows={3}
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={fetching || !content.trim()}
        >
          {fetching ? "Sending..." : "Comment"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comment display helper
// ---------------------------------------------------------------------------

interface CommentItemProps {
  comment: {
    readonly authorType?: string | null;
    readonly authorId?: string | null;
    readonly content: string;
    readonly createdAt: any;
  };
}

export function CommentItem({ comment }: CommentItemProps) {
  const isSystem = comment.authorType === "system";

  return (
    <div className={isSystem ? "text-muted-foreground italic" : ""}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium">
          {isSystem ? "System" : `${comment.authorType ?? "User"} ${comment.authorId?.slice(0, 8) ?? ""}`}
        </span>
        <span className="text-xs text-muted-foreground">
          {relativeTime(comment.createdAt)}
        </span>
      </div>
      <p className="text-sm">{comment.content}</p>
    </div>
  );
}
