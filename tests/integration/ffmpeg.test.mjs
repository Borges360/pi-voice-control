import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile,stat } from 'node:fs/promises';
import { FFmpegRecorder } from '../../dist/src/audio/ffmpeg-recorder.js';
import { OpenAICompatibleProvider } from '../../dist/src/providers/openai-compatible.js';
import { createServer } from 'node:http';
import { once } from 'node:events';
const executable=process.env.PI_VOICE_FFMPEG||'ffmpeg';
const base={ deviceId:'default',sampleRate:16000,channels:1,maxSeconds:1,minMs:350,silenceRms:0.002,onLevel(){} };
test('real FFmpeg sine -> meter -> WAV -> local HTTP STT -> cleanup',async()=>{
  const levels=[];
  // Inject only the input fixture; all production capture/finalize/WAV/HTTP code runs unchanged.
  const launch=(file,args,options)=>{ const start=args.indexOf('-f'); const end=args.indexOf('-t'); return spawn(file,[...args.slice(0,start),'-re','-f','lavfi','-i','sine=frequency=440:sample_rate=16000',...args.slice(end)],options); };
  const recorder=new FFmpegRecorder(executable,'linux',launch);
  const session=await recorder.start({ ...base,onLevel:r=>levels.push(r) },new AbortController().signal);
  await session.completed; const audio=await session.stop();
  const server=createServer(async(req,res)=>{ let bytes=0; for await(const b of req)bytes+=b.length; assert.ok(bytes>audio.bytes); res.setHeader('content-type','application/json'); res.end(JSON.stringify({ text:'Teste de integração local.' })); });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  try {
    const wav=await readFile(audio.path); assert.equal(wav.readUInt32LE(24),16000); assert.equal(wav.readUInt16LE(22),1); assert.equal(wav.readUInt16LE(34),16); assert.equal(audio.durationMs,1000); assert.ok(levels.some(r=>r>0.01));
    const p={ type:'openai-compatible',endpoint:`http://127.0.0.1:${server.address().port}/v1/audio/transcriptions`,model:'fixture' };
    const result=await new OpenAICompatibleProvider(p,[]).transcribe(audio,{ model:'fixture',language:'pt',timeoutMs:1000,signal:new AbortController().signal }); assert.equal(result.text,'Teste de integração local.');
  } finally { server.closeAllConnections(); await new Promise(r=>server.close(r)); await session.cancel(); await audio.cleanup(); }
  await assert.rejects(stat(audio.path),{ code:'ENOENT' });
});
test('real microphone smoke: explicit opt-in; no STT upload', { skip:process.env.VOICE_MIC_TEST!=='1' },async()=>{
  const recorder=new FFmpegRecorder(executable); const devices=await recorder.listDevices(); assert.ok(devices.length,'No accessible microphone');
  const levels=[]; const session=await recorder.start({ ...base,deviceId:devices[0].id,onLevel:r=>levels.push(r) },new AbortController().signal);
  let audio;
  try { await session.completed; audio=await session.stop(); assert.ok(audio.durationMs>=350); assert.ok(levels.length>0); assert.ok(audio.bytes>44); }
  finally { await session.cancel(); await audio?.cleanup(); }
});
