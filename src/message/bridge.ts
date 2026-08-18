import type { Context } from "@deepseek-ai/cordis";
import type { Logger as LarkSdkLogger } from "@larksuiteoapi/node-sdk";
import type { IncomingMessageEvent, RoutedUserInput } from "./message-router.ts";
import type { MessageBridgeConfig } from "../config.ts";
import type { LarkCredentials } from "../credentials.ts";
import type { ImageAttachmentRef, ImageMediaType } from "@deepseek-ai/dsh-attachment";
import { AgentSessionRouter, AgentTurnError } from "./agent-sessions.ts";
import { LarkTurnPresentation } from "./presentation.ts";
import { chunkReply } from "./assistant-output.ts";
import { MessageDedupe } from "./dedupe.ts";
import { LarkConnection } from "./lark-connection.ts";
import { routeUserInput } from "./message-router.ts";
import { resolveImageMediaType } from "./image-media.ts";
import type { BridgeConnectionState, LarkBridgeStatusView } from "../status.ts";

const EMPTY_REPLY = "任务已完成，但没有生成文本回复。";
const ERROR_REPLY = "处理消息时发生错误，请稍后重试。";
export class LarkMessageBridge {
  private readonly ctx: Context;
  private readonly logger: ReturnType<Context["logger"]>;
  private readonly connection: LarkConnection;
  private readonly sessions: AgentSessionRouter;
  private readonly dedupe: MessageDedupe;
  private readonly config: MessageBridgeConfig;
  private readonly appEntryId: string;
  private readonly appId: string;
  private readonly brand: "feishu" | "lark";
  private state: BridgeConnectionState = "connecting";
  private connectedAt: number | null = null;
  private lastEventAt: number | null = null;
  private lastError: string | null = null;
  private receivedCount = 0;
  private acceptedCount = 0;

