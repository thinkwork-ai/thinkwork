import { describe, expect, it } from "vitest";
import {
  CanonicalizationError,
  canonicalSha256Hex,
  canonicalSha256Ref,
  canonicalize,
} from "./canonical";

describe("canonicalize (RFC 8785)", () => {
  it("orders object keys and strips whitespace", () => {
    expect(canonicalize({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it("produces identical output for different key insertion orders", () => {
    const a = { x: { m: 1, n: [true, null, "s"] }, y: 2 };
    const b = { y: 2, x: { n: [true, null, "s"], m: 1 } };
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(canonicalSha256Hex(a)).toBe(canonicalSha256Hex(b));
  });

  it("sorts keys by UTF-16 code units", () => {
    // RFC 8785 §3.2.3 example ordering
    const value = {
      "€": "Euro Sign",
      "\r": "CR",
      "1": "One",
      "": "Control",
      "😀": "Emoji",
    };
    expect(canonicalize(value)).toBe(
      '{"\\r":"CR","1":"One","":"Control","€":"Euro Sign","😀":"Emoji"}',
    );
  });

  it("serializes numbers in ES2015 shortest form", () => {
    expect(canonicalize({ a: 1.0, b: 1e21, c: 0.000001, d: -0 })).toBe(
      '{"a":1,"b":1e+21,"c":0.000001,"d":0}',
    );
  });

  it("matches the RFC 8785 appendix hash for a known vector", () => {
    // Vector from RFC 8785 §3.2.3 (weird.json without the unsupported cases)
    const value = { numbers: [333333333.33333329, 1e30, 4.5, 0.002, 1e-27] };
    expect(canonicalize(value)).toBe(
      '{"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27]}',
    );
  });

  it("escapes control characters per JCS", () => {
    expect(canonicalize({ s: '\u0000\t\n"\\' })).toBe(
      '{"s":"\\u0000\\t\\n\\"\\\\"}',
    );
  });

  it("rejects undefined, functions, NaN, Infinity, BigInt, and class instances", () => {
    expect(() => canonicalize({ a: undefined })).toThrow(CanonicalizationError);
    expect(() => canonicalize([undefined])).toThrow(CanonicalizationError);
    expect(() => canonicalize({ a: () => 1 })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ a: NaN })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ a: Infinity })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ a: 1n })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ a: new Date() })).toThrow(
      CanonicalizationError,
    );
  });

  it("accepts null-prototype objects", () => {
    const value = Object.create(null) as Record<string, unknown>;
    value.a = 1;
    expect(canonicalize(value)).toBe('{"a":1}');
  });

  it("formats sha256 refs", () => {
    expect(canonicalSha256Ref({})).toBe(
      "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    );
  });
});
