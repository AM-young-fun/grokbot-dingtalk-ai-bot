import { ToolError } from './dingtalk-tool-error.js';

const CONFIG_FIELDS = [
  ['DINGTALK_CLIENT_ID', 'clientId'],
  ['DINGTALK_CLIENT_SECRET', 'clientSecret'],
  ['DINGTALK_OPERATOR_ID', 'operatorId'],
];

export function loadToolConfig(env = process.env) {
  const config = {};
  const missing = [];

  for (const [variable, field] of CONFIG_FIELDS) {
    const value = env[variable]?.trim() ?? '';
    if (!value) {
      missing.push(variable);
    } else {
      config[field] = value;
    }
  }

  if (missing.length > 0) {
    throw new ToolError(
      'CONFIG_MISSING',
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }

  return config;
}
