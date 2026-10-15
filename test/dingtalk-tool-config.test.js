import assert from 'node:assert/strict';
import test from 'node:test';

import { loadToolConfig } from '../src/dingtalk-tool-config.js';
import { ToolError } from '../src/dingtalk-tool-error.js';

test('loadToolConfig returns exactly the DingTalk tool configuration', () => {
  assert.deepEqual(loadToolConfig({
    DINGTALK_CLIENT_ID: 'client-id',
    DINGTALK_CLIENT_SECRET: 'client-secret',
    DINGTALK_OPERATOR_ID: 'operator-id',
    IGNORED: 'value',
  }), {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    operatorId: 'operator-id',
  });
});

test('loadToolConfig trims configuration values', () => {
  assert.deepEqual(loadToolConfig({
    DINGTALK_CLIENT_ID: '  client-id\n',
    DINGTALK_CLIENT_SECRET: '\tclient-secret ',
    DINGTALK_OPERATOR_ID: ' operator-id ',
  }), {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    operatorId: 'operator-id',
  });
});

test('loadToolConfig accepts an operator userId without a unionId', () => {
  assert.deepEqual(loadToolConfig({
    DINGTALK_CLIENT_ID: 'client-id',
    DINGTALK_CLIENT_SECRET: 'client-secret',
    DINGTALK_OPERATOR_USER_ID: ' 01412445306844863 ',
  }), {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    operatorUserId: '01412445306844863',
  });
});

test('loadToolConfig prefers a direct unionId when both identities exist', () => {
  assert.deepEqual(loadToolConfig({
    DINGTALK_CLIENT_ID: 'client-id',
    DINGTALK_CLIENT_SECRET: 'client-secret',
    DINGTALK_OPERATOR_ID: 'union-id',
    DINGTALK_OPERATOR_USER_ID: 'user-id',
  }), {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    operatorId: 'union-id',
  });
});

test('loadToolConfig names every missing variable without exposing values', () => {
  const secret = 'must-not-leak';

  assert.throws(
    () => loadToolConfig({ DINGTALK_CLIENT_SECRET: secret }),
    (error) => {
      assert.ok(error instanceof ToolError);
      assert.equal(error.code, 'CONFIG_MISSING');
      assert.match(error.message, /DINGTALK_CLIENT_ID/);
      assert.match(error.message, /DINGTALK_OPERATOR_ID/);
      assert.match(error.message, /DINGTALK_OPERATOR_USER_ID/);
      assert.doesNotMatch(error.message, new RegExp(secret));
      assert.doesNotMatch(error.message, /DINGTALK_CLIENT_SECRET/);
      return true;
    },
  );
});

test('loadToolConfig treats blank values as missing', () => {
  assert.throws(
    () => loadToolConfig({
      DINGTALK_CLIENT_ID: ' ',
      DINGTALK_CLIENT_SECRET: '\t',
      DINGTALK_OPERATOR_ID: '\n',
    }),
    (error) => {
      assert.equal(error.code, 'CONFIG_MISSING');
      for (const name of [
        'DINGTALK_CLIENT_ID',
        'DINGTALK_CLIENT_SECRET',
        'DINGTALK_OPERATOR_ID',
        'DINGTALK_OPERATOR_USER_ID',
      ]) {
        assert.match(error.message, new RegExp(name));
      }
      return true;
    },
  );
});
