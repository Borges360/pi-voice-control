import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import type { LoadedConfig, SettingKey } from '../config/load.js';
import { saveGlobal } from '../config/load.js';
import { validateConfig, type VoiceConfig } from '../config/validate.js';
import { LOCAL_MODELS, isLocalModel } from '../local/models.mjs';
import { createProvider } from '../providers/factory.js';
import { installLocal, ensureLocal } from '../providers/local.js';
import type { AudioCapture, CaptureSession, RecordedAudio, TranscriptionProvider, VoiceState } from '../core/types.js';
import { VoiceError, userError } from '../core/types.js';
import { VoiceIndicator } from './voice-indicator.js';
import type { VoiceView } from '../core/controller.js';
import { doctor } from './doctor.js';
import { LocaleSaveError, translate, translateText, type Locale } from '../i18n.js';
import { openPiSettings, type PiUI } from '../vendor/inteiro-terminal/pi.js';
import { SettingsSession, type Persist } from '../vendor/inteiro-terminal/settings.js';
import type { Field, Values } from '../vendor/inteiro-terminal/contracts.js';
import type { PanelAction, PanelController } from '../vendor/inteiro-terminal/controller.js';
import type { MessageOverrides } from '../vendor/inteiro-terminal/i18n.js';

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

/** Field ids of the panel. Values are flat strings; `configFrom` maps them back to VoiceConfig. */
const MODEL = 'model', MICROPHONE = 'microphone', LANGUAGE = 'language', SHORTCUT = 'shortcut', UI_LOCALE = 'interface-language';
const SOURCE_KEY: Record<string, SettingKey> = { [MODEL]: 'model', [MICROPHONE]: 'deviceId', [LANGUAGE]: 'language', [SHORTCUT]: 'shortcut' };
const LANGUAGE_PATTERN = /^(?:auto|[a-z]{2,3}(?:-[A-Za-z]{2,4})?)$/;
/** Generous bounds: install has its own 10 min limit, healthcheck 120 s and transcription up to 120 s. */
const SAVE_TIMEOUT_MS = 11 * 60_000;
/** FFmpeg and the Whisper worker need up to ~1 s to stop after abort. */
const CANCEL_GRACE_MS = 1_500;
const asLocale = (value: unknown): Locale => (value === 'pt-BR' ? 'pt-BR' : 'en');

export interface SettingsContext {
  state?: VoiceState; busy?: boolean; shortcut?: string; onSaved?(): void;
  locale?: () => Locale; trusted?: boolean; onLocaleChange?(locale: Locale): void;
  saveLocale?(locale: Locale): Promise<void>; onLocaleSaved?(locale: Locale): void;
  /** Fresh read of the stored configuration, used when a save could not be confirmed. */
  reload?(): LoadedConfig;
  /** Fresh read of the stored interface language. */
  readLocale?(): Locale;
}

/**
 * The /voice panel: five fields edited as a draft, action rows for checks, tests and dictation,
 * Ctrl+S to save (the panel stays open). Returns the closing action (`start`, `stop`, `cancel`).
 */
