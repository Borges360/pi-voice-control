import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import type { LoadedConfig } from '../config/load.js';
import { saveGlobal } from '../config/load.js';
import { validateConfig, type VoiceConfig } from '../config/validate.js';
import { LOCAL_MODELS, isLocalModel } from '../local/models.mjs';
import { createProvider } from '../providers/factory.js';
import { installLocal, ensureLocal } from '../providers/local.js';
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
    await provider?.prepare?.(signal);
    capture = await recorder.start({ ...config.capture, maxSeconds: 3, onLevel: rms => { view.rms = rms; } }, signal);
    view.state = 'RECORDING'; view.startedAt = performance.now(); indicator.update(view);
    await delay(2000, signal);
    view.state = 'FINALIZING'; indicator.update(view);
    audio = await capture.stop();
    if (audio.durationMs < config.capture.minMs || audio.peakRms < config.capture.silenceRms) throw new VoiceError('SILENT', 'Teste sem áudio útil; confira microfone e permissões.');
    if (provider) {
      view.state = 'TRANSCRIBING'; indicator.update(view);
      const result = await provider.transcribe(audio, { model: config.transcription.model, language: config.language, timeoutMs: config.transcription.timeoutMs, signal });
      return result.text ? 'STT OK. Texto descartado; editor preservado.' : 'STT respondeu sem texto.';
    }
    return 'Microfone OK: sinal real detectado, WAV 16 kHz mono. Áudio apagado.';
  } finally { indicator.clear(); await capture?.cancel(); await audio?.cleanup(); }
}
export async function settings(ui: ExtensionUIContext, loaded: LoadedConfig, recorder: AudioCapture, signal: AbortSignal,
  context: { state?: VoiceState; busy?: boolean; shortcut?: string; onSaved?(): void } = {},
  setup = { ensure: ensureLocal, install: installLocal }): Promise<string | undefined> {
  const c = structuredClone(loaded.config);
  const snapshot = () => JSON.stringify(c); let saved = snapshot();
  const ensureIdle = () => { if (context.busy) throw new VoiceError('BUSY', 'Encerre ou cancele o ditado antes de configurar/testar.'); };
  const edit = async (panel: PanelApi, title: string, value: string, set: (value: string) => void) => {
    const next = await panel.input(title, value); if (next !== undefined) set(next.trim());
  };
  const rows: PanelRow[] = [
    { id: 'model', label: 'Modelo', value: () => `Whisper ${c.transcription.model} · ~${LOCAL_MODELS[c.transcription.model].sizeMB} MB`,
      description: 'Local e offline. Tiny é mais leve; base e small priorizam precisão. Ctrl+S baixa o modelo se necessário e salva. Esc cancela.', activate: async panel => {
        const next = await panel.choose('Modelo Whisper local', Object.entries(LOCAL_MODELS).map(([name, info]) => ({ value: name, label: `${name} — ~${info.sizeMB} MB${name === 'tiny' ? ' · mais leve' : name === 'base' ? ' · equilíbrio' : ' · maior precisão'}` })), c.transcription.model);
        if (isLocalModel(next)) c.transcription.model = next;
      } },
    { id: 'microphone', label: 'Microfone', value: () => c.capture.deviceId, description: 'Enter lista microfones. Falha de FFmpeg não impede escolher o modelo.', activate: async (panel, op) => {
      ensureIdle(); panel.report('Enumerando microfones…'); const devices = await recorder.listDevices(op);
      if (!devices.length) throw new VoiceError('NO_DEVICE', 'Nenhum microfone encontrado. Verifique permissões ou execute /voice doctor.');
      const next = await panel.choose('Microfone', devices.map(d => ({ value: d.id, label: d.label })), c.capture.deviceId);
      if (next) c.capture.deviceId = next;
    } },
    { id: 'language', label: 'Idioma', value: () => c.language, description: 'pt = português; auto = detectar; aceita códigos ISO como en ou es.', activate: panel => edit(panel, 'Idioma (pt ou auto)', c.language, v => { c.language = v; }) },
    { id: 'shortcut', label: 'Atalho', value: () => c.shortcut.toUpperCase(), description: 'Escolha F1–F12. A mudança do atalho passa a valer após /reload.', activate: async panel => {
      const next = await panel.choose('Atalho de gravação', Array.from({ length: 12 }, (_, i) => ({ value: `f${i + 1}`, label: `F${i + 1}` })), c.shortcut); if (next) c.shortcut = next;
    } },
    { id: 'connection', label: 'Verificar modelo', value: () => 'Enter', description: 'Carrega o modelo escolhido em processo separado, com rede bloqueada. Não grava áudio.', activate: async (panel, op) => {
      ensureIdle(); panel.report('Verificando Whisper local…');
      await createProvider(c.transcription.model).healthcheck(op);
      panel.report(`Whisper ${c.transcription.model} pronto para ditado offline.`);
    } },
    { id: 'install', label: 'Preparar modelo', value: () => 'Baixar / reparar', description: 'Baixa somente o modelo selecionado, do Hugging Face para o cache do usuário. Pesos fora do repositório. Esc cancela.', activate: async (panel, op) => {
      ensureIdle(); panel.report(`Preparando Whisper ${c.transcription.model}…`);
      await setup.install(c.transcription.model, op, message => panel.report(message));
      panel.report('Modelo pronto. Ctrl+S salva a escolha.');
    } },
    { id: 'mic-test', label: 'Testar microfone', value: () => '2 segundos', description: 'Grava por 2 segundos, mostra waveform e apaga o áudio. Sem transcrição.', activate: async (panel, op) => {
      ensureIdle(); if (!await panel.confirm('Gravar microfone por 2 segundos? Fale após confirmar. Áudio será apagado.')) return;
      panel.report(await testCapture(ui, c, recorder, op));
    } },
    { id: 'stt-test', label: 'Testar ditado', value: () => 'Microfone + STT', description: 'Grava e transcreve 2 segundos. Descarta texto e áudio; preserva o editor.', activate: async (panel, op) => {
      ensureIdle();
      if (!await panel.confirm(`Gravar e transcrever 2 segundos com Whisper ${c.transcription.model}? Fale após confirmar. Texto descartado.`)) return;
      panel.report(await testCapture(ui, c, recorder, op, createProvider(c.transcription.model)));
    } },
    { id: 'doctor', label: 'Diagnóstico', value: () => 'Verificar ambiente', description: 'FFmpeg, dispositivos e STT. Nenhum áudio é enviado.', activate: async (panel, op) => {
      ensureIdle(); const result = await doctor({ ...loaded, config: c }, recorder, op, context.shortcut ?? loaded.config.shortcut); op.throwIfAborted(); ui.notify(result); panel.report('Diagnóstico exibido nas notificações.');
    } },
    { id: 'capture', label: context.state === 'RECORDING' ? 'Parar e transcrever' : 'Iniciar ditado', value: () => 'Enter', description: 'Fecha o painel e usa a configuração já salva. Ctrl+S salva alterações antes de iniciar.', activate: panel => {
      if (snapshot() !== saved) { panel.report('Salve as alterações com Ctrl+S antes de iniciar o ditado.'); return; }
      panel.close(context.state === 'RECORDING' ? 'stop' : 'start');
    } },
    { id: 'cancel', label: 'Cancelar ditado', value: () => 'Descartar', description: 'Cancela a gravação/transcrição atual e fecha o painel.', activate: panel => panel.close('cancel') },
  ];
  return openSettingsPanel(ui, {
    title: 'Voice / Configurações', summary: () => `${context.state ?? 'IDLE'} · Whisper local · ${c.transcription.model} · ${loaded.globalPath}`,
    rows, dirty: () => snapshot() !== saved, signal, formatError: userError,
    save: async (panel, op) => {
      ensureIdle(); validateConfig(c);
      await setup.ensure(c.transcription.model, op, message => panel.report(message));
      op.throwIfAborted(); await saveGlobal(loaded.globalPath, c); saved = snapshot();
      context.onSaved?.();
      panel.report(`Salvo. ${c.shortcut.toUpperCase()} inicia/para.${c.shortcut !== (context.shortcut ?? loaded.config.shortcut) ? ' Execute /reload para aplicar o atalho.' : ''} Overrides de projeto/env/CLI mantêm precedência.`);
    },
  });
}
