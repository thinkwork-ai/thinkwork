import { describe, expect, it } from "vitest";
import {
  buildOutboundMime,
  MAX_EMAIL_ATTACHMENT_TOTAL_BYTES,
} from "../outbound-mime.js";

const baseInput = {
  from: "space@agents.thinkwork.ai",
  to: ["chad@example.com"],
  replyTo: "space@agents.thinkwork.ai",
  subject: "Warrior orders",
  messageId: "<test-123@agents.thinkwork.ai>",
  extraHeaders: ["X-Thinkwork-Reply-Token: tok-abc"],
  text: "Plain body",
  html: "<p>Plain body</p>",
  boundarySeed: "seed",
};

describe("buildOutboundMime", () => {
  it("stays multipart/alternative with no attachments", () => {
    const mime = buildOutboundMime({ ...baseInput });
    expect(mime).toContain(
      'Content-Type: multipart/alternative; boundary="thinkwork-alt-seed"',
    );
    expect(mime).not.toContain("multipart/mixed");
    expect(mime).toContain("From: space@agents.thinkwork.ai");
    expect(mime).toContain("To: chad@example.com");
    expect(mime).toContain("Subject: Warrior orders");
    expect(mime).toContain("X-Thinkwork-Reply-Token: tok-abc");
    expect(mime).toContain("Plain body");
    expect(mime).toContain("<p>Plain body</p>");
    expect(mime).toContain("--thinkwork-alt-seed--");
  });

  it("wraps alternative inside multipart/mixed when attachments exist", () => {
    const bytes = Buffer.from("id,amount\n1,10\n", "utf8");
    const mime = buildOutboundMime({
      ...baseInput,
      attachments: [{ name: "orders.csv", contentType: "text/csv", bytes }],
    });
    expect(mime).toContain(
      'Content-Type: multipart/mixed; boundary="thinkwork-mix-seed"',
    );
    expect(mime).toContain(
      'Content-Type: multipart/alternative; boundary="thinkwork-alt-seed"',
    );
    expect(mime).toContain('Content-Type: text/csv; name="orders.csv"');
    expect(mime).toContain(
      'Content-Disposition: attachment; filename="orders.csv"',
    );
    expect(mime).toContain("Content-Transfer-Encoding: base64");
    expect(mime).toContain(bytes.toString("base64"));
    expect(mime).toContain("--thinkwork-mix-seed--");
  });

  it("round-trips binary attachment bytes through base64", () => {
    // xlsx files are zips — binary with a PK header; the encoded body must
    // decode to identical bytes.
    const bytes = Buffer.from([
      0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0xfe, 0x80, 0x7f, 0x0a, 0x0d,
    ]);
    const mime = buildOutboundMime({
      ...baseInput,
      attachments: [
        {
          name: "report.xlsx",
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          bytes,
        },
      ],
    });
    const afterHeader = mime.split("Content-Transfer-Encoding: base64")[1]!;
    const encoded = afterHeader
      .split("\r\n\r\n")[1]!
      .split("\r\n--")[0]!
      .replace(/\r\n/g, "");
    expect(Buffer.from(encoded, "base64")).toEqual(bytes);
  });

  it("chunks long base64 payloads to 76-char lines", () => {
    const bytes = Buffer.alloc(1024, 7);
    const mime = buildOutboundMime({
      ...baseInput,
      attachments: [
        { name: "blob.bin", contentType: "application/octet-stream", bytes },
      ],
    });
    const lines = mime.split("\r\n");
    const base64Lines = lines.filter((line) =>
      /^[A-Za-z0-9+/=]{60,}$/.test(line),
    );
    expect(base64Lines.length).toBeGreaterThan(5);
    for (const line of base64Lines) {
      expect(line.length).toBeLessThanOrEqual(76);
    }
  });

  it("sanitizes header-breaking filenames", () => {
    const mime = buildOutboundMime({
      ...baseInput,
      attachments: [
        {
          name: 'evil"\r\nX-Injected: yes.csv',
          contentType: "text/csv",
          bytes: Buffer.from("a,b\n"),
        },
      ],
    });
    // CR/LF and quotes are stripped, so the hostile name can neither break
    // out of the quoted-string nor start a new header line.
    expect(mime).not.toContain("\r\nX-Injected");
    expect(mime).toContain('filename="evil___X-Injected: yes.csv"');
  });

  it("keeps the total-size cap under the SES raw limit", () => {
    expect(MAX_EMAIL_ATTACHMENT_TOTAL_BYTES).toBeLessThanOrEqual(
      8 * 1024 * 1024,
    );
  });
});
