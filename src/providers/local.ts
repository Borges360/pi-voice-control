import { runLocal } from '../local/process.mjs';
import { VoiceError, type RecordedAudio, type TranscriptionProvider } from '../core/types.js';
import { sanitizeTranscript } from '../security/transcript.js';
import { modelInfo, type LocalModel } from '../local/models.mjs';
import { access } from 'node:fs/promises';
import { readyMarker } from '../local/process.mjs';

export function localError(error: unknown): VoiceError {
  const code = (error as { code?: string })?.code;
  if (code === 'LOCAL_MODEL') return new VoiceError('LOCAL_MODEL', 'Choose tiny, base, or small in /voice.');
  if (code === 'CANCELLED') return new VoiceError('CANCELLED', 'Local operation canceled.');
  if (code === 'LOCAL_TIMEOUT') return new VoiceError('LOCAL_TIMEOUT', 'Local Whisper timed out; try a shorter recording.');
  if (code === 'LOCAL_INFERENCE') return new VoiceError('LOCAL_INFERENCE', 'Whisper could not transcribe the recording. Try a shorter recording or repair the engine in /voice.');
  if (code === 'LOCAL_AUDIO') return new VoiceError('LOCAL_AUDIO', 'Invalid local audio; run Test microphone in /voice.');
  if (code === 'LOCAL_INSTALL') return new VoiceError('LOCAL_INSTALL', 'Could not prepare the local model. Check Hugging Face access and use Prepare model in /voice.');
  return new VoiceError('LOCAL_NOT_READY', 'Local model is unavailable. Open /voice → Prepare model to install or repair it.');
}
export class LocalProvider implements TranscriptionProvider {
  readonly id = 'local';
  constructor(readonly model: LocalModel) { modelInfo(model); }
  prepare = async (signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted();
    try { await access(readyMarker(this.model)); }
    catch { throw localError({ code: 'LOCAL_NOT_READY' }); }
    signal.throwIfAborted();
  };
  async healthcheck(signal: AbortSignal) {
    try { await runLocal({ task: 'probe', model: this.model }, { signal, timeoutMs: 120_000 }); return { ok: true, models: [this.model], catalogueAvailable: true }; }
    catch (error) { throw localError(error); }
  }
  async transcribe(audio: RecordedAudio, options: { model: string; language: string; timeoutMs: number; signal: AbortSignal }) {
    if (options.model !== this.model) throw new VoiceError('MODEL_MISMATCH', 'The requested model does not match the selected local engine.');
    try {
      const result = await runLocal({ task: 'transcribe', model: this.model, path: audio.path, language: options.language }, { signal: options.signal, timeoutMs: options.timeoutMs });
      return { text: sanitizeTranscript(result.text) };
    } catch (error) { if (error instanceof VoiceError) throw error; throw localError(error); }
  }
}
export async function installLocal(model: LocalModel, signal: AbortSignal, onProgress?: (message: string) => void) {
  try { await runLocal({ task: 'install', model }, { signal, timeoutMs: 10 * 60_000, onProgress }); }
  catch (error) { throw localError(error); }
}
export async function ensureLocal(model: LocalModel, signal: AbortSignal, onProgress?: (message: string) => void) {
  try { await new LocalProvider(model).prepare(signal); }
  catch (error) {
    if (!(error instanceof VoiceError) || error.code !== 'LOCAL_NOT_READY') throw error;
    onProgress?.(`Baixando Whisper ${model} (~${modelInfo(model).sizeMB} MB)…`);
    await installLocal(model, signal, onProgress);
  }
}
