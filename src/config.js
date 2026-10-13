export function resolveWebhookSecret(env = process.env) {
  const direct = env.GROKBOT_WEBHOOK_SECRET?.trim();
  if (direct) return direct;
  let auth = env.GROKBOT_WEBHOOK_AUTH?.trim() ?? "";
  if (/^authorization\s*:/i.test(auth)) auth = auth.replace(/^authorization\s*:/i, "").trim();
  if (/^bearer\s+/i.test(auth)) auth = auth.replace(/^bearer\s+/i, "").trim();
  return auth;
}

export function validateWebhookUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid GROKBOT_WEBHOOK_URL: HTTPS URL without embedded credentials required");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Invalid GROKBOT_WEBHOOK_URL: HTTPS URL without embedded credentials required");
  }
  return url.toString();
}

export function loadConfig(env = process.env) {
  const values = {
    DINGTALK_CLIENT_ID: env.DINGTALK_CLIENT_ID?.trim(),
    DINGTALK_CLIENT_SECRET: env.DINGTALK_CLIENT_SECRET?.trim(),
    GROKBOT_WEBHOOK_URL: env.GROKBOT_WEBHOOK_URL?.trim(),
    GROKBOT_WEBHOOK_SECRET: resolveWebhookSecret(env),
  };
  const missing = Object.keys(values).filter((name) => !values[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  validateWebhookUrl(values.GROKBOT_WEBHOOK_URL);
  return {
    clientId: values.DINGTALK_CLIENT_ID,
    clientSecret: values.DINGTALK_CLIENT_SECRET,
    webhookUrl: values.GROKBOT_WEBHOOK_URL,
    webhookSecret: values.GROKBOT_WEBHOOK_SECRET,
  };
}
