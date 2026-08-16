import { defineTool } from "@deepseek-ai/dsh-tools";
import { probeLarkCli } from "../lark-cli/cli-probe.ts";
import { collectAuthStatus } from "../lark-cli/auth-status.ts";
import type { ConnectorSyncState } from "../plugin.ts";
import type { AppState } from "../plugin.ts";

/** 工具依赖：由插件注入的运行态快照。 */
export interface LarkStatusDeps {
  getSnapshot: () => LarkStatusSnapshot;
}

/** 连接器状态快照：各应用状态。 */
export interface LarkStatusSnapshot {
  apps: readonly AppState[];
}

/** 单个应用在工具输出中的视图。 */
interface AppStatusValue {
  id: string;
  configured: boolean;
  appId: string;
  brand: string;
  cliPath: string;
  cliVersion?: string;
  syncState: ConnectorSyncState["kind"];
  message?: string;
}

/** lark_status 工具返回的结构化结果。 */
interface StatusValue {
  apps: AppStatusValue[];
}

/**
 * 构造 lark_status 工具：报告各应用的凭据配置与 lark-cli 联通状态。
 * 不返回任何秘密值。
 */
export function larkStatusTool(deps: LarkStatusDeps) {
  return defineTool({
    name: "lark_status",
    description:
      "Check the lark-connector status: per-app credential configuration, sync state, and (optionally) verification against the Lark API.",
    parameters: {
      verify: {
        type: "boolean",
        description:
          "Whether to verify credentials against the Lark API (network call). Defaults to false.",
      },
      app: {
        type: "string",
        description: "App id to report; defaults to all configured apps.",
      },
    },
    output: {
      schema: {
        type: "object",
        properties: {
          apps: {
            type: "array",
            required: true,
            items: {
              type: "object",
              properties: {
                id: { type: "string", required: true },
                configured: { type: "boolean", required: true },
                appId: { type: "string", required: true },
                brand: { type: "string", required: true },
                cliPath: { type: "string", required: true },
                cliVersion: { type: "string" },
                syncState: { type: "string", required: true },
                message: { type: "string" },
              },
              additionalProperties: false,
            },
            description: "Per-app connector status.",
          },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: "text", text: renderStatus(value as StatusValue) }],
    },
    async execute(args: { verify?: boolean; app?: string }) {
      return await buildStatus(deps, args.verify === true, args.app);
    },
  });
}

/** 组装状态结果：未配置时直接返回本地状态，配置后按需联网验证。 */
async function buildStatus(
  deps: LarkStatusDeps,
  verify: boolean,
  onlyApp: string | undefined,
): Promise<StatusValue> {
  const snapshot = deps.getSnapshot();
  const apps =
    onlyApp === undefined ? snapshot.apps : snapshot.apps.filter((app) => app.entry.id === onlyApp);

  const values: AppStatusValue[] = [];
  for (const app of apps) {
    values.push(await buildAppStatus(app, verify));
  }
  return { apps: values };
}

/** 组装单个应用的状态。 */
async function buildAppStatus(app: AppState, verify: boolean): Promise<AppStatusValue> {
  const { credentials, sync } = app;
  const value: AppStatusValue = {
    id: app.entry.id,
    configured: credentials.appId !== "",
    appId: credentials.appId,
    brand: credentials.brand,
    cliPath: credentials.cliPath === "" ? "(PATH)" : credentials.cliPath,
    syncState: sync.kind,
  };
  if (sync.kind === "error") value.message = sync.message;

  if (credentials.cliPath === "") {
    const probe = await probeLarkCli("lark-cli");
    if (probe !== null) {
      value.cliPath = probe.path;
      if (probe.version !== undefined) value.cliVersion = probe.version;
    }
  }
  if (!value.configured || !verify) return value;

  try {
    const view = await collectAuthStatus(
      credentials.cliPath === "" ? "lark-cli" : credentials.cliPath,
      {
        verify: true,
      },
    );
    if (view.appId !== "") value.appId = view.appId;
  } catch (err) {
    value.message = err instanceof Error ? err.message : String(err);
  }
  return value;
}

/** 把状态渲染为面向模型/用户的文本。 */
function renderStatus(value: StatusValue): string {
  const lines: string[] = [];
  for (const app of value.apps) {
    lines.push(
      `app ${app.id}: configured=${String(app.configured)} appId=${app.appId || "(empty)"} brand=${app.brand} cliPath=${app.cliPath} sync=${app.syncState}`,
    );
    if (app.cliVersion !== undefined) lines.push(`  cliVersion: ${app.cliVersion}`);
    if (app.message !== undefined) lines.push(`  message: ${app.message}`);
  }
  return lines.join("\n");
}
