// Drives the real /voice panel (vendored Pi settings adapter) by terminal bytes, with the real
// pi-tui KeybindingsManager. No microphone, FFmpeg, network or model download is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rmdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getKeybindings, visibleWidth } from '@earendil-works/pi-tui';
import { settings } from '../dist/src/ui/settings.js';
import { defaults } from '../dist/src/config/validate.js';
import { loadConfig } from '../dist/src/config/load.js';
import { VoiceError } from '../dist/src/core/types.js';
import { loadProjectLocale, LocaleSaveError, saveProjectLocale } from '../dist/src/i18n.js';
import { deferred, tick } from './helpers.mjs';

const KEY = { up: '\x1b[A', down: '\x1b[B', enter: '\r', esc: '\x1b', ctrlS: '\x13', ctrlU: '\x15' };
const plain = { fg: (_c, s) => s, bold: s => s };
const ORDER = ['model', 'microphone', 'language', 'shortcut', 'interface-language',
  'connection', 'install', 'mic-test', 'stt-test', 'doctor', 'start', 'cancel'];
const position = id => ORDER.indexOf(id === 'stop' ? 'start' : id);

async function fixture({ setup = {}, context = {}, recorder = {}, loaded: makeLoaded, rows = 30 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'voice-settings-test-'));
  const loaded = makeLoaded ? await makeLoaded(dir)
    : { config: structuredClone(defaults), globalPath: join(dir, 'voice.json'), projectPath: join(dir, 'project.json'), ffmpegPath: 'ffmpeg' };
  let panel, enumerated = 0, captured = 0, closed = false; const notices = [], overlays = [];
  const abort = new AbortController();
  const rec = {
    listDevices: async () => { ++enumerated; return [{ id: 'Mic José', label: 'Mic José' }, { id: 'usb', label: 'マイク USB 🎙️ Microphone (Realtek High Definition Audio)' }]; },
    start: async () => { ++captured; throw new Error('Opening or navigating the menu must not record'); },
    ...recorder,
  };
  const ui = {
    custom: (factory, options) => new Promise(resolve => {
      overlays.push(options);
      panel = factory({ terminal: { rows }, requestRender() {} }, plain, getKeybindings(), value => { closed = true; resolve(value); });
    }),
    notify: (m, kind) => notices.push({ m, kind }), setWidget() {}, setStatus() {},
  };
  const prepared = [], installed = [];
  const setupImpl = { ensure: async model => { prepared.push(model); }, install: async model => { installed.push(model); }, ...setup };
  const task = settings(ui, loaded, rec, abort.signal, context, setupImpl);
  await tick();
  const settle = async () => { for (let i = 0; i < 3; ++i) { await panel.drain(); await tick(); } };
  const key = async data => { panel.handleInput(data); await settle(); };
  const keys = async (...data) => { for (const d of data) await key(d); };
  const focused = () => panel.controller.session.focusedId;
  const goto = async id => {
    let current = position(focused());
    while (current < position(id)) { await key(KEY.down); current++; }
    while (current > position(id)) { await key(KEY.up); current--; }
    assert.equal(focused(), id);
  };
  const screen = (width = 100) => panel.render(width).join('\n');
  return {
    dir, loaded, task, key, keys, goto, screen, focused, prepared, installed, notices, overlays, abort, settle,
    panel: () => panel, closed: () => closed, enumerated: () => enumerated, captured: () => captured,
    cleanup: async () => { abort.abort(); await task.catch(() => {}); await rm(dir, { recursive: true, force: true }); },
  };
}

