import {
  AppType,
  Client,
  Domain,
  EventDispatcher,
  LoggerLevel,
  WSClient,
} from "@larksuiteoapi/node-sdk";
import type { Logger } from "@larksuiteoapi/node-sdk";
import { z } from "zod";
import type { IncomingMessageEvent } from "./message-router.ts";
import type { Brand } from "../brand.ts";

const BOT_INFO_URL = "/open-apis/bot/v3/info";
export class LarkConnection {
  private readonly client: Client;
  private readonly wsClient: WSClient;
  private readonly dispatcher: EventDispatcher;
  private readonly onMessage: (event: IncomingMessageEvent) => void | Promise<void>;
  private botOpenId: string | null = null;
  private readonly chatTitles = new Map<string, string>();
  private readonly userNames = new Map<string, string>();
  public constructor(options: {
    appId: string;
    appSecret: string;
    brand: Brand;
    logger: Logger;
    onMessage: (event: IncomingMessageEvent) => void | Promise<void>;
  }) {
    const domain = options.brand === "feishu" ? Domain.Feishu : Domain.Lark;
    this.onMessage = options.onMessage;
    this.client = new Client({
      appId: options.appId,
      appSecret: options.appSecret,
      appType: AppType.SelfBuild,
      domain,
      logger: options.logger,
      loggerLevel: LoggerLevel.info,
    });
    this.wsClient = new WSClient({
      appId: options.appId,
      appSecret: options.appSecret,
      domain,
      logger: options.logger,
      loggerLevel: LoggerLevel.info,
      autoReconnect: true,
      handshakeTimeoutMs: 15_000,
      wsConfig: { pingTimeout: 30 },
    });
    this.dispatcher = new EventDispatcher({
      logger: options.logger,
      loggerLevel: LoggerLevel.info,
    }).register({
      "im.message.receive_v1": async (event) => {
        if (event.message.chat_type !== "p2p" && event.message.chat_type !== "group") return;
        await this.onMessage({
          sender: event.sender,
          message: {
            message_id: event.message.message_id,
            chat_id: event.message.chat_id,
            chat_type: event.message.chat_type,
            message_type: event.message.message_type,
            content: event.message.content,
            ...(event.message.mentions === undefined ? {} : { mentions: event.message.mentions }),
          },
        });
      },
    });
  }
  public async start(): Promise<void> {
    await this.wsClient.start({ eventDispatcher: this.dispatcher });
  }
  public close(): void {
    this.wsClient.close({ force: true });
  }
  public async getBotOpenId(): Promise<string> {
    if (this.botOpenId !== null) return this.botOpenId;
    const response = await this.client.request<{ bot?: { open_id?: string } }>({
      url: BOT_INFO_URL,
    });
    const openId = response.bot?.open_id;
    if (openId === undefined || openId === "")
      throw new LarkBotIdentityError("bot/v3/info returned no bot open_id");
    this.botOpenId = openId;
    return openId;
  }
  public async getMessageMetadata(
    chatId: string,
    senderOpenId: string,
    chatType: "p2p" | "group",
  ): Promise<{ chatTitle: string; senderName: string }> {
    const [chatTitle, senderName] = await Promise.all([
      this.getChatTitle(chatId, chatType),
      this.getUserName(senderOpenId),
    ]);
    return {
      chatTitle: chatTitle ?? (chatType === "p2p" ? (senderName ?? chatId) : chatId),
      senderName: senderName ?? senderOpenId,
    };
  }

  public async replyText(messageId: string, text: string): Promise<void> {
    await this.client.im.message.reply({
      path: { message_id: messageId },
      data: { content: JSON.stringify({ text }), msg_type: "text", reply_in_thread: false },
    });
  }

  public async replyCard(messageId: string, card: object): Promise<string | null> {
    const response = await this.client.im.message.reply({
      path: { message_id: messageId },
      data: {
        content: JSON.stringify(card),
        msg_type: "interactive",
        reply_in_thread: false,
      },
    });
    return response.data?.message_id ?? null;
  }

  public async patchCard(messageId: string, card: object): Promise<void> {
    await this.client.im.v1.message.patch({
      path: { message_id: messageId },
      data: { content: JSON.stringify(card) },
    });
  }

  public async addReaction(messageId: string, emoji = "THINKING"): Promise<string | null> {
    try {
      const response = await this.client.im.messageReaction.create({
        path: { message_id: messageId },
        data: { reaction_type: { emoji_type: emoji } },
      });
      return response.data?.reaction_id ?? null;
    } catch {
      return null;
    }
  }

  public async removeReaction(messageId: string, reactionId: string): Promise<void> {
    try {
      await this.client.im.messageReaction.delete({
        path: { message_id: messageId, reaction_id: reactionId },
      });
    } catch {
      // Reaction cleanup is best-effort and must not fail the turn.
    }
  }

  private async getChatTitle(
    chatId: string,
    chatType: "p2p" | "group",
  ): Promise<string | undefined> {
    if (chatType === "p2p") return undefined;
    const cached = this.chatTitles.get(chatId);
    if (cached !== undefined) return cached;
    try {
      const response = await this.client.request<unknown>({
        url: "/open-apis/im/v1/chats/" + encodeURIComponent(chatId),
      });
      const name = z
        .object({ data: z.object({ name: z.string().optional() }).optional() })
        .loose()
        .safeParse(response).data?.data?.name;
      if (name !== undefined && name !== "") this.chatTitles.set(chatId, name);
      return name;
    } catch {
      return undefined;
    }
  }

  private async getUserName(openId: string): Promise<string | undefined> {
    const cached = this.userNames.get(openId);
    if (cached !== undefined) return cached;
    try {
      const response = await this.client.request<unknown>({
        url: "/open-apis/contact/v3/users/" + encodeURIComponent(openId) + "?user_id_type=open_id",
      });
      const name = z
        .object({
          data: z.object({ user: z.object({ name: z.string().optional() }).optional() }).optional(),
        })
        .loose()
        .safeParse(response).data?.data?.user?.name;
      if (name !== undefined && name !== "") this.userNames.set(openId, name);
      return name;
    } catch {
      return undefined;
    }
  }
}
export class LarkBotIdentityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "LarkBotIdentityError";
  }
}
