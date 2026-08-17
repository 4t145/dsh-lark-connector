import type { Context } from "@deepseek-ai/cordis";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import Schema from "@deepseek-ai/schemastery";
import { Config } from "./config.ts";
import type { AppEntry, Config as ConfigView } from "./config.ts";
import { EMPTY_CREDENTIALS, resolveAppCredentials } from "./credentials.ts";
import type { LarkCredentials } from "./credentials.ts";
import { DEFAULT_CLI_NAME } from "./lark-cli/cli.ts";
import { syncAppCredentials } from "./lark-cli/config-sync.ts";
import { LarkMessageBridge } from "./message/bridge.ts";
import { LarkConnectorStatusService } from "./remote-service.ts";
import type { LarkBridgeStatusView, LarkConnectorStatusView } from "./status.ts";
import { larkSetupTool } from "./tool/lark-setup.ts";
import { larkStatusTool } from "./tool/lark-status.ts";
import type { LarkStatusSnapshot } from "./tool/lark-status.ts";

/** 插件名称：用于日志、HMR 与 cordis.yml 中的行标识。 */
export const name = "lark-connector";

/** 声明依赖的服务：tools 注册表与 credentials 凭据服务。 */
export const inject = [
  "tools",
  "credentials",
  "agents",
  "sessions",
  "sessionPersistence",
  "agentDefaultModel",
  "agentPresets",
  "workspaceRegistry",
  "settings",
  "sessionTitle",
];

/** 凭据同步状态（discriminated union）。 */
export type ConnectorSyncState =
  | { kind: "unconfigured" }
  | { kind: "syncing" }
  | { kind: "synced"; checkedAt: number }
  | { kind: "error"; message: string; checkedAt: number };

/** 一个应用的运行态：凭据快照与同步状态。 */
export interface AppState {
  entry: AppEntry;
  credentials: LarkCredentials;
  sync: ConnectorSyncState;
  bridgeError: string | null;
}

/** 连接器运行态：各应用状态。 */
interface ConnectorState {
  apps: AppState[];
  bridges: Map<string, LarkMessageBridge>;
}

export function apply(ctx: Context, config: ConfigView) {
  const state: ConnectorState = {
    apps: config.apps.map((entry) => ({
      entry,
      credentials: EMPTY_CREDENTIALS,
      sync: { kind: "unconfigured" },
      bridgeError: null,
    })),
    bridges: new Map(),
  };
  const logger = ctx.logger("lark-connector");
  const workspaceSettings = ctx.settings.register(
    settingsNamespace("lark-connector"),
    Schema.object({
      workspace: Schema.string().default(""),
      agentPreset: Schema.string().default(""),
      modelProvider: Schema.string().default(""),
      model: Schema.string().default(""),
      thinkingReaction: Schema.boolean().default(true),
      streamOutput: Schema.boolean().default(true),
      showThoughts: Schema.boolean().default(true),
      showTools: Schema.boolean().default(true),
    }),
    {
      base: {
        workspace: config.bridge.workspace,
        agentPreset: config.bridge.agentPreset,
        modelProvider: config.bridge.modelProvider,
        model: config.bridge.model,
        thinkingReaction: config.bridge.thinkingReaction,
        streamOutput: config.bridge.streamOutput,
        showThoughts: config.bridge.showThoughts,
        showTools: config.bridge.showTools,
      },
    },
  );
  Object.assign(config.bridge, workspaceSettings.get());
  workspaceSettings.watch((next) => {
    Object.assign(config.bridge, next);
  });
  new LarkConnectorStatusService(
    ctx,
    () => connectorStatus(state, config.bridge),
    async (request) => {
      const normalized = {
        workspace: request.workspace.trim(),
        agentPreset: request.agentPreset.trim(),
        modelProvider: request.modelProvider.trim(),
        model: request.model.trim(),
        thinkingReaction: request.thinkingReaction,
        streamOutput: request.streamOutput,
        showThoughts: request.showThoughts,
        showTools: request.showTools,
      };
      await ctx.workspaceRegistry.create(
        normalized.workspace === "" ? process.cwd() : normalized.workspace,
      );
      await workspaceSettings.update(normalized);
      Object.assign(config.bridge, normalized);
      return connectorStatus(state, config.bridge);
    },
  );
  let refreshQueue = Promise.resolve();
  const scheduleRefresh = (): void => {
    refreshQueue = refreshQueue
      .then(async () => refreshAll(ctx, state, config, logger))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`failed to refresh Lark connector: ${message}`);
      });
  };

  scheduleRefresh();

  // credentials 服务更新时串行重建连接，避免并发 refresh 泄漏重复 WebSocket。
  ctx.on("credentials/updated", scheduleRefresh);

  ctx.tools.register(
    larkStatusTool({
      getSnapshot: () => ({ apps: state.apps }),
    }),
  );

  ctx.tools.register(larkSetupTool());

  ctx.effect(
    () => () => {
      for (const bridge of state.bridges.values()) bridge.dispose();
      state.bridges.clear();
    },
    "lark-message-bridges",
  );
}