test('/voice opens at once without enumeration, capture, network or writes; Esc on a clean panel closes', async () => {
  const f = await fixture();
  try {
    const s = f.screen(120);
    for (const text of ['Voice / Settings', 'local Whisper', 'Model', 'Whisper tiny · ~45 MB', 'Microphone', 'Transcription language',
      'Shortcut', 'Language', 'English', 'Check model', 'Prepare model', 'Download / repair', 'Test microphone', 'Test dictation',
      'Diagnostics', 'Start dictation', 'Cancel dictation', 'Ctrl+S save', 'Esc close']) assert.ok(s.includes(text), `missing ${text}`);
    assert.equal(f.enumerated(), 0); assert.equal(f.captured(), 0);
    assert.deepEqual(f.prepared, []); assert.deepEqual(f.installed, []);
    await f.key(KEY.esc);
    assert.equal(await f.task, undefined); assert.equal(f.closed(), true);
    await assert.rejects(stat(f.loaded.globalPath), { code: 'ENOENT' });
  } finally { await f.cleanup(); }
});

test('microphone choices load only on Enter; edits are drafts; Ctrl+S saves and keeps the panel open', async () => {
  const f = await fixture();
  try {
    await f.goto('microphone'); assert.equal(f.enumerated(), 0);
    await f.key(KEY.enter); assert.equal(f.enumerated(), 1);
    assert.match(f.screen(), /Mic José/); await f.keys(KEY.down, KEY.enter);
    await f.goto('shortcut'); await f.keys(KEY.enter, KEY.down, KEY.enter);
    assert.match(f.screen(), /Voice \/ Settings \*/); assert.match(f.screen(), /F9 \(\/reload pending\)/);
    await assert.rejects(stat(f.loaded.globalPath), { code: 'ENOENT' });
    await f.key(KEY.ctrlS);
    const data = JSON.parse(await readFile(f.loaded.globalPath, 'utf8'));
    assert.equal(data.shortcut, 'f9'); assert.equal(data.capture.deviceId, 'usb');
    assert.equal(f.closed(), false);
    assert.match(f.screen(), /Saved\. Project\/env\/CLI overrides keep precedence\./);
    assert.doesNotMatch(f.screen(), /Voice \/ Settings \*/);
    await f.key(KEY.esc); await f.task;
  } finally { await f.cleanup(); }
});

test('exactly three local models; selecting is a draft; Ctrl+S prepares then saves', async () => {
  const f = await fixture();
  try {
    await f.key(KEY.enter);
    const menu = f.screen(110);
    for (const name of ['tiny — ~45 MB · lighter', 'base', 'small']) assert.ok(menu.includes(name), `missing ${name}`);
    assert.doesNotMatch(menu, /OpenRouter|Endpoint|Credential|Provider/);
    await f.keys(KEY.down, KEY.down, KEY.enter);
    assert.match(f.screen(110), /Whisper small/);
    assert.deepEqual(f.prepared, []); await assert.rejects(stat(f.loaded.globalPath), { code: 'ENOENT' });
    await f.key(KEY.ctrlS);
    assert.deepEqual(f.prepared, ['small']);
    assert.equal(JSON.parse(await readFile(f.loaded.globalPath, 'utf8')).transcription.model, 'small');
  } finally { await f.cleanup(); }
});

test('failed or Esc-cancelled model download never saves and keeps the draft for Ctrl+S', async () => {
  for (const cancelled of [false, true]) {
    let attempts = 0;
    const f = await fixture({ setup: { ensure: async (_model, signal, progress) => {
      ++attempts; progress('Downloading Whisper small (~465 MB)…');
      if (!cancelled) throw new VoiceError('LOCAL_INSTALL', 'Download unavailable.');
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      throw new VoiceError('CANCELLED', 'Local operation canceled.');
    } } });
    try {
      await f.keys(KEY.enter, KEY.down, KEY.down, KEY.enter);
      f.panel().handleInput(KEY.ctrlS); await tick();
      if (cancelled) {
        assert.match(f.screen(110), /Downloading Whisper small/); assert.match(f.screen(110), /Esc cancel save/);
        await f.key(KEY.esc);
      } else await f.settle();
      await assert.rejects(stat(f.loaded.globalPath), { code: 'ENOENT' });
      assert.match(f.screen(110), cancelled ? /Save cancelled\. Your draft was kept\./ : /Download unavailable\. \[LOCAL_INSTALL\]/);
      assert.match(f.screen(110), /Voice \/ Settings \*/); assert.match(f.screen(110), /Whisper small/);
      assert.equal(f.closed(), false); assert.equal(attempts, 1);
    } finally { await f.cleanup(); }
  }
});

