import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { WavWriter } from '../dist/src/audio/wav-writer.js';
import { parseDevices, inputArgs, hostWarning } from '../dist/src/audio/device-discovery.js';
import { FFmpegRecorder } from '../dist/src/audio/ffmpeg-recorder.js';
test('WAV header valid, hard byte limit, odd samples trimmed, temp cleanup', async () => {
  const w = await WavWriter.create(1); const dir = w.directory;
  assert.equal(await w.append(Buffer.alloc(50000)),false);
  const a = await w.finish(0.25); const bytes = await readFile(a.path);
  assert.equal(bytes.length,32044); assert.equal(bytes.toString('ascii',0,4),'RIFF'); assert.equal(bytes.readUInt32LE(4),32036);
  assert.equal(bytes.readUInt16LE(22),1); assert.equal(bytes.readUInt32LE(24),16000); assert.equal(bytes.readUInt16LE(34),16); assert.equal(a.durationMs,1000);
  await a.cleanup(); await assert.rejects(stat(dir),{ code:'ENOENT' });
  const odd = await WavWriter.create(1); await odd.append(Buffer.from([1,2,3])); const b = await odd.finish(0.1); assert.equal(b.bytes,46); await b.cleanup();
});
test('enumeration parses audio-only sources, Unicode/quotes and safe argv', () => {
  const mic = 'Microfone "José" (USB)';
  assert.deepEqual(parseDevices(`[dshow @ 0x01] "Camera" (video)\n[dshow @ 0x01] "${mic}" (audio)\n[dshow @ 0x01]   Alternative name "@device"`, 'win32'),[{ id:mic,label:mic }]);
  assert.deepEqual(inputArgs(mic,'win32'),['-f','dshow','-i',`audio=${mic}`]);
  assert.deepEqual(parseDevices('[AVFoundation indev @ x] AVFoundation video devices:\n[x] [0] Camera\n[x] AVFoundation audio devices:\n[x] [0] Built-in mic', 'darwin'),[{ id:'0', label:'Built-in mic' }]);
  assert.deepEqual(parseDevices(' * default [Default audio]\n   usb [USB mic]','linux'),[{ id:'default',label:'Default audio' },{ id:'usb',label:'USB mic' }]);
  assert.deepEqual(inputArgs('alsa:hw:0','linux'),['-f','alsa','-i','hw:0']);
  assert.match(hostWarning({ SSH_CONNECTION:'x' }),/SSH/); assert.match(hostWarning({ WSL_INTEROP:'x' }),/WSL/);
});
test('nonexistent FFmpeg is bounded and actionable; aborted startup cleans', async () => {
  const recorder = new FFmpegRecorder('pi-voice-no-such-executable', 'linux');
  const options = { deviceId:'pulse-mic',maxSeconds:1,minMs:350,silenceRms:0.002,sampleRate:16000,channels:1,onLevel(){} };
  await assert.rejects(recorder.start(options,new AbortController().signal),e=>['FFMPEG_MISSING','CAPTURE_FAILED'].includes(e.code));
  const abort = new AbortController(); abort.abort(); await assert.rejects(recorder.start(options,abort.signal));
});
