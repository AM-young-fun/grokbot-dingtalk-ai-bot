# Grokbot 钉钉机器人连接层设计

## 目标

提供一个可由 Grokbot 自行克隆、配置和部署的 Node.js 项目。项目通过钉钉 Stream 模式持续接收机器人消息：群聊只处理明确 `@机器人` 的消息，单聊直接处理；连接层把钉钉原始消息发送到 Grokbot webhook，唤醒 Grokbot；Grokbot 完成判断和作答，并通过消息携带的 `sessionWebhook` 回复原会话。

首版只支持文本问答。不包含图片、文件、互动卡片、主动推送、管理后台或持久化对话记录。

## 使用流程

1. 用户把 GitHub 项目地址交给 Grokbot。
2. Grokbot 阅读 `README.md`，安装依赖。
3. Grokbot向用户索取钉钉应用 `Client ID`、`Client Secret`，并创建自己的 webhook 触发器。
4. Grokbot把钉钉凭据、webhook URL 和 webhook 密钥写入云机器环境变量，不提交到 Git。
5. Grokbot配置 webhook：收到钉钉原始 `data` 后进行思考，并使用 `data.sessionWebhook` 回复钉钉。
6. Grokbot启动连接层，并配置进程守护。
7. 用户在群聊中 `@机器人`，或与机器人单聊，完成端到端验证。

## 架构

项目使用钉钉官方 Node.js Stream SDK建立长连接，不要求公网回调地址或 HTTPS 域名。

组件边界：

- Stream 客户端：连接钉钉、订阅机器人消息、处理重连。
- 消息过滤器：群聊仅接受 `conversationType === "2"` 且 `isInAtList === true` 的消息；单聊接受文本消息。
- Webhook 转发器：把钉钉原始 `data` 作为 JSON POST 到 `GROKBOT_WEBHOOK_URL`，使用 Bearer 密钥鉴权。
- Grokbot webhook：唤醒 Grokbot；Grokbot自行判断、使用记忆和工具。群聊使用机器人群消息 OpenAPI 引用并 `@` 提问人；单聊通过 `data.sessionWebhook` 回复。
- ACK：Grokbot webhook 接受消息后立即向钉钉确认，不等待 Grokbot 完成作答。
- 配置层：从环境变量读取凭据并在启动时校验。

## 钉钉消息契约

Stream 回调 topic：

```text
/v1.0/im/bot/messages/get
```

代码保留钉钉回调的原始 `data` 字段，不创建另一套外部消息协议，不重命名字段。文本消息正文从以下位置读取：

```js
data.text.content
```

连接层发送给 Grokbot webhook 的 HTTP 请求：

```js
await fetch(process.env.GROKBOT_WEBHOOK_URL, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "authorization": `Bearer ${process.env.GROKBOT_WEBHOOK_SECRET}`
  },
  body: JSON.stringify(data)
});
```

请求体就是钉钉原始 `data`，不增加外层包装、不重命名字段。`data` 保留钉钉字段，包括但不限于 `senderId`、`senderNick`、`conversationId`、`conversationType`、`msgId`、`msgtype`、`isInAtList`、`sessionWebhook` 和 `sessionWebhookExpiredTime`。具体字段以钉钉实际回调为准。

单聊时，Grokbot 使用当前消息的 `sessionWebhook` 回复，出站请求体遵循钉钉文本消息格式：

```json
{
  "msgtype": "text",
  "text": {
    "content": "Grokbot 回复"
  }
}
```

`sessionWebhook` 有有效期，只用于回复对应入站会话，不作为长期主动推送地址保存。

群聊时，最终答案必须以机器人身份调用钉钉群消息 OpenAPI，发送 Markdown，并同时满足：

- 目标群：`data.conversationId`。
- 机器人：`data.robotCode`。
- 引用消息：`data.msgId`，作为被引用消息的 `openMessageId`。
- 引用发送者：`data.senderId`，作为发送者 `openDingTalkId`。
- `@` 提问人：`data.senderStaffId`，加入 `atUserIds`，正文同时包含对应 `@` 标记。