test('Esc in a field goes back without applying; dirty Esc warns, second Esc discards and closes', async () => {
  const f = await fixture();
  try {
    await f.goto('language'); await f.key(KEY.enter);
    await f.keys(KEY.ctrlU, 'e', 'n', KEY.esc);
    assert.equal(f.closed(), false); assert.match(f.screen(), /Transcription language\s+pt\b/);
    await f.keys(KEY.enter, KEY.ctrlU, 'e', 'n', KEY.enter);
    assert.match(f.screen(), /Transcription language\s+en\b/);
    await f.key(KEY.esc);
    assert.equal(f.closed(), false); assert.match(f.screen(), /There are unsaved changes\./); assert.match(f.screen(), /Press Esc again to discard/);
    await f.key(KEY.esc);
    assert.equal(await f.task, undefined); assert.equal(f.closed(), true);
    await assert.rejects(stat(f.loaded.globalPath), { code: 'ENOENT' });
  } finally { await f.cleanup(); }
});

test('invalid transcription language is refused in the field and never saved', async () => {
  const f = await fixture();
  try {
    await f.goto('language'); await f.keys(KEY.enter, KEY.ctrlU, '!', '!', KEY.enter);
    assert.match(f.screen(), /Use auto or a language code such as pt, en or es\./);
    await f.key(KEY.ctrlS);
    await assert.rejects(stat(f.loaded.globalPath), { code: 'ENOENT' });
  } finally { await f.cleanup(); }
});

test('Ctrl+S while editing commits the field then saves; an unknown error never leaks its payload', async () => {
  let attempts = 0;
  const f = await fixture({ setup: { ensure: async () => { if (++attempts === 1) throw new Error('upstream private payload'); } } });
  try {
    await f.goto('language'); await f.keys(KEY.enter, KEY.ctrlU, 'e', 's', KEY.ctrlS);
    assert.ok(!f.screen().includes('private payload'));
    assert.match(f.screen(), /Voice operation failed; run \/voice doctor\. \[INTERNAL\]/);
    await assert.rejects(stat(f.loaded.globalPath), { code: 'ENOENT' });
    await f.key(KEY.ctrlS);
    assert.equal(JSON.parse(await readFile(f.loaded.globalPath, 'utf8')).language, 'es');
    assert.equal(f.closed(), false);
  } finally { await f.cleanup(); }
});

test('failed config write keeps its draft available for a later Ctrl+S retry', async () => {
  const f = await fixture();
  try {
    await mkdir(f.loaded.globalPath);
    await f.keys(KEY.enter, KEY.down, KEY.down, KEY.enter, KEY.ctrlS);
    assert.match(f.screen(110), /Voice \/ Settings \*/); assert.match(f.screen(110), /\[INTERNAL\]/);
    assert.deepEqual(f.prepared, ['small']);
    await rmdir(f.loaded.globalPath);
    await f.key(KEY.ctrlS);
    assert.equal(JSON.parse(await readFile(f.loaded.globalPath, 'utf8')).transcription.model, 'small');
    assert.deepEqual(f.prepared, ['small', 'small']);
  } finally { await f.cleanup(); }
});

test('renders within 40/80/120 columns with Unicode device names, and asks to resize below 40x12', async () => {
  const f = await fixture();
  try {
    const check = label => { for (const width of [40, 80, 120]) for (const line of f.panel().render(width)) assert.ok(visibleWidth(line) <= width, `${label}: ${visibleWidth(line)} > ${width}: ${line}`); };
    check('list');
    await f.goto('microphone'); await f.key(KEY.enter); check('choices');
    await f.keys(KEY.down, KEY.enter); check('chosen');
    assert.match(f.screen(120), /マイク USB/);
    await f.goto('language'); await f.key(KEY.enter); check('editing'); await f.key(KEY.esc);
    await f.key(KEY.esc); check('decision');
    for (const width of [20, 39]) {
      const lines = f.panel().render(width);
      for (const line of lines) assert.ok(visibleWidth(line) <= width);
      assert.match(lines.join(' '), /Terminal too small/);
    }
    assert.equal(f.overlays[0].overlayOptions.minWidth, 40);
  } finally { await f.cleanup(); }
});

