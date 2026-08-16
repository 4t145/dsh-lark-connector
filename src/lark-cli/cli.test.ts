import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LarkCliNotFoundError, LarkCliTimeoutError, runLarkCli } from "./cli.ts";

const FIXTURE = fileURLToPath(new URL("./fixtures/echo-cli.mjs", import.meta.url));

describe("runLarkCli", () => {
  it("passes args and stdin through, returns stdout/stderr/exitCode", async () => {
    const result = await runLarkCli(process.execPath, {
      args: [FIXTURE, "config", "init", "--app-id", "cli_dummy"],
      stdin: "super-secret",
    });

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as { argv: string[]; stdin: string };
    expect(payload.argv).toEqual(["config", "init", "--app-id", "cli_dummy"]);
    expect(payload.stdin).toBe("super-secret");
    expect(result.stderr).toBe("");
  });

  it("reports a non-zero exit code without throwing", async () => {
    const result = await runLarkCli(process.execPath, {
      args: [FIXTURE],
      env: { FIXTURE_EXIT: "3" },
    });

    expect(result.exitCode).toBe(3);
  });

  it("throws LarkCliNotFoundError when the binary does not exist", async () => {
    await expect(runLarkCli("/nonexistent/lark-cli", { args: [] })).rejects.toBeInstanceOf(
      LarkCliNotFoundError,
    );
  });

  it("throws LarkCliTimeoutError when the process exceeds the timeout", async () => {
    await expect(
      runLarkCli(process.execPath, {
        args: [FIXTURE],
        timeoutMs: 100,
        env: { FIXTURE_DELAY_MS: "1000" },
      }),
    ).rejects.toBeInstanceOf(LarkCliTimeoutError);
  });
});
