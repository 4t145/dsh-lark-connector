import { describe, expect, it } from "vitest";
import { routeUserInput } from "./message-router.ts";

const BOT = "ou_bot";
const USER = "ou_user";

describe("routeUserInput", () => {
  it("accepts a direct text message", () => {
    const result = routeUserInput(
      {
        sender: { sender_id: { open_id: USER }, sender_type: "user" },
        message: {
          message_id: "om_1",
          chat_id: "oc_p2p",
          chat_type: "p2p",
          message_type: "text",
          content: JSON.stringify({ text: "你好" }),
        },
      },
      BOT,
    );
    expect(result).toEqual({
      messageId: "om_1",
      chatId: "oc_p2p",
      senderOpenId: USER,
      text: "你好",
    });
  });

  it("rejects a group message without a bot mention", () => {
    const result = routeUserInput(
      {
        sender: { sender_id: { open_id: USER }, sender_type: "user" },
        message: {
          message_id: "om_2",
          chat_id: "oc_group",
          chat_type: "group",
          message_type: "text",
          content: JSON.stringify({ text: "你好" }),
        },
      },
      BOT,
    );
    expect(result).toBeNull();
  });

  it("accepts a group mention and strips only the bot mention", () => {
    const result = routeUserInput(
      {
        sender: { sender_id: { open_id: USER }, sender_type: "user" },
        message: {
          message_id: "om_3",
          chat_id: "oc_group",
          chat_type: "group",
          message_type: "text",
          content: JSON.stringify({ text: "@_user_1 帮 @_user_2 查资料" }),
          mentions: [
            { key: "@_user_1", id: { open_id: BOT }, name: "机器人" },
            { key: "@_user_2", id: { open_id: "ou_other" }, name: "小王" },
          ],
        },
      },
      BOT,
    );
    expect(result?.text).toBe("帮 @小王 查资料");
  });

  it("rejects app messages and unsupported message types", () => {
    const base = {
      message_id: "om_4",
      chat_id: "oc_p2p",
      chat_type: "p2p" as const,
      content: JSON.stringify({ text: "hi" }),
    };
    expect(
      routeUserInput(
        {
          sender: { sender_id: { open_id: USER }, sender_type: "app" },
          message: { ...base, message_type: "text" },
        },
        BOT,
      ),
    ).toBeNull();
    expect(
      routeUserInput(
        {
          sender: { sender_id: { open_id: USER }, sender_type: "user" },
          message: { ...base, message_type: "image" },
        },
        BOT,
      ),
    ).toBeNull();
  });
});
