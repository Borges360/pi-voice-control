import { runLocal } from '../local/process.mjs';
import { VoiceError, type RecordedAudio, type TranscriptionProvider } from '../core/types.js';
import { sanitizeTranscript } from '../security/transcript.js';
import type { LocalProfile } from '../security/endpoint-policy.js';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { localCache, LOCAL_REVISION } from '../local/process.mjs';

export function localError(error: unknown): VoiceError {
  const code = (error as { code?: string })?.code;
  if (code === 'CANCELLED') return new VoiceError('CANCELLED', 'Operação local cancelada.');
  if (code === 'LOCAL_TIMEOUT') return new VoiceError('LOCAL_TIMEOUT', 'Whisper local excedeu o tempo limite; tente uma gravação menor.');
  if (code === 'LOCAL_INFERENCE') return new VoiceError('LOCAL_INFERENCE', 'Whisper não conseguiu transcrever. Tente uma gravação menor ou repare o motor em /voice.');
  if (code === 'LOCAL_AUDIO') return new VoiceError('LOCAL_AUDIO', 'Áudio local inválido; execute Testar microfone em /voice.');
  if (code === 'LOCAL_INSTALL') return new VoiceError('LOCAL_INSTALL', 'Não foi possível preparar o modelo local. Confira acesso ao Hugging Face e use Preparar motor local em /voice.');
  return new VoiceError('LOCAL_NOT_READY', 'Motor local indisponível. Abra /voice → Preparar motor local para instalar ou reparar.');
}
export class LocalProvider implements TranscriptionProvider {
  readonly id = 'local';
  constructor(readonly profile: LocalProfile) {}
  prepare = async (signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted();
    try { await access(join(localCache(), `ready-${LOCAL_REVISION}.json`)); }
    catch { throw localError({ code: 'LOCAL_NOT_READY' }); }
    signal.throwIfAborted();
  };
  async healthcheck(signal: AbortSignal) {
    try { await runLocal({ task: 'probe' }, { signal, timeoutMs: 30_000 }); return { ok: true, models: [this.profile.model], catalogueAvailable: true }; }
    catch (error) { throw localError(error); }
  }
  async transcribe(audio: RecordedAudio, options: { model: string; language: string; timeoutMs: number; signal: AbortSignal }) {
    if (options.model !== this.profile.model) throw new VoiceError('MODEL_MISMATCH', 'Modelo difere do motor local incluído.');
    try {
      const result = await runLocal({ task: 'transcribe', path: audio.path, language: options.language }, { signal: options.signal, timeoutMs: options.timeoutMs });
      return { text: sanitizeTranscript(result.text) };
    } catch (error) { if (error instanceof VoiceError) throw error; throw localError(error); }
  }
}
export async function installLocal(signal: AbortSignal, onProgress?: (message: string) => void) {
  try { await runLocal({ task: 'install' }, { signal, timeoutMs: 10 * 60_000, onProgress }); }
  catch (error) { throw localError(error); }
}