test('language preview switches the panel live; Ctrl+S saves only the project locale', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'voice-locale-settings-'));
  const projectRoot = join(scratch, 'project'); await mkdir(projectRoot);
  let locale = 'en';
  const f = await fixture({ context: { trusted: true, locale: () => locale, onLocaleChange: next => { locale = next; },
    saveLocale: next => saveProjectLocale(projectRoot, true, next) } });
  try {
    await f.goto('interface-language'); await f.keys(KEY.enter, KEY.down, KEY.enter);
    assert.equal(locale, 'pt-BR');
    const preview = f.screen(120);
    for (const text of ['Voz / Configurações *', 'Idioma', 'Português (Brasil)', 'Modelo', 'Microfone', 'Verificar modelo', 'Testar ditado', 'Ctrl+S salvar'])
      assert.ok(preview.includes(text), `missing ${text}`);
    for (const english of ['Voice / Settings', 'Check model', 'Test dictation', 'navigate', 'Ctrl+S save']) assert.ok(!preview.includes(english), `English left: ${english}`);
    for (const width of [40, 80, 120]) for (const line of f.panel().render(width)) assert.ok(visibleWidth(line) <= width);
    await f.keys(KEY.enter, KEY.up, KEY.enter);
    assert.equal(locale, 'en'); assert.match(f.screen(), /Voice \/ Settings/); assert.doesNotMatch(f.screen(120), /Configurações|navegar|Salvar|Idioma/);
    await f.keys(KEY.enter, KEY.down, KEY.enter); assert.equal(locale, 'pt-BR');
    await f.key(KEY.ctrlS);
    assert.equal(loadProjectLocale(projectRoot, true), 'pt-BR');
    assert.match(f.screen(), /Salvo\. As substituições do projeto\/env\/CLI continuam tendo precedência\./);
    assert.deepEqual(f.prepared, []);
    await assert.rejects(stat(f.loaded.globalPath), { code: 'ENOENT' });
    await f.key(KEY.esc); await f.task; assert.equal(locale, 'pt-BR');
  } finally { await f.cleanup(); await rm(scratch, { recursive: true, force: true }); }
});

test('discarding a language preview restores English and writes no preference', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'voice-locale-discard-'));
  const projectRoot = join(scratch, 'project'); await mkdir(projectRoot);
  let locale = 'en';
  const f = await fixture({ context: { trusted: true, locale: () => locale, onLocaleChange: next => { locale = next; },
    saveLocale: next => saveProjectLocale(projectRoot, true, next) } });
  try {
    await f.goto('interface-language'); await f.keys(KEY.enter, KEY.down, KEY.enter);
    assert.equal(locale, 'pt-BR');
    await f.key(KEY.esc); assert.match(f.screen(), /Há alterações não salvas/);
    await f.key(KEY.esc); await f.task;
    assert.equal(locale, 'en');
    assert.equal(loadProjectLocale(projectRoot, true), 'en');
    await assert.rejects(stat(join(projectRoot, '.pi', 'pi-voice-control.locale.json')), { code: 'ENOENT' });
  } finally { await f.cleanup(); await rm(scratch, { recursive: true, force: true }); }
});

