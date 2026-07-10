import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";

import { hashPassword, quoteIdent } from "../provision-members-db";

describe("hashPassword", () => {
  it("emits the $2b$ prefix Twenty's own signup writes", () => {
    const hash = hashPassword("TestPassword1!", 4);
    expect(hash.startsWith("$2b$")).toBe(true);
    expect(hash).toHaveLength(60);
  });

  it("produces a hash the password verifies against, and nothing else does", () => {
    const hash = hashPassword("TestPassword1!", 4);
    expect(bcrypt.compareSync("TestPassword1!", hash)).toBe(true);
    expect(bcrypt.compareSync("TestPassword1", hash)).toBe(false);
  });

  it("handles the shell-hostile characters in the shared rep password", () => {
    const hash = hashPassword("Abc123$$", 4);
    expect(bcrypt.compareSync("Abc123$$", hash)).toBe(true);
  });

  it("refuses passwords past bcrypt's silent 72-byte truncation point", () => {
    expect(() => hashPassword("x".repeat(73), 4)).toThrow(/72-byte/);
  });
});

describe("quoteIdent", () => {
  it("accepts a Twenty workspace data schema", () => {
    expect(quoteIdent("workspace_brl3ypdat40udm5gtn95sozcg")).toBe(
      '"workspace_brl3ypdat40udm5gtn95sozcg"',
    );
  });

  it("refuses anything that is not a workspace schema", () => {
    expect(() => quoteIdent("core")).toThrow(/Refusing/);
    expect(() =>
      quoteIdent('workspace_x"; drop table core."user"; --'),
    ).toThrow(/Refusing/);
    expect(() => quoteIdent("public")).toThrow(/Refusing/);
  });
});