export async function settings(ui: ExtensionUIContext, loaded: LoadedConfig, recorder: AudioCapture, signal: AbortSignal,
  context: SettingsContext = {},
  setup = { ensure: ensureLocal, install: installLocal }): Promise<string | undefined> {
  const sources = loaded.sources ?? {};
  const registered = context.shortcut ?? loaded.config.shortcut;
  /**
   * Work started by the panel (actions, choice loading, save). The adapter stops waiting after
   * `cancelGraceMs`, so settings() itself waits for the work to settle before returning: nothing
   * (FFmpeg, download, Whisper) outlives the panel, /reload or session shutdown.
   */
  const inflight = new Set<Promise<unknown>>();
  const track = <T>(work: Promise<T>): Promise<T> => {
    inflight.add(work);
    const forget = () => { inflight.delete(work); };
    work.then(forget, forget);
    return work;
  };
  let locale: Locale = context.locale?.() ?? 'en';
  const t = (text: string) => translateText(text, locale);
  const busyReason = () => (context.busy ? t('stop or cancel dictation first') : undefined);
  const trustSource = () => t('project trust');
  /** Draft values of the global file: an overridden key keeps its global value, so Ctrl+S never leaks an override. */
  const initial = (from: LoadedConfig, uiLocale: Locale): Values => {
    const base = from.global ?? from.config, s = from.sources ?? {};
    return {
      [MODEL]: s.model ? base.transcription.model : from.config.transcription.model,
      [MICROPHONE]: s.deviceId ? base.capture.deviceId : from.config.capture.deviceId,
      [LANGUAGE]: s.language ? base.language : from.config.language,
      [SHORTCUT]: s.shortcut ? base.shortcut : from.config.shortcut,
      [UI_LOCALE]: uiLocale,
    };
  };
  /** Effective configuration for checks and tests: overrides win, other keys come from the draft. */
  const configFrom = (values: Readonly<Values>): VoiceConfig => {
    const c = structuredClone(loaded.config);
    if (!sources.model && isLocalModel(values[MODEL])) c.transcription.model = values[MODEL];
    if (!sources.deviceId) c.capture.deviceId = String(values[MICROPHONE]);
    if (!sources.language) c.language = String(values[LANGUAGE]).trim();
    if (!sources.shortcut) c.shortcut = String(values[SHORTCUT]);
    return c;
  };
  const override = (id: string): Pick<Field, 'override'> => {
    const key = SOURCE_KEY[id]; const source = key ? sources[key] : undefined;
    if (!key || !source) return {};
    const c = loaded.config;
    const value = key === 'model' ? c.transcription.model : key === 'deviceId' ? c.capture.deviceId : key === 'language' ? c.language : c.shortcut;
    return { override: { value, source } };
  };
  const modelLabel = (name: string) => translate(name === 'tiny' ? 'settings.model.tiny' : name === 'base' ? 'settings.model.base' : 'settings.model.small', locale,
    { size: isLocalModel(name) ? LOCAL_MODELS[name].sizeMB : '?' });
  const fields = (): Field[] => [
    { id: MODEL, label: t('Model'), kind: 'select', ...override(MODEL),
      description: t('Local and offline. Tiny is lighter; base and small prioritize accuracy. Ctrl+S downloads the model if needed and saves. Esc cancels.'),
      choices: Object.keys(LOCAL_MODELS).map(name => ({ id: name, label: modelLabel(name) })),
      format: value => (isLocalModel(value) ? `Whisper ${value} · ~${LOCAL_MODELS[value].sizeMB} MB` : String(value)) },
    { id: MICROPHONE, label: t('Microphone'), kind: 'select', ...override(MICROPHONE),
      description: t('Press Enter to list microphones. FFmpeg errors do not prevent model selection.'),
      // Device names are shown as reported (never translated); enumeration runs only on Enter.
      loadChoices: async op => {
        if (context.busy) throw new VoiceError('BUSY', 'Stop or cancel dictation before changing settings or running a test.');
        const devices = await track(recorder.listDevices(op));
        if (!devices.length) throw new VoiceError('NO_DEVICE', 'No microphone found. Check permissions or run /voice doctor.');
        return devices.map(d => ({ id: d.id, label: d.label }));
      },
      loadTimeoutMs: 20_000 },
    { id: LANGUAGE, label: t('Transcription language'), kind: 'text', ...override(LANGUAGE),
      description: t('pt = Portuguese; auto = detect; ISO codes such as en or es are also accepted.'),
      validate: value => (typeof value === 'string' && LANGUAGE_PATTERN.test(value.trim()) ? undefined : t('Use auto or a language code such as pt, en or es.')) },
    { id: SHORTCUT, label: t('Shortcut'), kind: 'select', ...override(SHORTCUT),
      description: t('Choose F1–F12. Restart Pi with /reload to apply the shortcut change.'),
      choices: Array.from({ length: 12 }, (_, i) => ({ id: `f${i + 1}`, label: `F${i + 1}` })),
      format: value => `${String(value).toUpperCase()}${value !== registered ? translate('voice.reload.pending', locale) : ''}` },
    { id: UI_LOCALE, label: t('Language'), kind: 'select',
      description: t('Select the language for this trusted project. The choice previews immediately and is saved only with Ctrl+S.'),
      choices: [{ id: 'en', label: t('English') }, { id: 'pt-BR', label: t('Português (Brasil)') }],
      ...(context.trusted ? {} : { locked: { source: trustSource() } }) },
  ];
  const actions = (): PanelAction[] => allActions().map(action => {
    const run = action.run;
    return run ? { ...action, run: (...args: Parameters<typeof run>) => track(run(...args)) } : action;
  });
  const allActions = (): PanelAction[] => [
    { id: 'connection', label: t('Check model'), disabled: busyReason, timeoutMs: 130_000,
      description: t('Loads the selected model in a separate process with network access blocked. Does not record audio.'),
      run: async (draft, op, report) => {
        const model = configFrom(draft).transcription.model;
        report(t('Checking local Whisper…'));
        await createProvider(model).healthcheck(op);
        return t(`Whisper ${model} is ready for offline dictation.`);
      } },
    { id: 'install', label: t('Prepare model'), hint: t('Download / repair'), disabled: busyReason, timeoutMs: SAVE_TIMEOUT_MS,
      description: t('Downloads only the selected model from Hugging Face to the user cache. Model weights stay outside the repository. Esc cancels.'),
      run: async (draft, op, report) => {
        const model = configFrom(draft).transcription.model;
        report(t(`Preparing Whisper ${model}…`));
        await setup.install(model, op, message => report(t(message)));
        return t('Model is ready. Press Ctrl+S to save your selection.');
      } },
    { id: 'mic-test', label: t('Test microphone'), hint: t('2 seconds'), disabled: busyReason,
      description: t('Records for 2 seconds, shows a waveform, and deletes the audio. No transcription.'),
      confirm: t('Record from the microphone for 2 seconds? Speak after confirming. The audio will be deleted.'),
      run: async (draft, op) => t(await testCapture(ui, configFrom(draft), recorder, op, undefined, () => locale)) },
    { id: 'stt-test', label: t('Test dictation'), hint: t('Microphone + STT'), disabled: busyReason, timeoutMs: 180_000,
      description: t('Records and transcribes for 2 seconds. Discards the text and audio; leaves the editor unchanged.'),
      confirm: draft => t(`Record and transcribe 2 seconds with Whisper ${configFrom(draft).transcription.model}? Speak after confirming. The text will be discarded.`),
      run: async (draft, op) => {
        const config = configFrom(draft);
        return t(await testCapture(ui, config, recorder, op, createProvider(config.transcription.model), () => locale));
      } },
    { id: 'doctor', label: t('Diagnostics'), hint: t('Check environment'), disabled: busyReason, timeoutMs: 180_000,
      description: t('Checks FFmpeg, devices, and STT. No audio is sent.'),
      run: async (draft, op) => {
        const result = await doctor({ ...loaded, config: configFrom(draft) }, recorder, op, registered, () => locale);
        op.throwIfAborted(); ui.notify(result);
        return t('Diagnostics shown in notifications.');
      } },
    // Closing actions hand the choice back to index.ts; start/stop require a saved draft (Ctrl+S first).
    { id: context.state === 'RECORDING' ? 'stop' : 'start', label: t(context.state === 'RECORDING' ? 'Stop and transcribe' : 'Start dictation'),
      description: t('Closes the panel and uses saved settings. Press Ctrl+S to save changes before starting dictation.'), closeWith: true },
    { id: 'cancel', label: t('Cancel dictation'), hint: t('Discard'), closeWith: true, requiresSaved: false,
      description: t('Cancels the current recording/transcription and closes the panel.') },
  ];
  const messages = (): MessageOverrides => ({
    saved: t('Saved. Project/env/CLI overrides keep precedence.'),
    actionRequiresSaved: t('Press Ctrl+S to save changes before starting dictation.'),
    // Empty text falls back to the package message.
    lockedStatus: source => (source === trustSource() ? t('Project trust is required to change the interface language.') : ''),
    loadingChoices: label => (label === t('Microphone') ? t('Finding microphones…') : ''),
  });
  const title = () => t('Voice / Settings');
  const scope = (values: Readonly<Values>) =>
    t(`${context.state ?? 'IDLE'} · local Whisper · ${configFrom(values).transcription.model} · ${loaded.globalPath}`);

  const session = new SettingsSession(fields(), initial(loaded, locale), { locale, messages: messages() });
  if (loaded.globalInvalid?.length)
    session.setStatus(translate('settings.global.invalid', locale, { keys: loaded.globalInvalid.join(', ') }), 'warning');
  // Save progress (model download) goes to the status line; the host renderer comes from ui.custom.
  let requestRender = () => {};
  const host: PiUI = {
    custom: (factory, options) => ui.custom((tui, theme, keys, done) => {
      requestRender = () => tui.requestRender();
      return factory(tui, theme, keys, done);
    }, options),
  };
  let migrationPending = !!loaded.migrated;
  const persist: Persist = (values, op) => track(save(values, op));
  const save = async (values: Readonly<Values>, op: AbortSignal) => {
    if (context.busy) throw new VoiceError('BUSY', 'Stop or cancel dictation before changing settings or running a test.');
    const before = session.persisted;
    const configChanged = migrationPending || [MODEL, MICROPHONE, LANGUAGE, SHORTCUT].some(id => values[id] !== before[id]);
    const nextLocale = asLocale(values[UI_LOCALE]);
    if (configChanged) {
      const next = structuredClone(loaded.global ?? loaded.config);
      const model = values[MODEL];
      if (!isLocalModel(model)) throw new VoiceError('CONFIG', 'Invalid configuration: transcription.model (tiny, base ou small).');
      next.transcription.model = model;
      next.capture.deviceId = String(values[MICROPHONE]);
      next.language = String(values[LANGUAGE]).trim();
      next.shortcut = String(values[SHORTCUT]);
      validateConfig(next);
      await setup.ensure(model, op, message => {
        if (op.aborted) return;
        session.setStatus(t(message), 'info'); requestRender();
      });
      op.throwIfAborted();
      // Nothing is checked after the write: once written, the save succeeded.
      await saveGlobal(loaded.globalPath, next);
      migrationPending = false;
      context.onSaved?.();
    }
    if (nextLocale !== before[UI_LOCALE]) {
      if (!context.trusted || !context.saveLocale) throw new VoiceError('UNTRUSTED', 'Project trust is required to save the language.');
      await context.saveLocale(nextLocale);
      context.onLocaleSaved?.(nextLocale);
    }
  };
  const preview = (draft: Readonly<Values>, panel: PanelController) => {
    const next = asLocale(draft[UI_LOCALE]);
    if (next !== locale) {
      locale = next; context.onLocaleChange?.(locale);
      panel.setLocale(locale, messages());
    }
    panel.relabel({ title: title(), scope: scope(draft), fields: fields(), actions: actions() });
  };
  try {
    const result = await openPiSettings(host, {
      title: title(), scope: scope(session.draft), session, persist, signal, locale, messages: messages(),
      actions: actions(), reservedKeys: ['ctrl+c'],
      overlay: { width: '85%', minWidth: 40, maxHeight: '100%', anchor: 'center' },
      saveTimeoutMs: SAVE_TIMEOUT_MS, cancelGraceMs: CANCEL_GRACE_MS,
      formatError: error => (error instanceof LocaleSaveError ? t(error.message) : t(userError(error))),
      onDraftChange: (draft, _event, panel) => preview(draft, panel),
      ...(context.reload ? {
        reconcile: async () => initial(context.reload!(), context.readLocale?.() ?? asLocale(session.persisted[UI_LOCALE])),
      } : {}),
    });
    if (result.status === 'failed') ui.notify(result.message, 'error');
    return result.status === 'succeeded' ? result.action : undefined;
  } finally {
    // Work that ignored its AbortSignal is awaited here, so the caller's teardown really ends it.
    while (inflight.size) await Promise.allSettled([...inflight]);
    // An unsaved language preview never outlives the panel.
    const saved = asLocale(session.persisted[UI_LOCALE]);
    if (locale !== saved) { locale = saved; context.onLocaleChange?.(saved); }
  }
}
