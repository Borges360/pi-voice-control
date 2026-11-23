import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { mkdtemp,mkdir,writeFile,rm,stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { loadExtensions } from '../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js';
import { ExtensionRunner } from '../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js';
import voiceControl from '../dist/index.js';
import { readyMarker, localCache } from '../src/local/process.mjs';
test('official Pi loader (devDependency 1.6.0) loads source TypeScript and the vendored adapter with real extension API',async()=>{
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
  const envHome=process.env.HOME, envUserProfile=process.env.USERPROFILE;
  const originalFetch=globalThis.fetch;
  const commands=new Map(),shortcuts=new Map(),handlers=new Map(),flags=new Map(),notices=[]; let input,unsub=0;
  const api={ registerFlag:(k,v)=>flags.set(k,v),getFlag:()=>undefined,registerShortcut:(k,v)=>shortcuts.set(k,v),registerCommand:(k,v)=>commands.set(k,v),on:(k,h)=>handlers.set(k,h) };
  const ui={ notify:m=>notices.push(m),setWidget(){},setStatus(){},onTerminalInput:h=>{ input=h; return()=>++unsub; },pasteToEditor(){ throw new Error('Must not paste'); } };
  try {
    // This is a wiring test, not inference. Isolate readiness from the real user's
    // model cache so a clean CI runner can exercise the FFmpeg failure path too.
    process.env.HOME=root; process.env.USERPROFILE=root;
    assert.equal(localCache(),resolve(root,'.pi','agent','cache','voice-control'));
    await mkdir(localCache(),{recursive:true});
    await writeFile(readyMarker('tiny'),'{}');
    process.chdir(root); await mkdir(resolve(root,'.pi'),{recursive:true}); await writeFile(resolve(root,'.pi/voice-control.json'),JSON.stringify({ shortcut:'f9',capture:{ deviceId:'test mic' },transcription:{model:'tiny'} }));
    globalThis.fetch=async()=>Response.json({data:[]});
    process.env.PI_VOICE_FFMPEG='missing-ffmpeg-for-extension-test';
    Object.defineProperty(process.stdin,'isTTY',{ configurable:true,value:true }); Object.defineProperty(process.stdout,'isTTY',{ configurable:true,value:true }); process.stdout.write=function(data,...args) { return String(data).includes('\x1b[?1004')?true:stdoutWrite.call(this,data,...args); };
    voiceControl(api); assert.ok(shortcuts.has('f9')); assert.match(commands.get('voice').description,/Open the voice menu/); const ctx={ cwd:root,hasUI:true,ui,sessionManager:{getSessionId:()=> 'test-session',getLeafId:()=> 'test-leaf'},isProjectTrusted:()=>true };
    await handlers.get('session_start')({},ctx); assert.ok(input);
    input('\x1b[O'); assert.deepEqual(input('\x1b[20;1:1~'),{ consume:true });
    input('\x1b[I'); handlers.get('ui_prompt_start')(); assert.deepEqual(input('\x1b[20;1:1~'),{ consume:true }); handlers.get('ui_prompt_end')();
    await new Promise(r=>setTimeout(r,260));
    input('\x1b[20;1:3~'); assert.deepEqual(input('\x1b[20;1:1~'),{ data:'\x1b[20~' }); await shortcuts.get('f9').handler(ctx);
    assert.ok(notices.some(m=>m.includes('FFMPEG_MISSING')));
    await commands.get('voice').handler('status',ctx); assert.ok(notices.some(m=>m.startsWith('Voice: IDLE | microphone: test mic')));
    await handlers.get('session_shutdown')(); assert.equal(unsub,1);
  } finally {
    process.chdir(originalCwd); process.stdout.write=stdoutWrite;
    globalThis.fetch=originalFetch;
    for(const [i,stream] of [process.stdin,process.stdout].entries()) { if(descriptors[i]) Object.defineProperty(stream,'isTTY',descriptors[i]); else delete stream.isTTY; }
    if(envFfmpeg===undefined) delete process.env.PI_VOICE_FFMPEG; else process.env.PI_VOICE_FFMPEG=envFfmpeg;
    if(envHome===undefined) delete process.env.HOME; else process.env.HOME=envHome;
    if(envUserProfile===undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE=envUserProfile;
    await rm(root,{ recursive:true,force:true });
  }
});
test('/voice opens the panel without IO, gates the shortcut while open and runs the closing action', async () => {
  const { getKeybindings } = await import('@earendil-works/pi-tui');
  const root = await mkdtemp(resolve(tmpdir(), 'voice-panel-wiring-'));
  const descriptors = [process.stdin, process.stdout].map(s => Object.getOwnPropertyDescriptor(s, 'isTTY')); const stdoutWrite = process.stdout.write;
  const envAgent = process.env.PI_CODING_AGENT_DIR, envFfmpeg = process.env.PI_VOICE_FFMPEG;
  const commands = new Map(), shortcuts = new Map(), handlers = new Map(), notices = []; let input, component, opened = 0;
  const api = { registerFlag() {}, getFlag: () => undefined, registerShortcut: (k, v) => shortcuts.set(k, v), registerCommand: (k, v) => commands.set(k, v), on: (k, h) => handlers.set(k, h) };
  const ui = {
    notify: m => notices.push(m), setWidget() {}, setStatus() {}, onTerminalInput: h => { input = h; return () => {}; }, pasteToEditor() { throw new Error('Must not paste'); },
    custom: (factory, options) => new Promise(done => { ++opened; component = factory({ terminal: { rows: 30 }, requestRender() {} }, { fg: (_c, s) => s, bold: s => s }, getKeybindings(), done); assert.equal(options.overlay, true); }),
  };
  try {
    process.env.PI_CODING_AGENT_DIR = resolve(root, 'agent'); process.env.PI_VOICE_FFMPEG = 'missing-ffmpeg-for-panel-test';
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true }); Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
    process.stdout.write = function (data, ...args) { return String(data).includes('\x1b[?1004') ? true : stdoutWrite.call(this, data, ...args); };
    voiceControl(api);
    const ctx = { cwd: root, hasUI: true, ui, sessionManager: { getSessionId: () => 's', getLeafId: () => 'l' }, isProjectTrusted: () => false };
    await handlers.get('session_start')({}, ctx);
    const settle = async () => { await component.drain(); await new Promise(r => setImmediate(r)); };
    let running = commands.get('voice').handler('', ctx); await new Promise(r => setImmediate(r));
    assert.equal(opened, 1); assert.match(component.render(80).join('\n'), /Voice \/ Settings/);
    assert.equal(input('\x1b[19~'), undefined, 'F8 reaches the modal panel instead of the dictation gate');
    await shortcuts.get('f8').handler(ctx); assert.equal(opened, 1, 'the shortcut never acts while the panel is open');
    assert.ok(!notices.some(m => /FFMPEG|Recording|busy/i.test(m)), 'no capture is attempted while the panel is open');
    await commands.get('voice').handler('settings', ctx); assert.ok(notices.includes('Configuration or diagnostics are already running.'));
    component.handleInput('\x1b'); await settle(); await running;
    running = commands.get('voice').handler('', ctx); await new Promise(r => setImmediate(r));
    for (let i = 0; i < 11; ++i) { component.handleInput('\x1b[B'); await settle(); }
    assert.equal(component.controller.session.focusedId, 'cancel');
    component.handleInput('\r'); await settle(); await running;
    assert.equal(opened, 2);
    await assert.rejects(stat(resolve(root, 'agent', 'voice-control.json')), { code: 'ENOENT' });
    await handlers.get('session_shutdown')();
  } finally {
    process.stdout.write = stdoutWrite;
    for (const [i, stream] of [process.stdin, process.stdout].entries()) { if (descriptors[i]) Object.defineProperty(stream, 'isTTY', descriptors[i]); else delete stream.isTTY; }
    if (envAgent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = envAgent;
    if (envFfmpeg === undefined) delete process.env.PI_VOICE_FFMPEG; else process.env.PI_VOICE_FFMPEG = envFfmpeg;
    await rm(root, { recursive: true, force: true });
  }
});
test('with the shortcut on F1, F1 still opens the panel help while /voice is open', async () => {
  const { getKeybindings } = await import('@earendil-works/pi-tui');
  const root = await mkdtemp(resolve(tmpdir(), 'voice-panel-f1-'));
  const descriptors = [process.stdin, process.stdout].map(s => Object.getOwnPropertyDescriptor(s, 'isTTY')); const stdoutWrite = process.stdout.write;
  const envAgent = process.env.PI_CODING_AGENT_DIR, envShortcut = process.env.PI_VOICE_SHORTCUT;
  const commands = new Map(), shortcuts = new Map(), handlers = new Map(); let input, component, closed;
  const api = { registerFlag() {}, getFlag: () => undefined, registerShortcut: (k, v) => shortcuts.set(k, v), registerCommand: (k, v) => commands.set(k, v), on: (k, h) => handlers.set(k, h) };
  const ui = {
    notify() {}, setWidget() {}, setStatus() {}, onTerminalInput: h => { input = h; return () => {}; }, pasteToEditor() { throw new Error('Must not paste'); },
    custom: factory => new Promise(done => { closed = done; component = factory({ terminal: { rows: 40 }, requestRender() {} }, { fg: (_c, s) => s, bold: s => s }, getKeybindings(), done); }),
  };
  try {
    process.env.PI_CODING_AGENT_DIR = resolve(root, 'agent'); process.env.PI_VOICE_SHORTCUT = 'f1';
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true }); Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
    process.stdout.write = function (data, ...args) { return String(data).includes('\x1b[?1004') ? true : stdoutWrite.call(this, data, ...args); };
    voiceControl(api); assert.ok(shortcuts.has('f1'));
    const ctx = { cwd: root, hasUI: true, ui, sessionManager: { getSessionId: () => 's', getLeafId: () => 'l' }, isProjectTrusted: () => false };
    await handlers.get('session_start')({}, ctx);
    const running = commands.get('voice').handler('', ctx); await new Promise(r => setImmediate(r));
    for (const f1 of ['\x1bOP', '\x1b[11~']) assert.equal(input(f1), undefined, `F1 ${JSON.stringify(f1)} reaches the panel`);
    component.handleInput('\x1bOP'); await component.drain();
    assert.equal(component.controller.help, true, 'F1 opens the panel help');
    component.handleInput('\x1b'); await component.drain(); assert.equal(component.controller.help, false);
    component.handleInput('\x1b'); await component.drain(); await running; assert.ok(closed);
    await handlers.get('session_shutdown')();
  } finally {
    process.stdout.write = stdoutWrite;
    for (const [i, stream] of [process.stdin, process.stdout].entries()) { if (descriptors[i]) Object.defineProperty(stream, 'isTTY', descriptors[i]); else delete stream.isTTY; }
    if (envAgent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = envAgent;
    if (envShortcut === undefined) delete process.env.PI_VOICE_SHORTCUT; else process.env.PI_VOICE_SHORTCUT = envShortcut;
    await rm(root, { recursive: true, force: true });
  }
});
