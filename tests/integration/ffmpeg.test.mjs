import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile,stat } from 'node:fs/promises';
import { FFmpegRecorder } from '../../dist/src/audio/ffmpeg-recorder.js';
const executable=process.env.PI_VOICE_FFMPEG||'ffmpeg';
const base={ deviceId:'default',sampleRate:16000,channels:1,maxSeconds:1,minMs:350,silenceRms:0.002,onLevel(){} };
test('real FFmpeg sine -> meter -> WAV -> cleanup',async()=>{
  const levels=[];
  // Inject only the input fixture; all production capture/finalize/WAV code runs unchanged.
  const launch=(file,args,options)=>{ const start=args.indexOf('-f'); const end=args.indexOf('-t'); return spawn(file,[...args.slice(0,start),'-re','-f','lavfi','-i','sine=frequency=440:sample_rate=16000',...args.slice(end)],options); };
  const recorder=new FFmpegRecorder(executable,'linux',launch);
  const session=await recorder.start({ ...base,onLevel:r=>levels.push(r) },new AbortController().signal);
  await session.completed; const audio=await session.stop();
  try {
    const wav=await readFile(audio.path); assert.equal(wav.readUInt32LE(24),16000); assert.equal(wav.readUInt16LE(22),1); assert.equal(wav.readUInt16LE(34),16); assert.equal(audio.durationMs,1000); assert.ok(levels.some(r=>r>0.01));
  } finally { await session.cancel(); await audio.cleanup(); }
  await assert.rejects(stat(audio.path),{ code:'ENOENT' });
});
test('real microphone smoke: explicit opt-in; no STT upload', { skip:process.env.VOICE_MIC_TEST!=='1' },async()=>{
  const recorder=new FFmpegRecorder(executable); const devices=await recorder.listDevices(); assert.ok(devices.length,'No accessible microphone');
  const levels=[]; const session=await recorder.start({ ...base,deviceId:devices[0].id,onLevel:r=>levels.push(r) },new AbortController().signal);
  let audio;
  try { await session.completed; audio=await session.stop(); assert.ok(audio.durationMs>=350); assert.ok(levels.length>0); assert.ok(audio.bytes>44); }
  finally { await session.cancel(); await audio?.cleanup(); }
});
