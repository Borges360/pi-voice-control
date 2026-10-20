import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import type { LoadedConfig } from '../config/load.js';
import { saveGlobal } from '../config/load.js';
import { validateConfig, type VoiceConfig } from '../config/validate.js';
import { consentId, endpointPolicy, type HttpProfile } from '../security/endpoint-policy.js';
import { createProvider } from '../providers/factory.js';
import { installLocal } from '../providers/local.js';
import type { AudioCapture, CaptureSession, RecordedAudio, TranscriptionProvider, VoiceState } from '../core/types.js';
import { VoiceError, userError } from '../core/types.js';
import { VoiceIndicator } from './voice-indicator.js';
import type { VoiceView } from '../core/controller.js';
import { openSettingsPanel, type PanelApi, type PanelRow } from './settings-panel.js';
import { doctor } from './doctor.js';

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); reject(new VoiceError('CANCELLED', 'Teste cancelado.')); };
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  });
}
async function testCapture(ui: ExtensionUIContext, config: VoiceConfig, recorder: AudioCapture, signal: AbortSignal, provider?: TranscriptionProvider): Promise<string> {
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
    if (provider) {
      view.state = 'TRANSCRIBING'; indicator.update(view);
      const result = await provider.transcribe(audio, { model: config.transcription.profiles[config.transcription.profile]!.model, language: config.language, timeoutMs: config.transcription.timeoutMs, signal });
      return result.text ? 'STT OK. Texto descartado; editor preservado.' : 'STT respondeu sem texto.';
    }
    return 'Microfone OK: sinal real detectado, WAV 16 kHz mono. Áudio apagado.';
  } finally { indicator.clear(); await capture?.cancel(); await audio?.cleanup(); }
}
export async function settings(ui: ExtensionUIContext, loaded: LoadedConfig, recorder: AudioCapture, signal: AbortSignal,
  context: { state?: VoiceState; busy?: boolean; shortcut?: string; onSaved?(): void } = {}): Promise<string | undefined> {
  const c = structuredClone(loaded.config); let consents = [...loaded.consents];
  const snapshot = () => JSON.stringify([c, consents]); let saved = snapshot();
  const p = () => c.transcription.profiles[c.transcription.profile]!;
  const http = (): HttpProfile => { const profile = p(); if (profile.type === 'local') throw new VoiceError('LOCAL', 'O motor local não usa URL nem chave de API.'); return profile; };
  const ensureIdle = () => { if (context.busy) throw new VoiceError('BUSY', 'Encerre ou cancele o ditado antes de configurar/testar.'); };
  const authorize = async (panel: PanelApi, op: AbortSignal) => {
    validateConfig(c); const profile = p(); const policy = endpointPolicy(profile);
    if (!policy.external || consents.includes(consentId(profile))) return true;
    const allowed = await panel.confirm(`Autorizar áudio e credencial para ${policy.url.origin}, modelo ${profile.model}?${profile.type !== 'local' && profile.allowInsecureHttp ? ' HTTP sem criptografia.' : ''} Sem fallback. Ctrl+S persiste a escolha.`);
    op.throwIfAborted();
    if (allowed) consents = [...new Set([...consents, consentId(profile)])].slice(-128);
    return allowed;
  };
  const edit = async (panel: PanelApi, title: string, value: string, set: (value: string) => void) => {
    const next = await panel.input(title, value); if (next !== undefined) set(next.trim());
  };
  const rows: PanelRow[] = [
    { id: 'provider', label: 'Provedor', value: () => p().type === 'local' ? 'Local incluído (Whisper)' : p().type === 'openrouter' ? 'OpenRouter' : `Servidor HTTP (${c.transcription.profile})`,
      description: 'Local incluído funciona sem API/servidor. OpenRouter usa sua chave e um modelo STT. Alterações só persistem com Ctrl+S.', activate: async panel => {
        const choice = await panel.choose('Provedor de transcrição', [
          { value: 'builtin', label: 'Local incluído — Whisper no computador' }, { value: 'openrouter', label: 'OpenRouter — sua API de transcrição' },
          ...Object.entries(c.transcription.profiles).filter(([id, v]) => !['builtin', 'openrouter'].includes(id) && v.type !== 'local').map(([id]) => ({ value: id, label: `Servidor / API — ${id}` })),
        ], c.transcription.profile);
        if (!choice) return;
        if (choice === 'openrouter' && !c.transcription.profiles.openrouter) c.transcription.profiles.openrouter = { type: 'openrouter', endpoint: 'https://openrouter.ai/api/v1/audio/transcriptions', model: 'openai/whisper-1', apiKeyEnv: 'OPENROUTER_API_KEY' };
        c.transcription.profile = choice;
      } },
    { id: 'microphone', label: 'Microfone', value: () => c.capture.deviceId, description: 'Enter lista microfones. Falha de FFmpeg não impede configurar o provedor.', activate: async (panel, op) => {
      ensureIdle(); panel.report('Enumerando microfones…'); const devices = await recorder.listDevices(op);
      if (!devices.length) throw new VoiceError('NO_DEVICE', 'Nenhum microfone encontrado. Verifique permissões ou execute /voice doctor.');
      const next = await panel.choose('Microfone', devices.map(d => ({ value: d.id, label: d.label })), c.capture.deviceId);
      if (next) c.capture.deviceId = next;
    } },
    { id: 'language', label: 'Idioma', value: () => c.language, description: 'pt = português; auto = detectar; aceita códigos ISO como en ou es.', activate: panel => edit(panel, 'Idioma (pt ou auto)', c.language, v => { c.language = v; }) },
    { id: 'model', label: 'Modelo', value: () => p().model, description: 'OpenRouter lista somente modelos STT. Local usa Whisper tiny multilíngue. Servidor permite ID manual.', activate: async (panel, op) => {
      if (p().type === 'local') { panel.report('Whisper tiny multilíngue incluído, quantizado para CPU.'); return; }
      if (p().type === 'openrouter') {
        if (!await authorize(panel, op)) return;
        panel.report('Buscando modelos de transcrição…'); const health = await createProvider(p(), consents).healthcheck(op);
        const next = await panel.choose('Modelo STT', health.models.map(id => ({ value: id, label: id })), p().model); if (next) p().model = next;
      } else await edit(panel, 'ID exato do modelo STT', p().model, v => { p().model = v; });
    } },
    { id: 'endpoint', label: 'Endpoint', value: () => p().type === 'local' ? 'Processo local gerenciado' : http().endpoint, description: 'URL completa terminando em /audio/transcriptions. OpenRouter usa seu endpoint oficial.', activate: async panel => {
      if (p().type === 'local') { panel.report('Sem porta, servidor, Docker ou Python. Processo encerrado ao terminar.'); return; }
      if (p().type === 'openrouter') { panel.report('Endpoint oficial OpenRouter já configurado.'); return; }
      await edit(panel, 'URL completa STT', http().endpoint, v => { http().endpoint = v; });
    } },
    { id: 'credential', label: 'Credencial', value: () => p().type === 'local' ? 'Não necessária' : http().apiKeyEnv ? `${http().apiKeyEnv} (${process.env[http().apiKeyEnv!] ? 'presente' : 'ausente'})` : 'Sem chave', description: 'Informe o NOME da variável de ambiente, nunca o valor da chave. Abra o Pi com essa variável disponível.', activate: async panel => {
      if (p().type === 'local') return;
      await edit(panel, 'Nome da variável da chave (vazio = sem chave)', http().apiKeyEnv ?? '', v => { if (v) http().apiKeyEnv = v; else delete http().apiKeyEnv; });
    } },
    { id: 'shortcut', label: 'Atalho', value: () => c.shortcut.toUpperCase(), description: 'Escolha F1–F12. A mudança do atalho passa a valer após /reload.', activate: async panel => {
      const next = await panel.choose('Atalho de gravação', Array.from({ length: 12 }, (_, i) => ({ value: `f${i + 1}`, label: `F${i + 1}` })), c.shortcut); if (next) c.shortcut = next;
    } },
    { id: 'connection', label: 'Testar conexão / motor', value: () => 'Enter', description: 'Verifica o motor local ou catálogo STT. Nenhum áudio é enviado. Erros mostram a causa e como resolver.', activate: async (panel, op) => {
      ensureIdle(); if (!await authorize(panel, op)) return; panel.report('Verificando motor de transcrição…');
      const health = await createProvider(p(), consents).healthcheck(op);
      panel.report(p().type === 'local' ? 'Motor local pronto para ditado offline.' : health.catalogueAvailable ? `Conexão OK. ${health.models.length} modelos; selecionado ${health.models.includes(p().model) ? 'disponível' : 'não listado'}.` : 'Servidor acessível sem catálogo; use Testar ditado para validar o POST.');
    } },
    { id: 'install', label: 'Preparar motor local', value: () => 'Instalar / reparar', description: 'Baixa o modelo Whisper multilíngue do Hugging Face (~45 MB). Não grava nem envia áudio. Esc cancela.', activate: async (panel, op) => {
      ensureIdle(); panel.report('Preparando Whisper local…'); await installLocal(op, message => panel.report(message)); panel.report('Motor local pronto. Selecione Local incluído e salve com Ctrl+S.');
    } },
    { id: 'mic-test', label: 'Testar microfone', value: () => '2 segundos', description: 'Grava por 2 segundos, mostra waveform e apaga o áudio. Sem transcrição.', activate: async (panel, op) => {
      ensureIdle(); if (!await panel.confirm('Gravar microfone por 2 segundos? Fale após confirmar. Áudio será apagado.')) return;
      panel.report(await testCapture(ui, c, recorder, op));
    } },
    { id: 'stt-test', label: 'Testar ditado', value: () => 'Microfone + STT', description: 'Grava e transcreve 2 segundos. Descarta texto e áudio; preserva o editor.', activate: async (panel, op) => {
      ensureIdle(); if (!await authorize(panel, op)) return;
      if (!await panel.confirm(`Gravar e transcrever 2 segundos com ${c.transcription.profile}? Fale após confirmar. Texto descartado.`)) return;
      panel.report(await testCapture(ui, c, recorder, op, createProvider(p(), consents)));
    } },
    { id: 'doctor', label: 'Diagnóstico', value: () => 'Verificar ambiente', description: 'FFmpeg, dispositivos e STT. Nenhum áudio é enviado.', activate: async (panel, op) => {
      ensureIdle(); const result = await doctor({ ...loaded, config: c, consents }, recorder, op, context.shortcut ?? loaded.config.shortcut); ui.notify(result); panel.report('Diagnóstico exibido nas notificações.');
    } },
    { id: 'capture', label: context.state === 'RECORDING' ? 'Parar e transcrever' : 'Iniciar ditado', value: () => 'Enter', description: 'Fecha o painel e usa a configuração já salva. Ctrl+S salva alterações antes de iniciar.', activate: panel => {
      if (snapshot() !== saved) { panel.report('Salve as alterações com Ctrl+S antes de iniciar o ditado.'); return; }
      panel.close(context.state === 'RECORDING' ? 'stop' : 'start');
    } },
    { id: 'cancel', label: 'Cancelar ditado', value: () => 'Descartar', description: 'Cancela a gravação/transcrição atual e fecha o painel.', activate: panel => panel.close('cancel') },
  ];
  return openSettingsPanel(ui, {
    title: 'Voice / Configurações', summary: () => `${context.state ?? 'IDLE'} · ${p().type === 'local' ? 'Processamento no computador' : 'Provedor selecionado explicitamente'} · ${loaded.globalPath}`,
    rows, dirty: () => snapshot() !== saved, signal, formatError: userError,
    save: async (panel, op) => {
      ensureIdle(); validateConfig(c); if (!await authorize(panel, op)) { panel.report('Não salvo: envio externo não autorizado.'); return; }
      op.throwIfAborted(); await saveGlobal(loaded.globalPath, c, consents); saved = snapshot();
      context.onSaved?.();
      panel.report(`Salvo. ${c.shortcut.toUpperCase()} inicia/para.${c.shortcut !== (context.shortcut ?? loaded.config.shortcut) ? ' Execute /reload para aplicar o atalho.' : ''} Overrides de projeto/env/CLI mantêm precedência.`);
    },
  });
}
