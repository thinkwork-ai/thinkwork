import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { AtSign, Loader2, Paperclip, SendHorizontal, X } from "lucide-react";
import { Button, Textarea } from "@thinkwork/ui";
import { MentionMenu, type MentionTarget } from "./MentionMenu";

export interface ComposerMention {
  targetType: "USER" | "AGENT";
  targetId: string;
  displayName: string;
  rawText: string;
}

interface ThreadComposerProps {
  mentionTargets: MentionTarget[];
  isSending?: boolean;
  onSend: (
    content: string,
    files: File[],
    mentions: ComposerMention[],
  ) => Promise<void> | void;
}

export function ThreadComposer({
  mentionTargets,
  isSending = false,
  onSend,
}: ThreadComposerProps) {
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [mentions, setMentions] = useState<ComposerMention[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mentionQuery = useMemo(() => currentMentionQuery(content), [content]);
  const canSend = content.trim().length > 0 || files.length > 0;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSend || isSending) return;
    const sentContent = content.trim();
    await onSend(sentContent, files, mentions);
    setContent("");
    setFiles([]);
    setMentions([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(event.target.files ?? []));
  }

  function selectMention(target: MentionTarget) {
    const replacement = `@${target.displayName} `;
    const query = mentionQuery ?? "";
    const prefix = content.slice(0, content.length - query.length - 1);
    const nextContent = `${prefix}${replacement}`;
    setContent(nextContent);
    setMentions((current) => [
      ...current.filter(
        (mention) =>
          !(
            mention.targetType === target.targetType &&
            mention.targetId === target.targetId
          ),
      ),
      {
        targetType: target.targetType,
        targetId: target.targetId,
        displayName: target.displayName,
        rawText: replacement.trim(),
      },
    ]);
  }

  return (
    <form className="border-t p-3" onSubmit={handleSubmit}>
      <div className="relative mx-auto max-w-4xl">
        {mentionQuery !== null ? (
          <MentionMenu
            targets={mentionTargets}
            query={mentionQuery}
            onSelect={selectMention}
          />
        ) : null}
        <Textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={3}
          className="resize-none pr-28"
          placeholder="Message"
        />
        <div className="absolute bottom-2 right-2 flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setContent((value) => `${value}@`)}
            aria-label="Mention"
          >
            <AtSign className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach files"
          >
            <Paperclip className="size-4" />
          </Button>
          <Button
            type="submit"
            size="icon"
            disabled={!canSend || isSending}
            aria-label="Send message"
          >
            {isSending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <SendHorizontal className="size-4" />
            )}
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFiles}
        />
      </div>
      {files.length ? (
        <div className="mx-auto mt-2 flex max-w-4xl flex-wrap gap-2">
          {files.map((file) => (
            <span
              key={`${file.name}:${file.size}`}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs"
            >
              {file.name}
              <button
                type="button"
                onClick={() =>
                  setFiles((current) => current.filter((item) => item !== file))
                }
                aria-label={`Remove ${file.name}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </form>
  );
}

function currentMentionQuery(content: string) {
  const match = /(?:^|\s)@([\w.'-]*)$/u.exec(content);
  return match ? match[1] : null;
}
