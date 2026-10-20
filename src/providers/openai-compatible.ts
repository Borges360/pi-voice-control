import { readFile, stat } from 'node:fs/promises';
import { VoiceError, type TranscriptionProvider, type RecordedAudio, type ProviderHealth } from '../core/types.js';
import { endpointPolicy, requireConsent, type Profile } from '../security/endpoint-policy.js';
import { sanitizeTranscript } from '../security/transcript.js';

export async function limitedJson(response: Response, limit = 256 * 1024): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new VoiceError('RESPONSE_SIZE', 'Resposta STT excedeu o limite.'); }
  const reader = response.body?.getReader(); if (!reader) throw new VoiceError('RESPONSE_JSON', 'Servidor STT não retornou JSON.');
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const result = await reader.read(); if (result.done) break;
      bytes += result.value.length;
      if (bytes > limit) throw new VoiceError('RESPONSE_SIZE', 'Resposta STT excedeu o limite.');
      chunks.push(result.value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new VoiceError('RESPONSE_JSON', 'Servidor STT retornou JSON inválido.'); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export class OpenAICompatibleProvider implements TranscriptionProvider {
  readonly id = 'openai-compatible';
  constructor(readonly profile: Profile, private readonly consents: readonly string[], private readonly env = process.env, private readonly fetcher: typeof fetch = fetch) { endpointPolicy(profile); }
  private headers(): Record<string, string> {
    if (endpointPolicy(this.profile).external && this.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new VoiceError('TLS_DISABLED', 'Remova NODE_TLS_REJECT_UNAUTHORIZED=0 para usar STT externo.');
    const key = this.profile.apiKeyEnv ? this.env[this.profile.apiKeyEnv] : undefined;
    if (this.profile.apiKeyEnv && (!key || /[\r\n]/.test(key))) throw new VoiceError('API_KEY', 'Credencial STT ausente ou inválida na variável de ambiente configurada.');
    return key ? { Authorization: `Bearer ${key}` } : {};
  }
  async healthcheck(signal: AbortSignal): Promise<ProviderHealth> {
    // A catalogue GET never uploads audio. Some STT-only servers do not expose /models.
    const { url } = endpointPolicy(this.profile);
    // A project config must never redirect an env credential to a new host through doctor.
    if (this.profile.apiKeyEnv) requireConsent(this.profile, this.consents);
    const modelsUrl = new URL(url); modelsUrl.pathname = url.pathname.replace(/\/audio\/transcriptions$/, '/models');
    const timed = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
    try {
      const response = await this.fetcher(modelsUrl, { signal: timed, redirect: 'error', headers: this.headers() });
      if ([404, 405].includes(response.status)) { await response.body?.cancel(); return { ok: true, models: [], catalogueAvailable: false }; }
      if (!response.ok) { await response.body?.cancel(); throw new VoiceError(`HTTP_${response.status}`, `Falha no catálogo STT (HTTP ${response.status}).`); }
      const data = await limitedJson(response) as { data?: { id?: unknown }[] };
      if (!data || !Array.isArray(data.data)) throw new VoiceError('MODELS_FORMAT', 'Formato de catálogo STT não reconhecido.');
      return { ok: true, models: data.data.flatMap(m => m && typeof m.id === 'string' && m.id.trim() && m.id.length <= 256 && !/[\x00-\x1f\x7f-\x9f]/.test(m.id) ? [m.id] : []).slice(0, 256), catalogueAvailable: true };
    } catch (error) { throw this.safeError(error, timed); }
  }
  async transcribe(audio: RecordedAudio, options: { model: string; language: string; timeoutMs: number; signal: AbortSignal }): Promise<{ text: string }> {
    requireConsent(this.profile, this.consents);
    // Bind consent to the actual model sent, even if an external caller changes options.
    if (options.model !== this.profile.model) throw new VoiceError('MODEL_MISMATCH', 'Modelo da operação difere do perfil autorizado.');
    const timed = AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]);
    try {
      timed.throwIfAborted();
      const info = await stat(audio.path);
      if (!info.isFile() || info.size > 120 * 32000 + 44 || info.size < 44) throw new VoiceError('AUDIO_SIZE', 'Tamanho de áudio inválido.');
      const buffer = await readFile(audio.path, { signal: timed });
      if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new VoiceError('AUDIO_FORMAT', 'Áudio não é WAV válido.');
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(buffer)], { type: 'audio/wav' }), 'audio.wav');
      form.append('model', options.model); form.append('response_format', 'json');
      if (options.language !== 'auto') form.append('language', options.language);
      const response = await this.fetcher(this.profile.endpoint, { method: 'POST', body: form, headers: this.headers(), signal: timed, redirect: 'error' });
      if (!response.ok) { await response.body?.cancel(); throw new VoiceError(`HTTP_${response.status}`, `Transcrição falhou (HTTP ${response.status}); use /voice doctor.`); }
      const result = await limitedJson(response) as { text?: unknown };
      return { text: sanitizeTranscript(result?.text) };
    } catch (error) { throw this.safeError(error, timed); }
  }
  private safeError(error: unknown, signal: AbortSignal): VoiceError {
    if (error instanceof VoiceError) return error;
    if (signal.aborted) return new VoiceError(signal.reason?.name === 'TimeoutError' ? 'STT_TIMEOUT' : 'CANCELLED', 'Requisição STT cancelada ou excedeu o timeout.');
    return new VoiceError('STT_NETWORK', 'Serviço STT inacessível, redirecionado ou com certificado inválido.');
  }
}
