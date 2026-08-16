import { useEffect, useState, useSyncExternalStore } from "react";
import type { ChangeEvent } from "react";
import { Button, Input } from "@deepseek-ai/dsh-client-ui-primitives";
import type { IApiClient } from "@deepseek-ai/dsh-api-remotes/client";
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { SettingsSectionOwnerProps } from "@deepseek-ai/dsh-client-ui-settings/client";
import type { RemoteResult, TypertClientRemote } from "@deepseek-ai/dsh-typert-protocol";
import type { LarkConnectorStatusView } from "../status.ts";
import { en, zh } from "./locales.ts";
import type { LarkConnectorLocaleKey } from "./locales.ts";
import { TYPERT_REMOTE } from "./typert.remote-client.ts";

export const name = "lark-connector-client";
export const inject = ["connection", "slots", "remote", "locale"];
const APP_ID_REF = "LARK_APP_ID";
const APP_SECRET_REF = "LARK_APP_SECRET";
const BRAND_REF = "LARK_BRAND";
const CLI_PATH_REF = "LARK_CLI_PATH";
const REFS: readonly string[] = [APP_ID_REF, APP_SECRET_REF, BRAND_REF, CLI_PATH_REF];
const LOCALE_NAMESPACE = "lark-connector";
const FEISHU_LOGO =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"%3E%3Cpath fill="%2300D6B9" d="M6 28.5 22 12v11L11 34z"/%3E%3Cpath fill="%23337EFF" d="m22 12 20 12-20 12V25l9-1-9-6z"/%3E%3Cpath fill="%237F6BFF" d="M11 34l11-9v11l-7 4z"/%3E%3Cpath fill="%2300B8F0" d="m22 12-7-4-9 8 16 7z"/%3E%3C/svg%3E';

interface RefState {
  configured: boolean;
  source?: string;
  writable: boolean;
}
interface LocaleFace {
  bind: (namespace: string) => (key: LarkConnectorLocaleKey) => string;
  register: (namespace: string, dictionaries: { zh: typeof zh; en: typeof en }) => () => void;
  getSnapshot: () => { revision: number };
  subscribe: (listener: () => void) => () => void;
}

interface LarkConnectorSectionFace {
  api: IApiClient;
  t: (key: LarkConnectorLocaleKey) => string;
  locale: {
    getSnapshot: () => { revision: number };
    subscribe: (listener: () => void) => () => void;
  };
  getStatus: () => Promise<LarkConnectorStatusView>;
  setWorkspace: (request: {
    workspace: string;
    agentPreset: string;
    modelProvider: string;
    model: string;
  }) => Promise<LarkConnectorStatusView>;
}
interface LarkClientContext extends ClientContext {
  connection: { api: IApiClient };
  remote: TypertClientRemote;
}

interface LarkStatusRemote {
  status: () => Promise<RemoteResult<LarkConnectorStatusView>>;
  setWorkspace: (request: {
    workspace: string;
    agentPreset: string;
    modelProvider: string;
    model: string;
  }) => Promise<RemoteResult<LarkConnectorStatusView>>;
}

function sourceLabel(
  source: string | undefined,
  t: (key: LarkConnectorLocaleKey) => string,
): string {
  switch (source) {
    case "env":
      return t("sourceEnvVar");
    case "file":
      return t("sourceLocal");
    case "project-env":
    case "user-env":
      return t("sourceEnv");
    default:
      return source ?? t("sourceUnknown");
  }
}

export function apply(ctx: LarkClientContext) {
  const locale = ctx.get("locale") as LocaleFace;
  const t = locale.bind(LOCALE_NAMESPACE);
  ctx.effect(
    () => locale.register(LOCALE_NAMESPACE, { zh, en }),
    "lark-connector: locale dictionaries",
  );
  const remoteReady = ctx.remote.$mount(TYPERT_REMOTE).then(() => {
    const namespace: unknown = ctx.get("remote.larkConnector");
    return resolveLarkStatusRemote(namespace);
  });
  const api = ctx.connection.api;
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "lark-connector",
        order: 30,
        label: () => t("title"),
        inject: (): LarkConnectorSectionFace => ({
          api,
          t,
          locale: {
            getSnapshot: () => locale.getSnapshot(),
            subscribe: (listener) => locale.subscribe(listener),
          },
          getStatus: async () => {
            const result = await (await remoteReady).status();
            if (!result.ok) throw new Error(result.error.message);
            return result.value;
          },
          setWorkspace: async (request) => {
            const result = await (await remoteReady).setWorkspace(request);
            if (!result.ok) throw new Error(result.error.message);
            return result.value;
          },
        }),
      },
      LarkConnectorSection,
    ),
  );
}

