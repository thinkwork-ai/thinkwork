import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent,
} from "react";
import { Pencil } from "lucide-react";
import { useMutation } from "urql";
import { toast } from "sonner";
import {
  THREAD_RENAME_EVENT,
  type ThreadRenameEventDetail,
} from "@/lib/thread-rename";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@thinkwork/ui";
import { UpdateThreadMutation } from "@/lib/graphql-queries";
import { cn } from "@/lib/utils";

interface ThreadTitleInlineRenameProps {
  threadId: string;
  title: string;
  displayTitle?: ReactNode;
  className?: string;
  editingClassName?: string;
  textClassName?: string;
  inputClassName?: string;
  disabled?: boolean;
  onRenamed?: (title: string) => void;
  onEditingChange?: (editing: boolean) => void;
}

export function ThreadTitleInlineRename({
  threadId,
  title,
  displayTitle,
  className,
  editingClassName,
  textClassName,
  inputClassName,
  disabled = false,
  onRenamed,
  onEditingChange,
}: ThreadTitleInlineRenameProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [committing, setCommitting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const focusTimerRef = useRef<number | null>(null);
  const committingRef = useRef(false);
  const [, updateThread] = useMutation(UpdateThreadMutation);

  useEffect(() => {
    if (!editing) setDraft(title);
  }, [editing, title]);

  useEffect(() => {
    onEditingChange?.(editing);
  }, [editing, onEditingChange]);

  useEffect(() => {
    if (!editing) return;
    focusTimerRef.current = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
      focusTimerRef.current = null;
    }, 0);
    return () => {
      if (focusTimerRef.current !== null) {
        window.clearTimeout(focusTimerRef.current);
        focusTimerRef.current = null;
      }
    };
  }, [editing]);

  const startRename = useCallback(() => {
    if (disabled || committing) return;
    setDraft(title);
    setEditing(true);
  }, [committing, disabled, title]);

  // Enter edit mode when the thread's "…" menu fires the rename request.
  useEffect(() => {
    function onRenameRequest(event: Event) {
      const detail = (event as CustomEvent<ThreadRenameEventDetail>).detail;
      if (detail?.threadId === threadId) startRename();
    }
    window.addEventListener(THREAD_RENAME_EVENT, onRenameRequest);
    return () =>
      window.removeEventListener(THREAD_RENAME_EVENT, onRenameRequest);
  }, [threadId, startRename]);

  const cancelRename = useCallback(() => {
    setDraft(title);
    setEditing(false);
  }, [title]);

  const commitRename = useCallback(async () => {
    if (committingRef.current) return;

    const nextTitle = draft.trim();
    if (!nextTitle) {
      toast.error("Thread title can't be blank.");
      setDraft(title);
      setEditing(false);
      return;
    }

    if (nextTitle === title.trim()) {
      setDraft(title);
      setEditing(false);
      return;
    }

    committingRef.current = true;
    setCommitting(true);
    const result = await updateThread({
      id: threadId,
      input: { title: nextTitle },
    });
    committingRef.current = false;
    setCommitting(false);

    if (result.error) {
      toast.error(`Could not rename thread: ${result.error.message}`);
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }

    toast.success("Thread renamed.");
    setEditing(false);
    onRenamed?.(nextTitle);
    window.dispatchEvent(
      new CustomEvent("thinkwork:thread-renamed", {
        detail: { threadId, title: nextTitle },
      }),
    );
  }, [draft, onRenamed, threadId, title, updateThread]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      void commitRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelRename();
    }
  }

  if (editing) {
    return (
      <span
        className={cn("min-w-0", editingClassName ?? className)}
        data-thread-title-rename
        onClick={(event) => event.preventDefault()}
      >
        <input
          ref={inputRef}
          value={draft}
          disabled={committing}
          type="text"
          aria-label="Rename thread title"
          className={cn(
            "h-7 w-full min-w-0 border-0 bg-transparent px-0 text-sm text-foreground outline-none focus-visible:ring-0 disabled:opacity-60",
            inputClassName,
          )}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commitRename()}
          onKeyDown={handleKeyDown}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
        />
      </span>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <span
          className={cn("min-w-0 cursor-default", className)}
          data-thread-title-rename
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            startRename();
          }}
        >
          <span className={cn("block truncate", textClassName)}>
            {displayTitle ?? title}
          </span>
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent alignOffset={2} className="w-44">
        <ContextMenuItem
          onSelect={() => {
            window.setTimeout(startRename, 0);
          }}
        >
          <Pencil className="size-4" />
          Rename
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
