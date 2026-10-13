# Grokbot 钉钉机器人连接层设计

## 目标

提供一个可由 Grokbot 自行克隆、配置和部署的 Node.js 项目。项目通过钉钉 Stream 模式持续接收机器人消息：群聊只处理明确 `@机器人` 的消息，单聊直接处理；Grokbot 生成答案后，连接层回复原会话。

首版只支持文本问答。不包含图片、文件、互动卡片、主动推送、管理后台或持久化对话记录。

## 使用流程

1. 用户把 GitHub 项目地址交给 Grokbot。
2. Grokbot 阅读 `README.md`，安装依赖。
3. Grokbot向用户索取钉钉应用 `Client ID` 和 `Client Secret`。
4. Grokbot把凭据写入云机器环境变量，不提交到 Git。
5. Grokbot实现或连接 `handleDingTalkMessage(data)`。
6. Grokbot启动服务，并配置进程守护。
7. 用户在群聊中 `@机器人`，或与机器人单聊，完成端到端验证。

## 架构

项目使用钉钉官方 Node.js Stream SDK建立长连接，不要求公网回调地址或 HTTPS 域名。

组件边界：

- Stream 客户端：连接钉钉、订阅机器人消息、处理重连和 ACK。
- 消息过滤器：群聊仅接受 `conversationType === "2"` 且 `isInAtList === true` 的消息；单聊接受文本消息。
- Grokbot 接入点：`handleDingTalkMessage(data)` 接收钉钉原始消息数据，返回回复文本。
- 回复器：向当前消息携带的 `sessionWebhook` 发送钉钉标准文本消息。
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

Grokbot 接入函数：

```js
async function handleDingTalkMessage(data) {
  // Grokbot 在这里接入自身消息处理。
  return "回复文本";
}
```

`data` 保留钉钉字段，包括但不限于 `senderId`、`senderNick`、`conversationId`、`conversationType`、`msgId`、`msgtype`、`isInAtList`、`sessionWebhook` 和 `sessionWebhookExpiredTime`。具体字段以钉钉实际回调为准。

回复使用当前消息的 `sessionWebhook`，请求体遵循钉钉文本消息格式：

```json
{
  "msgtype": "text",
  "text": {
    "content": "Grokbot 回复"
  }
}
```

`sessionWebhook` 有有效期，只用于回复对应入站会话，不作为长期主动推送地址保存。

## 行为规则

- 仅处理 `msgtype === "text"`。
- 群聊消息必须确认机器人在 `@` 列表中。
- 单聊文本直接处理。
- 去掉正文首尾空白；空文本不调用 Grokbot。
- 每条符合条件的消息最多调用 Grokbot 一次。
- Grokbot 返回空值时，不发送空消息，改发明确失败提示。
- 回复内容使用字符串；首版不解释 Grokbot 返回的钉钉富消息对象。

## 错误处理

- 缺少 `DINGTALK_CLIENT_ID` 或 `DINGTALK_CLIENT_SECRET`：启动失败，并显示缺少的变量名。
- Stream 连接失败：记录不含密钥的错误，由 SDK执行重连。
- Grokbot 处理失败：记录 `msgId` 和简短错误，向当前会话发送“处理失败，请稍后重试”。
- `sessionWebhook` 缺失或过期：记录错误，不尝试猜测其他发送目标。
- 回复 HTTP 非成功或钉钉返回非零 `errcode`：记录状态码、`errcode`、`errmsg`，不记录完整 webhook URL。
- 日志不得输出 `Client Secret` 或完整 `sessionWebhook`。

## 项目文件

```text
README.md
package.json
.env.example
.gitignore
src/index.js
test/message-handler.test.js
```

`README.md` 面向 Grokbot，包含钉钉后台配置、所需参数、接入函数说明、启动命令、守护运行建议和端到端验收步骤。

## 测试与验收

自动测试覆盖：

- 群聊已 `@机器人` 时调用 Grokbot。
- 群聊未 `@机器人` 时忽略。
- 单聊文本调用 Grokbot。
- 非文本和空文本忽略。
- Grokbot 成功结果转换为钉钉文本回复。
- Grokbot 异常使用失败提示。
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
- 日志对会话 webhook 和用户消息做最小化记录。

