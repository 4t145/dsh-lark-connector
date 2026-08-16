import { defineTool } from "@deepseek-ai/dsh-tools";
import { checkSetup, runOfficialInstall } from "../lark-cli/setup.ts";
import type { SetupStatus } from "../lark-cli/setup.ts";

/** lark_setup 工具返回的结构化结果。 */
interface SetupValue {
  cliInstalled: boolean;
  cliVersion?: string;
  skillsInstalled: boolean;
  skillsCount: number;
  message: string;
}

/**
 * 构造 lark_setup 工具：检测（并可一键安装）lark-cli 与其官方 Agent Skills。
 * 安装会写全局（npm 全局包 + ~/.agents/skills），agent 调用前应告知用户。
 */
export function larkSetupTool() {
  return defineTool({
    name: "lark_setup",
    description:
      "Check whether lark-cli and its official Agent Skills are installed; optionally run the official one-command installer (npx @larksuite/cli@latest install) when missing.",
    parameters: {
      install: {
        type: "boolean",
        description:
          "Whether to install when missing: installs lark-cli globally and writes skills to ~/.agents/skills (network + user-level writes). Defaults to false (check only).",
      },
    },
    output: {
      schema: {
        type: "object",
        properties: {
          cliInstalled: {
            type: "boolean",
            required: true,
            description: "Whether lark-cli resolves on PATH.",
          },
          cliVersion: { type: "string", description: "lark-cli version line when installed." },
          skillsInstalled: {
            type: "boolean",
            required: true,
            description: "Whether lark-* skills are present in DSH discovery directories.",
          },
          skillsCount: {
            type: "integer",
            required: true,
            description: "Number of lark-* skills found.",
          },
          message: { type: "string", required: true, description: "Human-readable summary." },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: "text", text: renderSetup(value) }],
    },
    async execute(args: { install?: boolean }) {
      if (args.install === true) {
        return buildValue(
          await runOfficialInstall(),
          "installed via npx @larksuite/cli@latest install",
        );
      }
      return buildValue(await checkSetup(), "");
    },
  });
}

/** 组装工具结果。 */
function buildValue(status: SetupStatus, actionNote: string): SetupValue {
  const value: SetupValue = {
    cliInstalled: status.cli !== null,
    skillsInstalled: status.skillsCount > 0,
    skillsCount: status.skillsCount,
    message: "",
  };
  if (status.cli?.version !== undefined) value.cliVersion = status.cli.version;

  const parts: string[] = [];
  parts.push(
    value.cliInstalled
      ? `lark-cli installed (${value.cliVersion ?? "version unknown"})`
      : "lark-cli NOT installed",
  );
  parts.push(
    value.skillsInstalled
      ? `${String(value.skillsCount)} lark-* skills available to the agent`
      : "no lark-* skills in DSH discovery directories",
  );
  if (actionNote !== "") parts.push(actionNote);
  value.message = parts.join("; ");
  return value;
}

/** 把结果渲染为面向模型/用户的文本。 */
function renderSetup(value: SetupValue): string {
  return value.message;
}
