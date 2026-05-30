import { describe, it, expect, vi, beforeEach } from "vitest";

const selectSpy = vi.fn();
const notifySpy = vi.fn();

vi.mock("./thread-participants-query.js", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  selectThreadParticipantUserIds: (...args: any[]) => selectSpy(...args),
}));
vi.mock("../../graphql/notify.js", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  notifyThreadActivity: (...args: any[]) => notifySpy(...args),
}));

const { publishThreadActivity } = await import("./publish-thread-activity.js");

const base = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: {} as any,
  tenantId: "t1",
  threadId: "th1",
  messageId: "m1",
  threadTitle: "General",
  snippet: "hello",
  createdAt: "2026-05-29T00:00:00.000Z",
};

describe("publishThreadActivity", () => {
  beforeEach(() => {
    selectSpy.mockReset();
    notifySpy.mockReset();
    notifySpy.mockResolvedValue(undefined);
  });

  it("fans out to every non-author participant with the full payload (R1/R11)", async () => {
    selectSpy.mockResolvedValue(["author", "bob", "carol"]);

    await publishThreadActivity({ ...base, authorId: "author", authorType: "user" });

    expect(notifySpy).toHaveBeenCalledTimes(2);
    const recipients = notifySpy.mock.calls.map((c) => c[0].userId).sort();
    expect(recipients).toEqual(["bob", "carol"]);
    expect(notifySpy.mock.calls[0][0]).toMatchObject({
      tenantId: "t1",
      threadId: "th1",
      messageId: "m1",
      authorId: "author",
      authorType: "user",
      snippet: "hello",
      threadTitle: "General",
      createdAt: "2026-05-29T00:00:00.000Z",
    });
  });

  it("never notifies the author (R3)", async () => {
    selectSpy.mockResolvedValue(["author", "bob"]);

    await publishThreadActivity({ ...base, authorId: "author", authorType: "user" });

    const recipients = notifySpy.mock.calls.map((c) => c[0].userId);
    expect(recipients).toEqual(["bob"]);
    expect(recipients).not.toContain("author");
  });

  it("agent-authored message still notifies all user participants (author-skip is id-based)", async () => {
    selectSpy.mockResolvedValue(["bob", "carol"]);

    await publishThreadActivity({ ...base, authorId: "agent-7", authorType: "agent" });

    expect(notifySpy).toHaveBeenCalledTimes(2);
    expect(notifySpy.mock.calls.every((c) => c[0].authorType === "agent")).toBe(true);
  });

  it("a thread whose only participant is the author fires nothing", async () => {
    selectSpy.mockResolvedValue(["author"]);

    await publishThreadActivity({ ...base, authorId: "author", authorType: "user" });

    expect(notifySpy).not.toHaveBeenCalled();
  });

  it("swallows + logs a failure so the originating mutation is never broken", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    selectSpy.mockRejectedValue(new Error("db down"));

    await expect(
      publishThreadActivity({ ...base, authorId: "author", authorType: "user" }),
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
