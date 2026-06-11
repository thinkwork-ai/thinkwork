/**
 * Interactive ask_user_question card (plan 2026-06-09-005 U8).
 *
 * Renders the `data-user-question` message part — the question batch is
 * written ONCE at intake (questions only); answer state derives from the
 * message-level `userQuestion` GraphQL field (the pending_user_questions
 * row), never from local component state or parts mutation.
 *
 * Multi-question batches render one question at a time behind a tab strip
 * (Claude Code AskUserQuestion style): each tab shows the question header
 * plus a check once that question has a selection; picking a single-select
 * option auto-advances to the next unanswered question (multiSelect and
 * "Other" do not). ONE submit covers the whole batch and partial submits
 * stay allowed. Single-question batches render with no tab chrome.
 *
 * Answers payload contract (the wire convention the runtime echo block
 * matches on): an object keyed by question HEADER; value is the selected
 * option label string (single-select) or an array of labels (multiSelect);
 * a free-text "Other" answer is the typed string. " (Recommended)" suffixes
 * are stripped for display but the ORIGINAL label string — suffix included —
 * is what gets submitted.
 */

import { useState } from "react";
import { useMutation } from "urql";
import { Check } from "lucide-react";
import {
  Badge,
  Button,
  Input,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@thinkwork/ui";
import { cn } from "@/lib/utils";
import { formatTinyRelativeDate } from "@/lib/relative-time";
import { AnswerUserQuestionMutation } from "@/lib/user-question-queries";
import { toUserQuestionStatus } from "@/lib/user-question-record";
import type {
  UserQuestionData,
  UserQuestionItem,
  UserQuestionRecord,
} from "@/lib/ui-message-types";

// Canonical home is `@/lib/ui-message-types`; re-exported for existing
// imports that reach for the record type via the card module.
export type {
  UserQuestionRecord,
  UserQuestionStatus,
} from "@/lib/ui-message-types";

interface UserQuestionCardProps {
  data: UserQuestionData;
  question?: UserQuestionRecord | null;
}

const OTHER_VALUE = "__other__";
const RECOMMENDED_SUFFIX = /\s*\(recommended\)\s*$/i;

interface NormalizedQuestion {
  question: string;
  header: string;
  options: Array<{ label: string; description: string }>;
  multiSelect: boolean;
}

function normalizeQuestions(items?: UserQuestionItem[]): NormalizedQuestion[] {
  const normalized: NormalizedQuestion[] = [];
  for (const item of items ?? []) {
    if (!item || typeof item !== "object") continue;
    const question =
      typeof item.question === "string" ? item.question.trim() : "";
    const header = typeof item.header === "string" ? item.header.trim() : "";
    if (!question && !header) continue;
    normalized.push({
      question,
      header,
      options: (Array.isArray(item.options) ? item.options : [])
        .filter(
          (option) =>
            option &&
            typeof option.label === "string" &&
            option.label.trim() !== "",
        )
        .map((option) => ({
          label: option.label as string,
          description:
            typeof option.description === "string" ? option.description : "",
        })),
      multiSelect: item.multiSelect === true,
    });
  }
  return normalized;
}

function splitRecommended(label: string): {
  display: string;
  recommended: boolean;
} {
  const display = label.replace(RECOMMENDED_SUFFIX, "").trim();
  return {
    display: display || label,
    recommended: RECOMMENDED_SUFFIX.test(label),
  };
}

/** Answer key for a question: header first, then question text, then index. */
function answerKeyFor(question: NormalizedQuestion, index: number): string {
  return question.header || question.question || String(index);
}

/** Tab / fallback display label for a question. */
function headerLabelFor(question: NormalizedQuestion, index: number): string {
  return question.header || `Question ${index + 1}`;
}

function parseAnswersRecord(value: unknown): Record<string, unknown> {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

/**
 * Find this question's answer in the answers record — header first, then
 * question text, then batch index, trimmed/case-insensitive (mirrors the
 * runtime echo-block matcher).
 */
function answerForQuestion(
  answers: Record<string, unknown>,
  question: NormalizedQuestion,
  index: number,
): unknown {
  const candidates = new Map<string, unknown>();
  for (const [key, value] of Object.entries(answers)) {
    candidates.set(key.trim().toLowerCase(), value);
  }
  for (const lookup of [
    question.header.trim().toLowerCase(),
    question.question.trim().toLowerCase(),
    String(index),
  ]) {
    if (!lookup) continue;
    if (candidates.has(lookup)) return candidates.get(lookup);
  }
  return undefined;
}

function answerLabels(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values
    .filter(
      (entry): entry is string | number | boolean =>
        typeof entry === "string" ||
        typeof entry === "number" ||
        typeof entry === "boolean",
    )
    .map((entry) => String(entry))
    .filter((entry) => entry.trim() !== "");
}

export function UserQuestionCard({ data, question }: UserQuestionCardProps) {
  const questionId = typeof data.questionId === "string" ? data.questionId : "";
  const questions = normalizeQuestions(data.questions);
  // 2+ questions go behind a one-question-at-a-time tab strip; a single
  // question renders with no tab chrome at all.
  const tabbed = questions.length > 1;

  // Selected option labels per question index (OTHER_VALUE marks the
  // free-text choice); preserved across mutation errors so a retry keeps
  // the user's selections.
  const [selections, setSelections] = useState<Record<number, string[]>>({});
  const [otherTexts, setOtherTexts] = useState<Record<number, string>>({});
  const [activeTab, setActiveTab] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Server-confirmed answer state from the mutation result — still the
  // question record (server data), used until the message query refetches.
  const [submittedRecord, setSubmittedRecord] =
    useState<UserQuestionRecord | null>(null);
  // QUESTION_ALREADY_ANSWERED without fresh row data: flip to the answered
  // display; the subscription-triggered refetch fills in the details.
  const [alreadyAnswered, setAlreadyAnswered] = useState(false);

  const [{ fetching }, answerQuestion] = useMutation(
    AnswerUserQuestionMutation,
  );

  const activeIndex =
    questions.length > 0
      ? Math.min(Math.max(activeTab, 0), questions.length - 1)
      : 0;

  // Answer state ALWAYS prefers the persisted record; the mutation result
  // bridges the gap until the refetch lands. Never trust local-only state.
  const record =
    question && question.status !== "PENDING"
      ? question
      : (submittedRecord ?? question ?? null);
  const status =
    record?.status ??
    (alreadyAnswered || submittedRecord ? "ANSWERED" : "PENDING");
  const effectiveStatus =
    status === "PENDING" && alreadyAnswered ? "ANSWERED" : status;

  if (effectiveStatus === "CANCELLED") {
    return (
      <div
        data-testid="user-question-card"
        className="grid gap-2 rounded-lg border border-border/70 bg-background/70 p-4"
      >
        <p className="text-sm text-muted-foreground">
          No longer waiting on this question.
        </p>
        {questions.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {questions.map((questionItem, index) => (
              <span
                key={`${headerLabelFor(questionItem, index)}-${index}`}
                className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              >
                {headerLabelFor(questionItem, index)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (effectiveStatus !== "PENDING") {
    return <AnsweredQuestionCard questions={questions} record={record} />;
  }

  function resolvedAnswerFrom(
    index: number,
    selectionsState: Record<number, string[]>,
    otherTextsState: Record<number, string>,
  ): string | string[] | null {
    const questionItem = questions[index];
    const selected = selectionsState[index] ?? [];
    const otherText = (otherTextsState[index] ?? "").trim();
    const labels = selected
      .map((value) => (value === OTHER_VALUE ? otherText : value))
      .filter((value) => value.trim() !== "");
    if (labels.length === 0) return null;
    return questionItem.multiSelect ? labels : labels[0];
  }

  function resolvedAnswer(index: number): string | string[] | null {
    return resolvedAnswerFrom(index, selections, otherTexts);
  }

  /**
   * Next unanswered question after `from` (wrapping), judged against the
   * just-updated selections — or null when everything else is answered.
   */
  function nextUnanswered(
    from: number,
    selectionsState: Record<number, string[]>,
  ): number | null {
    for (let offset = 1; offset < questions.length; offset++) {
      const index = (from + offset) % questions.length;
      if (resolvedAnswerFrom(index, selectionsState, otherTexts) === null) {
        return index;
      }
    }
    return null;
  }

  function setSingle(index: number, value: string) {
    const next = { ...selections, [index]: [value] };
    setSelections(next);
    // Auto-advance on a concrete single-select choice (Claude Code style).
    // "Other" stays put — its inline input needs to stay visible.
    if (tabbed && value !== OTHER_VALUE) {
      const target = nextUnanswered(index, next);
      if (target !== null) setActiveTab(target);
    }
  }

  function toggleMulti(index: number, value: string) {
    setSelections((prev) => {
      const current = prev[index] ?? [];
      const next = current.includes(value)
        ? current.filter((entry) => entry !== value)
        : [...current, value];
      return { ...prev, [index]: next };
    });
  }

  async function handleSubmit() {
    if (!questionId) {
      setErrorMessage("This question card is missing its question id.");
      return;
    }
    // Partial submit: only answered questions make it into the payload,
    // keyed by question HEADER (wire convention from U4).
    const answers: Record<string, string | string[]> = {};
    questions.forEach((questionItem, index) => {
      const value = resolvedAnswer(index);
      if (value !== null) {
        answers[answerKeyFor(questionItem, index)] = value;
      }
    });

    setErrorMessage(null);
    const result = await answerQuestion({
      questionId,
      answers: JSON.stringify(answers),
    });

    if (result.error) {
      const codes = result.error.graphQLErrors.map(
        (graphQLError) => graphQLError.extensions?.code,
      );
      if (codes.includes("QUESTION_ALREADY_ANSWERED")) {
        // Someone else (or another device) got there first — flip to the
        // answered display; the refetch fills in who/when.
        setAlreadyAnswered(true);
        return;
      }
      setErrorMessage(
        result.error.graphQLErrors[0]?.message ?? result.error.message,
      );
      return;
    }

    const answered = result.data?.answerUserQuestion;
    if (answered) {
      setSubmittedRecord({
        id: answered.id,
        status: toUserQuestionStatus(answered.status),
        answers: answered.answers ?? null,
        answeredVia: answered.answeredVia ? String(answered.answeredVia) : null,
        answeredBy: answered.answeredBy ?? null,
        answeredAt: answered.answeredAt ?? null,
      });
    } else {
      setAlreadyAnswered(true);
    }
  }

  function renderQuestionFieldset(
    questionItem: NormalizedQuestion,
    index: number,
  ) {
    const selected = selections[index] ?? [];
    const answered = resolvedAnswer(index) !== null;
    const groupName = `user-question-${questionId}-${index}`;
    const otherSelected = selected.includes(OTHER_VALUE);
    return (
      <fieldset
        key={`${groupName}`}
        disabled={fetching}
        // In tabbed mode the header lives on the tab; keep it as the
        // group's accessible name without repeating it visually.
        aria-label={tabbed ? headerLabelFor(questionItem, index) : undefined}
        className="grid min-w-0 gap-2 border-0 p-0"
      >
        {!tabbed ? (
          <legend className="contents">
            <span
              className={cn(
                "text-sm font-semibold",
                answered ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {headerLabelFor(questionItem, index)}
            </span>
          </legend>
        ) : null}
        {questionItem.question ? (
          <p
            className={cn(
              "text-sm leading-5 text-foreground/90",
              tabbed && "font-medium text-foreground",
            )}
          >
            {questionItem.question}
            {questionItem.multiSelect ? (
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                (select all that apply)
              </span>
            ) : null}
          </p>
        ) : null}
        <div className="grid gap-1">
          {questionItem.options.map((option) => {
            const { display, recommended } = splitRecommended(option.label);
            const checked = selected.includes(option.label);
            return (
              <label
                key={option.label}
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 transition-colors",
                  checked
                    ? "border-primary/50 bg-primary/5"
                    : "border-border/60 bg-background/40 hover:bg-muted/40",
                  fetching && "cursor-not-allowed opacity-70",
                )}
              >
                <input
                  type={questionItem.multiSelect ? "checkbox" : "radio"}
                  name={groupName}
                  value={option.label}
                  checked={checked}
                  disabled={fetching}
                  className="mt-0.5 size-3.5 shrink-0 accent-primary"
                  onChange={() =>
                    questionItem.multiSelect
                      ? toggleMulti(index, option.label)
                      : setSingle(index, option.label)
                  }
                />
                <span className="grid min-w-0 gap-0.5">
                  <span className="flex flex-wrap items-center gap-1.5 text-sm text-foreground">
                    {display}
                    {recommended ? (
                      <Badge
                        variant="outline"
                        className="rounded-full border-primary/30 bg-primary/10 px-1.5 py-0 text-[10px] font-medium text-primary"
                      >
                        Recommended
                      </Badge>
                    ) : null}
                  </span>
                  {option.description ? (
                    <span className="text-xs leading-4 text-muted-foreground">
                      {option.description}
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
          <label
            className={cn(
              "flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 transition-colors",
              otherSelected
                ? "border-primary/50 bg-primary/5"
                : "border-border/60 bg-background/40 hover:bg-muted/40",
              fetching && "cursor-not-allowed opacity-70",
            )}
          >
            <input
              type={questionItem.multiSelect ? "checkbox" : "radio"}
              name={groupName}
              value={OTHER_VALUE}
              checked={otherSelected}
              disabled={fetching}
              className="mt-0.5 size-3.5 shrink-0 accent-primary"
              onChange={() =>
                questionItem.multiSelect
                  ? toggleMulti(index, OTHER_VALUE)
                  : setSingle(index, OTHER_VALUE)
              }
            />
            <span className="text-sm text-foreground">Other</span>
          </label>
          {otherSelected ? (
            <Input
              type="text"
              value={otherTexts[index] ?? ""}
              disabled={fetching}
              placeholder="Type your answer"
              aria-label={`Other answer for ${
                questionItem.header || `question ${index + 1}`
              }`}
              className="h-8 text-sm"
              onChange={(event) =>
                setOtherTexts((prev) => ({
                  ...prev,
                  [index]: event.target.value,
                }))
              }
            />
          ) : null}
        </div>
      </fieldset>
    );
  }

  return (
    <div
      data-testid="user-question-card"
      className="grid gap-4 rounded-lg border border-border/70 bg-background/70 p-4"
    >
      {tabbed ? (
        <Tabs
          value={String(activeIndex)}
          onValueChange={(value) => setActiveTab(Number(value))}
          className="gap-3"
        >
          <TabsList
            variant="line"
            className="w-full justify-start overflow-x-auto border-b border-border/60"
          >
            {questions.map((questionItem, index) => {
              const answered = resolvedAnswer(index) !== null;
              return (
                <TabsTrigger
                  key={`tab-${index}`}
                  value={String(index)}
                  disabled={fetching}
                  className={cn(
                    "flex-none gap-1.5 px-3",
                    // Unanswered tabs stay visually muted; partial submit
                    // is still allowed.
                    !answered && "text-muted-foreground/80",
                  )}
                >
                  {answered ? (
                    <Check aria-hidden className="size-3.5 text-primary" />
                  ) : null}
                  {headerLabelFor(questionItem, index)}
                </TabsTrigger>
              );
            })}
          </TabsList>
          {questions.map((questionItem, index) => (
            <TabsContent key={`panel-${index}`} value={String(index)}>
              {renderQuestionFieldset(questionItem, index)}
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        questions.map((questionItem, index) =>
          renderQuestionFieldset(questionItem, index),
        )
      )}
      {errorMessage ? (
        <p role="alert" className="text-xs leading-4 text-destructive">
          {errorMessage}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={fetching}
          onClick={() => void handleSubmit()}
        >
          {fetching ? <Spinner className="size-3.5" /> : null}
          {errorMessage ? "Retry" : "Submit answers"}
        </Button>
        <p className="text-xs text-muted-foreground">
          You can also just reply in chat — any reply answers this.
        </p>
        {tabbed ? (
          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={fetching || activeIndex === 0}
              onClick={() => setActiveTab(activeIndex - 1)}
            >
              Back
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={fetching || activeIndex === questions.length - 1}
              onClick={() => setActiveTab(activeIndex + 1)}
            >
              Next
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AnsweredQuestionCard({
  questions,
  record,
}: {
  questions: NormalizedQuestion[];
  record: UserQuestionRecord | null;
}) {
  const answeredVia = record?.answeredVia
    ? String(record.answeredVia).toUpperCase()
    : null;
  const answers = parseAnswersRecord(record?.answers);
  // answeredBy is a users.id UUID — only a resolved display name is ever
  // rendered; with no name source the byline is just "Answered".
  const answeredByName = record?.answeredByDisplayName?.trim() || null;
  const relativeTime = formatTinyRelativeDate(record?.answeredAt);
  const byline =
    answeredVia === "REPLY"
      ? [
          answeredByName
            ? `Answered by reply — ${answeredByName}`
            : "Answered by reply",
          relativeTime,
        ]
          .filter(Boolean)
          .join(" · ")
      : [
          answeredByName ? `Answered by ${answeredByName}` : "Answered",
          relativeTime,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div
      data-testid="user-question-card"
      className="grid gap-3 rounded-lg border border-border/70 bg-background/70 p-4"
    >
      {answeredVia === "REPLY" ? (
        // Answered in chat: the structured answers live on the reply
        // message, but the card still shows WHAT was asked — never a
        // contentless shell.
        <ol className="grid gap-1.5">
          {questions.map((questionItem, index) => (
            <li
              key={`${questionItem.header || questionItem.question}-${index}`}
              className="flex min-w-0 gap-1.5 text-sm leading-5 text-muted-foreground"
            >
              <span className="shrink-0 tabular-nums">{index + 1}.</span>
              <span className="min-w-0">
                <span className="font-semibold">
                  {questionItem.header || `Question ${index + 1}`}
                  {questionItem.question ? ": " : ""}
                </span>
                {questionItem.question || null}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <ol className="grid gap-1.5">
          {questions.map((questionItem, index) => {
            const labels = answerLabels(
              answerForQuestion(answers, questionItem, index),
            );
            return (
              <li
                key={`${questionItem.header || questionItem.question}-${index}`}
                className="flex min-w-0 gap-1.5 text-sm leading-5"
              >
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {index + 1}.
                </span>
                <span className="min-w-0">
                  <span className="font-semibold text-foreground">
                    {questionItem.header || `Question ${index + 1}`}:{" "}
                  </span>
                  {labels.length > 0 ? (
                    <span className="text-foreground">
                      {labels
                        .map((label) => splitRecommended(label).display)
                        .join(", ")}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Not answered</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="text-xs text-muted-foreground">{byline}</p>
    </div>
  );
}
