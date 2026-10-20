import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLocal } from '../src/local/process.mjs';
import { createProvider } from '../dist/src/providers/factory.js';
import { requireConsent } from '../dist/src/security/endpoint-policy.js';

test('built-in provider uses separate process; missing install is actionable, no network needed',async () => {
  const dir = await mkdtemp(join(tmpdir(),'voice-model-missing-'));
  try {
    await assert.rejects(runLocal({task:'probe'}, {signal:new AbortController().signal,cacheDir:dir}), e => e.code === 'LOCAL_NOT_READY');
    const profile = {type:'local',model:'onnx-community/whisper-tiny'};
    assert.equal(createProvider(profile,[]).id,'local'); requireConsent(profile,[]);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('cancelled worker never starts, timeout and running cancellation reap process',async () => {
  const abort = new AbortController(); abort.abort();
  await assert.rejects(runLocal({task:'probe'},{signal:abort.signal}), e => e.code === 'CANCELLED');
  const worker = new URL('./fixtures/local-worker.mjs',import.meta.url);
  const signal = new AbortController();
  await assert.rejects(runLocal({task:'probe'},{signal:signal.signal,timeoutMs:100,worker}), e => e.code === 'LOCAL_TIMEOUT');
  const pending = runLocal({task:'probe'},{signal:signal.signal,worker}); setTimeout(()=>signal.abort(),100);
  await assert.rejects(pending,e => e.code === 'CANCELLED');
});
