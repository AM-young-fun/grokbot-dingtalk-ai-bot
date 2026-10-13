import { DWClient, TOPIC_ROBOT } from "dingtalk-stream";
import { loadConfig } from "./config.js";
import { createRobotCallbackHandler } from "./runtime.js";
import { emotion } from "./emotion.js";

const config = loadConfig();
const client = new DWClient({ clientId: config.clientId, clientSecret: config.clientSecret });

const react = (data) => emotion("reply", data, config);
client.registerCallbackListener(TOPIC_ROBOT, createRobotCallbackHandler({ client, config, react }));

client.connect();
console.log("DingTalk Stream bridge started");
