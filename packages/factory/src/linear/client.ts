/**
 * Thin gateway over @linear/sdk so the poller/preflight/tests never touch the
 * SDK directly — tests use an in-memory fake implementing LinearGateway.
 *
 * Auth note: Linear personal API keys go in the Authorization header as the
 * BARE key (no `Bearer` prefix). `new LinearClient({ apiKey })` does exactly
 * that; never pass the key via `accessToken`, which adds `Bearer`.
 */

import { LinearClient } from "@linear/sdk";

import {
  ACTIVE_STATES,
  LANE_LABELS,
  VERIFICATION_STATES,
} from "../domain/statuses.js";

/**
 * Thrown at gateway construction when the @linear/sdk internal client shape the
 * raw candidate query depends on is missing (an SDK upgrade broke the reach).
 * Failing here — at startup — beats failing deep inside the first poll.
 */
export class LinearSdkShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinearSdkShapeError";
  }
}

export interface LinearIssueSnapshot {
  /** Linear internal id (uuid). */
  id: string;
  /** Human identifier, e.g. "THINK-123". */
  identifier: string;
  title: string;
  description: string;
  /** Workflow state name, e.g. "Ready to Work", "Verification". */
  state: string;
  /** Label names. */
  labels: string[];
  /** Web URL of the issue (for operator-facing links, e.g. Slack). */
  url?: string;
  /**
   * Label names on the DIRECT parent issue, or undefined when the issue has
   * no parent (or the gateway predates this field). Drives LFG inheritance:
   * a sub-issue of an LFG parent auto-advances through review gates so it
   * never stalls the parent (the factory created the children itself —
   * gating them on a human violates the LFG never-stuck doctrine). One level
   * only: the factory's plan phase creates a single tier of sub-issues.
   */
  parentLabels?: string[];
}

export interface LinearCommentSnapshot {
  id: string;
  body: string;
  /** Web URL of the comment (deep link, e.g. for Slack question links). */
  url?: string | null;
  /**
   * Author id: the workspace user id, or the bot actor id for
   * integration-authored comments. `null`/absent when the SDK exposes
   * neither — such comments are treated as UNTRUSTED for baton/evidence
   * purposes (fail-safe).
   */
  authorId?: string | null;
}

/**
 * Trust allowlist for comment-derived signals (batons, baton evidence).
 * Mirrors the Slack operator-allowlist doctrine applied to Linear: comments
 * are world-writable, so anything that steers a privileged worker or
 * advances a phase must come from the daemon itself or an operator.
 */
export interface CommentTrust {
  /** The daemon's own Linear viewer id (implicitly trusted). */
  daemonViewerId: string | null;
  /** Operator-configured trusted commenter ids (config `linear.trustedUserIds`). */
  trustedUserIds: readonly string[];
}

/** True when the comment's author is the daemon or an allowlisted user. */
export function isTrustedComment(
  comment: LinearCommentSnapshot,
  trust: CommentTrust,
): boolean {
  const author = comment.authorId ?? null;
  if (author === null) return false; // no author id → untrusted (fail-safe)
  if (trust.daemonViewerId !== null && author === trust.daemonViewerId)
    return true;
  return trust.trustedUserIds.includes(author);
}

