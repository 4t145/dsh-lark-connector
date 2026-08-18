import { describe, expect, it } from "vitest";
import { routeUserInput } from "./message-router.ts";
import type { IncomingMessageEvent } from "./message-router.ts";

const BOT = "ou_bot";
const USER = "ou_user";

function textEvent(overrides: Partial<IncomingMessageEvent["message"]> = {}): IncomingMessageEvent {
  return {
    sender: { sender_id: { open_id: USER }, sender_type: "user" },
    message: {
      message_id: "om_1",
      chat_id: "oc_p2p",
      chat_type: "p2p",
      message_type: "text",
      content: JSON.stringify({ text: "你好" }),
      ...overrides,
    },
  };
}

describe("routeUserInput", () => {
  it("accepts a direct text message", () => {
    const result = routeUserInput(textEvent(), BOT);
    expect(result).toEqual({
      messageId: "om_1",
      chatId: "oc_p2p",
      senderOpenId: USER,
      text: "你好",
      imageKeys: [],
    });
  });

  it("rejects a group message without a bot mention", () => {
    const result = routeUserInput(textEvent({ chat_id: "oc_group", chat_type: "group" }), BOT);
    expect(result).toBeNull();
  });

  it("accepts a group mention and strips only the bot mention", () => {
    const result = routeUserInput(
      textEvent({
        chat_id: "oc_group",
        chat_type: "group",
        content: JSON.stringify({ text: "@_user_1 帮 @_user_2 查资料" }),
        mentions: [
          { key: "@_user_1", id: { open_id: BOT }, name: "机器人" },
          { key: "@_user_2", id: { open_id: "ou_other" }, name: "小王" },
        ],
      }),
      BOT,
    );
    expect(result?.text).toBe("帮 @小王 查资料");
  });

  it("accepts a direct image message", () => {
    const result = routeUserInput(
      textEvent({
        message_type: "image",
        content: JSON.stringify({ image_key: "img_1" }),
      }),
      BOT,
    );
    expect(result).toEqual({
      messageId: "om_1",
      chatId: "oc_p2p",
      senderOpenId: USER,
      text: "",
      imageKeys: ["img_1"],
    });
  });

  it("rejects a group image message", () => {
    const result = routeUserInput(
      textEvent({
        chat_id: "oc_group",
        chat_type: "group",
        message_type: "image",
        content: JSON.stringify({ image_key: "img_1" }),
      }),
      BOT,
    );
    expect(result).toBeNull();
  });

  it("accepts a group post mentioning the bot with text and images", () => {
    const result = routeUserInput(
      textEvent({
        chat_id: "oc_group",
        chat_type: "group",
        message_type: "post",
        content: JSON.stringify({
          title: "请分析",
          content: [
            [
              { tag: "at", user_id: BOT, user_name: "机器人" },
              { tag: "text", text: "看看这张图" },
            ],
            [{ tag: "img", image_key: "img_2" }],
          ],
        }),
      }),
      BOT,
    );
    expect(result?.text).toBe("请分析\n看看这张图");
    expect(result?.imageKeys).toEqual(["img_2"]);
  });

  it("rejects a group post without a bot mention", () => {
    const result = routeUserInput(
      textEvent({
        chat_id: "oc_group",
        chat_type: "group",
        message_type: "post",
        content: JSON.stringify({
          content: [[{ tag: "text", text: "无关内容" }]],
        }),
      }),
      BOT,
    );
    expect(result).toBeNull();
  });

  it("accepts a direct post with only an image", () => {
    const result = routeUserInput(
      textEvent({
        message_type: "post",
        content: JSON.stringify({
          content: [[{ tag: "img", image_key: "img_3" }]],
        }),
      }),
      BOT,
    );
    expect(result?.text).toBe("");
    expect(result?.imageKeys).toEqual(["img_3"]);
  });

  it("keeps other users at mentions in posts", () => {
    const result = routeUserInput(
      textEvent({
        message_type: "post",
        content: JSON.stringify({
          content: [
            [
              { tag: "at", user_id: BOT, user_name: "机器人" },
              { tag: "at", user_id: "ou_other", user_name: "小王" },
              { tag: "text", text: "一起看" },
            ],
          ],
        }),
      }),
      BOT,
    );
    expect(result?.text).toBe("@小王一起看");
  });

  it("rejects app messages and unsupported message types", () => {
    const appEvent: IncomingMessageEvent = {
      sender: { sender_id: { open_id: USER }, sender_type: "app" },
      message: {
        message_id: "om_4",
        chat_id: "oc_p2p",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "hi" }),
      },
    };
    expect(routeUserInput(appEvent, BOT)).toBeNull();
    expect(
      routeUserInput(textEvent({ message_type: "sticker", content: JSON.stringify({}) }), BOT),
    ).toBeNull();
  });
});
