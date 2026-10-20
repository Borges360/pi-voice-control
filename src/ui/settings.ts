import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import type { LoadedConfig } from '../config/load.js';
import { saveGlobal } from '../config/load.js';
import { validateConfig, type VoiceConfig } from '../config/validate.js';
import { consentId, endpointPolicy, type Profile } from '../security/endpoint-policy.js';
import { OpenAICompatibleProvider } from '../providers/openai-compatible.js';
import type { AudioCapture, CaptureSession, RecordedAudio } from '../core/types.js';
import { VoiceError, userError } from '../core/types.js';
import { VoiceIndicator } from './voice-indicator.js';
import type { VoiceView } from '../core/controller.js';

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); reject(new VoiceError('CANCELLED', 'Teste cancelado.')); };
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  });
}
async function testCapture(ui: ExtensionUIContext, config: VoiceConfig, recorder: AudioCapture, signal: AbortSignal, provider?: OpenAICompatibleProvider): Promise<void> {
  let capture: CaptureSession | undefined; let audio: RecordedAudio | undefined;
  const view: VoiceView = { state: 'STARTING', startedAt: 0, rms: 0 };
  const indicator = new VoiceIndicator(ui, config.ui, () => ({ ...view }));
  try {
    indicator.update(view);
    capture = await recorder.start({ ...config.capture, maxSeconds: 3, onLevel: rms => { view.rms = rms; } }, signal);
    view.state = 'RECORDING'; view.startedAt = performance.now(); indicator.update(view);
    await delay(2000, signal);
    view.state = 'FINALIZING'; indicator.update(view);
    audio = await capture.stop();
    if (audio.durationMs < config.capture.minMs || audio.peakRms < config.capture.silenceRms) throw new VoiceError('SILENT', 'Teste sem áudio útil; confira microfone e permissões.');
    ui.notify('Captura OK: WAV 16 kHz mono; RMS detectou sinal real.');
    if (provider) {
      view.state = 'TRANSCRIBING'; indicator.update(view);
      const result = await provider.transcribe(audio, { model: provider.profile.model, language: config.language, timeoutMs: config.transcription.timeoutMs, signal });
      ui.notify(result.text ? 'STT OK: resposta JSON com texto válido. Conteúdo descartado; editor preservado.' : 'STT respondeu sem texto.', result.text ? 'info' : 'warning');
    }
  } finally { indicator.clear(); await capture?.cancel(); await audio?.cleanup(); }
}
export async function settings(ui: ExtensionUIContext, loaded: LoadedConfig, recorder: AudioCapture, signal: AbortSignal): Promise<boolean> {
  const opts = { signal }; const c = structuredClone(loaded.config); let consents = [...loaded.consents];
  const devices = await recorder.listDevices(signal);
  if (!devices.length) throw new VoiceError('NO_DEVICE', 'Nenhum microfone enumerado; execute /voice doctor.');
  const labels = devices.map((d, i) => `${i + 1}. ${d.label}`);
  const choice = await ui.select('Microfone (FFmpeg)', labels, opts); if (!choice) return false;
  c.capture.deviceId = devices[labels.indexOf(choice)]!.id;
  const language = await ui.input('Idioma (pt ou auto)', c.language, opts); if (language === undefined) return false; c.language = language;
  const mode = await ui.select('Provedor de transcrição', ['Local (loopback)', 'API / servidor fora de loopback'], opts); if (!mode) return false;
  const id = mode.startsWith('Local') ? 'local' : 'remote';
  const existing = c.transcription.profiles[id];
  const endpoint = await ui.input('URL completa /v1/audio/transcriptions', existing?.endpoint ?? (id === 'local' ? 'http://127.0.0.1:8000/v1/audio/transcriptions' : 'https://api.openai.com/v1/audio/transcriptions'), opts); if (endpoint === undefined) return false;
  const p: Profile = { type: 'openai-compatible', endpoint, model: existing?.model ?? c.transcription.profiles.local!.model, ...(id === 'local' && existing?.apiKeyEnv ? { apiKeyEnv: existing.apiKeyEnv } : {}) };
  if (id === 'remote') {
    const env = await ui.input('Nome da variável de ambiente da chave (vazio = sem chave)', existing?.apiKeyEnv ?? 'OPENAI_API_KEY', opts);
    if (env === undefined) return false; if (env) p.apiKeyEnv = env;
    // No implicit insecure LAN override: advanced users must first set it in JSON.
    p.allowInsecureHttp = existing?.allowInsecureHttp ?? false;
  }
  const policy = endpointPolicy(p);
  if (id === 'local' && policy.external) throw new VoiceError('LOCAL_ENDPOINT', 'Perfil local exige loopback; escolha API para servidor externo.');
  let models: string[] = [];
  if (await ui.confirm('Testar conexão STT?', 'Somente GET /models; nenhum áudio será enviado.', opts)) {
    try {
      const health = await new OpenAICompatibleProvider(p, consents).healthcheck(signal);
      models = health.models; ui.notify(health.catalogueAvailable ? 'Catálogo STT acessível.' : 'Servidor acessível sem catálogo; informe o modelo manualmente.');
    } catch (error) { if (signal.aborted) throw error; ui.notify(`${userError(error)} Informe modelo manualmente; o consentimento será pedido a seguir.`, 'warning'); }
  }
  if (models.length) {
    const model = await ui.select('Modelo', [...models, '(informar manualmente)'], opts); if (!model) return false;
    if (model !== '(informar manualmente)') p.model = model;
    else { const manual = await ui.input('ID exato do modelo STT', p.model, opts); if (manual === undefined) return false; p.model = manual; }
  } else { const model = await ui.input('ID exato do modelo STT', p.model, opts); if (model === undefined) return false; p.model = model; }
  const shortcut = await ui.input('Atalho: f1–f12 sem modificadores (Pi 1.3); aplica após /reload', c.shortcut, opts); if (shortcut === undefined) return false; c.shortcut = shortcut.toLowerCase();
  c.transcription.profile = id; c.transcription.profiles[id] = p; validateConfig(c);
  if (policy.external && !consents.includes(consentId(p))) {
    const allowed = await ui.confirm('Autorizar envio de áudio para este perfil?', `Suas gravações serão enviadas a ${policy.url.origin}, modelo ${p.model}.${p.allowInsecureHttp ? ' AVISO: HTTP sem criptografia.' : ''} Sem fallback automático. A autorização vale só para este endpoint/modelo.`, opts);
    if (!allowed) return false;
    consents = [...new Set([...consents, consentId(p)])].slice(-128);
  }
  if (await ui.confirm('Testar microfone por 2 segundos?', 'Gravação temporária local com waveform; o arquivo será apagado.', opts)) {
    const stt = await ui.confirm('Testar transcrição também?', `O áudio do teste será enviado ao perfil ${id}${policy.external ? ' EXTERNO já autorizado' : ' local'}. Texto será descartado, sem alterar o editor.`, opts);
    await testCapture(ui, c, recorder, signal, stt ? new OpenAICompatibleProvider(p, consents) : undefined);
  }
  signal.throwIfAborted();
  await saveGlobal(loaded.globalPath, c, consents);
  ui.notify('Configuração global salva. Overrides de projeto/env/CLI mantêm precedência. Execute /reload para aplicar atalho e UI. F8 inicia/para; /voice cancel descarta.');
  return true;
}
