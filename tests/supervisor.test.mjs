import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { FFmpegRecorder } from '../dist/src/audio/ffmpeg-recorder.js';
import { tick } from './helpers.mjs';
const path = fileURLToPath(new URL('./fixtures/fake-ffmpeg.mjs',import.meta.url));
function fixture(mode) {
  let pid;
  const launch = (_executable,args,options) => { assert.equal(options.shell,false); const child = spawn(process.execPath,[path,...args],options); pid = child.pid; return child; };
  const recorder = new FFmpegRecorder('unused','linux',launch,{ startupMs:1500,killMs:100 });
  const options = { deviceId:mode, sampleRate:16000,channels:1,maxSeconds:1,minMs:350,silenceRms:0.002,onLevel(){} };
  return { recorder,options,pid:()=>pid };
}
function dead(pid) { assert.throws(()=>process.kill(pid,0),e=>e.code==='ESRCH'); }
for (const mode of ['ok','ignore-q']) test(`supervisor ${mode}: idempotent stop, forced kill bounded, valid WAV and no orphan`, async () => {
  const f=fixture(mode); const start=performance.now(); const session=await f.recorder.start(f.options,new AbortController().signal);
  const [a,b]=await Promise.all([session.stop(),session.stop()]); assert.equal(a,b); assert.ok(a.bytes>44); assert.ok(performance.now()-start<5000);
  dead(f.pid()); await session.cancel(); await assert.rejects(stat(a.path),{ code:'ENOENT' });
});
for(const mode of ['fail','stall']) test(`supervisor startup ${mode}: sanitized failure and process reaped`, async()=>{
  const f=fixture(mode);
  await assert.rejects(f.recorder.start(f.options,new AbortController().signal),e=>['CAPTURE_TIMEOUT','CAPTURE_FAILED'].includes(e.code)&&!e.message.includes('sensitive'));
  dead(f.pid());
});
test('abort active capture removes process and temporary audio',async()=>{
  const f=fixture('ok'),abort=new AbortController(); const session=await f.recorder.start(f.options,abort.signal);
  abort.abort(); await session.cancel(); dead(f.pid()); await assert.rejects(session.stop());
});
test('unexpected microphone disconnect resolves failure and cleanup still succeeds',async()=>{
  const f=fixture('disconnect'); const session=await f.recorder.start(f.options,new AbortController().signal);
  const end=await session.completed; assert.equal(end.error.code,'CAPTURE_FAILED'); await assert.rejects(session.stop()); await session.cancel(); dead(f.pid()); await tick();
});
