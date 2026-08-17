import { installModelSelection } from "@deepseek-ai/dsh-agent";
import type { Agent, AgentHandle } from "@deepseek-ai/dsh-agent";
import "@deepseek-ai/dsh-agent-default-model";
import "@deepseek-ai/dsh-agent-presets";
import "@deepseek-ai/dsh-session-persistence";
import "@deepseek-ai/dsh-session-title";
import "@deepseek-ai/dsh-workspace";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { Context } from "@deepseek-ai/cordis";
import type { SessionEvent } from "@deepseek-ai/dsh-session/types";
import type { MessageBridgeConfig } from "../config.ts";
import { assistantTextAfter, turnFailureAfter } from "./assistant-output.ts";
import { larkChatSessionId } from "./session-id.ts";

export class AgentTurnError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AgentTurnError";
  }
}

interface SessionRuntime {
  agent: Agent;
  ownedHandle: AgentHandle | null;
  queue: Promise<void>;
  running: boolean;
  lastActivityAt: number;
}

export interface AgentSessionView {
  chatId: string;
  sessionId: string;
  running: boolean;
  lastActivityAt: number;
}

export class AgentSessionRouter {
  private readonly runtimes = new Map<string, SessionRuntime>();
  private readonly creating = new Map<string, Promise<SessionRuntime>>();
  private readonly ctx: Context;
  private readonly appId: string;
  private readonly config: MessageBridgeConfig;

  public constructor(ctx: Context, appId: string, config: MessageBridgeConfig) {
    this.ctx = ctx;
    this.appId = appId;
    this.config = config;
  }

  public async run(
    chatId: string,
    text: string,
    title?: string,
    onEvent?: (event: SessionEvent) => void,
  ): Promise<string> {
    const runtime = await this.getRuntime(chatId);
    if (title !== undefined && title !== "")
      this.ctx.sessionTitle.rename(runtime.agent.session, title);
    runtime.lastActivityAt = Date.now();
    const output = runtime.queue.then(async () => {
      runtime.running = true;
      try {
        return await this.runTurn(runtime.agent, text, onEvent);
      } finally {
        runtime.running = false;
        runtime.lastActivityAt = Date.now();
      }
    });
    runtime.queue = output.then(
      () => undefined,
      () => undefined,
    );
    return output;
  }

  public snapshot(): AgentSessionView[] {
    return [...this.runtimes.entries()]
      .map(([chatId, runtime]) => ({
        chatId,
        sessionId: runtime.agent.session.id,
        running: runtime.running,
        lastActivityAt: runtime.lastActivityAt,
      }))
      .sort((left, right) => right.lastActivityAt - left.lastActivityAt);
  }

  public dispose(): void {
    for (const runtime of this.runtimes.values()) {
      if (runtime.ownedHandle !== null) void runtime.ownedHandle.dispose();
    }
    this.runtimes.clear();
    this.creating.clear();
  }

  private async getRuntime(chatId: string): Promise<SessionRuntime> {
    const existing = this.runtimes.get(chatId);
    if (
      existing !== undefined &&
      this.ctx.agents.get(existing.agent.id) === existing.agent &&
      !this.ctx.workspaceRegistry.archivedSessionIds.includes(existing.agent.id)
    )
      return existing;
    if (existing !== undefined) this.runtimes.delete(chatId);
    const inFlight = this.creating.get(chatId);
    if (inFlight !== undefined) return inFlight;
    const creating = this.createRuntime(chatId);
    this.creating.set(chatId, creating);
    try {
      return await creating;
    } finally {
      this.creating.delete(chatId);
    }
  }

  private async createRuntime(chatId: string): Promise<SessionRuntime> {
    const workspacePath = this.workspacePath();
    const baseSessionId = larkChatSessionId(this.appId, chatId, workspacePath);
    const sessionId = this.ctx.workspaceRegistry.archivedSessionIds.includes(baseSessionId)
      ? larkChatSessionId(this.appId, chatId, workspacePath, String(Date.now()))
      : baseSessionId;
    const live = this.ctx.agents.get(sessionId);
    if (live !== undefined) {
      await this.attachToWorkspace(live);
      return this.publishRuntime(chatId, live, null);
    }

    const currentSelection = this.ctx.agentDefaultModel.currentSelection();
    const selection = {
      provider:
        this.config.modelProvider === "" ? currentSelection.provider : this.config.modelProvider,
      model: this.config.model === "" ? currentSelection.model : this.config.model,
    };
    const setup = async (agentCtx: Context): Promise<void> => {
      installModelSelection(agentCtx, { current: selection, assembled: undefined });
      await this.ctx.agentPresets.mount(
        agentCtx,
        this.config.agentPreset === "" ? undefined : this.config.agentPreset,
      );
    };
    const persisted = (await this.ctx.sessionPersistence.list()).some(
      (header) => header.id === sessionId,
    );
    const options = {
      agentOptions: { provider: selection.provider, model: selection.model },
      setup,
    };

    try {
      const handle = persisted
        ? await this.ctx.agents.resume({ ...options, resumeSessionId: sessionId })
        : await this.ctx.agents.create({
            ...options,
            sessionId,
            meta: {
              cwd: this.workspacePath(),
              ...(this.config.agentPreset === "" ? {} : { agentPreset: this.config.agentPreset }),
            },
          });
      await handle.agent.whenIdle();
      await this.attachToWorkspace(handle.agent);
      return this.publishRuntime(chatId, handle.agent, handle);
    } catch (error) {
      const published = this.ctx.agents.get(sessionId);
      if (published === undefined) throw error;
      await this.attachToWorkspace(published);
      return this.publishRuntime(chatId, published, null);
    }
  }

  private publishRuntime(
    chatId: string,
    agent: Agent,
    ownedHandle: AgentHandle | null,
  ): SessionRuntime {
    const runtime = {
      agent,
      ownedHandle,
      queue: Promise.resolve(),
      running: false,
      lastActivityAt: Date.now(),
    };
    this.runtimes.set(chatId, runtime);
    return runtime;
  }

  private workspacePath(): string {
    if (this.config.workspace !== "") return this.config.workspace;
    if (this.config.cwd !== "") return this.config.cwd;
    return process.cwd();
  }

  private async attachToWorkspace(agent: Agent): Promise<void> {
    const workspace = await this.ctx.workspaceRegistry.create(this.workspacePath());
    await workspace.attachSession(agent.id);
  }

  private async runTurn(
    agent: Agent,
    text: string,
    onEvent?: (event: SessionEvent) => void,
  ): Promise<string> {
    const firstSeq = agent.session.seq;
    const stop =
      onEvent === undefined
        ? undefined
        : agent.ctx.on("session/event", (session, event) => {
            if (session === agent.session && event.seq >= firstSeq) onEvent(event);
          });
    try {
      agent.followup(
        createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } }),
      );
      await agent.whenIdle();
      await this.ctx.sessions.flush(agent.session);
      const failure = turnFailureAfter(agent.session.events, firstSeq);
      if (failure !== undefined) throw new AgentTurnError(failure);
      return assistantTextAfter(agent.session.events, firstSeq);
    } finally {
      stop?.();
    }
  }
}
