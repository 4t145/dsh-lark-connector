import type { Context } from "@deepseek-ai/cordis";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { LarkConnectorStatusView } from "./status.ts";

export class LarkConnectorStatusService extends TypertRemoteService {
  private readonly getStatus: () => LarkConnectorStatusView;
  private readonly saveDefaults: (request: {
    workspace: string;
    agentPreset: string;
    modelProvider: string;
    model: string;
    thinkingReaction: boolean;
    streamOutput: boolean;
    showThoughts: boolean;
    showTools: boolean;
  }) => Promise<LarkConnectorStatusView>;

  public constructor(
    ctx: Context,
    getStatus: () => LarkConnectorStatusView,
    saveDefaults: (request: {
      workspace: string;
      agentPreset: string;
      modelProvider: string;
      model: string;
      thinkingReaction: boolean;
      streamOutput: boolean;
      showThoughts: boolean;
      showTools: boolean;
    }) => Promise<LarkConnectorStatusView>,
  ) {
    super(ctx, "larkConnectorStatus", { namespace: "larkConnector" });
    this.getStatus = getStatus;
    this.saveDefaults = saveDefaults;
  }

  public status(): LarkConnectorStatusView {
    return this.getStatus();
  }

  public async setWorkspace(request: {
    workspace: string;
    agentPreset: string;
    modelProvider: string;
    model: string;
    thinkingReaction: boolean;
    streamOutput: boolean;
    showThoughts: boolean;
    showTools: boolean;
  }): Promise<LarkConnectorStatusView> {
    return this.saveDefaults(request);
  }
}