export interface LinearGateway {
  /** All non-archived issues for the configured team (paginated fully). */
  listTeamIssues(teamKey: string): Promise<LinearIssueSnapshot[]>;
  /**
   * Fetch specific issues by human identifier (e.g. "THINK-123"). Used by the
   * tracer / safe-rollout scope so a scoped run fetches only those issues
   * instead of draining the whole team. Unknown identifiers are skipped.
   */
  getIssuesByIdentifier(identifiers: string[]): Promise<LinearIssueSnapshot[]>;
  /**
   * INVARIANT: comments are returned OLDEST-FIRST (createdAt ascending).
   * Every "newest X" finder in the codebase (findLedgerComment,
   * findNewestBaton, the Slack escalation's newestQuestion) iterates from the
   * array END expecting the newest comment there. @linear/sdk returns
   * newest-first (verified empirically 2026-07-13), which silently inverted
   * ALL of them in production — workers relaunched from the OLDEST baton (so
   * Slack-relayed answers never reached them) and escalations quoted the
   * oldest comment as "the question". The real gateway sorts to enforce this;
   * fakes must keep insertion (chronological) order.
   */
  listComments(issueId: string): Promise<LinearCommentSnapshot[]>;
  createComment(issueId: string, body: string): Promise<void>;
  updateComment(commentId: string, body: string): Promise<void>;
  addLabel(issueId: string, labelName: string): Promise<void>;
  removeLabel(issueId: string, labelName: string): Promise<void>;
  setState(issueId: string, stateName: string): Promise<void>;
  /** The authenticated (daemon) user's Linear id, cached after first fetch. */
  viewerId(): Promise<string>;
  /**
   * Workflow-state names of the issue's child issues (empty = no children).
   * Drives the parent-issue rule: children in flight -> parent waits quietly;
   * all children Done/Canceled -> parent proceeds. Replaces the boolean
   * hasChildIssues (existence = states.length > 0).
   */
  childIssueStates(issueId: string): Promise<string[]>;
  /**
   * Markdown content of the Progress document for this issue, or null when
   * none exists. Implementation choice (documented per U5): @linear/sdk
   * exposes `issue.documents()` whose Document fragment includes `title` and
   * `content`, so we read documents attached to the ISSUE directly — an exact
   * `Progress: <featureTitle>` title match wins, else the newest
   * `Progress:`-prefixed document. No project-level fallback is needed; when
   * nothing matches we return null and baton synthesis falls back to issue
   * description + comments.
   */
  getProgressDocument(
    issueId: string,
    featureTitle: string,
  ): Promise<string | null>;
}

interface PageOf<T> {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor?: string };
  fetchNext(): Promise<PageOf<T>>;
}

async function drain<T>(first: PageOf<T>): Promise<T[]> {
  const all: T[] = [...first.nodes];
  let page = first;
  while (page.pageInfo.hasNextPage) {
    page = await page.fetchNext();
    all.push(...page.nodes);
  }
  return all;
}

/**
 * Server-side candidate filter + INLINE state/labels selection (U6 poll-cost
 * fix). The naive `team.issues()` drain then N+1s `issue.state` +
 * `issue.labels()` per issue — ~2N extra round trips, 60s+ on the real
 * 245-issue team. This raw GraphQL query instead:
 *   1. filters to candidates server-side (lane-labeled active issues PLUS every
 *      Verification-family issue), so only dispatchable issues come back; and
 *   2. selects `state { name }` and `labels { nodes { name } }` inline, killing
 *      the N+1 — one request per page, not ~2N.
 * The poller's client-side `matchesFilter` still runs (belt-and-suspenders), so
 * this filter is a pure optimization and correctness never depends on it.
 */
