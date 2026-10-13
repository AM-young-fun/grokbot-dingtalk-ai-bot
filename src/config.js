export function loadConfig(env = process.env) {
  const required = ["DINGTALK_CLIENT_ID", "DINGTALK_CLIENT_SECRET"];
  const missing = required.filter((name) => !env[name]?.trim());

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return {
    clientId: env.DINGTALK_CLIENT_ID.trim(),
    clientSecret: env.DINGTALK_CLIENT_SECRET.trim(),
  };
}
