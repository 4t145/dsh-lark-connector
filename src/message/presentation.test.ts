import { describe, expect, it, vi } from "vitest";
import type { SessionEvent } from "@deepseek-ai/dsh-session/types";
import type { LarkConnection } from "./lark-connection.ts";
import { LarkTurnPresentation } from "./presentation.ts";

function sessionEvent(value: object): SessionEvent {
  return value as SessionEvent;
}

function createConnection() {
  const cards: object[] = [];
  const replyCard = vi.fn((_messageId: string, card: object) => {
    cards.push(card);
    return "card-1";
  });
  const patchCard = vi.fn((_messageId: string, card: object) => {
    cards.push(card);
  });
  return {
    cards,
    replyCard,
    patchCard,
    connection: { replyCard, patchCard } as unknown as LarkConnection,
  };
}

const PRESENTATION = {
  thinkingReaction: true,
  streamOutput: true,
  showThoughts: true,
  showTools: true,
} as const;

describe("LarkTurnPresentation", () => {
  it("streams reasoning, tool state, and assistant text into one v2 card", async () => {
    const transport = createConnection();
    const presentation = new LarkTurnPresentation(transport.connection, "source-1", PRESENTATION);

    await presentation.start();
    presentation.accept(
      sessionEvent({
        type: "assistant/chunk",
        seq: 1,
        time: 1,
        data: { turn: 1, step: 1, chunk: { type: "reasoning-delta", index: 0, text: "分析" } },
      }),
    );
    presentation.accept(
      sessionEvent({
        type: "tool/call",
        seq: 2,
        time: 2,
        data: { turn: 1, step: 1, callId: "call-1", name: "read", arguments: '{"path":"a"}' },
      }),
    );
    presentation.accept(
      sessionEvent({
        type: "tool/result",
        seq: 3,
        time: 3,
        data: {
          turn: 1,
          step: 1,
          message: {
            role: "user",
            content: [
              {
                type: "tool-result",
                toolCallId: "call-1",
                content: [{ type: "text", text: "done" }],
              },
            ],
            source: { kind: "tool" },
          },
        },
      }),
    );
    presentation.accept(
      sessionEvent({
        type: "assistant/chunk",
        seq: 4,
        time: 4,
        data: { turn: 1, step: 2, chunk: { type: "text-delta", index: 0, text: "答案" } },
      }),
    );

    await expect(presentation.complete("答案")).resolves.toBe(true);
    const finalCard = JSON.stringify(transport.cards.at(-1));
    expect(finalCard).toContain('"schema":"2.0"');
    expect(finalCard).toContain("collapsible_panel");
    expect(finalCard).toContain("分析");
    expect(finalCard).toContain("read");
    expect(finalCard).toContain("done");
    expect(finalCard).toContain("答案");
    expect(finalCard).toContain("已完成");
  });

  it("honors hidden thought and tool settings", async () => {
    const transport = createConnection();
    const presentation = new LarkTurnPresentation(transport.connection, "source-2", {
      ...PRESENTATION,
      showThoughts: false,
      showTools: false,
    });

    await presentation.start();
    presentation.accept(
      sessionEvent({
        type: "assistant/chunk",
        seq: 1,
        time: 1,
        data: { turn: 1, step: 1, chunk: { type: "reasoning-delta", index: 0, text: "隐藏" } },
      }),
    );
    presentation.accept(
      sessionEvent({
        type: "tool/call",
        seq: 2,
        time: 2,
        data: { turn: 1, step: 1, callId: "call-1", name: "secret-tool", arguments: "{}" },
      }),
    );

    await presentation.complete("公开答案");
    const finalCard = JSON.stringify(transport.cards.at(-1));
    expect(finalCard).not.toContain("隐藏");
    expect(finalCard).not.toContain("secret-tool");
    expect(finalCard).toContain("公开答案");
  });

  it("returns false when card creation fails so the bridge can fall back to text", async () => {
    const connection = {
      replyCard: vi.fn(() => {
        throw new Error("card unavailable");
      }),
      patchCard: vi.fn(),
    } as unknown as LarkConnection;
    const presentation = new LarkTurnPresentation(connection, "source-3", PRESENTATION);

    await presentation.start();

    await expect(presentation.fail("error fallback")).resolves.toBe(false);
    await expect(presentation.complete("fallback")).resolves.toBe(false);
  });
});
