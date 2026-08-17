import type { SessionEvent } from "@deepseek-ai/dsh-session/types";
import type { LarkConnection } from "./lark-connection.ts";

export interface PresentationConfig {
  thinkingReaction: boolean;
  streamOutput: boolean;
  showThoughts: boolean;
  showTools: boolean;
}

type TimelineEntry =
  | { kind: "thought"; text: string }
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      callId: string;
      name: string;
      status: "in_progress" | "completed" | "failed";
      detail: string;
    };

type CardStatus = "thinking" | "calling_tool" | "responding" | "complete" | "failed";

const HEADERS: Record<CardStatus, { content: string; template: string }> = {
  thinking: { content: "💭 思考中...", template: "wathet" },
  calling_tool: { content: "🛠 调用工具...", template: "blue" },
  responding: { content: "✍️ 回复中...", template: "blue" },
  complete: { content: "✅ 已完成", template: "green" },
  failed: { content: "⚠️ 出错", template: "red" },
};

function appendEntry(entries: TimelineEntry[], kind: "thought" | "text", text: string): void {
  if (text === "") return;
  const last = entries.at(-1);
  if (last?.kind === kind) last.text += text;
  else entries.push({ kind, text });
}

function truncate(value: string, limit = 1600): string {
  return value.length <= limit ? value : value.slice(0, limit) + "\n…";
}

function contentText(content: readonly { type: string; text?: string }[]): string {
  return content
    .flatMap((block) => (typeof block.text === "string" ? [block.text] : []))
    .join("\n");
}

function thoughtPanel(text: string): object {
  return {
    tag: "collapsible_panel",
    expanded: false,
    header: {
      title: { tag: "plain_text", content: "💭 思考" },
      vertical_align: "center",
      icon: {
        tag: "standard_icon",
        token: "down-small-ccm_outlined",
        color: "",
        size: "16px 16px",
      },
      icon_position: "right",
      icon_expanded_angle: -180,
    },
    border: { color: "grey", corner_radius: "5px" },
    vertical_spacing: "8px",
    padding: "8px 8px 8px 8px",
    elements: [{ tag: "markdown", content: text }],
  };
}

function cardFor(status: CardStatus, entries: readonly TimelineEntry[]): object {
  const elements: object[] = [];
  for (const [index, entry] of entries.entries()) {
    if (index > 0 && entry.kind !== "thought") elements.push({ tag: "hr" });
    if (entry.kind === "thought") {
      elements.push(thoughtPanel(entry.text));
      continue;
    }
    if (entry.kind === "text") {
      elements.push({ tag: "markdown", content: entry.text });
      continue;
    }
    const mark = entry.status === "in_progress" ? "⏳" : entry.status === "completed" ? "✅" : "❌";
    const detail = entry.detail === "" ? "" : "\n\n" + entry.detail;
    elements.push({ tag: "markdown", content: mark + " **" + entry.name + "**" + detail });
  }
  if (elements.length === 0) elements.push({ tag: "markdown", content: "_准备中..._" });
  const header = HEADERS[status];
  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: header.content },
      template: header.template,
    },
    body: { elements },
  };
}

export class LarkTurnPresentation {
  private readonly connection: LarkConnection;
  private readonly sourceMessageId: string;
  private readonly config: PresentationConfig;
  private readonly entries: TimelineEntry[] = [];
  private status: CardStatus = "thinking";
  private cardMessageId: string | null = null;
  private cardUnavailable = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushChain: Promise<void> = Promise.resolve();

  constructor(connection: LarkConnection, sourceMessageId: string, config: PresentationConfig) {
    this.connection = connection;
    this.sourceMessageId = sourceMessageId;
    this.config = config;
  }

  async start(): Promise<void> {
    if (!this.config.streamOutput) return;
    try {
      this.cardMessageId = await this.connection.replyCard(
        this.sourceMessageId,
        cardFor(this.status, this.entries),
      );
    } catch {
      this.cardUnavailable = true;
    }
  }

  accept(event: SessionEvent): void {
    if (!this.config.streamOutput) return;
    if (event.type === "assistant/chunk") {
      const chunk = event.data.chunk;
      if (chunk.type === "reasoning-delta" && this.config.showThoughts) {
        appendEntry(this.entries, "thought", chunk.text);
        this.status = "thinking";
      } else if (chunk.type === "text-delta") {
        appendEntry(this.entries, "text", chunk.text);
        this.status = "responding";
      }
      this.scheduleFlush();
      return;
    }
    if (event.type === "tool/call" && this.config.showTools) {
      this.status = "calling_tool";
      this.entries.push({
        kind: "tool",
        callId: event.data.callId,
        name: event.data.name,
        status: "in_progress",
        detail:
          event.data.arguments === "" ? "" : "```json\n" + truncate(event.data.arguments) + "\n```",
      });
      this.scheduleFlush();
      return;
    }
    if (event.type === "tool/result" && this.config.showTools) {
      const resultBlock = event.data.message.content[0];
      const callId = resultBlock.toolCallId;
      const tool = this.entries.findLast(
        (entry): entry is Extract<TimelineEntry, { kind: "tool" }> =>
          entry.kind === "tool" && entry.callId === callId,
      );
      if (tool !== undefined) {
        tool.status = event.data.error === undefined ? "completed" : "failed";
        const result = contentText(resultBlock.content);
        if (result !== "") tool.detail += (tool.detail === "" ? "" : "\n\n") + truncate(result);
      }
      this.status = "thinking";
      this.scheduleFlush();
    }
  }

  async complete(finalText: string): Promise<boolean> {
    if (!this.config.streamOutput) return false;
    const hasText = this.entries.some((entry) => entry.kind === "text" && entry.text !== "");
    if (!hasText && finalText !== "") appendEntry(this.entries, "text", finalText);
    this.status = "complete";
    await this.flushNow();
    return !this.cardUnavailable && this.cardMessageId !== null;
  }

  async fail(message: string): Promise<boolean> {
    if (!this.config.streamOutput) return false;
    appendEntry(this.entries, "text", message);
    this.status = "failed";
    await this.flushNow();
    return !this.cardUnavailable && this.cardMessageId !== null;
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.enqueueFlush();
    }, 100);
  }

  private async flushNow(): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.enqueueFlush();
  }

  private enqueueFlush(): Promise<void> {
    this.flushChain = this.flushChain.then(async () => {
      if (this.cardUnavailable) return;
      try {
        if (this.cardMessageId === null) {
          this.cardMessageId = await this.connection.replyCard(
            this.sourceMessageId,
            cardFor(this.status, this.entries),
          );
        } else {
          await this.connection.patchCard(this.cardMessageId, cardFor(this.status, this.entries));
        }
      } catch {
        this.cardUnavailable = true;
      }
    });
    return this.flushChain;
  }
}
