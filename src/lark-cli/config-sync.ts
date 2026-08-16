import { z } from "zod";
import type { Brand } from "../brand.ts";
import { runLarkCli } from "./cli.ts";

/** config init 失败时 stdout 中的错误负载（safeParse，属于 schema 校验边界）。 */
const InitErrorPayloadSchema = z
  .object({
    ok: z.literal(false),
    error: z.object({
      message: z.string(),
      hint: z.string().optional(),
    }),
  })
  .loose();

/** 从 config init 输出中解析出的失败原因。 */
export interface SyncFailure {
  message: string;
  hint?: string;
}

/** 同步的输入凭据。 */
export interface SyncCredentials {
  appId: string;
  appSecret: string;
  brand: Brand;
  /** lark-cli 命名 profile（config init --name）；多应用并存时用于区分。 */
  profile?: string;
}

/** 同步结果：ok 或 invalid（凭据被飞书服务端拒绝，如 app 不存在）。 */
export type SyncOutcome = { kind: "ok" } | { kind: "invalid"; failure: SyncFailure };

/** config init 的默认超时：其包含一次对飞书服务端的凭据校验。 */
export const DEFAULT_SYNC_TIMEOUT_MS = 30_000;

/**
 * 把插件配置的 app 凭据同步进 lark-cli 的本地配置。
 *
 * 秘密通过 stdin 传入（--app-secret-stdin），不进入进程列表；
 * 该命令会先本地落盘（秘密以掩码存储），再联网校验凭据。
 * 校验失败时退出码非零，但配置已写入——调用方决定如何呈现。
 *
 * @param cliPath lark-cli 可执行文件路径
 * @param creds 要同步的凭据（appId/appSecret 必须非空）
 * @throws {LarkCliNotFoundError} lark-cli 不存在
 * @throws {LarkCliTimeoutError} 超时
 * @throws {Error} 其他进程级失败
 */
export async function syncAppCredentials(
  cliPath: string,
  creds: SyncCredentials,
): Promise<SyncOutcome> {
  if (creds.appId === "" || creds.appSecret === "") {
    return { kind: "invalid", failure: { message: "appId and appSecret must not be empty" } };
  }

  const args = [
    "config",
    "init",
    "--app-id",
    creds.appId,
    "--app-secret-stdin",
    "--brand",
    creds.brand,
  ];
  if (creds.profile !== undefined) args.push("--name", creds.profile);

  const result = await runLarkCli(cliPath, {
    args,
    stdin: creds.appSecret,
    timeoutMs: DEFAULT_SYNC_TIMEOUT_MS,
  });

  if (result.exitCode === 0) return { kind: "ok" };

  const failure = parseInitError(result.stdout) ?? {
    message:
      lastNonEmptyLine([result.stderr, result.stdout]) ??
      `lark-cli config init exited with ${String(result.exitCode)}`,
  };
  return { kind: "invalid", failure };
}

/** 从 config init 的 stdout 解析错误负载；无法解析时返回 null。 */
function parseInitError(stdout: string): SyncFailure | null {
  if (stdout === "") return null;
  let payload: unknown;
  try {
    payload = JSON.parse(stdout);
  } catch {
    return null;
  }
  const parsed = InitErrorPayloadSchema.safeParse(payload);
  if (!parsed.success) return null;
  const error = parsed.data.error;
  const failure: SyncFailure = { message: error.message };
  if (error.hint !== undefined) failure.hint = error.hint;
  return failure;
}

/** 取若干文本中最末一个非空行（config init 的普通输出常以错误摘要结尾）。 */
function lastNonEmptyLine(texts: readonly string[]): string | null {
  for (const text of texts) {
    const line = text
      .split("\n")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "")
      .at(-1);
    if (line !== undefined) return line;
  }
  return null;
}
