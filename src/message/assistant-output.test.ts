import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@deepseek-ai/dsh-session/types";
import { assistantTextAfter, turnFailureAfter } from "./assistant-output.ts";

function sessionEvent(value: object): SessionEvent {
  return value as SessionEvent;
}

function turnEndError(seq: number, message: string, code = "PROVIDER_ERROR"): SessionEvent {
  return sessionEvent({
    type: "turn/end",
    seq,
    time: seq,
    data: { turn: 1, reason: { kind: "error", error: { message, code } } },
  });
}

function turnEndCompleted(seq: number): SessionEvent {
  return sessionEvent({
    type: "turn/end",
    seq,
    time: seq,
    data: { turn: 1, reason: { kind: "completed" } },
  });
}

function assistantMessage(seq: number, text: string): SessionEvent {
  return sessionEvent({
    type: "assistant/message",
    seq,
    time: seq,
    data: {
      turn: 1,
      step: 1,
      message: { role: "assistant", content: [{ type: "text", text }], source: {} },
    },
  });
}

function turnStart(seq: number): SessionEvent {
  return sessionEvent({ type: "turn/start", seq, time: seq, data: { turn: 1 } });
}

describe("assistantTextAfter", () => {
  it("returns the latest assistant text at or after the start seq", () => {
    const events = [turnStart(3), assistantMessage(1, "旧回复"), assistantMessage(5, "新回复")];
    expect(assistantTextAfter(events, 3)).toBe("新回复");
  });
});

describe("turnFailureAfter", () => {
  it("extracts the turn error message", () => {
    const events = [turnEndError(4, "Insufficient Balance")];
    expect(turnFailureAfter(events, 1)).toBe("Insufficient Balance");
  });

  it("ignores failures before the start seq", () => {
    const events = [turnEndError(2, "旧失败")];
    expect(turnFailureAfter(events, 5)).toBeUndefined();
  });

  it("is cleared by later assistant text or completed turns", () => {
    expect(
      turnFailureAfter([turnEndError(2, "失败"), assistantMessage(4, "恢复")], 1),
    ).toBeUndefined();
    expect(turnFailureAfter([turnEndError(2, "失败"), turnEndCompleted(6)], 1)).toBeUndefined();
  });

  it("falls back to the failure code when the message is blank", () => {
    const events = [turnEndError(3, "  ", "RATE_LIMIT")];
    expect(turnFailureAfter(events, 1)).toBe("RATE_LIMIT");
  });
});
