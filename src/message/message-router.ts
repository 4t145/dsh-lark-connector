import { z } from "zod";

const TextContentSchema = z.object({ text: z.string() }).loose();
const ImageContentSchema = z.object({ image_key: z.string() }).loose();
const PostElementSchema = z
  .object({
    tag: z.string().optional(),
    text: z.string().optional(),
    user_id: z.string().optional(),
    user_name: z.string().optional(),
    image_key: z.string().optional(),
  })
  .loose();
const PostContentSchema = z
  .object({
    title: z.string().optional(),
    content: z.array(z.array(PostElementSchema)).optional(),
  })
  .loose();

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
  /** 文本内容；纯图片消息为空字符串。 */
  text: string;
  /** 需要下载的图片 image_key 列表（按消息内出现顺序）。 */
  imageKeys: readonly string[];
}

/**
 * 私聊：接收文本、图片与富文本（post）消息。
 * 群聊：文本与富文本仅在明确 @ 当前机器人时接收；纯图片消息不接收（无法表达意图）。
 */
export function routeUserInput(
  event: IncomingMessageEvent,
  botOpenId: string,
): RoutedUserInput | null {
  if (event.sender.sender_type === "app") return null;
  const senderOpenId = event.sender.sender_id?.open_id;
  if (senderOpenId === undefined || senderOpenId === botOpenId) return null;
  const mentions = event.message.mentions ?? [];
  const eventMentionsBot = mentions.some((mention) => mention.id.open_id === botOpenId);
  switch (event.message.message_type) {
    case "text": {
      if (event.message.chat_type === "group" && !eventMentionsBot) return null;
      const parsed = parseTextContent(event.message.content);
      if (parsed === null) return null;
      let text = parsed;
      for (const mention of mentions) {
        const replacement =
          mention.id.open_id === botOpenId
            ? ""
            : "@" + (mention.name ?? mention.id.open_id ?? "用户");
        text = text.split(mention.key).join(replacement);
      }
      text = text.replace(/\s+/gu, " ").trim();
      if (text === "") return null;
      return routed(event, senderOpenId, text, []);
    }
    case "image": {
      if (event.message.chat_type === "group") return null;
      const imageKey = parseImageContent(event.message.content);
      if (imageKey === null) return null;
      return routed(event, senderOpenId, "", [imageKey]);
    }
    case "post": {
      const post = parsePostContent(event.message.content);
      if (post === null) return null;
      const postMentionsBot = post.atOpenIds.includes(botOpenId);
      if (event.message.chat_type === "group" && !eventMentionsBot && !postMentionsBot) return null;
      const text = renderPostText(post, botOpenId);
      if (text === "" && post.imageKeys.length === 0) return null;
      return routed(event, senderOpenId, text, post.imageKeys);
    }
    default:
      return null;
  }
}

function routed(
  event: IncomingMessageEvent,
  senderOpenId: string,
  text: string,
  imageKeys: readonly string[],
): RoutedUserInput {
  return {
    messageId: event.message.message_id,
    chatId: event.message.chat_id,
    senderOpenId,
    text,
    imageKeys,
  };
}

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function parseTextContent(content: string): string | null {
  const payload = parseJson(content);
  if (payload === null) return null;
  const parsed = TextContentSchema.safeParse(payload);
  return parsed.success ? parsed.data.text : null;
}

function parseImageContent(content: string): string | null {
  const payload = parseJson(content);
  if (payload === null) return null;
  const parsed = ImageContentSchema.safeParse(payload);
  return parsed.success && parsed.data.image_key !== "" ? parsed.data.image_key : null;
}

interface PostElementParsed {
  kind: "text" | "at" | "img";
  value: string;
  /** at 元素的 open_id（其余元素为空字符串）。 */
  openId: string;
}

interface ParsedPost {
  title: string;
  paragraphs: readonly (readonly PostElementParsed[])[];
  imageKeys: readonly string[];
  atOpenIds: readonly string[];
}

function parsePostContent(content: string): ParsedPost | null {
  const payload = parseJson(content);
  if (payload === null) return null;
  const parsed = PostContentSchema.safeParse(payload);
  if (!parsed.success) return null;
  const imageKeys: string[] = [];
  const atOpenIds: string[] = [];
  const paragraphs = (parsed.data.content ?? []).map((paragraph) => {
    const elements: PostElementParsed[] = [];
    for (const element of paragraph) {
      switch (element.tag) {
        case "text":
        case "a": {
          if (element.text !== undefined && element.text !== "")
            elements.push({ kind: "text", value: element.text, openId: "" });
          break;
        }
        case "at": {
          const openId = element.user_id ?? "";
          if (openId !== "") {
            atOpenIds.push(openId);
            elements.push({ kind: "at", value: element.user_name ?? openId, openId });
          }
          break;
        }
        case "img": {
          if (element.image_key !== undefined && element.image_key !== "") {
            imageKeys.push(element.image_key);
            elements.push({ kind: "img", value: element.image_key, openId: "" });
          }
          break;
        }
        default:
          break;
      }
    }
    return elements;
  });
  return { title: parsed.data.title ?? "", paragraphs, imageKeys, atOpenIds };
}

/** 标题 + 段落文本；@机器人 省略，@他人 保留为 @名字。 */
function renderPostText(post: ParsedPost, botOpenId: string): string {
  const lines: string[] = [];
  if (post.title.trim() !== "") lines.push(post.title.trim());
  for (const paragraph of post.paragraphs) {
    const line = paragraph
      .map((element) => {
        if (element.kind === "at") return element.openId === botOpenId ? "" : "@" + element.value;
        if (element.kind === "text") return element.value;
        return "";
      })
      .join("");
    const trimmed = line.replace(/\s+/gu, " ").trim();
    if (trimmed !== "") lines.push(trimmed);
  }
  return lines.join("\n");
}
