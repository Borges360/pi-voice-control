import test from 'node:test';
import assert from 'node:assert/strict';
import { networkError } from '../dist/src/providers/network-error.js';
const profile = { type:'openai-compatible',endpoint:'http://127.0.0.1:8000/v1/audio/transcriptions',model:'whisper' };
for (const [codes,expected] of [[['ECONNREFUSED'],'STT_REFUSED'],[['ENOTFOUND'],'STT_DNS'],[['ECONNREFUSED','ECONNREFUSED'],'STT_REFUSED'],[['DEPTH_ZERO_SELF_SIGNED_CERT'],'STT_TLS'],[['ECONNRESET'],'STT_NETWORK']]) test(`network diagnostics ${codes}`,() => {
  const error = new Error('secret auth token'); error.cause = codes.length === 1 ? {code:codes[0]} : new AggregateError(codes.map(code=>Object.assign(new Error('secret'),{code})));
  const result = networkError(error,new AbortController().signal,profile);
  assert.equal(result.code,expected); assert.ok(!result.message.includes('secret')); assert.ok(result.message.includes('http://127.0.0.1:8000'));
});