test('failed locale write keeps the preview dirty and retries without preparing a model', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'voice-locale-retry-'));
  const projectRoot = join(scratch, 'project'); await mkdir(projectRoot);
  let locale = 'en', attempts = 0;
  const f = await fixture({ context: { trusted: true, locale: () => locale, onLocaleChange: next => { locale = next; },
    saveLocale: async next => { if (++attempts === 1) throw new LocaleSaveError(); await saveProjectLocale(projectRoot, true, next); } } });
  try {
    await f.goto('interface-language'); await f.keys(KEY.enter, KEY.down, KEY.enter, KEY.ctrlS);
    assert.equal(attempts, 1); assert.equal(loadProjectLocale(projectRoot, true), 'en');
    assert.match(f.screen(), /Não foi possível salvar a preferência de idioma/);
    assert.match(f.screen(), /Configurações \*/);
    await f.key(KEY.ctrlS);
    assert.equal(attempts, 2); assert.equal(loadProjectLocale(projectRoot, true), 'pt-BR');
    assert.deepEqual(f.prepared, []);
    await assert.rejects(stat(f.loaded.globalPath), { code: 'ENOENT' });
  } finally { await f.cleanup(); await rm(scratch, { recursive: true, force: true }); }
});

test('untrusted project keeps English: the language row is locked with the reason', async () => {
  const f = await fixture({ context: { trusted: false } });
  try {
    assert.match(f.screen(120), /\[locked: project trust\]/);
    await f.goto('interface-language'); await f.key(KEY.enter);
    assert.match(f.screen(120), /Project trust is required to change the interface language\./);
    assert.doesNotMatch(f.screen(120), /Português/);
  } finally { await f.cleanup(); }
});

test('project/env/CLI overrides show their source, are not editable and never leak into the global file', async () => {
  const f = await fixture({ loaded: async dir => {
    await mkdir(join(dir, 'project', '.pi'), { recursive: true });
    await writeFile(join(dir, 'project', '.pi', 'voice-control.json'), JSON.stringify({ capture: { deviceId: 'project mic' } }));
    return loadConfig(join(dir, 'project'), { PI_CODING_AGENT_DIR: join(dir, 'agent'), PI_VOICE_MODEL: 'base' }, { language: 'es' }, dir);
  } });
  try {
    const s = f.screen(120);
    assert.match(s, /Whisper base.*\[source: PI_VOICE_MODEL\]/); assert.match(s, /project mic.*\[source: \.pi\/voice-control\.json\]/);
    assert.match(s, /es.*\[source: --voice-language\]/);
    await f.key(KEY.enter); assert.match(f.screen(120), /PI_VOICE_MODEL\. Change it at the source|set by PI_VOICE_MODEL/);
    await f.goto('shortcut'); await f.keys(KEY.enter, KEY.down, KEY.enter, KEY.ctrlS);
    const saved = JSON.parse(await readFile(f.loaded.globalPath, 'utf8'));
    assert.equal(saved.shortcut, 'f9');
    assert.equal(saved.transcription.model, 'tiny'); assert.equal(saved.capture.deviceId, 'default'); assert.equal(saved.language, 'pt');
    assert.deepEqual(f.prepared, ['tiny']);
  } finally { await f.cleanup(); }
});

test('confirmed test action starts on Go back; Esc cancels the running capture and the panel stays usable', async () => {
  const started = deferred(); let aborted = false;
  const f = await fixture({ recorder: { start: async (_options, signal) => {
    started.resolve();
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    aborted = true; throw new VoiceError('CANCELLED', 'Recording canceled.');
  } } });
  try {
    await f.goto('mic-test'); await f.key(KEY.enter);
    assert.match(f.screen(), /Record from the microphone for 2 seconds\?/); assert.match(f.screen(), />\s*\[Go back\]/);
    await f.key(KEY.enter); assert.doesNotMatch(f.screen(), /Record from the microphone/);
    await f.keys(KEY.enter, KEY.down);
    f.panel().handleInput(KEY.enter); await started.promise; await tick();
    assert.match(f.screen(), /Esc cancel/);
    await f.key(KEY.esc);
    assert.equal(aborted, true); assert.match(f.screen(), /Operation cancelled\./);
    assert.equal(f.closed(), false);
    await f.key(KEY.down); assert.equal(f.focused(), 'stt-test');
  } finally { await f.cleanup(); }
});

