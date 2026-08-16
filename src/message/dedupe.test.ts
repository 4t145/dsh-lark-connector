import { describe, expect, it } from "vitest";
import { MessageDedupe } from "./dedupe.ts";

describe("MessageDedupe", () => {
  it("rejects duplicates and evicts the oldest id", () => {
    const dedupe = new MessageDedupe(2);
    expect(dedupe.accept("a")).toBe(true);
    expect(dedupe.accept("a")).toBe(false);
    expect(dedupe.accept("b")).toBe(true);
    expect(dedupe.accept("c")).toBe(true);
    expect(dedupe.accept("a")).toBe(true);
  });
});
