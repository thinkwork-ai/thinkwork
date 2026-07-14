/**
 * In-memory LinearGateway fake for poller/preflight tests. Records every
 * write; reads can be programmed to fail to simulate mid-poll API errors.
 */

import type {
  LinearCommentSnapshot,
  LinearGateway,
  LinearIssueSnapshot,
} from "../src/linear/client.js";

export interface FakeIssue extends LinearIssueSnapshot {
  comments: LinearCommentSnapshot[];
  /** KTD-12 guard input: does this issue have child issues? */
  hasChildren?: boolean;
  /** Child workflow-state names; defaults derived from hasChildren. */
  childStates?: string[];
  /** Content of the `Progress: <title>` document; null/absent = none. */
  progressDoc?: string | null;
}

export interface WriteLogEntry {
  op:
    | "createComment"
    | "updateComment"
    | "addLabel"
    | "removeLabel"
    | "setState";
  args: string[];
}

let nextCommentId = 1;

export function makeIssue(
  partial: Partial<FakeIssue> & { identifier: string },
): FakeIssue {
  return {
    id: partial.id ?? `uuid-${partial.identifier}`,
    identifier: partial.identifier,
    title: partial.title ?? `Title for ${partial.identifier}`,
    description: partial.description ?? "",
    state: partial.state ?? "Todo",
    labels: partial.labels ?? [],
    url: partial.url ?? `https://linear.test/issue/${partial.identifier}`,
    parentLabels: partial.parentLabels,
    comments: partial.comments ?? [],
    hasChildren: partial.hasChildren ?? false,
    childStates: partial.childStates,
    progressDoc: partial.progressDoc ?? null,
  };
}

export class FakeGateway implements LinearGateway {
  issues: FakeIssue[];
  writes: WriteLogEntry[] = [];
  /** Author id stamped on comments this gateway creates (the daemon). */
  viewer = "viewer-daemon";
  /** When set, the matching read throws once (then auto-clears). */
  failNextListIssues = false;
  /** Issue id whose next listComments call throws (auto-clears). */
  failListCommentsFor: string | null = null;

  constructor(issues: FakeIssue[]) {
    this.issues = issues;
  }

  private byId(issueId: string): FakeIssue {
    const issue = this.issues.find((i) => i.id === issueId);
    if (!issue) throw new Error(`fake: unknown issue ${issueId}`);
    return issue;
  }

  async listTeamIssues(_teamKey: string): Promise<LinearIssueSnapshot[]> {
    if (this.failNextListIssues) {
      this.failNextListIssues = false;
      throw new Error("fake: listTeamIssues 500");
    }
    return this.issues.map(({ comments: _c, ...snapshot }) => ({
      ...snapshot,
    }));
  }

  async getIssuesByIdentifier(
    identifiers: string[],
  ): Promise<LinearIssueSnapshot[]> {
    if (this.failNextListIssues) {
      this.failNextListIssues = false;
      throw new Error("fake: getIssuesByIdentifier 500");
    }
    const wanted = new Set(identifiers);
    return this.issues
      .filter((i) => wanted.has(i.identifier))
      .map(({ comments: _c, ...snapshot }) => ({ ...snapshot }));
  }

  async listComments(issueId: string): Promise<LinearCommentSnapshot[]> {
    if (this.failListCommentsFor === issueId) {
      this.failListCommentsFor = null;
      throw new Error(`fake: listComments 500 for ${issueId}`);
    }
    return this.byId(issueId).comments.map((c) => ({ ...c }));
  }

  async viewerId(): Promise<string> {
    return this.viewer;
  }

  async createComment(issueId: string, body: string): Promise<void> {
    this.writes.push({ op: "createComment", args: [issueId, body] });
    this.byId(issueId).comments.push({
      id: `c-${nextCommentId++}`,
      body,
      authorId: this.viewer,
    });
  }

  async updateComment(commentId: string, body: string): Promise<void> {
    this.writes.push({ op: "updateComment", args: [commentId, body] });
    for (const issue of this.issues) {
      const comment = issue.comments.find((c) => c.id === commentId);
      if (comment) {
        comment.body = body;
        return;
      }
    }
    throw new Error(`fake: unknown comment ${commentId}`);
  }

  async addLabel(issueId: string, labelName: string): Promise<void> {
    this.writes.push({ op: "addLabel", args: [issueId, labelName] });
    const issue = this.byId(issueId);
    if (!issue.labels.includes(labelName)) issue.labels.push(labelName);
  }

  async removeLabel(issueId: string, labelName: string): Promise<void> {
    this.writes.push({ op: "removeLabel", args: [issueId, labelName] });
    const issue = this.byId(issueId);
    issue.labels = issue.labels.filter((l) => l !== labelName);
  }

  async childIssueStates(issueId: string): Promise<string[]> {
    const issue = this.byId(issueId);
    if (issue.childStates !== undefined) return issue.childStates;
    return issue.hasChildren === true ? ["In Progress"] : [];
  }

  async getProgressDocument(
    issueId: string,
    _featureTitle: string,
  ): Promise<string | null> {
    return this.byId(issueId).progressDoc ?? null;
  }

  async setState(issueId: string, stateName: string): Promise<void> {
    this.writes.push({ op: "setState", args: [issueId, stateName] });
    this.byId(issueId).state = stateName;
  }

  writesOf(op: WriteLogEntry["op"]): WriteLogEntry[] {
    return this.writes.filter((w) => w.op === op);
  }
}