test('a result that arrives after Esc is reported but not used', async () => {
  const gate = deferred();
  const f = await fixture({ setup: { install: async (_model, _signal, progress) => { progress('Downloading and preparing local Whisper…'); await gate.promise; } } });
  try {
    await f.goto('install'); f.panel().handleInput(KEY.enter); await tick(); await tick();
    assert.match(f.screen(), /Downloading and preparing local Whisper…/);
    f.panel().handleInput(KEY.esc); await tick(); gate.resolve(); await f.settle();
    assert.match(f.screen(), /Prepare model finished before the cancellation took effect/);
    assert.doesNotMatch(f.screen(), /Model is ready/);
    assert.equal(f.closed(), false);
  } finally { await f.cleanup(); }
});

test('start dictation needs a saved draft; cancel closes at once and returns its action', async () => {
  const f = await fixture();
  try {
    await f.keys(KEY.enter, KEY.down, KEY.enter);
    await f.goto('start'); await f.key(KEY.enter);
    assert.equal(f.closed(), false); assert.match(f.screen(), /Press Ctrl\+S to save changes before starting dictation\./);
    await f.key(KEY.ctrlS); await f.key(KEY.enter);
    assert.equal(await f.task, 'start');
  } finally { await f.cleanup(); }
  const g = await fixture({ context: { state: 'RECORDING' } });
  try {
    assert.match(g.screen(), /Stop and transcribe/);
    await g.keys(KEY.enter, KEY.down, KEY.enter);
    await g.goto('cancel'); await g.key(KEY.enter); assert.equal(await g.task, 'cancel');
  } finally { await g.cleanup(); }
});

test('while dictation is busy, checks and tests are unavailable and the microphone list says why', async () => {
  const f = await fixture({ context: { busy: true } });
  try {
    assert.match(f.screen(120), /unavailable: stop or cancel dictation first/);
    await f.goto('microphone'); await f.key(KEY.enter);
    assert.equal(f.enumerated(), 0); assert.match(f.screen(120), /Stop or cancel dictation before changing settings or running a test\. \[BUSY\]/);
    await f.goto('doctor'); await f.key(KEY.enter); assert.match(f.screen(120), /Unavailable: stop or cancel dictation first/);
  } finally { await f.cleanup(); }
});

test('parent abort closes the panel and cancels the running operation', async () => {
  let signalSeen;
  const f = await fixture({ setup: { install: (_m, signal) => { signalSeen = signal; return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new VoiceError('CANCELLED', 'x')), { once: true })); } } });
  try {
    await f.goto('install'); f.panel().handleInput(KEY.enter); await tick(); await tick();
    f.abort.abort();
    assert.equal(await f.task, undefined); assert.equal(f.closed(), true); assert.equal(signalSeen.aborted, true);
  } finally { await f.cleanup(); }
});

test('a save that never confirms becomes unknown; Ctrl+S reads storage instead of writing again', async () => {
  let reads = 0;
  const f = await fixture({
    setup: { ensure: () => new Promise(() => {}) },
    context: { reload: () => { ++reads; return { config: structuredClone(defaults), globalPath: '', projectPath: '', ffmpegPath: 'ffmpeg' }; } },
  });
  try {
    await f.keys(KEY.enter, KEY.down, KEY.enter);
    f.panel().handleInput(KEY.ctrlS); await tick();
    f.panel().handleInput(KEY.esc);
    await new Promise(resolve => setTimeout(resolve, 1700)); await f.settle();
    assert.match(f.screen(110), /not confirmed|could not be confirmed/i);
    await f.key(KEY.ctrlS);
    assert.equal(reads, 1); await assert.rejects(stat(f.loaded.globalPath), { code: 'ENOENT' });
    assert.match(f.screen(110), /Voice \/ Settings \*/);
  } finally { await f.cleanup(); }
});
