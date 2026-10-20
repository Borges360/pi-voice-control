import test from 'node:test';
import assert from 'node:assert/strict';
import { endpointPolicy, consentId, requireConsent } from '../dist/src/security/endpoint-policy.js';
import { sanitizeTranscript } from '../dist/src/security/transcript.js';
const p = endpoint => ({ type: 'openai-compatible', endpoint, model: 'whisper' });
test('endpoint schemes, credentials, query, fragments, insecure remote and spoofed loopback blocked', () => {
  for (const endpoint of ['file:///v1/audio/transcriptions', 'http://169.254.169.254/v1/audio/transcriptions', 'http://localhost.evil/v1/audio/transcriptions', 'https://key:secret@example.com/v1/audio/transcriptions', 'https://example.com/v1/audio/transcriptions?key=secret', 'https://example.com/v1/audio/transcriptions#key', 'https://example.com/other']) assert.throws(() => endpointPolicy(p(endpoint)));
  for (const host of ['127.0.0.1','localhost','[::1]']) assert.equal(endpointPolicy(p(`http://${host}:8000/v1/audio/transcriptions`)).external, false);
  assert.equal(endpointPolicy({ ...p('http://stt.lab/v1/audio/transcriptions'), allowInsecureHttp: true }).external, true);
});
test('consent bound to endpoint/model/key-env/HTTP policy', () => {
  const profile = p('https://example.com/v1/audio/transcriptions'); const consent = [consentId(profile)]; requireConsent(profile, consent);
  for (const change of [{ model: 'other' }, { endpoint: 'https://other.example/v1/audio/transcriptions' }, { apiKeyEnv: 'OTHER_KEY' }, { allowInsecureHttp: true }]) assert.throws(() => requireConsent({ ...profile, ...change }, consent));
  requireConsent(p('http://localhost:8000/v1/audio/transcriptions'), []);
});
test('sanitize ANSI, OSC, bracketed paste terminators and terminal controls without rewriting text', () => {
  assert.equal(sanitizeTranscript('\x1b[31mOlá\x1b[0m\r\nKafka OAuth2!\x1b[201~\x00\x1b]0;title\x07'), 'Olá\nKafka OAuth2!');
  assert.equal(sanitizeTranscript('rm -rf /; $(whoami) "José"'), 'rm -rf /; $(whoami) "José"');
  assert.throws(() => sanitizeTranscript('a'.repeat(100001))); assert.throws(() => sanitizeTranscript({ text: 'bad' }));
});
