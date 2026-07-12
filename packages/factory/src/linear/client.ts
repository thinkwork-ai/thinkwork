/**
 * Thin gateway over @linear/sdk so the poller/preflight/tests never touch the
 * SDK directly — tests use an in-memory fake implementing LinearGateway.
 *
 * Auth note: Linear personal API keys go in the Authorization header as the
 * BARE key (no `Bearer` prefix). `new LinearClient({ apiKey })` does exactly
 * that; never pass the key via `accessToken`, which adds `Bearer`.
 */

import { LinearClient } from "@linear/sdk";

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
}

export interface LinearCommentSnapshot {
  id: string;
  body: string;
}

export interface LinearGateway {
  /** All non-archived issues for the configured team (paginated fully). */
  listTeamIssues(teamKey: string): Promise<LinearIssueSnapshot[]>;
  listComments(issueId: string): Promise<LinearCommentSnapshot[]>;
  createComment(issueId: string, body: string): Promise<void>;
  updateComment(commentId: string, body: string): Promise<void>;
  addLabel(issueId: string, labelName: string): Promise<void>;
  removeLabel(issueId: string, labelName: string): Promise<void>;
  setState(issueId: string, stateName: string): Promise<void>;
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

export function createLinearGateway(apiKey: string): LinearGateway {
  const client = new LinearClient({ apiKey });

  async function teamByKey(teamKey: string) {
    const teams = await client.teams({ filter: { key: { eq: teamKey } } });
    const team = teams.nodes[0];
    if (!team) throw new Error(`Linear team with key "${teamKey}" not found`);
    return team;
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

  return {
    async listTeamIssues(teamKey) {
      const team = await teamByKey(teamKey);
      const issues = await drain(
        (await team.issues({ first: 100 })) as unknown as PageOf<{
          id: string;
          identifier: string;
          title: string;
          description?: string;
          state: Promise<{ name: string } | undefined>;
          labels(): Promise<PageOf<{ name: string }>>;
        }>,
      );
      const snapshots: LinearIssueSnapshot[] = [];
      for (const issue of issues) {
        const state = await issue.state;
        const labels = await drain(await issue.labels());
        snapshots.push({
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          description: issue.description ?? "",
          state: state?.name ?? "",
          labels: labels.map((l) => l.name),
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
        }>,
      );
      return comments.map((c) => ({ id: c.id, body: c.body }));
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
  };
}
