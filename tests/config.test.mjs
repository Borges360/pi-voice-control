import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv from 'ajv';
import { defaults, validateConfig, mergeConfig } from '../dist/src/config/validate.js';
import { loadConfig, saveGlobal } from '../dist/src/config/load.js';

test('defaults and both examples satisfy real JSON schema and runtime validation', async () => {
  const schema = JSON.parse(await readFile(new URL('../schemas/voice-control.schema.json', import.meta.url), 'utf8'));
  const validate = new Ajv().compile(schema);
  for (const value of [defaults, ...await Promise.all(['local','remote','openrouter'].map(async name => JSON.parse(await readFile(new URL(`../examples/voice-control.${name}.json`, import.meta.url), 'utf8'))))]) {
    assert.ok(validate(value), JSON.stringify(validate.errors)); assert.ok(validateConfig(mergeConfig(defaults, value)));
  }
});
test('reject unsafe options, unknown fields, secrets, bounds, malformed profiles', () => {
  for (const patch of [
    { shortcut: 'enter' }, { shortcut: 'ctrl+ctrl+f8' }, { ui: { fps: 11 } }, { ui: { bars: 1000 } },
    { capture: { maxSeconds: 121 } }, { capture: { sampleRate: 44100 } }, { capture: { deviceId: '\n' } },
    { privacy: { retainAudio: true } }, { transcription: { autoSubmit: true } }, { transcription: { cloudFallback: true } },
    { transcription: { profile: 'missing' } }, { transcription: { profiles: { local: { apiKey: 'do not print' } } } },
    { transcription: { profiles: { local: { apiKeyEnv: 'not a name' } } } }, { language: '???' }, { random: true },
  ]) assert.throws(() => validateConfig(mergeConfig(defaults, patch)));
  assert.throws(() => mergeConfig(defaults, JSON.parse('{"__proto__":{"polluted":true}}')));
  assert.equal({}.polluted, undefined);
});
test('global/project/env/CLI precedence; project never grants consent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'voice-config-test-')); const home = join(root, 'home'), cwd = join(root, 'project');
  try {
    await mkdir(join(home, '.pi','agent'), { recursive: true }); await mkdir(join(cwd, '.pi'), { recursive: true });
    await writeFile(join(home, '.pi','agent','voice-control.json'), JSON.stringify({ language: 'en', ui: { bars: 16 }, remoteConsents: ['a'.repeat(64)] }));
    await writeFile(join(cwd, '.pi','voice-control.json'), JSON.stringify({ language: 'es', ui: { fps: 5 } }));
    const l = loadConfig(cwd, { PI_VOICE_LANGUAGE: 'de', PI_VOICE_FFMPEG: '/path with spaces/ffmpeg' }, { language: 'pt' }, home);
    assert.equal(l.config.language, 'pt'); assert.equal(l.config.ui.bars, 16); assert.equal(l.config.ui.fps, 5); assert.equal(l.ffmpegPath, '/path with spaces/ffmpeg'); assert.equal(l.consents.length, 1);
    assert.equal(loadConfig(cwd, {}, {}, home).config.language, 'es');
    await saveGlobal(l.globalPath, l.config, l.consents); assert.ok(JSON.parse(await readFile(l.globalPath, 'utf8')).remoteConsents); assert.deepEqual((await readdir(join(home, '.pi','agent'))), ['voice-control.json']);
    await writeFile(l.projectPath, JSON.stringify({ remoteConsents: ['b'.repeat(64)] })); assert.throws(() => loadConfig(cwd, {}, {}, home), /Consentimento/);
    await writeFile(l.projectPath, '{'); assert.throws(() => loadConfig(cwd, {}, {}, home), /JSON/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
