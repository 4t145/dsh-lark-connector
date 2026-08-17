import type { Context } from "@deepseek-ai/cordis";
import type { Logger as LarkSdkLogger } from "@larksuiteoapi/node-sdk";
import type { IncomingMessageEvent } from "./message-router.ts";
import type { MessageBridgeConfig } from "../config.ts";
import type { LarkCredentials } from "../credentials.ts";
import { AgentSessionRouter } from "./agent-sessions.ts";
import { LarkTurnPresentation } from "./presentation.ts";
import { chunkReply } from "./assistant-output.ts";
import { MessageDedupe } from "./dedupe.ts";
import { LarkConnection } from "./lark-connection.ts";
import { routeUserInput } from "./message-router.ts";
import type { BridgeConnectionState, LarkBridgeStatusView } from "../status.ts";

const EMPTY_REPLY = "任务已完成，但没有生成文本回复。";
const ERROR_REPLY = "处理消息时发生错误，请稍后重试。";
export class LarkMessageBridge {
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
      const contextualText =
        "【飞书会话：" +
        metadata.chatTitle +
        "】\n" +
        "【发件人：" +
        metadata.senderName +
        "（" +
        input.senderOpenId +
        "）】\n" +
        input.text;
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
        try {
          const displayedError =
            presentation !== undefined && this.config.streamOutput
              ? await presentation.fail(ERROR_REPLY)
              : false;
          if (!displayedError)
            await this.connection.replyText(event.message.message_id, ERROR_REPLY);
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
