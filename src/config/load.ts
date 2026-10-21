import { readFileSync, existsSync, statSync } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaults, mergeConfig, validateConfig, object, type VoiceConfig } from './validate.js';
import { VoiceError } from '../core/types.js';
import { installedDefault } from '../local/process.mjs';
import { isLocalModel } from '../local/models.mjs';

export interface LoadedConfig { config: VoiceConfig; globalPath: string; projectPath: string; ffmpegPath: string; migrated?: boolean }
/** Migrate 0.1/0.2 files in memory; Ctrl+S persists the local-only configuration. */
export function migrateLegacy(value: Record<string, unknown>): { value: Record<string, unknown>; migrated: boolean } {
  const result = structuredClone(value); let migrated = false;
  if (Object.hasOwn(result, 'remoteConsents')) { delete result.remoteConsents; migrated = true; }
  if (result.transcription && typeof result.transcription === 'object' && !Array.isArray(result.transcription)) {
    const t = result.transcription as Record<string, unknown>;
    if (Object.hasOwn(t, 'profiles') || Object.hasOwn(t, 'profile')) {
      const profiles = t.profiles as Record<string, { type?: string; model?: unknown }> | undefined;
      const profile = profiles && Object.hasOwn(profiles, String(t.profile)) ? profiles[String(t.profile)] : undefined;
      const name = profile?.type === 'local' && typeof profile.model === 'string' ? profile.model.replace('onnx-community/whisper-', '') : 'tiny';
      if (!Object.hasOwn(t, 'model')) t.model = isLocalModel(name) ? name : 'tiny';
      delete t.profiles; delete t.profile; migrated = true;
    }
    if (t.cloudFallback === false) { delete t.cloudFallback; migrated = true; }
  }
  return { value: result, migrated };
}
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
  const global = migrateLegacy(read(globalPath)); const project = migrateLegacy(read(projectPath));
  const base = mergeConfig(defaults, { transcription: { model: installedDefault(join(home, '.pi', 'agent', 'cache', 'voice-control')) } });
  let merged = mergeConfig(mergeConfig(base, global.value), project.value);
  const overrides: Record<string, unknown> = {};
  if (env.PI_VOICE_SHORTCUT) overrides.shortcut = env.PI_VOICE_SHORTCUT;
  if (env.PI_VOICE_LANGUAGE) overrides.language = env.PI_VOICE_LANGUAGE;
  if (env.PI_VOICE_MODEL) overrides.transcription = { model: env.PI_VOICE_MODEL };
  merged = mergeConfig(mergeConfig(merged, overrides), flags);
  return { config: validateConfig(merged), migrated: global.migrated || project.migrated || !!env.PI_VOICE_PROFILE, globalPath, projectPath, ffmpegPath: env.PI_VOICE_FFMPEG || 'ffmpeg' };
}
export async function saveGlobal(path: string, config: VoiceConfig): Promise<void> {
  const validated = validateConfig(config);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(validated, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
    await rename(temp, path);
  } finally { await rm(temp, { force: true }); }
}
