import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeTranscript } from '../dist/src/security/transcript.js';
test('sanitize ANSI, OSC, bracketed paste terminators and terminal controls without rewriting text', () => {
  assert.equal(sanitizeTranscript('\x1b[31mOlá\x1b[0m\r\nKafka OAuth2!\x1b[201~\x00\x1b]0;title\x07'), 'Olá\nKafka OAuth2!');
  assert.equal(sanitizeTranscript('rm -rf /; $(whoami) "José"'), 'rm -rf /; $(whoami) "José"');
  assert.throws(() => sanitizeTranscript('a'.repeat(100001))); assert.throws(() => sanitizeTranscript({ text: 'bad' }));
});
