import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CATALOG, loadProjectLocale, saveProjectLocale, translate, translateText } from '../dist/src/i18n.js';

test('every stable message key has a non-empty English/Portuguese pair with matching placeholders', () => {
  const keys = Object.keys(CATALOG);
  assert.ok(keys.length >= 100);
  for (const key of keys) {
    const message = CATALOG[key];
    assert.equal(typeof message.en, 'string', `${key} has no English text`);
    assert.equal(typeof message['pt-BR'], 'string', `${key} has no Brazilian Portuguese text`);
    assert.ok(message.en.length > 0 && message['pt-BR'].length > 0, `${key} has an empty translation`);
    const placeholders = value => [...value.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)].map(match => match[1]).sort();
    assert.deepEqual(placeholders(message['pt-BR']), placeholders(message.en), `${key} placeholder mismatch`);
  }
});

test('English is the safe default and catalog interpolation preserves runtime values', () => {
  assert.equal(loadProjectLocale('missing-project-for-i18n', true), 'en');
  assert.equal(loadProjectLocale('missing-project-for-i18n', false), 'en');
  assert.equal(translateText('A user supplied backend message.', 'pt-BR'), 'A user supplied backend message.');
  assert.equal(translateText('No speech detected.', 'pt-BR'), 'Nenhuma fala detectada.');
  assert.equal(translateText('Invalid configuration: transcription.timeoutMs.', 'pt-BR'), 'Configuração inválida: transcription.timeoutMs.');
  assert.equal(translateText('Could not read voice-control.json; check the JSON (128 KiB limit).', 'pt-BR'), 'Não foi possível ler voice-control.json; verifique o JSON (limite de 128 KiB).');
  assert.equal(translateText('STT response is invalid or too long.', 'pt-BR'), 'A resposta de STT é inválida ou longa demais.');
  assert.equal(translate('voice.status', 'pt-BR', {
    state: 'RECORDING', device: 'Microfone USB', model: 'small', language: 'auto', shortcut: 'F8', pending: '',
  }), 'Voz: RECORDING | microfone: Microfone USB | modelo local: small | idioma da transcrição: auto | atalho: F8');
  assert.equal(translateText('Model device: DirectSound (Mic José). [FFMPEG_MISSING]', 'pt-BR'), 'Model device: DirectSound (Mic José). [FFMPEG_MISSING]');
});

test('untrusted projects cannot load or persist a language preference', async () => {
  const root = await mkdtemp(join(tmpdir(), 'voice-i18n-untrusted-'));
  try {
    await assert.rejects(saveProjectLocale(root, false, 'pt-BR'), /Project trust is required/);
    assert.equal(loadProjectLocale(root, false), 'en');
    await assert.rejects(readFile(join(root, '.pi', 'pi-voice-control.locale.json')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('trusted preference is project-local, schema checked, and safely falls back to English', async () => {
  const root = await mkdtemp(join(tmpdir(), 'voice-i18n-trusted-'));
  const otherProject = await mkdtemp(join(tmpdir(), 'voice-i18n-other-project-'));
  try {
    assert.equal(loadProjectLocale(root, true), 'en');
    assert.equal(loadProjectLocale(otherProject, true), 'en');
    await assert.rejects(saveProjectLocale(root, true, 'fr'), /Unsupported interface language/);
    await saveProjectLocale(root, true, 'pt-BR');
    const preferencePath = join(root, '.pi', 'pi-voice-control.locale.json');
    assert.deepEqual(JSON.parse(await readFile(preferencePath, 'utf8')), { schemaVersion: 1, locale: 'pt-BR' });
    assert.equal(loadProjectLocale(root, true), 'pt-BR');
    await writeFile(preferencePath, JSON.stringify({ schemaVersion: 99, locale: 'pt-BR' }));
    assert.equal(loadProjectLocale(root, true), 'en');
    await writeFile(preferencePath, '{broken');
    assert.equal(loadProjectLocale(root, true), 'en');
  } finally { await rm(root, { recursive: true, force: true }); await rm(otherProject, { recursive: true, force: true }); }
});

test('locale writer refuses a non-directory .pi parent and a non-file preference target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'voice-i18n-unsafe-'));
  try {
    const parent = join(root, '.pi');
    await writeFile(parent, 'preserve');
    await assert.rejects(saveProjectLocale(root, true, 'pt-BR'));
    assert.equal(await readFile(parent, 'utf8'), 'preserve');
    assert.equal(loadProjectLocale(root, true), 'en');
    await rm(parent);
    await mkdir(parent);
    const preferencePath = join(parent, 'pi-voice-control.locale.json');
    await mkdir(preferencePath);
    await assert.rejects(saveProjectLocale(root, true, 'pt-BR'));
    assert.equal(loadProjectLocale(root, true), 'en');
  } finally { await rm(root, { recursive: true, force: true }); }
});
