import { describe, test, expect } from "bun:test";
import { pathSegmentId } from "../src/ids.js";

describe("pathSegmentId (#8 path-param validation)", () => {
  test("accepts a plain UUID unchanged", () => {
    const id = "0192f3a4-5b6c-7d8e-9f01-234567890abc";
    expect(pathSegmentId(id)).toBe(id);
  });

  test("accepts non-UUID app ids (default-shelf seed)", () => {
    expect(pathSegmentId("cat-default-work")).toBe("cat-default-work");
  });

  test("accepts the synthetic virtual-occurrence id (has no slash)", () => {
    const occ = "0192f3a4-5b6c-7d8e-9f01-234567890abc__occ__2026-06-15";
    expect(pathSegmentId(occ)).toBe(occ);
  });

  test("accepts the synthetic recurrence-child id", () => {
    const child = "0192f3a4-5b6c-7d8e-9f01-234567890abc__child__2026-06-15";
    expect(pathSegmentId(child)).toBe(child);
  });

  // --- traversal / injection vectors are rejected ---

  test("rejects a path-traversal id", () => {
    expect(() => pathSegmentId("../categories/x")).toThrow(/path separator/);
  });

  test("rejects a bare .. segment", () => {
    expect(() => pathSegmentId("..")).toThrow(
      /traversal segment|path separator/,
    );
  });

  test("rejects a bare . segment", () => {
    expect(() => pathSegmentId(".")).toThrow(
      /traversal segment|path separator/,
    );
  });

  test("rejects a forward slash", () => {
    expect(() => pathSegmentId("a/b")).toThrow(/path separator/);
  });

  test("rejects a backslash", () => {
    expect(() => pathSegmentId("a\\b")).toThrow(/path separator/);
  });

  test("rejects a space (whitespace)", () => {
    expect(() => pathSegmentId("a b")).toThrow(/whitespace|control/);
  });

  test("rejects control characters", () => {
    expect(() => pathSegmentId("a\x01b")).toThrow(/control/);
    expect(() => pathSegmentId("a\nb")).toThrow(/whitespace|control/);
  });

  test("rejects empty string", () => {
    expect(() => pathSegmentId("")).toThrow(/non-empty/);
  });

  test("rejects non-string input", () => {
    expect(() => pathSegmentId(42)).toThrow(/non-empty string/);
    expect(() => pathSegmentId(undefined)).toThrow(/non-empty string/);
  });

  test("rejects over-length ids", () => {
    expect(() => pathSegmentId("a".repeat(129))).toThrow(/exceeds/);
  });

  // --- reserved chars that survive the reject set get percent-encoded ---

  test("percent-encodes reserved chars that could inject query/fragment", () => {
    // No slash -> passes the reject set, but %/?/# are encoded so they can't
    // introduce query/fragment structure into the URL downstream.
    expect(pathSegmentId("a%b")).toBe("a%25b");
    expect(pathSegmentId("a?b")).toBe("a%3Fb");
    expect(pathSegmentId("a#b")).toBe("a%23b");
  });

  test("uses the field name in the error message", () => {
    expect(() => pathSegmentId("a/b", "todoId")).toThrow(/Invalid todoId/);
  });
});
