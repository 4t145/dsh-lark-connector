import type { CredentialProvider, CredentialRef } from "@deepseek-ai/dsh-credentials";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import type { AppEntry } from "./config.ts";
import { BRANDS } from "./brand.ts";
import type { Brand } from "./brand.ts";

/** 默认应用的 appId 引用名（同时也是环境变量名）。 */
export const LARK_APP_ID_REF = "LARK_APP_ID" as const;
/** 默认应用的 appSecret 引用名。 */
export const LARK_APP_SECRET_REF = "LARK_APP_SECRET" as const;
/** 默认应用的 brand 引用名。 */
export const LARK_BRAND_REF = "LARK_BRAND" as const;
/** 默认应用的 lark-cli 路径引用名；未配置时从 PATH 解析。 */
export const LARK_CLI_PATH_REF = "LARK_CLI_PATH" as const;

/** 解析后的应用凭据快照（空串 = 未配置）。 */
export interface LarkCredentials {
  appId: string;
  appSecret: string;
  brand: Brand;
  cliPath: string;
}

/** 未配置任何凭据时的默认快照。 */
export const EMPTY_CREDENTIALS: Readonly<LarkCredentials> = Object.freeze({
  appId: "",
  appSecret: "",
  brand: "feishu",
  cliPath: "",
});

/**
 * 按应用的引用组从 credentials 服务解析凭据快照。
 * 空值视为未配置；brand 取配置值或默认；cliPath 留空表示 PATH 解析。
 * 继承环境变量（与引用同名）自动生效且优先级最高——由 credentials 提供者保证。
 *
 * @param credentials credentials 服务（注入的 ctx.credentials）
 * @param entry 应用条目（决定读取哪些引用）
 * @throws {Error} resolve 失败时向上传播（带 cause）
 */
export async function resolveAppCredentials(
  credentials: CredentialProvider,
  entry: AppEntry,
): Promise<LarkCredentials> {
  const refs = [
    credentialRef(entry.appIdRef),
    credentialRef(entry.appSecretRef),
    credentialRef(entry.brandRef),
    credentialRef(entry.cliPathRef),
  ] as const;
  const values = await Promise.all(
    refs.map(async (ref) => {
      const resolved = await credentials.resolve(ref);
      return resolved?.value ?? "";
    }),
  );
  const appId = values[0] ?? "";
  const appSecret = values[1] ?? "";
  const brandValue = values[2] ?? "";
  const cliPath = values[3] ?? "";
  return {
    appId,
    appSecret,
    brand: isBrand(brandValue) ? brandValue : EMPTY_CREDENTIALS.brand,
    cliPath,
  };
}

/** 判定字符串是否为合法 brand。 */
function isBrand(value: string): value is Brand {
  return (BRANDS as readonly string[]).includes(value);
}

/** 应用条目引用组的类型导出（供客户端常量对齐）。 */
export type { CredentialRef };
