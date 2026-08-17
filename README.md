# dsh-lark-connector

一个面向 DeepSeek Harness（DSH）的飞书连接器插件。

它把飞书机器人接入 DSH：飞书私聊或群聊中的消息可以进入独立的 DSH 会话，由 Agent 处理后再回复到原飞书消息。同时提供 Web 设置页，用于管理飞书凭据、连接状态以及新建飞书会话的默认配置。

## 功能特性

- 飞书 WebSocket 长连接：使用飞书官方 Node SDK 接收实时消息，不需要额外部署 Webhook 服务。
- 私聊与群聊支持：私聊消息直接响应；群聊仅响应明确 @ 机器人的文本消息。
- 会话隔离：每个飞书 chat 映射到独立的 DSH session；同一 chat 内按 FIFO 顺序处理，不同 chat 可以并发处理。
- 会话恢复与归档替换：使用 DSH session persistence 保存历史；归档后的 chat 会自动创建新的可见 session。
- 原生 DSH 会话标题：使用飞书聊天标题作为 DSH session 标题，并在消息中标注发送者信息。
- Workspace 归属：可将飞书会话归入指定 DSH workspace；未配置时使用宿主默认目录。
- 新会话默认配置：在 Web 设置页选择 Agent preset、Provider/Model 和 Workspace，应用于之后创建的飞书 session。
- 可靠回复：Agent 完成后将最终文本回复到原消息；超长文本自动分段，消息 ID 有界去重，避免长连接重放造成重复处理。
- 凭据管理：通过 DSH credentials 服务保存 App ID、App Secret、品牌和 lark-cli 路径，也支持环境变量和 .env 来源。
- lark-cli 集成：自动同步应用凭据到 lark-cli，并提供 lark_setup、lark_status 工具检查 CLI、官方 Skills 与连接状态。
- 中英文 Web 界面：设置页面文案跟随 DSH 当前语言。

## 安装

在 DSH profile 中安装本插件：

```sh
npm install
npm run build
dsh plugin --profile web add /path/to/dsh-lark-connector
```

插件 bundle 安装后，重启 DSH Web Host。插件注册名为 lark-connector。

## 飞书应用配置

在飞书开放平台创建应用并启用机器人能力，然后：

1. 开通接收和发送消息所需的权限。
2. 在事件订阅中选择“使用长连接接收事件”。
3. 订阅 im.message.receive_v1。
4. 将机器人加入需要响应的群聊。

## Web 设置

打开 DSH 设置中的“飞书连接器”页面，可以配置：

- App ID
- App Secret
- Brand（feishu 或 lark）
- lark-cli 路径
- 飞书会话 Workspace
- 新建飞书会话使用的 Agent preset
- 新建飞书会话使用的模型 Provider 和 Model
- 处理期间是否添加 THINKING 表情，并在完成后移除
- 是否使用交互卡片流式更新回复
- 是否在卡片中展示可折叠思维过程
- 是否在卡片时间线中展示工具调用和结果

卡片展示默认参考 lark-acp：思考和工具调用会合并到同一张 Feishu Card，并在生成期间持续更新。若卡片接口不可用，会自动回退为普通文本回复。

保存的默认配置只影响之后新建的飞书 session，不会修改已经存在的 session。

## 环境变量

凭据引用如下：

| 引用            | 作用                                        |
| --------------- | ------------------------------------------- |
| LARK_APP_ID     | 飞书应用 App ID                             |
| LARK_APP_SECRET | 飞书应用密钥                                |
| LARK_BRAND      | 品牌，通常为 feishu                         |
| LARK_CLI_PATH   | lark-cli 可执行文件路径；留空时从 PATH 查找 |

例如：

```sh
export LARK_APP_ID=cli_xxx
export LARK_APP_SECRET=your-app-secret
export LARK_BRAND=feishu
npx @deepseek-ai/dsh web --port 8080
```

环境变量来源通常是只读的，优先级高于 Web 页面中保存的同名凭据。

## lark-cli 与官方 Skills

插件提供两个 DSH 工具：

- lark_setup：检查 lark-cli 和官方 Agent Skills；可选择执行官方安装器。
- lark_status：查看应用配置、CLI 版本和连接状态；可选择联网验证凭据。

也可以手动安装：

```sh
npx @larksuite/cli@latest install
```

## 本地开发

```sh
npm install
npm run check
npm run build
```

测试覆盖消息去重、chat/session ID、消息路由和 lark-cli 配置同步等核心逻辑。

## 项目结构

- src/plugin.ts：DSH 插件生命周期、凭据同步和工具注册。
- src/message/：飞书长连接、消息过滤、会话路由和 Agent 回复。
- src/lark-cli/：lark-cli 探测、安装和凭据同步。
- src/client/：DSH Web 设置页和 Typert 客户端 RPC。
- src/typert.host.ts：Host 端 RPC manifest。
- cordis.patch.yml：bundle 安装时使用的 Cordis 插件入口配置。

## 许可证

MIT
