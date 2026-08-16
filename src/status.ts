export type BridgeConnectionState = "connecting" | "connected" | "error" | "stopped";

export interface LarkSessionLinkView {
  chatId: string;
  sessionId: string;
  running: boolean;
  lastActivityAt: number;
}

export interface LarkBridgeStatusView {
  appEntryId: string;
  appId: string;
  brand: "feishu" | "lark";
  state: BridgeConnectionState;
  connectedAt: number | null;
  lastEventAt: number | null;
  lastError: string | null;
  receivedCount: number;
  acceptedCount: number;
  sessions: LarkSessionLinkView[];
}

export interface LarkConnectorStatusView {
  enabled: boolean;
  workspace: string;
  workspaceConfigured: boolean;
  agentPreset: string;
  modelProvider: string;
  model: string;
  checkedAt: number;
  apps: LarkBridgeStatusView[];
}
