import { z } from "zod";

const workspaceRequestSchema = z.object({
  workspace: z.string(),
  agentPreset: z.string(),
  modelProvider: z.string(),
  model: z.string(),
  thinkingReaction: z.boolean(),
  streamOutput: z.boolean(),
  showThoughts: z.boolean(),
  showTools: z.boolean(),
});

const statusSchema = z.object({
  enabled: z.boolean(),
  workspace: z.string(),
  workspaceConfigured: z.boolean(),
  agentPreset: z.string(),
  modelProvider: z.string(),
  model: z.string(),
  thinkingReaction: z.boolean(),
  streamOutput: z.boolean(),
  showThoughts: z.boolean(),
  showTools: z.boolean(),
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

export const TYPERT = {
  package: "@4t145/lark-connector",
  face: "host",
  schemas: [],
  invocations: [
    {
      id: "@4t145/lark-connector#larkConnector/status",
      service: "larkConnectorStatus",
      namespace: "larkConnector",
      method: "status",
      invocation: { kind: "direct" },
      parameters: [],
      result: {
        mode: "strict",
        typeSymbol: "@4t145/lark-connector#LarkConnectorStatusView",
        schema: statusSchema,
      },
      sourceLocation: { file: "src/remote-service.ts", line: 18, column: 3 },
    },
    {
      id: "@4t145/lark-connector#larkConnector/setWorkspace",
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
            typeSymbol: "@4t145/lark-connector#WorkspaceRequest",
            schema: workspaceRequestSchema,
          },
        },
      ],
      result: {
        mode: "strict",
        typeSymbol: "@4t145/lark-connector#LarkConnectorStatusView",
        schema: statusSchema,
      },
      sourceLocation: { file: "src/remote-service.ts", line: 22, column: 3 },
    },
  ],
  model: { services: [], events: [], objects: [] },
} as const;

export default TYPERT;
