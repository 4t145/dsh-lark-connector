import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { syncAppCredentials } from "./config-sync.ts";

const FIXTURE = fileURLToPath(new URL("./fixtures/echo-cli.mjs", import.meta.url));

const ERROR_PAYLOAD = JSON.stringify({
  ok: false,
  error: {
    type: "config",
    subtype: "invalid_client",
    code: 20048,
    message: "The specified app does not exist.",
    hint: "run lark-cli config init to set valid app_id and app_secret",
  },
});

afterEach(() => {
  delete process.env["FIXTURE_EXIT"];
  delete process.env["FIXTURE_STDOUT"];
  delete process.env["FIXTURE_STDERR"];
  delete process.env["FIXTURE_OUTPUT_FILE"];
});

describe("syncAppCredentials", () => {
  it("builds config init argv and feeds the secret via stdin, never in argv", async () => {
    const outputDir = mkdtempSync(path.join(tmpdir(), "lark-connector-test-"));
    const echoFile = path.join(outputDir, "echo.json");
    process.env["FIXTURE_OUTPUT_FILE"] = echoFile;

    const outcome = await syncAppCredentials(FIXTURE, {
      appId: "cli_demo_app",
      appSecret: "sekrit-value",
      brand: "feishu",
    });

    expect(outcome).toEqual({ kind: "ok" });

    const echo = JSON.parse(readFileSync(echoFile, "utf8")) as { argv: string[]; stdin: string };
    rmSync(outputDir, { recursive: true, force: true });
    expect(echo.argv).toEqual([
      "config",
      "init",
      "--app-id",
      "cli_demo_app",
      "--app-secret-stdin",
      "--brand",
      "feishu",
    ]);
    // 秘密只允许出现在 stdin，绝不出现在 argv（进程列表可见）。
    expect(echo.argv.join(" ")).not.toContain("sekrit-value");
    expect(echo.stdin).toBe("sekrit-value");
  });

  it("returns invalid with the parsed server message when the app is rejected", async () => {
    process.env["FIXTURE_EXIT"] = "3";
    process.env["FIXTURE_STDOUT"] = ERROR_PAYLOAD;

    const outcome = await syncAppCredentials(FIXTURE, {
      appId: "cli_demo_app",
      appSecret: "sekrit-value",
      brand: "feishu",
    });

    expect(outcome).toEqual({
      kind: "invalid",
      failure: {
        message: "The specified app does not exist.",
        hint: "run lark-cli config init to set valid app_id and app_secret",
      },
    });
  });

  it("returns invalid for empty credentials without spawning", async () => {
    const outcome = await syncAppCredentials("/definitely/missing/lark-cli", {
      appId: "",
      appSecret: "",
      brand: "lark",
    });

    expect(outcome).toEqual({
      kind: "invalid",
      failure: { message: "appId and appSecret must not be empty" },
    });
  });
});
