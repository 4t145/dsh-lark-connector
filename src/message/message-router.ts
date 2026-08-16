import { z } from "zod";

const TextContentSchema = z.object({ text: z.string() }).loose();
export interface IncomingMessageEvent {
  sender: { sender_id?: { open_id?: string }; sender_type?: string };
  message: {
    message_id: string;
    chat_id: string;
    chat_type: "p2p" | "group";
    message_type: string;
    content: string;
    mentions?: readonly { key: string; id: { open_id?: string }; name?: string }[];
  };
}
export interface RoutedUserInput {
  messageId: string;
  chatId: string;
  senderOpenId: string;
  text: string;
}

/** 私聊文本直接接收；群聊文本仅在明确 @ 当前机器人时接收。 */
export function routeUserInput(
  event: IncomingMessageEvent,
  botOpenId: string,
): RoutedUserInput | null {
  if (event.sender.sender_type === "app") return null;
  if (event.message.message_type !== "text") return null;
  const senderOpenId = event.sender.sender_id?.open_id;
  if (senderOpenId === undefined || senderOpenId === botOpenId) return null;
  const mentions = event.message.mentions ?? [];
  if (
    event.message.chat_type === "group" &&
    !mentions.some((mention) => mention.id.open_id === botOpenId)
  )
    return null;
  const parsed = parseTextContent(event.message.content);
  if (parsed === null) return null;
  let text = parsed;
  for (const mention of mentions) {
    const replacement =
      mention.id.open_id === botOpenId ? "" : "@" + (mention.name ?? mention.id.open_id ?? "用户");
    text = text.split(mention.key).join(replacement);
  }
  text = text.replace(/\s+/gu, " ").trim();
  if (text === "") return null;
  return { messageId: event.message.message_id, chatId: event.message.chat_id, senderOpenId, text };
}

function parseTextContent(content: string): string | null {
  let payload: unknown;
  try {
    payload = JSON.parse(content);
  } catch {
    return null;
  }
  const parsed = TextContentSchema.safeParse(payload);
  return parsed.success ? parsed.data.text : null;
}