function isLarkStatusRemote(value: unknown): value is LarkStatusRemote {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "status") === "function" &&
    typeof Reflect.get(value, "setWorkspace") === "function"
  );
}

function resolveLarkStatusRemote(value: unknown): LarkStatusRemote {
  if (isLarkStatusRemote(value)) return value;
  throw new Error("lark-connector-client: status remote failed to mount");
}

function LarkConnectorSection(props: LarkConnectorSectionFace & SettingsSectionOwnerProps) {
  const { api, getStatus, setWorkspace, t, locale } = props;
  useSyncExternalStore(locale.subscribe, locale.getSnapshot, locale.getSnapshot);
  const [status, setStatus] = useState<LarkConnectorStatusView | undefined>();
  const [statusError, setStatusError] = useState<string | undefined>();
  const [refs, setRefs] = useState<Readonly<Record<string, RefState>> | undefined>();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [defaultsDraft, setDefaultsDraft] = useState<{
    workspace: string;
    agentPreset: string;
    modelProvider: string;
    model: string;
  }>();
  const [presets, setPresets] = useState<readonly { id: string; name?: string; broken?: string }[]>(
    [],
  );
  const [modelGroups, setModelGroups] = useState<
    readonly { id: string; name: string; models: readonly { id: string; name: string }[] }[]
  >([]);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);

  const loadCredentials = async (): Promise<void> => {
    try {
      const response = await api.credentials.describe({ refs: [...REFS] });
      if (response.result.ok) setRefs(response.result.value.credentials);
    } catch {
      // Keep the form editable while the host reconnects.
    }
  };
  const loadStatus = async (): Promise<void> => {
    try {
      const next = await getStatus();
      setStatus(next);
      setDefaultsDraft(
        (current) =>
          current ?? {
            workspace: next.workspaceConfigured ? next.workspace : "",
            agentPreset: next.agentPreset,
            modelProvider: next.modelProvider,
            model: next.model,
          },
      );
      setStatusError(undefined);
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    void loadCredentials();
    void loadStatus();
    void api.agentPresets.list({}).then((response) => {
      if (response.result.ok) setPresets(response.result.value.presets);
    });
    void api.llm.models({}).then((response) => {
      if (response.result.ok) setModelGroups(response.result.value.groups);
    });
    const timer = window.setInterval(() => void loadStatus(), 3000);
    return () => {
      window.clearInterval(timer);
    };
  }, [api, getStatus]);

  const saveWorkspace = async (): Promise<void> => {
    setWorkspaceSaving(true);
    try {
      if (defaultsDraft === undefined) return;
      const next = await setWorkspace(defaultsDraft);
      setStatus(next);
      setDefaultsDraft({
        workspace: next.workspaceConfigured ? next.workspace : "",
        agentPreset: next.agentPreset,
        modelProvider: next.modelProvider,
        model: next.model,
      });
      setStatusError(undefined);
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : String(error));
    } finally {
      setWorkspaceSaving(false);
    }
  };

  const save = async (): Promise<void> => {
    for (const [ref, draft] of Object.entries(drafts)) {
      const value = draft.trim();
      if (value !== "") await api.credentials.set({ ref, value });
      else await api.credentials.unset({ ref });
    }
    setDrafts({});
    setSaved(true);
    await loadCredentials();
    await loadStatus();
    window.setTimeout(() => {
      setSaved(false);
    }, 2000);
  };

  const statusOf = (ref: string): string => {
    const state = refs?.[ref];
    if (state?.configured === true)
      return state.source === "env" ? t("configuredFromEnv") : t("configured");
    return t("notConfigured");
  };
  const field = (
    ref: string,
    label: LarkConnectorLocaleKey,
    placeholder: string,
    secret = false,
  ) => {
    const state = refs?.[ref];
    return (
      <label style={fieldStyle}>
        <span style={labelStyle}>{t(label)}</span>
        <Input
          value={drafts[ref] ?? ""}
          type={secret ? "password" : "text"}
          placeholder={placeholder}
          disabled={state?.writable === false}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            setDrafts((current) => ({ ...current, [ref]: event.target.value }));
          }}
        />
        <small style={mutedStyle}>
          {statusOf(ref)}
          {state?.source === undefined ? "" : " · " + sourceLabel(state.source, t)}
        </small>
      </label>
    );
  };

  const savedPresetMissing =
    defaultsDraft?.agentPreset !== undefined &&
    defaultsDraft.agentPreset !== "" &&
    !presets.some((preset) => preset.id === defaultsDraft.agentPreset);
  const selectedModelValue =
    defaultsDraft !== undefined && defaultsDraft.modelProvider !== "" && defaultsDraft.model !== ""
      ? JSON.stringify([defaultsDraft.modelProvider, defaultsDraft.model])
      : "";
  const savedModelMissing =
    selectedModelValue !== "" &&
    !modelGroups.some(
      (group) =>
        group.id === defaultsDraft?.modelProvider &&
        group.models.some((model) => model.id === defaultsDraft.model),
    );

  return (
    <div style={pageStyle}>
      <header>
        <div style={titleStyle}>
          <img src={FEISHU_LOGO} alt="" width={28} height={28} />
          <h3 style={{ margin: 0 }}>{t("title")}</h3>
        </div>
        <p style={mutedStyle}>{t("description")}</p>
        {status === undefined ? null : (
          <p style={mutedStyle}>
            {t("workspace")}：{status.workspace}
            {status.workspaceConfigured ? "" : "（" + t("inheritedWorkspace") + "）"}
          </p>
        )}
      </header>
      <section style={sectionStyle}>
        <h4 style={{ margin: 0 }}>{t("defaultsTitle")}</h4>
        {status === undefined ? null : (
          <div style={savedConfigStyle}>
            <strong>{t("saved")}</strong>
            <span>
              {t("workspace")}：{status.workspace}
              {status.workspaceConfigured ? "" : "（" + t("inheritedWorkspace") + "）"}
            </span>
            <span>
              {t("agentPreset")}：{status.agentPreset || t("inheritPreset")}
            </span>
            <span>
              {t("model")}：
              {status.modelProvider !== "" && status.model !== ""
                ? status.modelProvider + " / " + status.model
                : t("inheritModel")}
            </span>
          </div>
        )}
        <label style={fieldStyle}>
          <span style={labelStyle}>Workspace</span>
          <Input
            value={defaultsDraft?.workspace ?? ""}
            placeholder={status?.workspace ?? t("workspacePlaceholder")}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setDefaultsDraft((current) => ({
                workspace: event.target.value,
                agentPreset: current?.agentPreset ?? "",
                modelProvider: current?.modelProvider ?? "",
                model: current?.model ?? "",
              }));
            }}
          />
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>{t("agentPreset")}</span>
          <select
            style={selectStyle}
            value={defaultsDraft?.agentPreset ?? ""}
            onChange={(event) => {
              setDefaultsDraft((current) => ({
                workspace: current?.workspace ?? "",
                agentPreset: event.target.value,
                modelProvider: current?.modelProvider ?? "",
                model: current?.model ?? "",
              }));
            }}
          >
            <option value="">{t("inheritPreset")}</option>
            {savedPresetMissing ? (
              <option value={defaultsDraft.agentPreset}>
                {defaultsDraft.agentPreset}（{t("unavailable")}）
              </option>
            ) : null}
            {presets
              .filter((preset) => preset.broken === undefined)
              .map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name ?? preset.id}
                </option>
              ))}
          </select>
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>{t("model")}</span>
          <select
            style={selectStyle}
            value={selectedModelValue}
            onChange={(event) => {
              const parsed: unknown =
                event.target.value === "" ? ["", ""] : JSON.parse(event.target.value);
              const [modelProvider = "", model = ""] = Array.isArray(parsed)
                ? parsed.filter((value): value is string => typeof value === "string")
                : ["", ""];
              setDefaultsDraft((current) => ({
                workspace: current?.workspace ?? "",
                agentPreset: current?.agentPreset ?? "",
                modelProvider,
                model,
              }));
            }}
          >
            <option value="">{t("inheritModel")}</option>
            {savedModelMissing ? (
              <option value={selectedModelValue}>
                {defaultsDraft?.modelProvider} / {defaultsDraft?.model}（{t("unavailable")}）
              </option>
            ) : null}
            {modelGroups.flatMap((group) =>
              group.models.map((model) => (
                <option
                  key={JSON.stringify([group.id, model.id])}
                  value={JSON.stringify([group.id, model.id])}
                >
                  {group.name} / {model.name}
                </option>
              )),
            )}
          </select>
        </label>
        <small style={mutedStyle}>{t("defaultsHint")}</small>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button
            variant="primary"
            disabled={workspaceSaving || defaultsDraft === undefined}
            onClick={() => void saveWorkspace()}
          >
            {workspaceSaving ? t("saving") : t("saveDefaults")}
          </Button>
        </div>
      </section>
      <section style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <h4 style={{ margin: 0 }}>{t("connectionStatus")}</h4>
          <Button variant="outline" onClick={() => void loadStatus()}>
            {t("refresh")}
          </Button>
        </div>
        {statusError === undefined ? null : <p style={errorStyle}>{statusError}</p>}
        {status?.apps.map((app) => (
          <div key={app.appEntryId} style={rowStyle}>
            <span style={dotStyle(app.state)} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <strong>
                {app.brand === "feishu" ? t("feishu") : "Lark"} · {app.appEntryId}
              </strong>
              <div style={mutedStyle}>
                {connectionLabel(app.state, t)} · {t("received")} {app.receivedCount} ·{" "}
                {t("handled")} {app.acceptedCount}
              </div>
              {app.lastError === null ? null : <div style={errorStyle}>{app.lastError}</div>}
            </div>
          </div>
        )) ?? <div style={mutedStyle}>{t("loadingStatus")}</div>}
      </section>
      <section style={sectionStyle}>
        <h4 style={{ margin: 0 }}>{t("credentials")}</h4>
        {field(APP_ID_REF, "appId", "cli_xxx")}
        {field(APP_SECRET_REF, "appSecret", t("useExisting"), true)}
        <label style={fieldStyle}>
          <span style={labelStyle}>{t("brand")}</span>
          <select
            value={drafts[BRAND_REF] ?? ""}
            disabled={refs?.[BRAND_REF]?.writable === false}
            onChange={(event) => {
              setDrafts((current) => ({ ...current, [BRAND_REF]: event.target.value }));
            }}
            style={selectStyle}
          >
            <option value="" disabled>
              {t("selectBrand")}
            </option>
            <option value="feishu">{t("feishu")}</option>
            <option value="lark">Lark</option>
          </select>
          <small style={mutedStyle}>{statusOf(BRAND_REF)}</small>
        </label>
        {field(CLI_PATH_REF, "cliPath", t("cliPathPlaceholder"))}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button variant="primary" onClick={() => void save()}>
            {saved ? t("savedButton") : t("save")}
          </Button>
        </div>
      </section>
    </div>
  );
}

