import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { probeLarkCli } from "./cli-probe.ts";
import type { LarkCliInfo } from "./cli-probe.ts";
import { runLarkCli } from "./cli.ts";

/** 官方一键安装命令：全局安装 lark-cli 并把最新 skills 装进 ~/.agents/skills。 */
const OFFICIAL_INSTALL_COMMAND: readonly string[] = [
  "npx",
  "-y",
  "@larksuite/cli@latest",
  "install",
];

/** 官方安装的超时：包含 npm 下载与全局安装。 */
export const DEFAULT_INSTALL_TIMEOUT_MS = 5 * 60_000;

/** skill 发现目录：DSH 扫描 $DSH_HOME/skills 与 ~/.agents/skills。 */
const DSH_SKILL_HOME = path.join(homedir(), ".dsh", "skills");
const AGENTS_SKILL_HOME = path.join(homedir(), ".agents", "skills");

/** 安装探测结果。 */
export interface SetupStatus {
  cli: LarkCliInfo | null;
  /** 发现的 lark-* skill 数量（跨 DSH 发现目录合计）。 */
  skillsCount: number;
}

/**
 * 探测 lark-cli 与 lark-* skills 的安装状态（只读，不触发安装）。
 */
export async function checkSetup(): Promise<SetupStatus> {
  const cli = await probeLarkCli("lark-cli");
  return { cli, skillsCount: countLarkSkills() };
}

/**
 * 运行官方一键安装（npx @larksuite/cli@latest install）。
 * 全局安装 lark-cli 并写入 ~/.agents/skills，属用户级写操作，调用方应知会用户。
 *
 * @throws {LarkCliNotFoundError} npx 不可用
 * @throws {LarkCliTimeoutError} 安装超时
 * @throws {Error} 其他进程级失败
 */
export async function runOfficialInstall(): Promise<SetupStatus> {
  await runLarkCli(OFFICIAL_INSTALL_COMMAND[0] ?? "npx", {
    args: OFFICIAL_INSTALL_COMMAND.slice(1),
    timeoutMs: DEFAULT_INSTALL_TIMEOUT_MS,
  });
  return await checkSetup();
}

/** 统计 DSH 发现目录下的 lark-* skill 数量。 */
function countLarkSkills(): number {
  const dirs = [DSH_SKILL_HOME, AGENTS_SKILL_HOME];
  const names = new Set<string>();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith("lark-")) names.add(entry);
    }
  }
  return names.size;
}
