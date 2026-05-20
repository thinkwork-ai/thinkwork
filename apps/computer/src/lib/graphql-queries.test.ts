import { print } from "graphql";
import { describe, expect, it } from "vitest";
import {
  AppletQuery,
  AppletsQuery,
  ChatGlobalInboxQuery,
  ComputerKnowledgeBaseDetailQuery,
  ComputerKnowledgeBasesQuery,
  ComputerMemoryRecordsQuery,
  ComputerMemorySearchQuery,
  ComputerMemorySystemConfigQuery,
  ComputerRecentWikiPagesQuery,
  ComputerWikiBacklinksQuery,
  ComputerWikiPageQuery,
  ComputerWikiSearchQuery,
  DeleteComputerMemoryRecordMutation,
  PromoteDraftAppletMutation,
  SpaceQuery,
  SpaceThreadCollaborationQuery,
  SpacesQuery,
  SpaceThreadsQuery,
  SpaceThreadContextQuery,
  StartCustomerOnboardingMutation,
  ThreadLinkedTasksQuery,
  ThreadMentionTargetsQuery,
  ThreadsPagedQuery,
  ThreadTurnUpdatedSubscription,
} from "./graphql-queries";

describe("computer GraphQL queries", () => {
  it("requests tenantId on thread-turn updates so list subscriptions can refresh", () => {
    expect(print(ThreadTurnUpdatedSubscription)).toContain("tenantId");
  });

  it("memoryRecords query selects the full set of fields the Brain detail sheet needs", () => {
    const printed = print(ComputerMemoryRecordsQuery);
    for (const field of [
      "memoryRecordId",
      "createdAt",
      "strategy",
      "factType",
      "confidence",
      "tags",
      "accessCount",
      "proofCount",
      "context",
      "threadId",
    ]) {
      expect(printed).toContain(field);
    }
  });

  it("delete mutation operates against memoryRecordId scoped by tenant + user", () => {
    const printed = print(DeleteComputerMemoryRecordMutation);
    expect(printed).toContain("deleteMemoryRecord");
    expect(printed).toContain("tenantId");
    expect(printed).toContain("userId");
    expect(printed).toContain("memoryRecordId");
  });

  it("memorySearch query keeps the strategy + score fields the search sheet expects", () => {
    const printed = print(ComputerMemorySearchQuery);
    expect(printed).toContain("memorySearch");
    expect(printed).toContain("score");
    expect(printed).toContain("totalCount");
    expect(printed).toContain("strategy");
  });

  it("memorySystemConfig query returns hindsightEnabled flag for graph-toggle gating", () => {
    const printed = print(ComputerMemorySystemConfigQuery);
    expect(printed).toContain("memorySystemConfig");
    expect(printed).toContain("hindsightEnabled");
    expect(printed).toContain("managedMemoryEnabled");
  });

  it("recentWikiPages + wikiSearch + wikiPage + wikiBacklinks compose the Pages tab", () => {
    expect(print(ComputerRecentWikiPagesQuery)).toContain("recentWikiPages");
    expect(print(ComputerWikiSearchQuery)).toContain("wikiSearch");
    expect(print(ComputerWikiPageQuery)).toContain("wikiPage");
    expect(print(ComputerWikiBacklinksQuery)).toContain("wikiBacklinks");
  });

  it("KB queries hit the read-only knowledgeBases + knowledgeBase fields", () => {
    expect(print(ComputerKnowledgeBasesQuery)).toContain("knowledgeBases");
    expect(print(ComputerKnowledgeBaseDetailQuery)).toContain("knowledgeBase");
    expect(print(ComputerKnowledgeBaseDetailQuery)).toContain("embeddingModel");
  });

  it("requests live applet source and preview fields for app mounting", () => {
    const query = print(AppletQuery);

    expect(query).toContain("applet(appId: $appId)");
    expect(query).toContain("source");
    expect(query).toContain("files");
    expect(query).toContain("metadata");
    expect(query).toContain("stdlibVersionAtGeneration");
  });

  it("requests applet previews for the apps gallery", () => {
    const query = print(AppletsQuery);

    expect(query).toContain("applets");
    expect(query).toContain("nodes");
    expect(query).toContain("nextCursor");
    expect(query).toContain("prompt");
  });

  it("promotes draft applet previews through the user-callable mutation", () => {
    const mutation = print(PromoteDraftAppletMutation);

    expect(mutation).toContain("promoteDraftApplet(input: $input)");
    expect(mutation).toContain("appId");
    expect(mutation).toContain("persisted");
    expect(mutation).toContain("errors");
  });

  it("requests Spaces, Space threads, linked tasks, and onboarding start fields", () => {
    expect(print(SpacesQuery)).toContain("spaces");
    expect(print(SpacesQuery)).toContain("unreadThreadCount");
    expect(print(SpacesQuery)).toContain("lastActivityAt");
    expect(print(SpaceQuery)).toContain("checklistTemplates");
    expect(print(SpaceQuery)).toContain("agentAssignments");
    expect(print(SpaceThreadsQuery)).toContain("spaceId: $spaceId");
    expect(print(SpaceThreadContextQuery)).toContain("participants");
    expect(print(ThreadLinkedTasksQuery)).toContain("threadLinkedTasks");
    expect(print(StartCustomerOnboardingMutation)).toContain(
      "startCustomerOnboarding",
    );
    expect(print(StartCustomerOnboardingMutation)).toContain("missingFields");
  });

  it("requests global Inbox rows with Space identity and unread filter", () => {
    const inbox = print(ChatGlobalInboxQuery);
    expect(inbox).toContain("unreadOnly: true");
    expect(inbox).toContain("space");
    expect(inbox).toContain("lastReadAt");
    expect(print(ThreadsPagedQuery)).toContain("unreadOnly: $unreadOnly");
    expect(print(ThreadsPagedQuery)).toContain("spaceId: $spaceId");
  });

  it("requests collaborative Space Thread fields and mention targets", () => {
    const thread = print(SpaceThreadCollaborationQuery);
    const mentionTargets = print(ThreadMentionTargetsQuery);

    expect(thread).toContain("sender");
    expect(thread).toContain("mentions");
    expect(thread).toContain("participants");
    expect(mentionTargets).toContain("threadMentionTargets");
    expect(mentionTargets).toContain("targetType");
    expect(mentionTargets).toContain("targetId");
    expect(mentionTargets).toContain("displayName");
    expect(mentionTargets).toContain("avatarUrl");
    expect(mentionTargets).toContain("role");
  });
});
