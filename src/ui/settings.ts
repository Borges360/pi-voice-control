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
import { LocaleSaveError, type Locale } from '../i18n.js';

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); reject(new VoiceError('CANCELLED', 'Test canceled.')); };
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  });
}
async function testCapture(ui: ExtensionUIContext, config: VoiceConfig, recorder: AudioCapture, signal: AbortSignal,
  provider?: TranscriptionProvider, locale: () => Locale = () => 'en'): Promise<string> {
  let capture: CaptureSession | undefined; let audio: RecordedAudio | undefined;
  const view: VoiceView = { state: 'STARTING', startedAt: 0, rms: 0 };
  const indicator = new VoiceIndicator(ui, config.ui, () => ({ ...view }), locale);
  try {
    indicator.update(view);
    await provider?.prepare?.(signal);
    capture = await recorder.start({ ...config.capture, maxSeconds: 3, onLevel: rms => { view.rms = rms; } }, signal);
    view.state = 'RECORDING'; view.startedAt = performance.now(); indicator.update(view);
    await delay(2000, signal);
    view.state = 'FINALIZING'; indicator.update(view);
    audio = await capture.stop();
    if (audio.durationMs < config.capture.minMs || audio.peakRms < config.capture.silenceRms) throw new VoiceError('SILENT', 'No useful audio was detected; check the microphone and permissions.');
    if (provider) {
      view.state = 'TRANSCRIBING'; indicator.update(view);
      const result = await provider.transcribe(audio, { model: config.transcription.model, language: config.language, timeoutMs: config.transcription.timeoutMs, signal });
      return result.text ? 'Dictation OK. Text discarded; editor unchanged.' : 'Dictation returned no text.';
    }
    return 'Microphone OK: real signal detected, 16 kHz mono WAV. Audio deleted.';
  } finally { indicator.clear(); await capture?.cancel(); await audio?.cleanup(); }
}
export async function settings(ui: ExtensionUIContext, loaded: LoadedConfig, recorder: AudioCapture, signal: AbortSignal,
  context: {
    state?: VoiceState; busy?: boolean; shortcut?: string; onSaved?(): void;
    locale?: () => Locale; trusted?: boolean; onLocaleChange?(locale: Locale): void;
    saveLocale?(locale: Locale): Promise<void>; onLocaleSaved?(locale: Locale): void;
  } = {},
  setup = { ensure: ensureLocal, install: installLocal }): Promise<string | undefined> {
  const c = structuredClone(loaded.config);
  const snapshot = () => JSON.stringify(c); let saved = snapshot();
  let locale = context.locale?.() ?? 'en'; let savedLocale = locale;
  const dirty = () => snapshot() !== saved || locale !== savedLocale;
  const ensureIdle = () => { if (context.busy) throw new VoiceError('BUSY', 'Stop or cancel dictation before changing settings or running a test.'); };
  const edit = async (panel: PanelApi, title: string, value: string, set: (value: string) => void) => {
    const next = await panel.input(title, value); if (next !== undefined) set(next.trim());
  };
  const rows: PanelRow[] = [
    { id: 'model', label: 'Model', value: () => `Whisper ${c.transcription.model} · ~${LOCAL_MODELS[c.transcription.model].sizeMB} MB`,
      description: 'Local and offline. Tiny is lighter; base and small prioritize accuracy. Ctrl+S downloads the model if needed and saves. Esc cancels.', activate: async panel => {
        const next = await panel.choose('Local Whisper model', Object.entries(LOCAL_MODELS).map(([name, info]) => ({ value: name, label: `${name} — ~${info.sizeMB} MB${name === 'tiny' ? ' · lighter' : name === 'base' ? ' · balanced' : ' · highest accuracy'}` })), c.transcription.model);
        if (isLocalModel(next)) c.transcription.model = next;
      } },
    { id: 'microphone', label: 'Microphone', value: () => c.capture.deviceId, translateValue: false, description: 'Press Enter to list microphones. FFmpeg errors do not prevent model selection.', activate: async (panel, op) => {
      ensureIdle(); panel.report('Finding microphones…'); const devices = await recorder.listDevices(op);
      if (!devices.length) throw new VoiceError('NO_DEVICE', 'No microphone found. Check permissions or run /voice doctor.');
      const next = await panel.choose('Microphone', devices.map(d => ({ value: d.id, label: d.label, translateLabel: false })), c.capture.deviceId);
      if (next) c.capture.deviceId = next;
    } },
    { id: 'language', label: 'Transcription language', value: () => c.language, translateValue: false, description: 'pt = Portuguese; auto = detect; ISO codes such as en or es are also accepted.', activate: panel => edit(panel, 'Transcription language (pt or auto)', c.language, v => { c.language = v; }) },
    { id: 'shortcut', label: 'Shortcut', value: () => c.shortcut.toUpperCase(), description: 'Choose F1–F12. Restart Pi with /reload to apply the shortcut change.', activate: async panel => {
      const next = await panel.choose('Recording shortcut', Array.from({ length: 12 }, (_, i) => ({ value: `f${i + 1}`, label: `F${i + 1}` })), c.shortcut); if (next) c.shortcut = next;
    } },
    { id: 'interface-language', label: 'Language', value: () => locale === 'pt-BR' ? 'Português (Brasil)' : 'English', description: 'Select the language for this trusted project. The choice previews immediately and is saved only with Ctrl+S.', activate: async panel => {
      if (!context.trusted) { panel.report('Project trust is required to change the interface language.'); return; }
      const next = await panel.choose('Interface language', [
        { value: 'en', label: 'English' }, { value: 'pt-BR', label: 'Português (Brasil)' },
      ], locale);
      if (next === 'en' || next === 'pt-BR') { locale = next; context.onLocaleChange?.(locale); panel.report(''); }
    } },
    { id: 'connection', label: 'Check model', value: () => 'Enter', description: 'Loads the selected model in a separate process with network access blocked. Does not record audio.', activate: async (panel, op) => {
      ensureIdle(); panel.report('Checking local Whisper…');
      await createProvider(c.transcription.model).healthcheck(op);
      panel.report(`Whisper ${c.transcription.model} is ready for offline dictation.`);
    } },
    { id: 'install', label: 'Prepare model', value: () => 'Download / repair', description: 'Downloads only the selected model from Hugging Face to the user cache. Model weights stay outside the repository. Esc cancels.', activate: async (panel, op) => {
      ensureIdle(); panel.report(`Preparing Whisper ${c.transcription.model}…`);
      await setup.install(c.transcription.model, op, message => panel.report(message));
      panel.report('Model is ready. Press Ctrl+S to save your selection.');
    } },
    { id: 'mic-test', label: 'Test microphone', value: () => '2 seconds', description: 'Records for 2 seconds, shows a waveform, and deletes the audio. No transcription.', activate: async (panel, op) => {
      ensureIdle(); if (!await panel.confirm('Record from the microphone for 2 seconds? Speak after confirming. The audio will be deleted.')) return;
      panel.report(await testCapture(ui, c, recorder, op, undefined, () => locale));
    } },
    { id: 'stt-test', label: 'Test dictation', value: () => 'Microphone + STT', description: 'Records and transcribes for 2 seconds. Discards the text and audio; leaves the editor unchanged.', activate: async (panel, op) => {
      ensureIdle();
      if (!await panel.confirm(`Record and transcribe 2 seconds with Whisper ${c.transcription.model}? Speak after confirming. The text will be discarded.`)) return;
      panel.report(await testCapture(ui, c, recorder, op, createProvider(c.transcription.model), () => locale));
    } },
    { id: 'doctor', label: 'Diagnostics', value: () => 'Check environment', description: 'Checks FFmpeg, devices, and STT. No audio is sent.', activate: async (panel, op) => {
      ensureIdle(); const result = await doctor({ ...loaded, config: c }, recorder, op, context.shortcut ?? loaded.config.shortcut, () => locale); op.throwIfAborted(); ui.notify(result); panel.report('Diagnostics shown in notifications.');
    } },
    { id: 'capture', label: context.state === 'RECORDING' ? 'Stop and transcribe' : 'Start dictation', value: () => 'Enter', description: 'Closes the panel and uses saved settings. Press Ctrl+S to save changes before starting dictation.', activate: panel => {
      if (dirty()) { panel.report('Press Ctrl+S to save changes before starting dictation.'); return; }
      panel.close(context.state === 'RECORDING' ? 'stop' : 'start');
    } },
    { id: 'cancel', label: 'Cancel dictation', value: () => 'Discard', description: 'Cancels the current recording/transcription and closes the panel.', activate: panel => panel.close('cancel') },
  ];
  try { return await openSettingsPanel(ui, {
    title: 'Voice / Settings', summary: () => `${context.state ?? 'IDLE'} · local Whisper · ${c.transcription.model} · ${loaded.globalPath}`,
    rows, dirty, signal, locale: () => locale,
    formatError: error => error instanceof LocaleSaveError ? error.message : userError(error),
    save: async (panel, op) => {
      ensureIdle(); validateConfig(c);
      const configChanged = snapshot() !== saved;
      const localeChanged = locale !== savedLocale;
      if (configChanged) {
        await setup.ensure(c.transcription.model, op, message => panel.report(message));
        op.throwIfAborted(); await saveGlobal(loaded.globalPath, c); saved = snapshot();
        context.onSaved?.();
      }
      if (localeChanged) {
        if (!context.trusted || !context.saveLocale) throw new VoiceError('UNTRUSTED', 'Project trust is required to save the language.');
        await context.saveLocale(locale); op.throwIfAborted(); savedLocale = locale;
        context.onLocaleSaved?.(locale);
      }
      panel.report(`Saved. ${c.shortcut.toUpperCase()} starts/stops dictation.${c.shortcut !== (context.shortcut ?? loaded.config.shortcut) ? ' Run /reload to apply the shortcut change.' : ''} Project/env/CLI overrides keep precedence.`);
    },
  }); } finally {
    if (locale !== savedLocale) { locale = savedLocale; context.onLocaleChange?.(savedLocale); }
  }
}
