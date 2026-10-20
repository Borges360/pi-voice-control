import { readFile, stat } from 'node:fs/promises';
import { VoiceError, type TranscriptionProvider, type RecordedAudio, type ProviderHealth } from '../core/types.js';
import { endpointPolicy, requireConsent, type HttpProfile } from '../security/endpoint-policy.js';
import { sanitizeTranscript } from '../security/transcript.js';
import { networkError } from './network-error.js';

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
  constructor(readonly profile: HttpProfile, private readonly consents: readonly string[], private readonly env = process.env, private readonly fetcher: typeof fetch = fetch) { endpointPolicy(profile); }
  prepare = async (signal: AbortSignal): Promise<void> => { await this.healthcheck(signal); };
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
    if (this.profile.type === 'openrouter') modelsUrl.searchParams.set('output_modalities', 'transcription');
    const timed = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
    try {
      const response = await this.fetcher(modelsUrl, { signal: timed, redirect: 'manual', headers: this.headers() });
      if ([404, 405].includes(response.status)) { await response.body?.cancel(); return { ok: true, models: [], catalogueAvailable: false }; }
      if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new VoiceError('STT_REDIRECT', 'STT redirecionou a conexão. Configure a URL final em /voice.'); }
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
      const body = this.profile.type === 'openrouter' ? JSON.stringify({ model: options.model, input_audio: { data: buffer.toString('base64'), format: 'wav' }, ...(options.language !== 'auto' ? { language: options.language } : {}) }) : form;
      const headers = { ...this.headers(), ...(this.profile.type === 'openrouter' ? { 'Content-Type': 'application/json' } : {}) };
      const response = await this.fetcher(this.profile.endpoint, { method: 'POST', body, headers, signal: timed, redirect: 'manual' });
      if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new VoiceError('STT_REDIRECT', 'STT redirecionou a conexão. Configure a URL final em /voice; áudio não foi reenviado.'); }
      if (!response.ok) {
        await response.body?.cancel();
        const guidance: Record<number, string> = {
          401: 'Chave STT inválida ou ausente. Confira a variável da credencial em /voice.',
          402: 'Provedor STT sem saldo/créditos. Confira sua conta ou escolha Local incluído em /voice.',
          403: 'A chave não tem permissão para este modelo STT. Confira conta e modelo em /voice.',
          404: 'Endpoint ou modelo STT não encontrado. Confira a URL e o modelo em /voice.',
          429: 'Limite de requisições STT atingido. Aguarde ou escolha Local incluído em /voice.',
        };
        throw new VoiceError(`HTTP_${response.status}`, guidance[response.status] ?? `Transcrição falhou (HTTP ${response.status}); use Testar conexão em /voice.`);
      }
      const result = await limitedJson(response) as { text?: unknown };
      return { text: sanitizeTranscript(result?.text) };
    } catch (error) { throw this.safeError(error, timed); }
  }
  private safeError(error: unknown, signal: AbortSignal): VoiceError {
    return networkError(error, signal, this.profile);
  }
}
