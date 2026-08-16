// 插件公开入口（门面）：只 re-export 对外 API，实现见各子模块。
// Config 同时是类型与值（schema），单条 re-export 同时导出两种含义。
export { apply, inject, name, Config } from "./plugin.ts";
export type { ConnectorSyncState, AppState } from "./plugin.ts";
export type { Config as ConfigView, MessageBridgeConfig } from "./config.ts";
export { BRANDS, DEFAULT_BRAND } from "./brand.ts";
export type { Brand } from "./brand.ts";
export {
  LARK_APP_ID_REF,
  LARK_APP_SECRET_REF,
  LARK_BRAND_REF,
  LARK_CLI_PATH_REF,
} from "./credentials.ts";
export type { LarkCredentials } from "./credentials.ts";
export { DEFAULT_APPS, DEFAULT_APP_ID, DEFAULT_MESSAGE_BRIDGE } from "./config.ts";
export type { AppEntry } from "./config.ts";
