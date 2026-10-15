# Grokbot DingTalk Bridge

把 Grokbot 接入钉钉机器人。服务使用钉钉 Stream 长连接收消息，不需要公网回调地址：

- 群聊：只有 `@机器人` 才处理。
- 单聊：直接处理文本消息。
- 回复：通过当前消息的 `sessionWebhook` 返回原会话。
- 首版：只支持文本。

## 给 Grokbot 的执行说明

拿到本仓库后，请按顺序执行：

1. 确认云机器已安装 Node.js 20 或更高版本。
2. 运行 `npm install` 和 `npm test`。
3. 向用户索取钉钉 `Client ID`、`Client Secret`；不要要求用户把密钥提交到 Git。
4. 修改 `src/grokbot.js`，把 `handleDingTalkMessage(data)` 接到你自己的消息处理能力。
5. 设置环境变量，运行 `npm start`。
6. 根据“端到端验收”逐项验证。
7. 使用 systemd、PM2 或容器重启策略保持进程运行。
8. 钉钉 Stream 长连接可能出现假在线或停止收消息；使用 PM2 部署时，配置 crontab 每 10 分钟重启一次进程。

不要修改钉钉入站字段名。传给 `handleDingTalkMessage(data)` 的 `data` 是钉钉机器人回调原始数据对象。

## 钉钉后台配置

1. 进入钉钉开发者后台，创建企业内部应用。
2. 添加“机器人”应用能力。
3. 消息接收模式选择 Stream 模式。
4. 发布应用，并把机器人添加到目标群。
5. 获取：
   - `Client ID`，也叫 `AppKey`。
   - `Client Secret`，也叫 `AppSecret`。

