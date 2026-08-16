import { spawn } from "node:child_process";

/** lark-cli 可执行文件的默认名称，从 PATH 解析。 */
export const DEFAULT_CLI_NAME = "lark-cli";

/**
 * 抑制 lark-cli 的更新/技能通知，保持子进程输出纯净
 * （参见官方 lark-shared skill 的约定）。
 */
const SUPPRESS_NOTIFIER_ENV: Readonly<Record<string, string>> = Object.freeze({
  LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
  LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
});

/** 运行 lark-cli 子进程的参数。 */
export interface RunOptions {
  /** 传给 lark-cli 的参数（不含可执行文件本身）。 */
  args: readonly string[];
  /** 写入 stdin 的内容；app secret 应从这里传入，避免出现在进程列表。 */
  stdin?: string;
  /** 额外注入子进程的环境变量。 */
  env?: Readonly<Record<string, string>>;
  /** 超时毫秒数；超时后强制结束子进程并抛 {@link LarkCliTimeoutError}。 */
  timeoutMs?: number;
}

/** lark-cli 一次运行的结果。非零退出码不是异常，由调用方按命令语义解释。 */
export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** 找不到 lark-cli 可执行文件（spawn ENOENT）时抛出。 */
export class LarkCliNotFoundError extends Error {
  readonly cliPath: string;

  constructor(cliPath: string) {
    super(
      `lark-cli not found at "${cliPath}" — install it via "npx @larksuite/cli@latest install" or set the cliPath config`,
    );
    this.name = "LarkCliNotFoundError";
    this.cliPath = cliPath;
  }
}

/** lark-cli 子进程执行超时。 */
export class LarkCliTimeoutError extends Error {
  readonly cliPath: string;
  readonly timeoutMs: number;

  constructor(cliPath: string, timeoutMs: number) {
    super(`lark-cli "${cliPath}" did not finish within ${String(timeoutMs)}ms`);
    this.name = "LarkCliTimeoutError";
    this.cliPath = cliPath;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * 运行一次 lark-cli 命令并收集完整输出。
 *
 * 进程级失败（ENOENT、超时、spawn 异常）以异常抛出；
 * 命令的业务失败（非零退出码）以 {@link RunResult.exitCode} 返回，由调用方解释。
 *
 * @throws {LarkCliNotFoundError} 可执行文件不存在
 * @throws {LarkCliTimeoutError} 超过 timeoutMs 仍未结束
 * @throws {Error} 其他 spawn/IO 失败（带 cause）
 */
export async function runLarkCli(cliPath: string, options: RunOptions): Promise<RunResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(cliPath, options.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...SUPPRESS_NOTIFIER_ENV, ...(options.env ?? {}) },
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const timeoutMs = options.timeoutMs;
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            child.kill("SIGKILL");
            reject(new LarkCliTimeoutError(cliPath, timeoutMs));
          }, timeoutMs);

    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(new LarkCliNotFoundError(cliPath));
      } else {
        reject(err);
      }
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        // 子进程被信号杀死时 code 为 null，按惯例记为 -1。
        exitCode: code ?? -1,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });

    if (options.stdin !== undefined) child.stdin.write(options.stdin);
    child.stdin.end();
  });
}
