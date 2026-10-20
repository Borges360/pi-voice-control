import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { loadExtensions } from '../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js';
import { ExtensionRunner } from '../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js';
import voiceControl from '../dist/index.js';
test('official Pi 1.3 loader loads source TypeScript with real extension API',async()=>{
  const loaded=await loadExtensions([resolve('index.ts')],process.cwd());
  assert.deepEqual(loaded.errors,[]); assert.equal(loaded.extensions.length,1);
  const e=loaded.extensions[0]; assert.ok(e.commands.has('voice')); assert.ok(e.shortcuts.has('f8')); assert.equal(e.tools.size,0);
  assert.ok(e.handlers.has('session_shutdown')); assert.ok(e.handlers.has('session_before_switch'));
  const runner=new ExtensionRunner(loaded.extensions,loaded.runtime,process.cwd(),{},{});
  assert.ok(runner.getShortcuts({}).has('f8'));
  assert.equal(runner.getShortcuts({ 'app.interrupt':['f8'] }).has('f8'),false);
  assert.ok(runner.getShortcutDiagnostics().some(d=>d.message.includes('conflict')));
});
test('interactive wiring: F8 start/stop, focus, modal, reload teardown, existing UI preserved',async()=>{
  const root=await mkdtemp(resolve(tmpdir(),'voice-extension-test-')); const originalCwd=process.cwd();
  const descriptors=[process.stdin,process.stdout].map(s=>Object.getOwnPropertyDescriptor(s,'isTTY')); const stdoutWrite=process.stdout.write;
  const envFfmpeg=process.env.PI_VOICE_FFMPEG;
  const commands=new Map(),shortcuts=new Map(),handlers=new Map(),flags=new Map(),notices=[]; let input,unsub=0;
  const api={ registerFlag:(k,v)=>flags.set(k,v),getFlag:()=>undefined,registerShortcut:(k,v)=>shortcuts.set(k,v),registerCommand:(k,v)=>commands.set(k,v),on:(k,h)=>handlers.set(k,h) };
  const ui={ notify:m=>notices.push(m),setWidget(){},setStatus(){},onTerminalInput:h=>{ input=h; return()=>++unsub; },pasteToEditor(){ throw new Error('Must not paste'); } };
  try {
    process.chdir(root); await mkdir(resolve(root,'.pi')); await writeFile(resolve(root,'.pi/voice-control.json'),JSON.stringify({ shortcut:'f9',capture:{ deviceId:'test mic' } }));
    process.env.PI_VOICE_FFMPEG='missing-ffmpeg-for-extension-test';
    Object.defineProperty(process.stdin,'isTTY',{ configurable:true,value:true }); Object.defineProperty(process.stdout,'isTTY',{ configurable:true,value:true }); process.stdout.write=function(data,...args) { return String(data).includes('\x1b[?1004')?true:stdoutWrite.call(this,data,...args); };
    voiceControl(api); assert.ok(shortcuts.has('f9')); const ctx={ cwd:root,hasUI:true,ui };
    await handlers.get('session_start')({},ctx); assert.ok(input);
    input('\x1b[O'); assert.deepEqual(input('\x1b[20;1:1~'),{ consume:true });
    input('\x1b[I'); handlers.get('ui_prompt_start')(); assert.deepEqual(input('\x1b[20;1:1~'),{ consume:true }); handlers.get('ui_prompt_end')();
    await new Promise(r=>setTimeout(r,260));
    input('\x1b[20;1:3~'); assert.deepEqual(input('\x1b[20;1:1~'),{ data:'\x1b[20~' }); await shortcuts.get('f9').handler(ctx);
    assert.ok(notices.some(m=>m.includes('FFMPEG_MISSING')));
    await commands.get('voice').handler('status',ctx); assert.ok(notices.some(m=>m.includes('IDLE')));
    await handlers.get('session_shutdown')(); assert.equal(unsub,1);
  } finally {
    process.chdir(originalCwd); process.stdout.write=stdoutWrite;
    for(const [i,stream] of [process.stdin,process.stdout].entries()) { if(descriptors[i]) Object.defineProperty(stream,'isTTY',descriptors[i]); else delete stream.isTTY; }
    if(envFfmpeg===undefined) delete process.env.PI_VOICE_FFMPEG; else process.env.PI_VOICE_FFMPEG=envFfmpeg;
    await rm(root,{ recursive:true,force:true });
  }
});
