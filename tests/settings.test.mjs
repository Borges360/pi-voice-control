import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { settings } from '../dist/src/ui/settings.js';
import { defaults } from '../dist/src/config/validate.js';
import { VoiceError } from '../dist/src/core/types.js';
import { matchesKey, visibleWidth } from '@earendil-works/pi-tui';
import { tick } from './helpers.mjs';

const theme = { fg: (_c,s) => s, bg: (_c,s) => s, bold: s => s };
const keys = { matches: (data, key) => matchesKey(data, ({ 'tui.select.confirm':'enter', 'tui.select.cancel':'escape', 'tui.select.up':'up', 'tui.select.down':'down' })[key]) };
async function fixture(setupOverride = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'voice-settings-test-'));
  const loaded = { config:structuredClone(defaults), globalPath:join(dir,'voice.json'), projectPath:join(dir,'project.json'), ffmpegPath:'ffmpeg' };
  let panel, enumerated = 0; const abort = new AbortController();
  const recorder = { listDevices:async () => { ++enumerated; return [{ id:'Mic José',label:'Mic José' }]; }, start:async () => { throw new Error('Opening the menu must not record'); } };
  const ui = { custom:async factory => new Promise(resolve => { panel = factory({ terminal:{ rows:26 }, requestRender(){} },theme,keys,resolve); }), notify(){}, setWidget(){}, setStatus(){} };
  const prepared = [];
  const setup = { ensure:async model => { prepared.push(model); }, install:async model => { prepared.push(model); }, ...setupOverride };
  const task = settings(ui,loaded,recorder,abort.signal,{},setup); await tick();
  const key = async data => { panel.handleInput(data); await tick(); };
  const down = async count => { for (let i=0;i<count;++i) await key('\x1b[B'); };
  return { loaded, task, key, down, panel, prepared, enumerated:() => enumerated, cleanup:async () => { abort.abort(); await task; await rm(dir,{ recursive:true,force:true }); } };
}

test('menu opens immediately, without enumeration/capture/network; Esc preserves config',async () => {
  const f = await fixture();
  try {
    const rendered = f.panel.render(100).join('\n'); assert.match(rendered,/Voice \/ Configurações/); assert.match(rendered,/Ctrl\+S/); assert.match(rendered,/Whisper local/);
    assert.equal(f.enumerated(),0); await f.key('\x1b'); await f.task; await assert.rejects(stat(f.loaded.globalPath),{ code:'ENOENT' });
  } finally { await f.cleanup(); }
});
test('edit microphone/shortcut in one menu; only Ctrl+S persists and leaves panel open',async () => {
  const f = await fixture();
  try {
    await f.down(1); await f.key('\r'); await f.key('\r');
    assert.equal(f.enumerated(),1); await assert.rejects(stat(f.loaded.globalPath),{ code:'ENOENT' });
    await f.down(2); await f.key('\r'); await f.down(1); await f.key('\r');
    await f.key('\x13'); await f.panel.drain();
    const data = JSON.parse(await readFile(f.loaded.globalPath,'utf8')); assert.equal(data.shortcut,'f9'); assert.equal(data.capture.deviceId,'Mic José');
    assert.match(f.panel.render(100).join('\n'),/Salvo/); await f.key('\x1b'); await f.task;
  } finally { await f.cleanup(); }
});
test('exactly three local models; selecting is a draft, Ctrl+S prepares then saves',async () => {
  const f = await fixture();
  try {
    await f.key('\r');
    const menu = f.panel.render(110).join('\n');
    for (const name of ['tiny','base','small']) assert.match(menu,new RegExp(name));
    assert.doesNotMatch(menu,/OpenRouter|Endpoint|Credencial|Provedor/);
    await f.down(2); await f.key('\r');
    assert.match(f.panel.render(110).join('\n'),/Whisper small/);
    assert.deepEqual(f.prepared,[]); await assert.rejects(stat(f.loaded.globalPath),{code:'ENOENT'});
    await f.key('\x13'); await f.panel.drain();
    assert.deepEqual(f.prepared,['small']);
    assert.equal(JSON.parse(await readFile(f.loaded.globalPath,'utf8')).transcription.model,'small');
  } finally { await f.cleanup(); }
});

test('failed or cancelled model download never saves the selected model',async () => {
  for (const cancelled of [false,true]) {
    const f = await fixture({ensure:async (_model,signal) => {
      if (!cancelled) throw new VoiceError('LOCAL_INSTALL','Download indisponível.');
      await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));
      signal.throwIfAborted();
    }});
    try {
      await f.key('\r'); await f.down(1); await f.key('\r'); await f.key('\x13');
      if(cancelled) await f.key('\x1b');
      await f.panel.drain();
      await assert.rejects(stat(f.loaded.globalPath),{code:'ENOENT'});
      assert.equal(f.loaded.config.transcription.model,'tiny');
      assert.match(f.panel.render(110).join('\n'),cancelled?/cancelad/i:/Download indisponível/);
    } finally { await f.cleanup(); }
  }
});

test('dirty Esc asks before discard, cancelled edit and abort never write',async () => {
  const f = await fixture();
  try {
    await f.down(2); await f.key('\r'); await f.key('\x1b');
    await f.key('\r'); await f.key('\x15'); await f.key('en'); await f.key('\r');
    await f.key('\x1b'); assert.match(f.panel.render(100).join('\n'),/Alterações não salvas/);
    await f.key('\x1b'); await f.task; await assert.rejects(stat(f.loaded.globalPath),{ code:'ENOENT' });
  } finally { await f.cleanup(); }
});
test('panel renders Unicode without overflow at narrow/wide terminal widths',async () => {
  const f = await fixture();
  try { for (const width of [12,24,40,80,120]) for (const line of f.panel.render(width)) assert.ok(visibleWidth(line)<=width,`${visibleWidth(line)} > ${width}`); }
  finally { await f.cleanup(); }
});
