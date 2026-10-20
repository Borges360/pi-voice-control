import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceController } from '../dist/src/core/controller.js';
import { VoiceError } from '../dist/src/core/types.js';
import { fakeCapture, configuration, deferred, tick } from './helpers.mjs';

function fixture(overrides = {}, transcribe = async () => ({ text: 'Olá Kubernetes!' })) {
  const fake = fakeCapture(overrides); const states = [], pastes = [], notices = [];
  let calls = 0;
  const c = new VoiceController(fake.recorder, () => ({ transcribe: (...args) => { ++calls; return transcribe(...args); } }), {
    update: v => states.push(v.state), paste: t => pastes.push(t), notify: m => notices.push(m),
  });
  return { c, fake, states, pastes, notices, providerCalls: () => calls };
}
test('success transitions and concurrent stop produce exactly one paste', async () => {
  const f = fixture(); await f.c.start(configuration(), []);
  assert.equal(f.c.snapshot().rms, 0.2);
  await Promise.all([f.c.stop(), f.c.stop(), f.c.start(configuration(), [])]);
  assert.deepEqual(f.pastes, ['Olá Kubernetes!']); assert.equal(f.fake.calls.start, 1); assert.equal(f.fake.calls.stop, 1);
  assert.deepEqual(f.states, ['STARTING','RECORDING','FINALIZING','TRANSCRIBING','SUCCESS','IDLE']);
  assert.equal(f.c.busy, false); assert.ok(f.fake.calls.cleanup);
});
for (const failure of ['network', 'empty', 'short', 'silent', 'capture']) {
  test(`${failure} preserves editor and releases resources`, async () => {
    const f = fixture({ audio: failure === 'short' ? { durationMs: 100 } : failure === 'silent' ? { peakRms: 0 } : {}, session: failure === 'capture' ? { stop: async () => { throw new VoiceError('CAPTURE', 'Falha'); } } : {} }, async () => {
      if (failure === 'network') throw new Error('secret server response'); return { text: '' };
    });
    await f.c.start(configuration(), []); await f.c.stop();
    assert.deepEqual(f.pastes, []); assert.equal(f.c.state, 'IDLE'); assert.equal(f.c.busy, false); assert.ok(f.fake.calls.cancel);
    assert.ok(!f.notices.join(' ').includes('secret'));
    if (['short','silent','capture'].includes(failure)) assert.equal(f.providerCalls(), 0);
  });
}
test('cancel STARTING retains lock until late capture is cleaned', async () => {
  const started = deferred(); const fake = fakeCapture();
  const f = fixture({ recorder: { start: async () => started.promise } });
  const first = f.c.start(configuration(), []); const cancel = f.c.cancel();
  await f.c.start(configuration(), []); assert.equal(f.c.busy, true);
  started.resolve(fake.session); await first; await cancel;
  assert.equal(f.c.busy, false); assert.deepEqual(f.pastes, []); assert.ok(fake.calls.cancel);
});
test('cancel RECORDING idempotent, disposal permanently forbids capture', async () => {
  const f = fixture(); await f.c.start(configuration(), []);
  await Promise.all([f.c.cancel(), f.c.cancel()]); assert.equal(f.c.state, 'IDLE'); assert.deepEqual(f.pastes, []);
  await f.c.dispose(); await f.c.start(configuration(), []); assert.equal(f.fake.calls.start, 1);
});
test('cancel FINALIZING invalidates late audio and cleans it', async () => {
  const stopping = deferred(); const f = fixture({ session: { stop: () => stopping.promise } });
  await f.c.start(configuration(), []); const stop = f.c.stop(); await f.c.cancel();
  stopping.resolve(f.fake.audio); await stop; assert.deepEqual(f.pastes, []); assert.equal(f.providerCalls(), 0); assert.ok(f.fake.calls.cleanup);
});
test('late STT result cannot paste, hide or unlock the next recording', async () => {
  const result = deferred(); const f = fixture({}, () => result.promise);
  await f.c.start(configuration(), []); const first = f.c.stop(); await tick(); assert.equal(f.c.state, 'TRANSCRIBING');
  await f.c.cancel(); await f.c.start(configuration(), []); assert.equal(f.c.state, 'RECORDING');
  result.resolve({ text: 'late' }); await first; assert.deepEqual(f.pastes, []); assert.equal(f.c.state, 'RECORDING');
  await f.c.dispose();
});
test('remote consent checked before even opening microphone', async () => {
  const f = fixture(); const c = configuration(); c.transcription.profiles.local.endpoint = 'https://example.com/v1/audio/transcriptions';
  await f.c.start(c, []); assert.equal(f.fake.calls.start, 0); assert.ok(f.notices.some(m => m.includes('CONSENT_REQUIRED'))); assert.equal(f.c.state, 'IDLE');
});
test('natural capture end automatically finalizes', async () => {
  const f = fixture(); await f.c.start(configuration(), []); f.fake.end.resolve({});
  await tick(); await tick(); assert.deepEqual(f.pastes, ['Olá Kubernetes!']); assert.equal(f.c.state, 'IDLE');
});
test('randomized sequential starts/stops/cancels preserve lock and insertion bounds', async () => {
  const f = fixture(); let seed = 27;
  for (let i = 0; i < 250; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; await [() => f.c.start(configuration(), []), () => f.c.stop(), () => f.c.cancel()][seed % 3](); }
  await f.c.dispose(); assert.equal(f.c.busy, false); assert.ok(f.pastes.length <= f.fake.calls.start); assert.ok(f.fake.calls.stop <= f.fake.calls.start);
});
test('120 second wall-clock limit finalizes and clears its timer', async t => {
  t.mock.timers.enable({ apis:['setTimeout'] }); const f=fixture(); await f.c.start(configuration(),[]);
  t.mock.timers.tick(120000); await tick(); await tick();
  assert.equal(f.c.state,'IDLE'); assert.deepEqual(f.pastes,['Olá Kubernetes!']); assert.ok(f.notices.some(m=>m.includes('120s')));
  await f.c.dispose(); t.mock.timers.reset();
});
