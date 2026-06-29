import type React from "react";
import { useRef, useState } from "react";
import { formatBytes } from "@thinkwork/shared-utils";
import { Link } from "@tanstack/react-router";
import {
  Archive,
  CalendarDays,
  ChevronDown,
  CheckCircle2,
  FileText,
  Flag,
  MessageSquareText,
  Plus,
  Tags,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import { IconPlanet } from "@tabler/icons-react";
import {
  Badge,
  Button,
  Calendar,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Textarea,
} from "@thinkwork/ui";
import {
  WORK_ITEM_PRIORITY_ORDER,
  type WorkItemDocumentKind,
  type WorkItemDocumentSummary,
  type WorkItemPriority,
  type WorkItemAssigneeSummary,
  type WorkItemLabelSummary,
  type WorkItemSpaceSummary,
  type WorkItemStatusSummary,
  type WorkItemSummary,
  workItemDocumentKindLabel,
  workItemAssigneeLabel,
  workItemDueLabel,
  workItemLabels,
  workItemPriorityLabel,
  workItemSourceLabel,
  workItemSpaceLabel,
  workItemStatusCategory,
  workItemStatusCategoryLabel,
  workItemStatusLabel,
  workItemThreadCountLabel,
} from "./work-item-display";

interface WorkItemDetailSheetProps {
  item: WorkItemSummary | null;
  sequenceNumber?: number;
  spaces: WorkItemSpaceSummary[];
  labels?: WorkItemLabelSummary[];
  documents?: WorkItemDocumentSummary[];
  documentsLoading?: boolean;
  documentSaving?: boolean;
  statuses: WorkItemStatusSummary[];
  assignees: WorkItemAssigneeSummary[];
  updating?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStatusChange: (
    item: WorkItemSummary,
    status: WorkItemStatusSummary,
  ) => void;
  onItemUpdate?: (
    item: WorkItemSummary,
    patch: {
      priority?: WorkItemPriority;
      dueAt?: string | null;
      ownerUserId?: string | null;
      labelIds?: string[];
    },
  ) => void;
  onDocumentCreate?: (input: {
    title: string;
    kind: WorkItemDocumentKind;
    content?: string;
    contentBase64?: string;
    contentType?: string;
    filename?: string;
  }) => Promise<boolean | void>;
  onDocumentArchive?: (document: WorkItemDocumentSummary) => void;
}

export function WorkItemDetailSheet({
  item,
  sequenceNumber,
  spaces,
  labels = [],
  documents = [],
  documentsLoading,
  documentSaving,
  statuses,
  assignees,
  updating,
  open,
  onOpenChange,
  onStatusChange,
  onItemUpdate,
  onDocumentCreate,
  onDocumentArchive,
}: WorkItemDetailSheetProps) {
  const primaryThreadId = item?.threadLinks?.[0]?.threadId;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto data-[side=right]:w-[min(520px,calc(100vw-2rem))] data-[side=right]:sm:max-w-none">
        {item ? (
          <>
            <SheetHeader className="border-b border-border/70 px-6 py-5 pr-12">
              <SheetTitle className="text-lg">{item.title}</SheetTitle>
              <SheetDescription>
                {sequenceNumber
                  ? `WI-${sequenceNumber}`
                  : shortWorkItemKey(item)}
              </SheetDescription>
            </SheetHeader>

            <div className="grid gap-5 px-6 py-5">
              <div className="flex flex-wrap items-center gap-2">
                <StatusControl
                  item={item}
                  statuses={statuses}
                  disabled={updating}
                  onChange={(status) => onStatusChange(item, status)}
                />
                <PriorityControl
                  item={item}
                  disabled={updating || !onItemUpdate}
                  onChange={(priority) => onItemUpdate?.(item, { priority })}
                />
                <AssigneeControl
                  item={item}
                  assignees={assignees}
                  disabled={updating || !onItemUpdate}
                  onChange={(ownerUserId) =>
                    onItemUpdate?.(item, { ownerUserId })
                  }
                />
                <DueDateControl
                  item={item}
                  disabled={updating || !onItemUpdate}
                  onChange={(dueAt) => onItemUpdate?.(item, { dueAt })}
                />
                <DetailBadge
                  icon={<IconPlanet className="size-3.5 text-primary" />}
                  label={workItemSpaceLabel(item.spaceId, spaces)}
                />
              </div>

              {labels.length > 0 ? (
                <LabelAssignments
                  item={item}
                  labels={labels}
                  disabled={updating || !onItemUpdate}
                  onChange={(labelIds) => onItemUpdate?.(item, { labelIds })}
                />
              ) : null}

              {item.notes ? (
                <section className="grid gap-2">
                  <h3 className="text-sm font-semibold">Notes</h3>
                  <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                    {item.notes}
                  </p>
                </section>
              ) : null}

              <DocumentsSection
                documents={documents}
                loading={documentsLoading}
                saving={documentSaving}
                onCreate={onDocumentCreate}
                onArchive={onDocumentArchive}
              />

              <Separator />

              <section className="grid gap-3">
                <h3 className="text-sm font-semibold">Source</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <DetailBadge
                    icon={<MessageSquareText className="size-3.5" />}
                    label={`${workItemThreadCountLabel(item)} - ${workItemSourceLabel(item)}`}
                  />
                  {primaryThreadId ? (
                    <Button asChild size="sm" variant="outline">
                      <Link to="/threads/$id" params={{ id: primaryThreadId }}>
                        Open thread
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </section>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DocumentsSection({
  documents,
  loading,
  saving,
  onCreate,
  onArchive,
}: {
  documents: WorkItemDocumentSummary[];
  loading?: boolean;
  saving?: boolean;
  onCreate?: (input: {
    title: string;
    kind: WorkItemDocumentKind;
    content?: string;
    contentBase64?: string;
    contentType?: string;
    filename?: string;
  }) => Promise<boolean | void>;
  onArchive?: (document: WorkItemDocumentSummary) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [addMode, setAddMode] = useState<"text" | "upload" | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<WorkItemDocumentKind>("NOTE");
  const [content, setContent] = useState("");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadKind, setUploadKind] = useState<WorkItemDocumentKind>("NOTE");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <FileText className="size-4 text-muted-foreground" />
          Documents
        </h3>
        {onCreate ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
              >
                <Plus className="size-3" />
                Add
                <ChevronDown className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={() => setAddMode("text")}>
                <FileText className="mr-2 size-3.5" />
                Text document
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setAddMode("upload")}>
                <Upload className="mr-2 size-3.5" />
                Upload file
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {addMode === "text" && onCreate ? (
        <form
          className="grid gap-3 rounded-md border border-border/80 bg-muted/10 p-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const trimmedTitle = title.trim();
            if (!trimmedTitle) return;
            const created = await onCreate({
              title: trimmedTitle,
              kind,
              content,
            });
            if (created === false) return;
            setTitle("");
            setKind("NOTE");
            setContent("");
            setAddMode(null);
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="work-item-document-title">Title</Label>
            <Input
              id="work-item-document-title"
              value={title}
              disabled={saving}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="work-item-document-kind">Kind</Label>
            <Select
              value={kind}
              disabled={saving}
              onValueChange={(value) => setKind(value as WorkItemDocumentKind)}
            >
              <SelectTrigger id="work-item-document-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORK_ITEM_DOCUMENT_KIND_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {workItemDocumentKindLabel(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="work-item-document-content">Content</Label>
            <Textarea
              id="work-item-document-content"
              rows={6}
              value={content}
              disabled={saving}
              onChange={(event) => setContent(event.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => setAddMode(null)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving || !title.trim()}>
              Save
            </Button>
          </div>
        </form>
      ) : null}

      {addMode === "upload" && onCreate ? (
        <form
          className="grid gap-3 rounded-md border border-border/80 bg-muted/10 p-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!uploadFile) return;
            const contentType =
              uploadFile.type || guessContentType(uploadFile.name);
            const isPreviewable =
              contentType.startsWith("text/") ||
              contentType === "application/json";
            const uploadContent = isPreviewable
              ? await uploadFile.text()
              : undefined;
            const contentBase64 = isPreviewable
              ? undefined
              : await fileToBase64(uploadFile);
            const created = await onCreate({
              title: uploadTitle.trim() || uploadFile.name,
              kind: uploadKind,
              content: uploadContent,
              contentBase64,
              contentType,
              filename: uploadFile.name,
            });
            if (created === false) return;
            setUploadTitle("");
            setUploadKind("NOTE");
            setUploadFile(null);
            if (fileInputRef.current) fileInputRef.current.value = "";
            setAddMode(null);
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="work-item-document-file">File</Label>
            <Input
              ref={fileInputRef}
              id="work-item-document-file"
              type="file"
              disabled={saving}
              accept=".md,.txt,.csv,.json,.pdf,.doc,.docx,.xls,.xlsx"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setUploadFile(file);
                if (file && !uploadTitle.trim()) setUploadTitle(file.name);
              }}
            />
            {uploadFile ? (
              <p className="text-xs text-muted-foreground">
                {formatBytes(uploadFile.size)}
              </p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="work-item-document-upload-title">Title</Label>
            <Input
              id="work-item-document-upload-title"
              value={uploadTitle}
              disabled={saving}
              onChange={(event) => setUploadTitle(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="work-item-document-upload-kind">Kind</Label>
            <Select
              value={uploadKind}
              disabled={saving}
              onValueChange={(value) =>
                setUploadKind(value as WorkItemDocumentKind)
              }
            >
              <SelectTrigger id="work-item-document-upload-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORK_ITEM_DOCUMENT_KIND_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {workItemDocumentKindLabel(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => setAddMode(null)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving || !uploadFile}>
              Upload
            </Button>
          </div>
        </form>
      ) : null}

      {loading && documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading documents...</p>
      ) : documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No documents yet.</p>
      ) : (
        <div className="grid gap-2">
          {documents.map((document) => (
            <article
              key={document.id}
              className="grid gap-2 rounded-md border border-border/80 bg-background p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="truncate text-sm font-medium">
                      {document.title}
                    </h4>
                    <Badge variant="outline" className="h-5 rounded-full px-2">
                      {workItemDocumentKindLabel(document.kind)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {document.contentType} | {formatBytes(document.sizeBytes)} |{" "}
                    {formatDate(document.updatedAt ?? document.createdAt)}
                  </p>
                </div>
                {onArchive ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                    disabled={saving}
                    aria-label={`Archive ${document.title}`}
                    title="Archive"
                    onClick={() => onArchive(document)}
                  >
                    <Archive className="size-3.5" />
                  </Button>
                ) : null}
              </div>
              {document.content ? (
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/20 p-2 text-xs leading-5 text-muted-foreground">
                  {document.content}
                </pre>
              ) : null}
              {!document.content && !isPreviewableDocument(document) ? (
                <p className="rounded-md bg-muted/20 p-2 text-xs text-muted-foreground">
                  Preview unavailable for this file type.
                </p>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function LabelAssignments({
  item,
  labels,
  disabled,
  onChange,
}: {
  item: WorkItemSummary;
  labels: WorkItemLabelSummary[];
  disabled?: boolean;
  onChange: (labelIds: string[]) => void;
}) {
  const selectedIds = new Set(workItemLabels(item).map((label) => label.id));
  return (
    <section className="grid gap-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Tags className="size-4 text-muted-foreground" />
        Labels
      </h3>
      <div className="flex flex-wrap gap-2">
        {labels.map((label) => {
          const checked = selectedIds.has(label.id);
          return (
            <label
              key={label.id}
              className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted/30"
            >
              <Checkbox
                className="size-3.5"
                checked={checked}
                disabled={disabled}
                onCheckedChange={(value) => {
                  const next = new Set(selectedIds);
                  if (value === true) next.add(label.id);
                  else next.delete(label.id);
                  onChange([...next]);
                }}
              />
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: label.color ?? "#64748b" }}
              />
              <span>{label.name}</span>
            </label>
          );
        })}
      </div>
    </section>
  );
}

function StatusControl({
  item,
  statuses,
  disabled,
  onChange,
}: {
  item: WorkItemSummary;
  statuses: WorkItemStatusSummary[];
  disabled?: boolean;
  onChange: (status: WorkItemStatusSummary) => void;
}) {
  const currentValue =
    item.status?.id && statuses.some((status) => status.id === item.status?.id)
      ? item.status.id
      : workItemStatusCategory(item);

  return (
    <Select
      value={currentValue}
      disabled={disabled || statuses.length === 0}
      onValueChange={(value) => {
        const next = statuses.find((status) => status.id === value);
        if (next) onChange(next);
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={`Change status for ${item.title}`}
        className={controlClassName}
      >
        <CheckCircle2 className="size-3.5 shrink-0" />
        <SelectValue placeholder={workItemStatusLabel(item)} />
      </SelectTrigger>
      <SelectContent>
        {statuses.map((status) => (
          <SelectItem key={status.id} value={status.id}>
            {status.name || workItemStatusCategoryLabel(status.category)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PriorityControl({
  item,
  disabled,
  onChange,
}: {
  item: WorkItemSummary;
  disabled?: boolean;
  onChange: (priority: WorkItemPriority) => void;
}) {
  return (
    <Select
      value={item.priority}
      disabled={disabled}
      onValueChange={(value) => onChange(value as WorkItemPriority)}
    >
      <SelectTrigger
        size="sm"
        aria-label={`Change priority for ${item.title}`}
        className={controlClassName}
      >
        <Flag className="size-3.5 shrink-0" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {WORK_ITEM_PRIORITY_ORDER.map((priority) => (
          <SelectItem key={priority} value={priority}>
            {workItemPriorityLabel(priority)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AssigneeControl({
  item,
  assignees,
  disabled,
  onChange,
}: {
  item: WorkItemSummary;
  assignees: WorkItemAssigneeSummary[];
  disabled?: boolean;
  onChange: (ownerUserId: string | null) => void;
}) {
  const value = item.ownerUserId ?? UNASSIGNED_VALUE;

  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) =>
        onChange(next === UNASSIGNED_VALUE ? null : next)
      }
    >
      <SelectTrigger
        size="sm"
        aria-label={`Change assignee for ${item.title}`}
        className={controlClassName}
      >
        <UserRound className="size-3.5 shrink-0" />
        <SelectValue placeholder={workItemAssigneeLabel(item, assignees)} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
        {assignees.map((assignee) => (
          <SelectItem key={assignee.id} value={assignee.id}>
            {assignee.name || assignee.email || "User"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DueDateControl({
  item,
  disabled,
  onChange,
}: {
  item: WorkItemSummary;
  disabled?: boolean;
  onChange: (dueAt: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const value = parseDate(item.dueAt);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={`Change due date for ${item.title}`}
          className={`${controlClassName} hover:bg-muted/40`}
        >
          <CalendarDays className="size-3.5 shrink-0" />
          <span className="truncate">{workItemDueLabel(item.dueAt)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto gap-0 rounded-lg p-0">
        <Calendar
          mode="single"
          selected={value ?? undefined}
          defaultMonth={value ?? undefined}
          captionLayout="dropdown"
          onSelect={(date) => {
            onChange(date ? noonIso(date) : null);
            setOpen(false);
          }}
        />
        {item.dueAt ? (
          <div className="flex justify-end border-t p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              <X className="size-3" />
              Clear
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function DetailBadge({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Badge
      variant="outline"
      className="h-7 max-w-full gap-1.5 rounded-full bg-muted/10 px-2.5 text-xs font-medium text-muted-foreground"
    >
      {icon}
      <span className="truncate">{label}</span>
    </Badge>
  );
}

const UNASSIGNED_VALUE = "__unassigned__";
const WORK_ITEM_DOCUMENT_KIND_OPTIONS: WorkItemDocumentKind[] = [
  "PLAN",
  "PROGRESS",
  "SPEC",
  "EVIDENCE",
  "HANDOFF",
  "NOTE",
  "OTHER",
];
const controlClassName =
  "h-7 max-w-full gap-1.5 rounded-full border border-border bg-muted/10 px-2.5 text-xs font-medium text-muted-foreground";

async function fileToBase64(file: File) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function guessContentType(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  return "application/octet-stream";
}

function isPreviewableDocument(document: WorkItemDocumentSummary) {
  const contentType = document.contentType.toLowerCase();
  return contentType.startsWith("text/") || contentType === "application/json";
}



function formatDate(value?: string | null) {
  if (!value) return "Updated recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Updated recently";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function noonIso(date: Date) {
  const next = new Date(date);
  next.setHours(12, 0, 0, 0);
  return next.toISOString();
}

function shortWorkItemKey(item: WorkItemSummary) {
  return `WI-${item.id
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 5)
    .toUpperCase()}`;
}