/**
 * 解析全部应用的凭据并同步进 lark-cli。
 * 解析失败或凭据为空时保持/进入相应状态，不让插件加载失败。
 */
async function refreshAll(
  ctx: Context,
  state: ConnectorState,
  config: ConfigView,
  logger: ReturnType<Context["logger"]>,
): Promise<void> {
  await Promise.all(state.apps.map((app) => refreshApp(ctx, app, logger)));
  await restartBridges(ctx, state, config, logger);
}

/** 同步单个应用：解析凭据 → config init（命名 profile）。 */
async function refreshApp(
  ctx: Context,
  app: AppState,
  logger: ReturnType<Context["logger"]>,
): Promise<void> {
  let credentials: LarkCredentials;
  try {
    credentials = await resolveAppCredentials(ctx.credentials, app.entry);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    app.sync = { kind: "error", message, checkedAt: Date.now() };
    logger.error(`failed to resolve Lark credentials for ${app.entry.id}: ${message}`);
    return;
  }
  app.credentials = credentials;

  if (credentials.appId === "" || credentials.appSecret === "") {
    app.sync = { kind: "unconfigured" };
    return;
  }

  app.sync = { kind: "syncing" };
  try {
    const outcome = await syncAppCredentials(resolveCliPath(credentials), {
      appId: credentials.appId,
      appSecret: credentials.appSecret,
      brand: credentials.brand,
      profile: app.entry.id,
    });
    if (outcome.kind === "ok") {
      app.sync = { kind: "synced", checkedAt: Date.now() };
      logger.info(`Lark app ${app.entry.id} synced (appId=${credentials.appId})`);
    } else {
      app.sync = { kind: "error", message: outcome.failure.message, checkedAt: Date.now() };
      logger.warn(`Lark rejected app ${app.entry.id}: ${outcome.failure.message}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    app.sync = { kind: "error", message, checkedAt: Date.now() };
    logger.error(`failed to sync Lark app ${app.entry.id}: ${message}`);
  }
}

/** 按最新凭据重建长连接；凭据更新时旧连接先关闭，避免重复消费。 */
async function restartBridges(
  ctx: Context,
  state: ConnectorState,
  config: ConfigView,
  logger: ReturnType<Context["logger"]>,
): Promise<void> {
  for (const bridge of state.bridges.values()) bridge.dispose();
  state.bridges.clear();
  if (!config.bridge.enabled) return;

  for (const app of state.apps) {
    app.bridgeError = null;
    if (app.credentials.appId === "" || app.credentials.appSecret === "") continue;
    const bridge = new LarkMessageBridge(ctx, app.entry.id, app.credentials, config.bridge);
    try {
      await bridge.start();
      state.bridges.set(app.entry.id, bridge);
    } catch (error) {
      bridge.dispose();
      const message = error instanceof Error ? error.message : String(error);
      app.bridgeError = message;
      logger.error(`failed to connect Lark app ${app.entry.id}: ${message}`);
    }
  }
}

function connectorStatus(
  state: ConnectorState,
  bridge: ConfigView["bridge"],
): LarkConnectorStatusView {
  const configuredWorkspace = bridge.workspace !== "" ? bridge.workspace : bridge.cwd;
  return {
    enabled: bridge.enabled,
    workspace: configuredWorkspace === "" ? process.cwd() : configuredWorkspace,
    workspaceConfigured: configuredWorkspace !== "",
    agentPreset: bridge.agentPreset,
    modelProvider: bridge.modelProvider,
    model: bridge.model,
    thinkingReaction: bridge.thinkingReaction,
    streamOutput: bridge.streamOutput,
    showThoughts: bridge.showThoughts,
    showTools: bridge.showTools,
    checkedAt: Date.now(),
    apps: state.apps.map((app): LarkBridgeStatusView => {
      const runtimeBridge = state.bridges.get(app.entry.id);
      if (runtimeBridge !== undefined) return runtimeBridge.snapshot();
      const configured = app.credentials.appId !== "" && app.credentials.appSecret !== "";
      const error = app.bridgeError ?? (app.sync.kind === "error" ? app.sync.message : null);
      return {
        appEntryId: app.entry.id,
        appId: app.credentials.appId,
        brand: app.credentials.brand,
        state: error !== null ? "error" : bridge.enabled && configured ? "connecting" : "stopped",
        connectedAt: null,
        lastEventAt: null,
        lastError: error,
        receivedCount: 0,
        acceptedCount: 0,
        sessions: [],
      };
    }),
  };
}

/** 解析 lark-cli 可执行文件：凭据配置优先，否则用 PATH 上的默认名称。 */
function resolveCliPath(credentials: LarkCredentials): string {
  return credentials.cliPath === "" ? DEFAULT_CLI_NAME : credentials.cliPath;
}

/** 供 larkStatusTool 使用的快照类型（避免循环依赖）。 */
export type { LarkStatusSnapshot };
export { Config };