function connectionLabel(state: string, t: (key: LarkConnectorLocaleKey) => string): string {
  if (state === "connected") return t("connected");
  if (state === "connecting") return t("connecting");
  if (state === "error") return t("connectionError");
  return t("stopped");
}
const pageStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  padding: "12px 0",
  maxWidth: "760px",
} as const;
const titleStyle = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
} as const;
const sectionStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  padding: "12px 0",
  borderTop: "1px solid var(--dsw-alias-border-l2)",
} as const;
const sectionHeaderStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
} as const;
const savedConfigStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  padding: "10px 12px",
  borderRadius: "8px",
  background: "var(--dsw-alias-bg-subtle)",
  color: "var(--dsw-alias-fg-muted)",
  fontSize: "12px",
} as const;
const fieldStyle = { display: "flex", flexDirection: "column", gap: "6px" } as const;
const labelStyle = { fontSize: "12px", fontWeight: 600 } as const;
const mutedStyle = { color: "var(--dsw-alias-fg-muted)", fontSize: "12px", margin: 0 } as const;
const errorStyle = {
  color: "var(--dsw-alias-fg-error)",
  fontSize: "12px",
  margin: 0,
  overflowWrap: "anywhere",
} as const;
const rowStyle = {
  display: "flex",
  alignItems: "flex-start",
  gap: "10px",
  padding: "10px 0",
} as const;
const selectStyle = {
  height: "34px",
  borderRadius: "8px",
  border: "1px solid var(--dsw-alias-border-l2)",
  background: "var(--dsw-alias-bg-base)",
  color: "inherit",
  padding: "0 10px",
} as const;
function dotStyle(state: string) {
  return {
    width: "8px",
    height: "8px",
    marginTop: "6px",
    borderRadius: "50%",
    flex: "0 0 auto",
    background: state === "connected" ? "#19a974" : state === "error" ? "#d14343" : "#8a8f98",
  } as const;
}
