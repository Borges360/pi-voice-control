import { readFileSync, existsSync, statSync } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaults, mergeConfig, validateConfig, object, type VoiceConfig } from './validate.js';
import { VoiceError } from '../core/types.js';
import { agentDirectory, installedDefault } from '../local/process.mjs';
import { isLocalModel } from '../local/models.mjs';

/** Settings the panel edits, and the place that currently overrides the global value (if any). */
export type SettingKey = 'model' | 'deviceId' | 'language' | 'shortcut';
export interface LoadedConfig {
  config: VoiceConfig; globalPath: string; projectPath: string; ffmpegPath: string; migrated?: boolean;
  /** Defaults + installed model + global file only: what Ctrl+S writes back (no project/env/CLI values). */
  global?: VoiceConfig;
  /** Highest-precedence source above the global file, e.g. PI_VOICE_MODEL or --voice-language. */
  sources?: Partial<Record<SettingKey, string>>;
}
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
  } catch { throw new VoiceError('CONFIG_FILE', 'Could not read voice-control.json; check the JSON (128 KiB limit).'); }
}
export function loadConfig(cwd: string, env: NodeJS.ProcessEnv = process.env, flags: Record<string, unknown> = {}, home = homedir()): LoadedConfig {
  const agentDir = agentDirectory(env, home);
  const globalPath = join(agentDir, 'voice-control.json');
  const projectPath = join(cwd, '.pi', 'voice-control.json');
  const global = migrateLegacy(read(globalPath)); const project = migrateLegacy(read(projectPath));
  const base = mergeConfig(defaults, { transcription: { model: installedDefault(join(agentDir, 'cache', 'voice-control')) } });
  let merged = mergeConfig(mergeConfig(base, global.value), project.value);
  const overrides: Record<string, unknown> = {};
  if (env.PI_VOICE_SHORTCUT) overrides.shortcut = env.PI_VOICE_SHORTCUT;
  if (env.PI_VOICE_LANGUAGE) overrides.language = env.PI_VOICE_LANGUAGE;
  if (env.PI_VOICE_MODEL) overrides.transcription = { model: env.PI_VOICE_MODEL };
  merged = mergeConfig(mergeConfig(merged, overrides), flags);
  const config = validateConfig(merged);
  let globalOnly: VoiceConfig;
  try { globalOnly = validateConfig(mergeConfig(base, global.value)); } catch { globalOnly = structuredClone(config); }
  const sources: Partial<Record<SettingKey, string>> = {};
  const p = project.value as { transcription?: { model?: unknown }; capture?: { deviceId?: unknown }; language?: unknown; shortcut?: unknown };
  const f = flags as { transcription?: { model?: unknown }; language?: unknown };
  const projectSource = '.pi/voice-control.json';
  if (p.transcription && typeof p.transcription === 'object' && p.transcription.model !== undefined) sources.model = projectSource;
  if (p.capture && typeof p.capture === 'object' && p.capture.deviceId !== undefined) sources.deviceId = projectSource;
  if (p.language !== undefined) sources.language = projectSource;
  if (p.shortcut !== undefined) sources.shortcut = projectSource;
  if (env.PI_VOICE_MODEL) sources.model = 'PI_VOICE_MODEL';
  if (env.PI_VOICE_LANGUAGE) sources.language = 'PI_VOICE_LANGUAGE';
  if (env.PI_VOICE_SHORTCUT) sources.shortcut = 'PI_VOICE_SHORTCUT';
  if (f.transcription && typeof f.transcription === 'object' && f.transcription.model !== undefined) sources.model = '--voice-model';
  if (f.language !== undefined) sources.language = '--voice-language';
  return { config, global: globalOnly, sources, migrated: global.migrated || project.migrated || !!env.PI_VOICE_PROFILE, globalPath, projectPath, ffmpegPath: env.PI_VOICE_FFMPEG || 'ffmpeg' };
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
