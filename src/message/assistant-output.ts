import type { SessionEvent } from "@deepseek-ai/dsh-session";

export function assistantTextAfter(events: readonly SessionEvent[], firstSeq: number): string {
  let started = false;
  let text = "";
  for (const event of events) {
    if (event.seq < firstSeq) continue;
    if (event.type === "turn/start") {
      started = true;
      continue;
    }
    if (!started || event.type !== "assistant/message") continue;
    text = event.data.message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
  }
  return text.trim();
}
export function turnFailureAfter(
  events: readonly SessionEvent[],
  firstSeq: number,
): string | undefined {
  let failure: string | undefined;
  for (const event of events) {
    if (event.seq < firstSeq) continue;
    if (event.type === "assistant/message") {
      const hasText = event.data.message.content.some(
        (block) => block.type === "text" && block.text.trim() !== "",
      );
      if (hasText) failure = undefined;
      continue;
    }
    if (event.type !== "turn/end") continue;
    const reason = event.data.reason;
    if (reason.kind === "completed") failure = undefined;
    else if (reason.kind === "error") {
      const message = reason.error.message.trim();
      failure = message !== "" ? message : reason.error.code;
    }
  }
  return failure;
}

export function chunkReply(text: string, chunkSize: number): string[] {
  if (text.length <= chunkSize) return [text];
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length; offset += chunkSize)
    chunks.push(text.slice(offset, offset + chunkSize));
  return chunks;
}
