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

## 端到端验收

自动测试通过不代表钉钉与 Grokbot 已真实联通。部署后必须完成：

1. 云机器日志确认 Stream 已连接。
2. 群聊 `@机器人` 提问，原群收到 Grokbot 正确回复。
3. 群聊不 `@机器人`，机器人不回复。
4. 与机器人单聊，收到 Grokbot 正确回复。
5. 重启进程，再次验证群聊和单聊。

## 生产运行

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

也可用 systemd、Docker、云平台托管进程，但除异常退出自动重启外，仍应配置每 10 分钟主动重启，并通过环境变量注入密钥。

日志只保留排障所需的 `msgId` 和简短错误。不要输出用户完整消息、`Client Secret` 或完整 `sessionWebhook`。
