import { endpointPolicy, type Profile } from '../security/endpoint-policy.js';
import { VoiceError } from '../core/types.js';

export interface VoiceConfig {
  shortcut: string; language: string; debounceMs: number;
  capture: { backend: 'ffmpeg'; deviceId: string; sampleRate: 16000; channels: 1; maxSeconds: number; minMs: number; silenceRms: number };
  ui: { placement: 'auto' | 'belowEditor' | 'status'; waveform: boolean; bars: number; fps: number; showDuration: boolean; noiseFloorDb: number };
  transcription: { profile: string; timeoutMs: number; autoSubmit: false; cloudFallback: false; profiles: Record<string, Profile> };
  privacy: { retainAudio: false; retainTranscripts: false; telemetry: false };
}
export const defaults: VoiceConfig = {
  shortcut: 'f8', language: 'pt', debounceMs: 250,
  capture: { backend: 'ffmpeg', deviceId: 'default', sampleRate: 16000, channels: 1, maxSeconds: 120, minMs: 350, silenceRms: 0.002 },
  ui: { placement: 'auto', waveform: true, bars: 14, fps: 8, showDuration: true, noiseFloorDb: -60 },
  transcription: { profile: 'builtin', timeoutMs: 120_000, autoSubmit: false, cloudFallback: false, profiles: {
    builtin: { type: 'local', model: 'onnx-community/whisper-tiny' },
    local: { type: 'openai-compatible', endpoint: 'http://127.0.0.1:8000/v1/audio/transcriptions', model: 'Systran/faster-whisper-small' },
  } },
  privacy: { retainAudio: false, retainTranscripts: false, telemetry: false },
};
const bad = (key: string): never => { throw new VoiceError('CONFIG', `Configuração inválida: ${key}.`); };
export function object(value: unknown, key = 'root'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad(key);
  return value as Record<string, unknown>;
}
function keys(o: Record<string, unknown>, allowed: string[], key: string) { for (const k of Object.keys(o)) if (!allowed.includes(k)) bad(`${key}.${k}`); }
function string(v: unknown, k: string, max = 512) { if (typeof v !== 'string' || !v.trim() || v.length > max || /[\x00-\x1f\x7f]/.test(v)) bad(k); }
function number(v: unknown, k: string, min: number, max: number, integer = false) { if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) bad(k); }
export function validShortcut(v: unknown): v is string {
  // Pi 1.3 matches unmodified F1–F12; modified function keys are not recognized.
  return typeof v === 'string' && /^f(?:[1-9]|1[0-2])$/.test(v);
}
export function validateConfig(value: unknown): VoiceConfig {
  const c = object(value);
  keys(c, ['shortcut', 'language', 'debounceMs', 'capture', 'ui', 'transcription', 'privacy'], 'root');
  if (!validShortcut(c.shortcut)) bad('shortcut');
  if (typeof c.language !== 'string' || !/^(?:auto|[a-z]{2,3}(?:-[A-Za-z]{2,4})?)$/.test(c.language)) bad('language');
  number(c.debounceMs, 'debounceMs', 100, 1000, true);
  const a = object(c.capture, 'capture');
  keys(a, ['backend', 'deviceId', 'sampleRate', 'channels', 'maxSeconds', 'minMs', 'silenceRms'], 'capture');
  if (a.backend !== 'ffmpeg' || a.sampleRate !== 16000 || a.channels !== 1) bad('capture.format');
  string(a.deviceId, 'capture.deviceId');
  number(a.maxSeconds, 'capture.maxSeconds', 1, 120, true); number(a.minMs, 'capture.minMs', 100, 1000, true); number(a.silenceRms, 'capture.silenceRms', 0.0001, 0.1);
  const u = object(c.ui, 'ui');
  keys(u, ['placement', 'waveform', 'bars', 'fps', 'showDuration', 'noiseFloorDb'], 'ui');
  if (!['auto', 'belowEditor', 'status'].includes(String(u.placement)) || typeof u.waveform !== 'boolean' || typeof u.showDuration !== 'boolean') bad('ui');
  number(u.bars, 'ui.bars', 14, 20, true); number(u.fps, 'ui.fps', 1, 10, true); number(u.noiseFloorDb, 'ui.noiseFloorDb', -90, -10);
  const t = object(c.transcription, 'transcription');
  keys(t, ['profile', 'timeoutMs', 'autoSubmit', 'cloudFallback', 'profiles'], 'transcription');
  if (t.autoSubmit !== false || t.cloudFallback !== false) bad('transcription.privacy');
  string(t.profile, 'transcription.profile', 80); number(t.timeoutMs, 'transcription.timeoutMs', 1000, 120000, true);
  const profiles = object(t.profiles, 'profiles');
  if (Object.keys(profiles).length > 32 || !Object.hasOwn(profiles, t.profile as string)) bad('profiles');
  for (const [id, raw] of Object.entries(profiles)) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) bad('profile.id');
    const p = object(raw, 'profile');
    if (p.type === 'local') {
      keys(p, ['type', 'model'], 'profile');
      if (p.model !== 'onnx-community/whisper-tiny') bad('profile.model');
      continue;
    }
    keys(p, ['type', 'endpoint', 'model', 'apiKeyEnv', 'allowInsecureHttp'], 'profile');
    if (p.type !== 'openai-compatible' && p.type !== 'openrouter') bad('profile.type');
    string(p.endpoint, 'profile.endpoint', 2048); string(p.model, 'profile.model', 256);
    if (p.apiKeyEnv !== undefined && (typeof p.apiKeyEnv !== 'string' || !/^[A-Z_][A-Z0-9_]{0,127}$/.test(p.apiKeyEnv))) bad('profile.apiKeyEnv');
    if (p.allowInsecureHttp !== undefined && typeof p.allowInsecureHttp !== 'boolean') bad('profile.allowInsecureHttp');
    endpointPolicy(p as unknown as Profile);
  }
  const p = object(c.privacy, 'privacy'); keys(p, ['retainAudio', 'retainTranscripts', 'telemetry'], 'privacy');
  if (p.retainAudio !== false || p.retainTranscripts !== false || p.telemetry !== false) bad('privacy');
  return structuredClone(c) as unknown as VoiceConfig;
}
export function mergeConfig(base: unknown, patch: unknown): unknown {
  const b = object(base); const p = object(patch); const result = { ...b };
  for (const [key, value] of Object.entries(p)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) bad('unsafe-key');
    result[key] = value && typeof value === 'object' && !Array.isArray(value) && b[key] && typeof b[key] === 'object' && !Array.isArray(b[key])
      ? mergeConfig(b[key], value) : value;
  }
  return result;
}