若群聊回调缺少引用或 `@` 所需字段，Grokbot必须记录明确错误，不得退化成无引用、无 `@` 的普通群消息。

## 行为规则

- 仅处理 `msgtype === "text"`。
- 群聊消息必须确认机器人在 `@` 列表中。
- 单聊文本直接处理。
- 去掉正文首尾空白；空文本不触发 Grokbot webhook。
- 每条符合条件的消息最多触发 Grokbot webhook 一次。
- Grokbot webhook 返回任意 `2xx` 即视为已接受，不把响应体当成答案。
- webhook 接受后立即 ACK 钉钉，避免 Grokbot 长任务造成消息重投。
- Grokbot 负责最终回复；连接层不等待、不生成、不代发答案。
- 不发送“收到，正在思考”等中间文字。
- webhook 接受成功后，可尽力给原消息添加 `👌` reaction；reaction 失败时静默，不影响 webhook 或 ACK。
- 群聊最终答案必须引用原消息并 `@` 原提问人；单聊不引用、不 `@`。

## 错误处理

- 缺少 `DINGTALK_CLIENT_ID`、`DINGTALK_CLIENT_SECRET`、`GROKBOT_WEBHOOK_URL` 或 `GROKBOT_WEBHOOK_SECRET`：启动失败，并显示缺少的变量名。
- Stream 连接失败：记录不含密钥的错误，由 SDK执行重连。
- Grokbot webhook 网络失败、超时或返回非 `2xx`：记录 `msgId`、状态码和简短错误，并向钉钉返回失败 ACK，使平台可重投。
- webhook 请求超时固定为 10 秒；只限制“是否接收”，不限制 Grokbot 后续作答时间。
- Grokbot 回复失败由 Grokbot 自身记录和处理；连接层无法确认最终回复结果。
- 日志不得输出 `Client Secret`、`GROKBOT_WEBHOOK_SECRET`、完整 Grokbot webhook URL 或完整 `sessionWebhook`。

## 项目文件

```text
README.md
package.json
.env.example
.gitignore
src/index.js
src/webhook.js
test/webhook.test.js
```

`README.md` 面向 Grokbot，包含钉钉后台配置、Grokbot webhook 契约、所需参数、启动命令、守护运行建议和端到端验收步骤。

## 测试与验收

自动测试覆盖：

- 群聊已 `@机器人` 时触发 Grokbot webhook。
- 群聊未 `@机器人` 时忽略。
- 单聊文本触发 Grokbot webhook。
- 非文本和空文本忽略。
- webhook 请求体等于钉钉原始 `data`。
- webhook 使用 Bearer 密钥。
- webhook `2xx` 后 ACK 成功；失败或超时后 ACK 失败。
- 不发送中间提示文字；可选 `👌` reaction 失败不影响主流程。
- 群聊最终回复使用 `conversationId`、`robotCode`、`msgId`、`senderId` 和 `senderStaffId` 完成引用与 `@`。
- 缺少配置时拒绝启动。

上线验收必须在真实钉钉环境完成：

1. 云机器日志显示 Stream 已连接。
2. 群聊 `@机器人` 提问，原群收到正确回复。
3. 群聊不 `@机器人`，机器人不回复。
4. 单聊提问，单聊收到正确回复。
5. 重启进程后再次完成群聊和单聊验证。

单元测试通过只代表连接层逻辑通过，不代表真实钉钉或 Grokbot 已联通。

## 安全与部署

- 凭据只通过环境变量注入。
- `.env` 加入 `.gitignore`，仓库只提交 `.env.example`。
- 建议使用 systemd、PM2 或容器重启策略保持进程运行。
- 首版不开放入站 HTTP 端口。
- Grokbot webhook 必须验证 Bearer 密钥。
- 日志对 Grokbot webhook、会话 webhook 和用户消息做最小化记录。

