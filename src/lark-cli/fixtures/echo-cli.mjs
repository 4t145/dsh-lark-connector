#!/usr/bin/env node
// 测试 fixture：可直接执行（shebang）。把收到的 argv 与 stdin 原样输出为 JSON；
// 可通过环境变量配置退出码、stderr、固定 stdout 负载，以及把回显写入文件。
import { writeFileSync } from "node:fs";

const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  const delayMs = process.env.FIXTURE_DELAY_MS;
  if (delayMs !== undefined) {
    // 延迟期间保持进程存活（不可 unref，否则事件循环空转导致进程提前退出）。
    setTimeout(finish, Number.parseInt(delayMs, 10));
    return;
  }
  finish();
});

function finish() {
  const echo = JSON.stringify({
    argv: process.argv.slice(2),
    stdin: Buffer.concat(chunks).toString("utf8"),
  });
  const outputFile = process.env.FIXTURE_OUTPUT_FILE;
  if (outputFile !== undefined) writeFileSync(outputFile, echo);
  if (process.env.FIXTURE_STDOUT !== undefined) {
    process.stdout.write(process.env.FIXTURE_STDOUT);
  } else {
    process.stdout.write(echo);
  }
  if (process.env.FIXTURE_STDERR !== undefined) process.stderr.write(process.env.FIXTURE_STDERR);
  const exitCode = process.env.FIXTURE_EXIT;
  process.exitCode = exitCode === undefined ? 0 : Number.parseInt(exitCode, 10);
}
