import Schema from "@deepseek-ai/schemastery";
import {
  LARK_APP_ID_REF,
  LARK_APP_SECRET_REF,
  LARK_BRAND_REF,
  LARK_CLI_PATH_REF,
} from "./credentials.ts";

export interface AppEntry {
  id: string;
  appIdRef: string;
  appSecretRef: string;
  brandRef: string;
  cliPathRef: string;
}

export interface MessageBridgeConfig {
  enabled: boolean;
  workspace: string;
  /** Legacy alias retained for existing configurations. */
  cwd: string;
  agentPreset: string;
  modelProvider: string;
  model: string;
  replyChunkSize: number;
  dedupeCapacity: number;
}

export interface Config {
  apps: AppEntry[];
  bridge: MessageBridgeConfig;
}

export const DEFAULT_APP_ID = "default";
export const DEFAULT_APPS: readonly AppEntry[] = Object.freeze([
  {
    id: DEFAULT_APP_ID,
    appIdRef: LARK_APP_ID_REF,
    appSecretRef: LARK_APP_SECRET_REF,
    brandRef: LARK_BRAND_REF,
    cliPathRef: LARK_CLI_PATH_REF,
  },
]);
export const DEFAULT_MESSAGE_BRIDGE: Readonly<MessageBridgeConfig> = Object.freeze({
  enabled: true,
  workspace: "",
  cwd: "",
  agentPreset: "",
  modelProvider: "",
  model: "",
  replyChunkSize: 3_500,
  dedupeCapacity: 2_000,
});

const AppEntrySchema: Schema<AppEntry> = Schema.object({
  id: Schema.string().default(DEFAULT_APP_ID),
  appIdRef: Schema.string().default(LARK_APP_ID_REF),
  appSecretRef: Schema.string().default(LARK_APP_SECRET_REF),
  brandRef: Schema.string().default(LARK_BRAND_REF),
  cliPathRef: Schema.string().default(LARK_CLI_PATH_REF),
});
const MessageBridgeSchema: Schema<MessageBridgeConfig> = Schema.object({
  enabled: Schema.boolean().default(DEFAULT_MESSAGE_BRIDGE.enabled),
  workspace: Schema.string().default(DEFAULT_MESSAGE_BRIDGE.workspace),
  cwd: Schema.string().default(DEFAULT_MESSAGE_BRIDGE.cwd),
  agentPreset: Schema.string().default(DEFAULT_MESSAGE_BRIDGE.agentPreset),
  modelProvider: Schema.string().default(DEFAULT_MESSAGE_BRIDGE.modelProvider),
  model: Schema.string().default(DEFAULT_MESSAGE_BRIDGE.model),
  replyChunkSize: Schema.number()
    .min(500)
    .max(4_000)
    .default(DEFAULT_MESSAGE_BRIDGE.replyChunkSize),
  dedupeCapacity: Schema.number()
    .min(100)
    .max(20_000)
    .default(DEFAULT_MESSAGE_BRIDGE.dedupeCapacity),
});
export const Config: Schema<Config> = Schema.object({
  apps: Schema.array(AppEntrySchema).default([...DEFAULT_APPS]),
  bridge: MessageBridgeSchema.default({ ...DEFAULT_MESSAGE_BRIDGE }),
});
