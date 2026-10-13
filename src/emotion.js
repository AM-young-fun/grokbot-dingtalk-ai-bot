// Best-effort 👌 reaction on the user's message via DingTalk robot emotion API
// (POST /v1.0/robot/emotion/reply and /v1.0/robot/emotion/recall). Never throws.
const API = "https://api.dingtalk.com";
const EMOTION = "👌";

export async function getAccessToken({ clientId, clientSecret, fetchImpl = fetch }) {
  const res = await fetchImpl(`${API}/v1.0/oauth2/accessToken`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ appKey: clientId, appSecret: clientSecret }),
  });
  const body = await res.json();
  if (!res.ok || !body.accessToken) throw new Error(`accessToken failed (${res.status})`);
  return body.accessToken;
}

export function buildEmotionBody(data) {
  return {
    robotCode: data.robotCode,
    openMsgId: data.msgId,
    openConversationId: data.conversationId,
    emotionType: 2,
    emotionName: EMOTION,
    textEmotion: { emotionId: "2659900", emotionName: EMOTION, text: EMOTION, backgroundId: "im_bg_1" },
  };
}

export async function emotion(action, data, { clientId, clientSecret, fetchImpl = fetch } = {}) {
  try {
    if (!data?.robotCode || !data?.msgId || !data?.conversationId || !clientId || !clientSecret) return false;
    const token = await getAccessToken({ clientId, clientSecret, fetchImpl });
    const res = await fetchImpl(`${API}/v1.0/robot/emotion/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-acs-dingtalk-access-token": token },
      body: JSON.stringify(buildEmotionBody(data)),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
