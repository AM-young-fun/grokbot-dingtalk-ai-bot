import { DWClient, TOPIC_ROBOT } from "dingtalk-stream";
import { loadConfig } from "./config.js";
import { handleDingTalkMessage } from "./grokbot.js";
import { sendReply } from "./reply.js";
import { createRobotCallbackHandler } from "./runtime.js";

const config = loadConfig();
const client = new DWClient({
  clientId: config.clientId,
  clientSecret: config.clientSecret,
});

client.registerCallbackListener(
  TOPIC_ROBOT,
  createRobotCallbackHandler({
    client,
    handleMessage: handleDingTalkMessage,
    send: sendReply,
  }),
);

client.connect();
console.log("DingTalk Stream bridge started");
