import { runLarkCli } from "./cli.ts";

/** 探测到的 lark-cli 信息。 */
export interface LarkCliInfo {
  /** 实际使用的可执行文件（配置路径或 PATH 解析名）。 */
  path: string;
  /** `lark-cli --version` 的首行输出（如 `lark-cli version 1.0.72`），探测失败时缺省。 */
  version?: string;
}

/**
 * 探测 lark-cli 是否可用并取版本号。
 * 探测失败（未安装、不可执行）返回 null，不抛异常——调用方用其呈现降级信息。
 *
 * @param cliPath 要探测的可执行文件（可为 PATH 上的名称）
 */
export async function probeLarkCli(cliPath: string): Promise<LarkCliInfo | null> {
  try {
    const result = await runLarkCli(cliPath, { args: ["--version"] });
    const version = firstLine(result.stdout) ?? firstLine(result.stderr);
    const info: LarkCliInfo = { path: cliPath };
    if (version !== undefined) info.version = version;
    return info;
  } catch {
    return null;
  }
}

/** 取文本首行；空文本返回 null。 */
function firstLine(text: string): string | undefined {
  const line = text
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry !== "");
  return line;
}
