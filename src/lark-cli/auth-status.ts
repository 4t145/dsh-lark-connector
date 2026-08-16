import { z } from "zod";
import { runLarkCli } from "./cli.ts";

/** auth status --json 中单个身份（bot/user）段。 */
const IdentitySchema = z
  .object({
    status: z.string(),
    available: z.boolean(),
    verified: z.boolean().optional(),
    message: z.string().optional(),
    hint: z.string().optional(),
  })
  .loose();

/** auth status --json 的完整视图（passthrough 容忍未来新增字段）。 */
export const AuthStatusSchema = z
  .object({
    appId: z.string(),
    brand: z.string(),
    identity: z.string(),
    identities: z
      .object({
        bot: IdentitySchema.optional(),
        user: IdentitySchema.optional(),
      })
      .loose(),
    note: z.string().optional(),
  })
  .loose();

/** lark-cli auth status 的结构化视图。 */
export type AuthStatusView = z.infer<typeof AuthStatusSchema>;

/** auth status 的默认超时；--verify 包含一次网络校验。 */
export const DEFAULT_AUTH_STATUS_TIMEOUT_MS = 30_000;

/** 采集 auth status 的选项。 */
export interface AuthStatusOptions {
  /** 是否联网验证凭据（--verify）。 */
  verify: boolean;
}

/**
 * 运行 `lark-cli auth status --json [--verify]` 并解析结果。
 *
 * lark-cli 把"校验失败"作为正常输出返回（exit 0，payload 内携带错误），
 * 因此解析失败或进程级错误才抛异常。
 *
 * @param cliPath lark-cli 可执行文件路径
 * @throws {LarkCliNotFoundError} lark-cli 不存在
 * @throws {LarkCliTimeoutError} 超时
 * @throws {Error} 输出无法解析或进程级失败（带 cause）
 */
export async function collectAuthStatus(
  cliPath: string,
  options: AuthStatusOptions,
): Promise<AuthStatusView> {
  const result = await runLarkCli(cliPath, {
    args: ["auth", "status", "--json", ...(options.verify ? ["--verify"] : [])],
    timeoutMs: DEFAULT_AUTH_STATUS_TIMEOUT_MS,
  });

  let payload: unknown;
  try {
    payload = JSON.parse(result.stdout);
  } catch (err) {
    throw new Error(`unable to parse lark-cli auth status output`, { cause: err });
  }

  const parsed = AuthStatusSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`unexpected lark-cli auth status payload`, { cause: parsed.error });
  }
  return parsed.data;
}