  public constructor(
    ctx: Context,
    appId: string,
    credentials: LarkCredentials,
    config: MessageBridgeConfig,
  ) {
    this.ctx = ctx;
    this.logger = ctx.logger("lark-message-bridge");
    this.config = config;
    this.appEntryId = appId;
    this.appId = credentials.appId;
    this.brand = credentials.brand;
    this.sessions = new AgentSessionRouter(ctx, appId, config);
    this.dedupe = new MessageDedupe(config.dedupeCapacity);
    this.connection = new LarkConnection({
      appId: credentials.appId,
      appSecret: credentials.appSecret,
      brand: credentials.brand,
      logger: createSdkLogger(this.logger),
      onMessage: async (event) => {
        await this.handleMessage(event);
      },
    });
  }
  public async start(): Promise<void> {
    try {
      await this.connection.start();
      this.state = "connected";
      this.connectedAt = Date.now();
      this.lastError = null;
      this.logger.info("Lark message WebSocket connected");
    } catch (error) {
      this.state = "error";
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  public snapshot(): LarkBridgeStatusView {
    return {
      appEntryId: this.appEntryId,
      appId: this.appId,
      brand: this.brand,
      state: this.state,
      connectedAt: this.connectedAt,
      lastEventAt: this.lastEventAt,
      lastError: this.lastError,
      receivedCount: this.receivedCount,
      acceptedCount: this.acceptedCount,
      sessions: this.sessions.snapshot(),
    };
  }

  public dispose(): void {
    this.state = "stopped";
    this.connection.close();
    this.sessions.dispose();
  }
  private async handleMessage(event: IncomingMessageEvent): Promise<void> {
    this.receivedCount += 1;
    this.lastEventAt = Date.now();
    let reactionId: string | null = null;
    let presentation: LarkTurnPresentation | undefined;
    try {
      const input = routeUserInput(event, await this.connection.getBotOpenId());
      if (input === null || !this.dedupe.accept(input.messageId)) return;
      this.acceptedCount += 1;
      this.logger.info("received Lark input chat=%s sender=%s", input.chatId, input.senderOpenId);
      const metadata = await this.connection.getMessageMetadata(
        input.chatId,
        input.senderOpenId,
        event.message.chat_type,
      );
      const collected = await this.collectImages(input);
      if (input.imageKeys.length > 0 && collected.refs.length === 0 && input.text === "") {
        this.lastError = "all image downloads failed";
        await this.connection.replyText(input.messageId, "图片处理失败，请重试或改用文字描述。");
        return;
      }
      let body = input.text;
      if (body === "" && collected.refs.length > 0) body = "用户发送了图片，请查看。";
      const imageNotes: string[] = [];
      if (collected.refs.length > 0)
        imageNotes.push("附带 " + String(collected.refs.length) + " 张图片");
      if (collected.failed > 0)
        imageNotes.push(String(collected.failed) + " 张图片下载失败或格式不支持");
      if (collected.dropped > 0)
        imageNotes.push("超过单条数量上限，忽略 " + String(collected.dropped) + " 张图片");
      const contextualText =
        "【飞书会话：" +
        metadata.chatTitle +
        "】\n" +
        "【发件人：" +
        metadata.senderName +
        "（" +
        input.senderOpenId +
        "）】\n" +
        body +
        (imageNotes.length > 0 ? "\n【" + imageNotes.join("，") + "】" : "");
      if (this.config.thinkingReaction)
        reactionId = await this.connection.addReaction(input.messageId);
      presentation = new LarkTurnPresentation(this.connection, input.messageId, {
        thinkingReaction: this.config.thinkingReaction,
        streamOutput: this.config.streamOutput,
        showThoughts: this.config.showThoughts,
        showTools: this.config.showTools,
      });
      await presentation.start();
      const output = await this.sessions.run(
        input.chatId,
        contextualText,
        metadata.chatTitle,
        (sessionEvent) => presentation?.accept(sessionEvent),
        collected.refs,
      );
      const displayed = await presentation.complete(output === "" ? EMPTY_REPLY : output);
      if (!displayed)
        for (const chunk of chunkReply(
          output === "" ? EMPTY_REPLY : output,
          this.config.replyChunkSize,
        ))
          await this.connection.replyText(input.messageId, chunk);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      this.logger.error("failed to process Lark message: %s", message);
      if (event.message.message_id !== "") {
        const replyText =
          error instanceof AgentTurnError && message !== ""
            ? "本轮运行失败：" + message
            : ERROR_REPLY;
        try {
          const displayedError =
            presentation !== undefined && this.config.streamOutput
              ? await presentation.fail(replyText)
              : false;
          if (!displayedError) await this.connection.replyText(event.message.message_id, replyText);
        } catch (replyError) {
          this.logger.error(
            "failed to send Lark error reply: %s",
            replyError instanceof Error ? replyError.message : String(replyError),
          );
        }
      }
    } finally {
      if (reactionId !== null && event.message.message_id !== "")
        await this.connection.removeReaction(event.message.message_id, reactionId);
    }
  }

  /** 下载消息中的图片并批量写入附件存储；失败的图片计数但不阻断文本。 */
  private async collectImages(input: RoutedUserInput): Promise<{
    refs: readonly ImageAttachmentRef[];
    failed: number;
    dropped: number;
  }> {
    if (input.imageKeys.length === 0) return { refs: [], failed: 0, dropped: 0 };
    const limit = this.ctx.attachments.imageLimits.maxImagesPerMessage;
    const dropped = Math.max(0, input.imageKeys.length - limit);
    const prepared: { data: Uint8Array; mediaType: ImageMediaType; name: string }[] = [];
    let failed = 0;
    for (const imageKey of input.imageKeys.slice(0, limit)) {
      try {
        const { data, contentType } = await this.connection.downloadImage(
          input.messageId,
          imageKey,
        );
        const mediaType = resolveImageMediaType(contentType, data);
        if (mediaType === null || data.length === 0) {
          failed += 1;
          this.logger.warn("unsupported or empty Lark image %s", imageKey);
          continue;
        }
        prepared.push({ data, mediaType, name: imageKey });
      } catch (error) {
        failed += 1;
        this.logger.warn(
          "failed to download Lark image %s: %s",
          imageKey,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    const refs: ImageAttachmentRef[] = [];
    for (const image of prepared) {
      try {
        refs.push(await this.ctx.attachments.saveImage(image));
      } catch (error) {
        failed += 1;
        this.logger.error(
          "failed to save Lark image %s: %s",
          image.name,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    return { refs, failed, dropped };
  }
}
function createSdkLogger(logger: ReturnType<Context["logger"]>): LarkSdkLogger {
  const render = (values: readonly unknown[]): string => values.map(String).join(" ");
  return {
    error: (...values) => {
      logger.error(render(values));
    },
    warn: (...values) => {
      logger.warn(render(values));
    },
    info: (...values) => {
      logger.info(render(values));
    },
    debug: (...values) => {
      logger.debug(render(values));
    },
    trace: (...values) => {
      logger.debug(render(values));
    },
  };
}
