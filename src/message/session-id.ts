import { createHash } from "node:crypto";
import { SessionId } from "@deepseek-ai/dsh-session";

/** 同一应用、同一飞书 chat 稳定映射到同一个 DSH session。 */
export function larkChatSessionId(
  appId: string,
  chatId: string,
  workspace = "",
  generation = "",
): SessionId {
  const digest = createHash("sha256")
    .update(appId)
    .update("\0")
    .update(chatId)
    .update("\0")
    .update(workspace)
    .update("\0")
    .update(generation)
    .digest("hex");
  return SessionId("lark-" + digest);
}
