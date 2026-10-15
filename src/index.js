import { DWClient, TOPIC_ROBOT } from "dingtalk-stream";
import { loadConfig } from "./config.js";
import { createRobotCallbackHandler } from "./runtime.js";
import { emotion } from "./emotion.js";
import { startWatchdog } from "./watchdog.js";

const config = loadConfig();
const client = new DWClient({ clientId: config.clientId, clientSecret: config.clientSecret });

const react = (data) => emotion("reply", data, config);
client.registerCallbackListener(TOPIC_ROBOT, createRobotCallbackHandler({ client, config, react }));

client.connect();
startWatchdog({ client });
console.log("DingTalk Stream bridge started");
