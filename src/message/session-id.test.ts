import { describe, expect, it } from "vitest";
import { larkChatSessionId } from "./session-id.ts";

describe("larkChatSessionId", () => {
  it("is stable for the same app and chat", () => {
    expect(larkChatSessionId("app", "oc_1")).toBe(larkChatSessionId("app", "oc_1"));
  });
  it("isolates different chats and apps", () => {
    expect(larkChatSessionId("app", "oc_1")).not.toBe(larkChatSessionId("app", "oc_2"));
    expect(larkChatSessionId("app-a", "oc_1")).not.toBe(larkChatSessionId("app-b", "oc_1"));
  });

  it("starts a distinct session after the workspace changes", () => {
    expect(larkChatSessionId("app", "oc_1", "/workspace/a")).not.toBe(
      larkChatSessionId("app", "oc_1", "/workspace/b"),
    );
  });
});
