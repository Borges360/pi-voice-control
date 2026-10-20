import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { runLocal } from '../../src/local/process.mjs';

test('real included Whisper: offline Portuguese fixture in separate process', {skip:!process.env.VOICE_LOCAL_TEST},async()=>{
  const result=await runLocal({task:'transcribe',path:resolve(process.env.VOICE_LOCAL_WAV ?? '.acceptance-local/speech.wav'),language:'pt'},{signal:new AbortController().signal});
  assert.equal(typeof result.text,'string'); assert.match(result.text,/extens[aã]o/i); assert.match(result.text,/terminal/i);
});