项目使用官方 Node.js 包 [`dingtalk-stream`](https://github.com/open-dingtalk/dingtalk-stream-sdk-nodejs)。

## 安装

```bash
git clone git@github.com:AM-young-fun/grokbot-dingtalk-ai-bot.git
cd grokbot-dingtalk-ai-bot
npm install
npm test
```

## 配置

必须设置两个环境变量：

```bash
export DINGTALK_CLIENT_ID='替换为 Client ID'
export DINGTALK_CLIENT_SECRET='替换为 Client Secret'
```

也可参考 `.env.example`。项目不会自动读取 `.env`；生产环境应由 systemd、PM2、容器或云平台注入环境变量。

禁止提交真实密钥。`.env` 已加入 `.gitignore`。

## 接入 Grokbot

只需修改 `src/grokbot.js`，保留函数名和参数：

```js
export async function handleDingTalkMessage(data) {
  const question = data.text.content.trim();
  const answer = await yourGrokbotCall(question, data);
  return answer;
}
```

要求：

- 参数 `data` 必须保留钉钉原始结构。
- 返回非空字符串。
- 可使用 `conversationId` 和 `senderId` 做会话隔离。
- 不要记录 `Client Secret` 或完整 `sessionWebhook`。
- 如果 Grokbot 已有本地 SDK、HTTP API 或 CLI，在这个文件里调用即可。

常用入站字段：

```js
data.text.content
data.msgtype
data.msgId
data.senderId
data.senderNick
data.conversationId
data.conversationType
data.isInAtList
data.sessionWebhook
data.sessionWebhookExpiredTime
```

字段以钉钉实际回调为准。连接层不会创建另一套消息协议。

## 启动

```bash
npm start
```

成功启动会输出：

```text
DingTalk Stream bridge started
```

缺少环境变量时，进程会直接退出并列出缺少的变量。

## 钉钉消息规则

入站 Stream topic：

```text
/v1.0/im/bot/messages/get
```

只接受：

- `msgtype === "text"`。
- 单聊：`conversationType === "1"`。
- 群聊：`conversationType === "2"` 且 `isInAtList === true`。

出站遵循钉钉文本消息格式：

```json
{
  "msgtype": "text",
  "text": {
    "content": "Grokbot 回复"
  }
}
```

`sessionWebhook` 有有效期，只用于回复当前入站会话，不应作为永久推送地址保存。

Grokbot 抛错或返回空字符串时，用户收到：

```text
处理失败，请稍后重试
```

## 测试

```bash
npm test
node --check src/index.js
```

自动测试覆盖配置校验、群聊 `@` 过滤、单聊、空消息、非文本消息、钉钉回复格式、Grokbot 异常和 Stream ACK。

## 钉钉知识库只读 CLI

仓库同时提供 `dingtalk-grokbot-tool` package bin，用于读取钉钉知识库工作区、节点和 ALIDOC 文档。它不修改钉钉数据，也不影响现有 Stream bridge。

先给企业内部应用开通以下只读权限：

- `Document.Workspace.Read`
- `Document.WorkspaceDocument.Read`
- `Wiki.Node.Read`

`DINGTALK_OPERATOR_ID` 必须是执行读取操作用户的 `unionId`。CLI 从启动它的进程环境读取以下变量；不要提交或打印这些值：

```bash
export DINGTALK_CLIENT_ID='替换为 Client ID'
export DINGTALK_CLIENT_SECRET='替换为 Client Secret'
export DINGTALK_OPERATOR_ID='替换为用户 unionId'
```

安装依赖后，可用仓库脚本运行 package bin：

```bash
npm install
npm run tool -- health
```

安装本 package 的环境也会得到 `dingtalk-grokbot-tool` bin；以下命令均可将 `npm run tool --` 替换成 `dingtalk-grokbot-tool`。

完整命令和选项：

```bash
npm run tool -- health
npm run tool -- workspaces [--cursor CURSOR] [--limit 1..100]
npm run tool -- workspace --workspace-id WORKSPACE_ID
npm run tool -- nodes --workspace-id WORKSPACE_ID [--parent-node-id PARENT_NODE_ID] [--cursor CURSOR] [--limit 1..100]
npm run tool -- node --node-id NODE_ID
npm run tool -- resolve --url 'https://docs.dingtalk.com/...'
npm run tool -- read --node-id NODE_ID [--format json|markdown|text|blocks]
```

`workspaces` 默认 `--limit 20`，`nodes` 默认 `--limit 50`，`read` 默认 `--format json`。已知 URL 时先 `resolve`，再用返回的节点 ID 执行 `read`；已知节点时可直接 `read`，需要标题、类型或父级信息时先执行 `node`。位置未知时先列出 `workspaces`，再从工作区根节点开始用 `nodes` 逐层浏览。

结构化成功输出为单行 JSON：

```json
{"ok":true,"data":{}}
```

`workspaces` 和 `nodes` 额外返回 `page.nextCursor` 与 `page.hasMore`。只要 `hasMore` 为 `true`，就必须把返回的 `page.nextCursor` 实际值代入 `--cursor 'NEXT_CURSOR_VALUE'` 继续请求；未读取所有页时不能声称结果完整。`markdown` 与 `text` 格式直接输出纯文本；`json` 返回经过清理和规范化的元数据、块、Markdown 与文本子集；`blocks` 只返回经过清理和规范化的块子集。需要保留结构时，必须先读取 `--format json` 或 `--format blocks`，再做总结。只有 `json` 暴露 `unsupportedBlockTypes`，必须用它检查、披露不支持的类型和规范化限制；如果先用了 `blocks`，在做任何完整性或保真度说明前还必须运行 `--format json`。字段可能被省略，无法保证原始文档的精确保真度，也不能声称完全一致；不能先根据结构损失更多的 `markdown` 或 `text` 总结。

错误以安全 JSON 写入 stderr：

```json
{"ok":false,"error":{"code":"DOCUMENT_FORBIDDEN","message":"..."}}
```

退出码：`0` 成功，`1` 未预期错误，`2` 参数错误，`3` 缺少环境变量，`4` 认证失败或无权限，`5` 未找到或内容类型不支持，`6` 限流，`7` 超时或上游错误。空列表、无权限、不支持类型和未完成分页都只是有边界的结果，不能据此断言内容不存在。

CLI 只支持 URL/ID 定位和目录逐层浏览，不提供全文搜索，不支持创建、更新、删除、复制、移动或权限变更。不要输出凭据、access token 或完整敏感 URL。Docker bot 容器也包含同一只读 bin；`docker compose exec` 启动的 CLI 进程共享对应 bot 服务的环境变量。

只读证明的范围是知识库 CLI，不是整个 bridge：`src/dingtalk-doc-client.js` 的文档接口均为 GET，只有 URL 解析使用 `queryByUrl` POST；`src/dingtalk-auth.js` 另有一个非内容写入的 token POST。现有 bridge 的 reply、emotion 和 webhook POST 属于消息处理，不是知识库内容写入。可用以下限定范围的命令复核；结果应只包含 token POST 和 `queryByUrl` POST，不应包含 PUT、PATCH、DELETE、内容写入、复制或移动操作：

```bash
rg -n "method:\s*['\"](?:POST|PUT|PATCH|DELETE)['\"]|overwriteContent|appendText|/copy|/move" \
  src/dingtalk-auth.js src/dingtalk-doc-client.js bin/dingtalk-grokbot-tool.js
```

`npm test` 覆盖参数、输出格式、分页、内容规范化及错误映射，但不证明真实钉钉账号、权限、网络或文档可用。上线前仍需使用目标用户 `unionId` 执行 `health`，并对授权工作区完成一次真实的列表、解析和读取验证。

### 知识库 CLI 真实环境验收清单

以下命令只是待执行的验收顺序，不表示已经执行，也不构成真实钉钉权限、数据、容器隔离或重启行为的证明。必须注入两个 bot 的真实独立配置，逐项检查实际返回值，并用真实值替换所有大写占位符：

```bash
# 1. 两个实例分别验证认证和网络
docker compose exec bot-one dingtalk-grokbot-tool health
docker compose exec bot-two dingtalk-grokbot-tool health

# 2. 遍历所有 workspace 页；hasMore=true 时替换并继续 NEXT_CURSOR_VALUE
docker compose exec bot-one dingtalk-grokbot-tool workspaces --limit 20
docker compose exec bot-one dingtalk-grokbot-tool workspaces --limit 20 \
  --cursor 'NEXT_CURSOR_VALUE'

# 3. 遍历根节点和子节点；hasMore=true 时替换并继续 NEXT_CURSOR_VALUE
docker compose exec bot-one dingtalk-grokbot-tool nodes \
  --workspace-id 'WORKSPACE_ID' --limit 50
docker compose exec bot-one dingtalk-grokbot-tool nodes \
  --workspace-id 'WORKSPACE_ID' --parent-node-id 'PARENT_NODE_ID' \
  --limit 50 --cursor 'NEXT_CURSOR_VALUE'

# 4. 解析真实 URL，并把返回的 nodeId 用于后续读取
docker compose exec bot-one dingtalk-grokbot-tool resolve \
  --url 'https://docs.dingtalk.com/REAL_DOCUMENT_URL'

# 5. 检查四种输出；先检查 json 的 unsupportedBlockTypes
docker compose exec bot-one dingtalk-grokbot-tool read --node-id 'NODE_ID' --format json
docker compose exec bot-one dingtalk-grokbot-tool read --node-id 'NODE_ID' --format blocks
docker compose exec bot-one dingtalk-grokbot-tool read --node-id 'NODE_ID' --format markdown
docker compose exec bot-one dingtalk-grokbot-tool read --node-id 'NODE_ID' --format text

# 6. 使用已知无权节点；预期 stderr code 为 DOCUMENT_FORBIDDEN、退出码为 4
docker compose exec bot-one dingtalk-grokbot-tool node \
  --node-id 'KNOWN_UNAUTHORIZED_NODE_ID'

# 7. 验证两个容器各自只能看到预期授权范围，不混用配置
docker compose exec bot-one dingtalk-grokbot-tool workspaces --limit 20
docker compose exec bot-two dingtalk-grokbot-tool workspaces --limit 20

# 8. 记录 bot-two 状态，只重启 bot-one，再确认 bot-two 未重启且仍可访问
bot_two_id=$(docker compose ps -q bot-two)
docker inspect --format '{{.State.StartedAt}} {{.RestartCount}}' "$bot_two_id"
docker compose restart bot-one
docker compose ps
docker inspect --format '{{.State.StartedAt}} {{.RestartCount}}' "$bot_two_id"
docker compose exec bot-one dingtalk-grokbot-tool health
docker compose exec bot-two dingtalk-grokbot-tool health
```

## 端到端验收

自动测试通过不代表钉钉与 Grokbot 已真实联通。部署后必须完成：

1. 云机器日志确认 Stream 已连接。
2. 群聊 `@机器人` 提问，原群收到 Grokbot 正确回复。
3. 群聊不 `@机器人`，机器人不回复。
4. 与机器人单聊，收到 Grokbot 正确回复。
5. 重启进程，再次验证群聊和单聊。

## 生产运行

### Docker Compose：两个独立 bot

Compose 示例从同一个 Dockerfile 构建一个镜像，并启动 `bot-one`、`bot-two` 两个服务。两者分别使用环境文件、日志和重启生命周期；不暴露端口。

全新 checkout 不包含被忽略的本地 env 文件，因此在创建它们之前，`docker compose config` 和 `docker compose up` 会因找不到 `deploy/bots/bot-one.env` 或 `deploy/bots/bot-two.env` 而失败。必须先复制或创建两个文件，再分别填写真实且独立的配置。不要提交生成的 `.env` 文件：

```bash
cp deploy/bots/bot-one.env.example deploy/bots/bot-one.env
cp deploy/bots/bot-two.env.example deploy/bots/bot-two.env
```

确认配置可解析，再构建并启动：

```bash
docker compose config
docker compose up -d --build
docker compose ps
```

每个容器都包含 `dingtalk-grokbot-tool`。CLI 共享该服务的进程环境，可分别检查配置和工作区：

```bash
docker compose exec bot-one dingtalk-grokbot-tool health
docker compose exec bot-one dingtalk-grokbot-tool workspaces
docker compose exec bot-two dingtalk-grokbot-tool health
docker compose exec bot-two dingtalk-grokbot-tool workspaces
```

只重启一个 bot：

```bash
docker compose restart bot-one
```

镜像层和应用代码共用，但两个服务配置互不混用。容器进入运行状态只说明进程已启动，不代表钉钉 Stream 已连接，也不代表真实群聊、单聊或文档读取验收通过；仍须完成上面的“端到端验收”和目标账号的真实文档读取验证。

连接 watchdog 在检测到长期未连接或失活时退出进程，`restart: unless-stopped` 随后重启对应容器。Docker 部署不强制定时重启。若运维仍保留每 10 分钟主动重启作为额外 workaround，必须为两个服务使用不同任务名和锁文件，并分别定向到 `bot-one`、`bot-two`，避免一个任务同时重启两个实例，例如：

```cron
*/10 * * * * /absolute/path/to/flock -n /tmp/grokbot-bot-one-restart.lock /usr/bin/docker compose -f /absolute/path/to/compose.yaml restart bot-one
*/10 * * * * /absolute/path/to/flock -n /tmp/grokbot-bot-two-restart.lock /usr/bin/docker compose -f /absolute/path/to/compose.yaml restart bot-two
```

### PM2

可使用任一种进程守护方案：

```bash
pm2 start src/index.js --name grokbot-dingtalk
pm2 save
```

然后让部署本项目的 AI 执行 `command -v pm2` 和 `command -v flock`，把所得绝对路径填入 crontab。不要直接假定 cron 能找到 Node.js 或 PM2：

```cron
*/10 * * * * /absolute/path/to/flock -n /tmp/grokbot-dingtalk-restart.lock /absolute/path/to/pm2 restart grokbot-dingtalk --update-env 2>&1 | /usr/bin/logger -t grokbot-dingtalk-restart
```

配置后执行：

```bash
crontab -l
pm2 status grokbot-dingtalk
```

确认 cron 已保存、PM2 进程名准确。定时重启可能打断正在处理的单条消息，并会清空进程内的 10 分钟消息去重缓存；钉钉若在重启窗口重投，仍可能再次触发 Grokbot。不要把定时重启误认为零丢失或永久去重。

也可用 systemd、Docker、云平台托管进程，并通过环境变量注入密钥。watchdog 配合进程守护处理检测到的连接失活；定时重启只作为运维选择的额外 workaround，不是 Docker 部署必需项。

日志只保留排障所需的 `msgId` 和简短错误。不要输出用户完整消息、`Client Secret` 或完整 `sessionWebhook`。
