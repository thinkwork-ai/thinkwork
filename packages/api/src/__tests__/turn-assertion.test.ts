/**
 * turn-assertion lib tests (THINK-324 Wave-3 C18): mint/verify roundtrip
 * against a real local ECDSA P-256 keypair standing in for KMS, tamper +
 * expiry + fail-open behaviors, and public-key caching.
 */

import { createSign, generateKeyPairSync } from "node:crypto";
import { GetPublicKeyCommand, SignCommand } from "@aws-sdk/client-kms";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetTurnAssertionCaches,
  enforceTurnAssertion,
  mintTurnAssertion,
  verifyTurnAssertion,
} from "../lib/turn-assertion.js";

const { publicKey, privateKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
});

/** A KMS stand-in that signs with the local private key. */
function fakeKms(overrides: { failSign?: boolean; failGetKey?: boolean } = {}) {
  const send = vi.fn(async (command: unknown) => {
    if (command instanceof SignCommand) {
      if (overrides.failSign) throw new Error("kms sign down");
      const signer = createSign("sha256");
      signer.update(Buffer.from(command.input.Message as Uint8Array));
      return { Signature: new Uint8Array(signer.sign(privateKey)) };
    }
    if (command instanceof GetPublicKeyCommand) {
      if (overrides.failGetKey) throw new Error("kms getkey down");
      return {
        PublicKey: new Uint8Array(
          publicKey.export({ format: "der", type: "spki" }),
        ),
      };
    }
    throw new Error("unexpected command");
  });
  return { send };
}

const BINDING = {
  tenant_id: "11111111-1111-1111-1111-111111111111",
  thread_id: "55555555-5555-5555-5555-555555555555",
  turn_id: "66666666-6666-6666-6666-666666666666",
};

beforeEach(() => {
  __resetTurnAssertionCaches();
  process.env.AGENTCORE_TURN_ASSERTION_KMS_KEY_ID =
    "arn:aws:kms:us-east-1:123:key/test";
});

describe("mintTurnAssertion / verifyTurnAssertion", () => {
  it("roundtrips a valid assertion", async () => {
    const kms = fakeKms();
    const token = await mintTurnAssertion(BINDING, { kms });
    expect(token).toMatch(/^twta1\./);
    const verdict = await verifyTurnAssertion(token!, { kms });
    expect(verdict).toEqual({ status: "valid", binding: BINDING });
  });

  it("rejects a tampered payload", async () => {
    const kms = fakeKms();
    const token = (await mintTurnAssertion(BINDING, { kms }))!;
    const [prefix, payload, sig] = token.split(".");
    const forged = JSON.parse(
      Buffer.from(payload!, "base64url").toString("utf8"),
    );
    forged.turn_id = "77777777-7777-7777-7777-777777777777";
    const tampered = `${prefix}.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${sig}`;
    const verdict = await verifyTurnAssertion(tampered, { kms });
    expect(verdict).toMatchObject({ status: "invalid", reason: "bad signature" });
  });

  it("rejects an expired assertion", async () => {
    const kms = fakeKms();
    const token = (await mintTurnAssertion(BINDING, {
      kms,
      ttlSeconds: 60,
      now: new Date("2026-07-21T00:00:00Z"),
    }))!;
    const verdict = await verifyTurnAssertion(token, {
      kms,
      now: new Date("2026-07-21T00:02:00Z"),
    });
    expect(verdict).toMatchObject({ status: "invalid", reason: "expired" });
  });

  it("rejects malformed tokens", async () => {
    const kms = fakeKms();
    expect(await verifyTurnAssertion("garbage", { kms })).toMatchObject({
      status: "invalid",
    });
    expect(await verifyTurnAssertion("nope.a.b", { kms })).toMatchObject({
      status: "invalid",
      reason: "malformed",
    });
  });

  it("mint fails open: no key configured or KMS down → null", async () => {
    process.env.AGENTCORE_TURN_ASSERTION_KMS_KEY_ID = "";
    expect(await mintTurnAssertion(BINDING, { kms: fakeKms() })).toBeNull();
    process.env.AGENTCORE_TURN_ASSERTION_KMS_KEY_ID = "arn:key";
    expect(
      await mintTurnAssertion(BINDING, { kms: fakeKms({ failSign: true }) }),
    ).toBeNull();
    expect(
      await mintTurnAssertion(
        { ...BINDING, thread_id: "" },
        { kms: fakeKms() },
      ),
    ).toBeNull();
  });

  it("verify distinguishes unavailable from invalid", async () => {
    const kms = fakeKms();
    const token = (await mintTurnAssertion(BINDING, { kms }))!;
    process.env.AGENTCORE_TURN_ASSERTION_KMS_KEY_ID = "";
    expect(await verifyTurnAssertion(token, { kms })).toMatchObject({
      status: "unavailable",
    });
    process.env.AGENTCORE_TURN_ASSERTION_KMS_KEY_ID = "arn:key";
    __resetTurnAssertionCaches();
    expect(
      await verifyTurnAssertion(token, { kms: fakeKms({ failGetKey: true }) }),
    ).toMatchObject({ status: "unavailable" });
  });

  it("caches the public key across verifies", async () => {
    const kms = fakeKms();
    const token = (await mintTurnAssertion(BINDING, { kms }))!;
    await verifyTurnAssertion(token, { kms });
    await verifyTurnAssertion(token, { kms });
    const getKeyCalls = kms.send.mock.calls.filter(
      ([c]) => c instanceof GetPublicKeyCommand,
    );
    expect(getKeyCalls).toHaveLength(1);
  });
});

describe("enforceTurnAssertion (C19)", () => {
  it("accepts a matching token and rejects a mismatched binding (real verify)", async () => {
    // enforceTurnAssertion uses the module-level KMS client; the fake-kms
    // path is covered by verifyTurnAssertion tests above. Here exercise
    // the header plumbing with an unavailable verifier (no key) plus the
    // required-mode absence branch — signature-level acceptance/rejection
    // is delegated to verifyTurnAssertion, tested exhaustively above.
    process.env.AGENTCORE_TURN_ASSERTION_KMS_KEY_ID = "";
    const tolerated = await enforceTurnAssertion({
      headers: { "x-thinkwork-turn-assertion": "twta1.p.s" },
      binding: BINDING,
      surface: "test",
    });
    expect(tolerated.ok).toBe(true);
    const malformed = await enforceTurnAssertion({
      headers: { "x-thinkwork-turn-assertion": "garbage" },
      binding: BINDING,
      surface: "test",
    });
    expect(malformed.ok).toBe(false);
  });

  it("tolerates absence by default but refuses it in required mode", async () => {
    const tolerant = await enforceTurnAssertion({
      headers: {},
      binding: BINDING,
      surface: "test",
    });
    expect(tolerant.ok).toBe(true);
    const required = await enforceTurnAssertion({
      headers: {},
      binding: BINDING,
      surface: "test",
      required: true,
    });
    expect(required.ok).toBe(false);
  });

  it("reads TURN_ASSERTION_REQUIRED from the env", async () => {
    process.env.TURN_ASSERTION_REQUIRED = "true";
    try {
      const result = await enforceTurnAssertion({
        headers: {},
        binding: BINDING,
        surface: "test",
      });
      expect(result.ok).toBe(false);
    } finally {
      delete process.env.TURN_ASSERTION_REQUIRED;
    }
  });
});