const TEAM_ISSUES_QUERY = `
query FactoryTeamIssues($filter: IssueFilter, $after: String) {
  issues(first: 100, after: $after, includeArchived: false, filter: $filter) {
    nodes {
      id
      identifier
      title
      description
      url
      state { name }
      labels { nodes { name } }
      parent { labels { nodes { name } } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

interface RawIssueNode {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string | null;
  state: { name: string } | null;
  labels: { nodes: { name: string }[] };
  parent: { labels: { nodes: { name: string }[] } } | null;
}

interface RawIssuesResponse {
  issues: {
    nodes: RawIssueNode[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

/** IssueFilter selecting the same candidates the poller enrolls. */
function candidateIssueFilter(teamId: string): Record<string, unknown> {
  return {
    team: { id: { eq: teamId } },
    or: [
      {
        and: [
          { state: { name: { in: [...ACTIVE_STATES] } } },
          { labels: { some: { name: { in: [...LANE_LABELS] } } } },
        ],
      },
      { state: { name: { in: [...VERIFICATION_STATES] } } },
    ],
  };
}

export function createLinearGateway(apiKey: string): LinearGateway {
  const client = new LinearClient({ apiKey });
  let cachedViewerId: string | null = null;

  // Team ids are immutable — cache per key so the per-tick listTeamIssues call
  // doesn't spend one of the 2,500 hourly API requests re-resolving it forever.
  const cachedTeamIds = new Map<string, string>();

  async function teamIdByKey(teamKey: string): Promise<string> {
    const cached = cachedTeamIds.get(teamKey);
    if (cached !== undefined) return cached;
    const teams = await client.teams({ filter: { key: { eq: teamKey } } });
    const team = teams.nodes[0];
    if (!team) throw new Error(`Linear team with key "${teamKey}" not found`);
    cachedTeamIds.set(teamKey, team.id);
    return team.id;
  }

  async function labelIdByName(
    issueId: string,
    labelName: string,
  ): Promise<string> {
    const issue = await client.issue(issueId);
    const team = await issue.team;
    if (!team) throw new Error(`issue ${issueId} has no team`);
    const labels = await drain(
      (await team.labels({
        filter: { name: { eq: labelName } },
      })) as unknown as PageOf<{
        id: string;
        name: string;
      }>,
    );
    const match = labels.find((l) => l.name === labelName);
    if (!match)
      throw new Error(`label "${labelName}" not found on team ${team.key}`);
    return match.id;
  }

  // The SDK's underlying GraphQL client, used for the one raw candidate query
  // (state + labels inline) that the typed helpers cannot express without an
  // N+1. Typed minimally so we never depend on @linear/sdk internals.
  const gql = (
    client as unknown as {
      client?: {
        rawRequest<T>(
          query: string,
          variables?: Record<string, unknown>,
        ): Promise<{ data?: T | null; errors?: unknown }>;
      };
    }
  ).client;

  // Startup guard (fail loudly, not mid-poll): the raw candidate query reaches
  // into @linear/sdk internals. If that shape ever changes, throw a clear,
  // named error at construction instead of a cryptic failure on the first poll.
  if (gql === undefined || typeof gql.rawRequest !== "function") {
    throw new LinearSdkShapeError(
      "createLinearGateway: expected @linear/sdk client.client.rawRequest to be a " +
        "function, but it is missing — the SDK internal shape changed and the raw " +
        "candidate query (listTeamIssues) cannot run. Pin/adjust @linear/sdk or " +
        "update the raw-GraphQL reach in linear/client.ts.",
    );
  }

  return {
    async listTeamIssues(teamKey) {
      // Resolve the team first so an unknown key still fails loudly (a
      // server-side filter on a bad key would otherwise just return an empty
      // board and hide the misconfiguration).
      const teamId = await teamIdByKey(teamKey);
      const filter = candidateIssueFilter(teamId);
      const snapshots: LinearIssueSnapshot[] = [];
      let after: string | null = null;
      for (;;) {
        const res: { data?: RawIssuesResponse | null; errors?: unknown } =
          await gql.rawRequest<RawIssuesResponse>(TEAM_ISSUES_QUERY, {
            filter,
            after,
          });
        // A page that resolves with GraphQL `errors` or without a `data.issues`
        // payload (throttle / partial failure) must NOT silently break the loop
        // — that would return a TRUNCATED candidate set that looks like success,
        // silently skipping an enrolled issue. Throw instead: pollTick's
        // try/catch converts it into a clean PollAbortedError (retried next tick).
        if (
          res.errors !== undefined &&
          res.errors !== null &&
          !(Array.isArray(res.errors) && res.errors.length === 0)
        ) {
          throw new Error(
            "listTeamIssues: Linear GraphQL returned errors mid-pagination — " +
              "aborting to avoid a truncated candidate set: " +
              JSON.stringify(res.errors),
          );
        }
        const page = res.data?.issues;
        if (!page) {
          throw new Error(
            "listTeamIssues: Linear returned a page with no `data.issues` payload " +
              "(GraphQL error, throttle, or partial failure) — aborting to avoid a " +
              "truncated candidate set",
          );
        }
        for (const n of page.nodes) {
          snapshots.push({
            id: n.id,
            identifier: n.identifier,
            title: n.title,
            description: n.description ?? "",
            state: n.state?.name ?? "",
            labels: n.labels.nodes.map((l) => l.name),
            url: n.url ?? undefined,
            parentLabels: n.parent?.labels.nodes.map((l) => l.name),
          });
        }
        if (!page.pageInfo.hasNextPage) break;
        after = page.pageInfo.endCursor;
      }
      return snapshots;
    },

    async getIssuesByIdentifier(identifiers) {
      const snapshots: LinearIssueSnapshot[] = [];
      for (const identifier of identifiers) {
        // `client.issue` accepts the human identifier (e.g. "THINK-123").
        // Skip unknown/invalid ids rather than aborting the whole scoped run.
        let issue;
        try {
          issue = await client.issue(identifier);
        } catch {
          continue;
        }
        if (!issue) continue;
        const state = await issue.state;
        const labels = await drain(
          (await issue.labels()) as unknown as PageOf<{ name: string }>,
        );
        // Parent labels for LFG inheritance. Scoped runs only (tracer /
        // safe rollout), so the extra round trips per issue are acceptable.
        let parentLabels: string[] | undefined;
        try {
          const parent = await issue.parent;
          if (parent) {
            const pl = await drain(
              (await parent.labels()) as unknown as PageOf<{ name: string }>,
            );
            parentLabels = pl.map((l) => l.name);
          }
        } catch {
          // Fetch failure → no inheritance (fail-closed: gates still gate).
          parentLabels = undefined;
        }
        snapshots.push({
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          description: issue.description ?? "",
          state: state?.name ?? "",
          labels: labels.map((l) => l.name),
          url: issue.url,
          parentLabels,
        });
      }
      return snapshots;
    },

    async listComments(issueId) {
      const issue = await client.issue(issueId);
      const comments = await drain(
        (await issue.comments()) as unknown as PageOf<{
          id: string;
          body: string;
          url?: string | null;
          createdAt: Date | string;
          /** Workspace-user author id (SDK Comment.userId getter). */
          userId?: string | null;
          /** Bot author (SDK Comment.botActor property). */
          botActor?: { id?: string | null } | null;
        }>,
      );
      // Enforce the interface's OLDEST-FIRST invariant: the SDK returns
      // newest-first, and every from-the-end "newest" finder depends on
      // chronological order (see the LinearGateway.listComments doc).
      comments.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      return comments.map((c) => ({
        id: c.id,
        body: c.body,
        url: c.url ?? null,
        authorId: c.userId ?? c.botActor?.id ?? null,
      }));
    },

    async createComment(issueId, body) {
      await client.createComment({ issueId, body });
    },

    async updateComment(commentId, body) {
      await client.updateComment(commentId, { body });
    },

    async addLabel(issueId, labelName) {
      const labelId = await labelIdByName(issueId, labelName);
      const issue = await client.issue(issueId);
      const current = await drain(
        (await issue.labels()) as unknown as PageOf<{
          id: string;
          name: string;
        }>,
      );
      const ids = new Set(current.map((l) => l.id));
      if (ids.has(labelId)) return;
      ids.add(labelId);
      await client.updateIssue(issueId, { labelIds: [...ids] });
    },

    async removeLabel(issueId, labelName) {
      const issue = await client.issue(issueId);
      const current = await drain(
        (await issue.labels()) as unknown as PageOf<{
          id: string;
          name: string;
        }>,
      );
      const remaining = current
        .filter((l) => l.name !== labelName)
        .map((l) => l.id);
      if (remaining.length === current.length) return;
      await client.updateIssue(issueId, { labelIds: remaining });
    },

    async childIssueStates(issueId) {
      const issue = await client.issue(issueId);
      const children = await drain(
        (await issue.children()) as unknown as PageOf<{
          state: Promise<{ name: string } | undefined>;
        }>,
      );
      const states: string[] = [];
      for (const child of children) {
        const st = await child.state;
        states.push(st?.name ?? "");
      }
      return states;
    },

    async getProgressDocument(issueId, featureTitle) {
      const issue = await client.issue(issueId);
      const docs = await drain(
        (await issue.documents()) as unknown as PageOf<{
          title: string;
          content?: string;
          updatedAt: Date | string;
        }>,
      );
      const exactTitle = `Progress: ${featureTitle}`;
      const byNewest = (a: { updatedAt: Date | string }, b: { updatedAt: Date | string }) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      const exact = docs.filter((d) => d.title === exactTitle).sort(byNewest);
      if (exact.length > 0) return exact[0].content ?? null;
      const prefixed = docs
        .filter((d) => d.title.startsWith("Progress:"))
        .sort(byNewest);
      if (prefixed.length > 0) return prefixed[0].content ?? null;
      return null;
    },

    async setState(issueId, stateName) {
      const issue = await client.issue(issueId);
      const team = await issue.team;
      if (!team) throw new Error(`issue ${issueId} has no team`);
      const states = await drain(
        (await team.states()) as unknown as PageOf<{
          id: string;
          name: string;
        }>,
      );
      const match = states.find((s) => s.name === stateName);
      if (!match)
        throw new Error(
          `workflow state "${stateName}" not found on team ${team.key}`,
        );
      await client.updateIssue(issueId, { stateId: match.id });
    },

    async viewerId() {
      if (cachedViewerId === null) {
        const viewer = await client.viewer;
        cachedViewerId = viewer.id;
      }
      return cachedViewerId;
    },
  };
}
