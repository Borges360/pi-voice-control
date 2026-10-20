import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioMeter, Waveform } from '../dist/src/audio/audio-meter.js';
test('RMS from real PCM windows is independent of odd chunk boundaries', () => {
  const pcm = Buffer.alloc(640); for (let i=0; i<320; i++) pcm.writeInt16LE(i%2 ? -16384 : 16384, i*2);
  const levels = []; const meter = new AudioMeter(v => levels.push(v));
  for (let i=0; i<pcm.length; i+=7) meter.push(pcm.subarray(i,i+7));
  assert.deepEqual(levels,[0.5]); assert.equal(meter.peak,0.5);
  meter.push(Buffer.alloc(640)); assert.equal(levels[1],0);
});
test('waveform smooths actual signal, decays on silence and has fixed buffer', () => {
  const wave = new Waveform(14,-60); for(let i=0;i<50;i++) wave.tick(0.4);
  assert.ok(wave.levels.at(-1) >= 5); const peak = wave.levels.at(-1); wave.tick(0); assert.ok(wave.levels.at(-1)<peak);
  for(let i=0;i<1000;i++) wave.tick(0); assert.equal(wave.levels.length,14); assert.ok(wave.levels.every(x=>x===0));
});
