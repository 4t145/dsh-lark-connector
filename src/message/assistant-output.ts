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
export function chunkReply(text: string, chunkSize: number): string[] {
  if (text.length <= chunkSize) return [text];
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length; offset += chunkSize)
    chunks.push(text.slice(offset, offset + chunkSize));
  return chunks;
}
