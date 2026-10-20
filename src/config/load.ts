import { readFileSync, existsSync, statSync } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaults, mergeConfig, validateConfig, object, type VoiceConfig } from './validate.js';
import { VoiceError } from '../core/types.js';

export interface LoadedConfig { config: VoiceConfig; consents: string[]; globalPath: string; projectPath: string; ffmpegPath: string }
function read(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    if (statSync(path).size > 128 * 1024) throw new Error();
    const text = readFileSync(path, 'utf8');
    if (Buffer.byteLength(text) > 128 * 1024) throw new Error();
    return object(JSON.parse(text));
  } catch { throw new VoiceError('CONFIG_FILE', 'Não foi possível ler voice-control.json; verifique o JSON (limite 128 KiB).'); }
}
export function loadConfig(cwd: string, env: NodeJS.ProcessEnv = process.env, flags: Record<string, unknown> = {}, home = homedir()): LoadedConfig {
  const globalPath = join(home, '.pi', 'agent', 'voice-control.json');
  const projectPath = join(cwd, '.pi', 'voice-control.json');
  const global = read(globalPath); const project = read(projectPath);
  const consents = global.remoteConsents ?? [];
  if (!Array.isArray(consents) || consents.length > 128 || consents.some(v => typeof v !== 'string' || !/^[0-9a-f]{64}$/.test(v))) throw new VoiceError('CONFIG', 'remoteConsents global inválido.');
  delete global.remoteConsents;
  if (Object.hasOwn(project, 'remoteConsents')) throw new VoiceError('PROJECT_CONSENT', 'Consentimento externo só pode ser salvo no arquivo global pelo assistente.');
  let merged = mergeConfig(mergeConfig(defaults, global), project);
  const overrides: Record<string, unknown> = {};
  if (env.PI_VOICE_SHORTCUT) overrides.shortcut = env.PI_VOICE_SHORTCUT;
  if (env.PI_VOICE_LANGUAGE) overrides.language = env.PI_VOICE_LANGUAGE;
  if (env.PI_VOICE_PROFILE) overrides.transcription = { profile: env.PI_VOICE_PROFILE };
  merged = mergeConfig(mergeConfig(merged, overrides), flags);
  return { config: validateConfig(merged), consents: consents as string[], globalPath, projectPath, ffmpegPath: env.PI_VOICE_FFMPEG || 'ffmpeg' };
}
export async function saveGlobal(path: string, config: VoiceConfig, consents: string[]): Promise<void> {
  const validated = validateConfig(config);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify({ ...validated, remoteConsents: consents }, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
    await rename(temp, path);
  } finally { await rm(temp, { force: true }); }
}
