import { z } from "zod";
import type { RemoteResult, TypertRemoteNamespaceMap } from "@deepseek-ai/dsh-typert-protocol";
import type { LarkConnectorStatusView } from "../status.ts";

const workspaceRequestSchema = z.object({
  workspace: z.string(),
  agentPreset: z.string(),
  modelProvider: z.string(),
  model: z.string(),
});

const statusSchema = z.object({
  enabled: z.boolean(),
  workspace: z.string(),
  workspaceConfigured: z.boolean(),
  agentPreset: z.string(),
  modelProvider: z.string(),
  model: z.string(),
  checkedAt: z.number(),
  apps: z.array(
    z.object({
      appEntryId: z.string(),
      appId: z.string(),
      brand: z.union([z.literal("feishu"), z.literal("lark")]),
      state: z.union([
        z.literal("connecting"),
        z.literal("connected"),
        z.literal("error"),
        z.literal("stopped"),
      ]),
      connectedAt: z.union([z.number(), z.null()]),
      lastEventAt: z.union([z.number(), z.null()]),
      lastError: z.union([z.string(), z.null()]),
      receivedCount: z.number(),
      acceptedCount: z.number(),
      sessions: z.array(
        z.object({
          chatId: z.string(),
          sessionId: z.string(),
          running: z.boolean(),
          lastActivityAt: z.number(),
        }),
      ),
    }),
  ),
});

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    larkConnector: {
      status(): Promise<RemoteResult<LarkConnectorStatusView>>;
      setWorkspace(request: {
        workspace: string;
        agentPreset: string;
        modelProvider: string;
        model: string;
      }): Promise<RemoteResult<LarkConnectorStatusView>>;
    };
  }
}

export const TYPERT_REMOTE = {
  package: "lark-connector",
  descriptors: [
    {
      id: "lark-connector#larkConnector/status",
      service: "larkConnectorStatus",
      namespace: "larkConnector",
      method: "status",
      invocation: { kind: "direct" },
      parameters: [],
      result: {
        mode: "strict",
        typeSymbol: "lark-connector#LarkConnectorStatusView",
        schema: statusSchema,
      },
      sourceLocation: { file: "src/remote-service.ts", line: 18, column: 3 },
    },
    {
      id: "lark-connector#larkConnector/setWorkspace",
      service: "larkConnectorStatus",
      namespace: "larkConnector",
      method: "setWorkspace",
      invocation: { kind: "direct" },
      parameters: [
        {
          name: "request",
          wire: "request",
          source: "json",
          codec: {
            mode: "strict",
            typeSymbol: "lark-connector#WorkspaceRequest",
            schema: workspaceRequestSchema,
          },
        },
      ],
      result: {
        mode: "strict",
        typeSymbol: "lark-connector#LarkConnectorStatusView",
        schema: statusSchema,
      },
      sourceLocation: { file: "src/remote-service.ts", line: 22, column: 3 },
    },
  ],
} as const;

export type LarkRemoteMap = Pick<TypertRemoteNamespaceMap, "larkConnector">;
export default TYPERT_REMOTE;
