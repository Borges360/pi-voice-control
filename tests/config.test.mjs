import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv from 'ajv';
import { defaults, validateConfig, mergeConfig } from '../dist/src/config/validate.js';
import { loadConfig, saveGlobal } from '../dist/src/config/load.js';

test('defaults and all local model examples satisfy real JSON schema and runtime validation', async () => {
  const schema = JSON.parse(await readFile(new URL('../schemas/voice-control.schema.json', import.meta.url), 'utf8'));
  const validate = new Ajv().compile(schema);
  for (const value of [defaults, ...await Promise.all(['local','base','small'].map(async name => JSON.parse(await readFile(new URL(`../examples/voice-control.${name}.json`, import.meta.url), 'utf8'))))]) {
    assert.ok(validate(value), JSON.stringify(validate.errors)); assert.ok(validateConfig(mergeConfig(defaults, value)));
  }
});
test('reject unsafe options, unknown fields, secrets, bounds, unsupported models or providers', () => {
  for (const patch of [
    { shortcut: 'enter' }, { shortcut: 'ctrl+ctrl+f8' }, { ui: { fps: 11 } }, { ui: { bars: 1000 } },
    { capture: { maxSeconds: 121 } }, { capture: { sampleRate: 44100 } }, { capture: { deviceId: '\n' } },
    { privacy: { retainAudio: true } }, { transcription: { autoSubmit: true } }, { transcription: { cloudFallback: true } },
    { transcription: { model: 'large-v3' } }, { transcription: { model: 'tinny' } },
    { transcription: { endpoint: 'https://example.com' } }, { transcription: { profiles: {} } }, { language: '???' }, { random: true },
  ]) assert.throws(() => validateConfig(mergeConfig(defaults, patch)));
  assert.throws(() => mergeConfig(defaults, JSON.parse('{"__proto__":{"polluted":true}}')));
  assert.equal({}.polluted, undefined);
});
test('global/project/env/CLI model precedence; save contains only local settings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'voice-config-test-')); const home = join(root, 'home'), cwd = join(root, 'project');
  try {
    await mkdir(join(home, '.pi','agent'), { recursive: true }); await mkdir(join(cwd, '.pi'), { recursive: true });
    await writeFile(join(home, '.pi','agent','voice-control.json'), JSON.stringify({ language: 'en', ui: { bars: 16 }, remoteConsents: ['a'.repeat(64)] }));
    await writeFile(join(cwd, '.pi','voice-control.json'), JSON.stringify({ language: 'es', ui: { fps: 5 }, transcription: { model: 'base' } }));
    const l = loadConfig(cwd, { PI_VOICE_LANGUAGE: 'de', PI_VOICE_MODEL: 'small', PI_VOICE_FFMPEG: '/path with spaces/ffmpeg' }, { language: 'pt', transcription: { model: 'tiny' } }, home);
    assert.equal(l.config.language, 'pt'); assert.equal(l.config.ui.bars, 16); assert.equal(l.config.ui.fps, 5); assert.equal(l.ffmpegPath, '/path with spaces/ffmpeg'); assert.equal(l.config.transcription.model, 'tiny');
    assert.equal(loadConfig(cwd, {}, {}, home).config.language, 'es'); assert.equal(loadConfig(cwd, {}, {}, home).config.transcription.model, 'base');
    assert.equal(loadConfig(cwd, { PI_VOICE_MODEL: 'small' }, {}, home).config.transcription.model, 'small');
    await saveGlobal(l.globalPath, l.config); assert.equal(JSON.parse(await readFile(l.globalPath, 'utf8')).remoteConsents, undefined); assert.deepEqual((await readdir(join(home, '.pi','agent'))), ['voice-control.json']);
    await writeFile(l.projectPath, JSON.stringify({ remoteConsents: ['b'.repeat(64)] })); assert.equal(loadConfig(cwd, {}, {}, home).migrated, true);
    await writeFile(l.projectPath, '{'); assert.throws(() => loadConfig(cwd, {}, {}, home), /JSON/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('legacy remote profiles are removed without rewriting files or losing other preferences', async () => {
  const root = await mkdtemp(join(tmpdir(), 'voice-migrate-'));
  try {
    await mkdir(join(root, '.pi','agent'), { recursive: true });
    const path = join(root, '.pi','agent','voice-control.json');
    const old = JSON.stringify({ shortcut:'f9', language:'es', capture:{deviceId:'Meu mic'}, transcription:{ profile:'openrouter', profiles:{openrouter:{ type:'openrouter',endpoint:'https://example.com/v1/audio/transcriptions',model:'remote',apiKeyEnv:'OLD_KEY'}}, cloudFallback:false }, remoteConsents:['a'.repeat(64)] });
    await writeFile(path, old);
    const loaded = loadConfig(join(root,'project'), {}, {}, root);
    assert.equal(loaded.migrated,true); assert.equal(loaded.config.transcription.model,'tiny');
    assert.equal(loaded.config.shortcut,'f9'); assert.equal(loaded.config.capture.deviceId,'Meu mic');
    assert.equal(loaded.config.language,'es'); assert.equal(await readFile(path,'utf8'),old);
    await saveGlobal(path,loaded.config);
    assert.doesNotMatch(await readFile(path,'utf8'),/endpoint|OLD_KEY|remoteConsents|profiles|cloudFallback/);
    await writeFile(path,JSON.stringify({transcription:{profile:'builtin',profiles:{builtin:{type:'local',model:'onnx-community/whisper-small'}}}}));
    assert.equal(loadConfig(join(root,'project'), {}, {}, root).config.transcription.model,'small');
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('installation default is used only below saved settings and overrides',async()=>{
  const home=await mkdtemp(join(tmpdir(),'voice-install-default-'));
  try {
    const cache=join(home,'.pi','agent','cache','voice-control'); await mkdir(cache,{recursive:true});
    await writeFile(join(cache,'default-model.json'),JSON.stringify({model:'small'}));
    assert.equal(loadConfig(join(home,'project'),{},{},home).config.transcription.model,'small');
    await saveGlobal(join(home,'.pi','agent','voice-control.json'),defaults);
    assert.equal(loadConfig(join(home,'project'),{},{},home).config.transcription.model,'tiny');
    assert.equal(loadConfig(join(home,'project'),{PI_VOICE_MODEL:'base'},{},home).config.transcription.model,'base');
  } finally { await rm(home,{recursive:true,force:true}); }
});
