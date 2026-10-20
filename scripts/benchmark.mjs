import { performance } from 'node:perf_hooks';
import { AudioMeter,Waveform } from '../dist/src/audio/audio-meter.js';
const started=performance.now(); const { default:factory }=await import('../dist/index.js'); const coldImportMs=performance.now()-started;
const api={ registerFlag(){},getFlag(){},registerShortcut(){},registerCommand(){},on(){} };
const samples=[];
for(let i=0;i<100;i++) { const t=performance.now(); factory(api); samples.push(performance.now()-t); }
samples.sort((a,b)=>a-b);
const pcm=Buffer.alloc(640); for(let i=0;i<320;i++) pcm.writeInt16LE(Math.round(Math.sin(i/5)*8000),i*2);
const wave=new Waveform(),meter=new AudioMeter(()=>{}); const meterStart=performance.now();
for(let i=0;i<6000;i++) { meter.push(pcm); if(i%6===0) wave.tick(meter.latest); }
console.log(JSON.stringify({ platform:process.platform,node:process.versions.node,coldImportMs:+coldImportMs.toFixed(2),warmFactoryMedianMs:+samples[50].toFixed(2),warmFactoryP95Ms:+samples[95].toFixed(2),pcm120SecondsProcessingMs:+(performance.now()-meterStart).toFixed(2),waveBufferBars:wave.levels.length },null,2));
