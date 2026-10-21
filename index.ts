import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { matchesKey, isKeyRepeat, isKeyRelease, type KeyId } from '@earendil-works/pi-tui';
import { loadConfig, type LoadedConfig } from './src/config/load.js';
import { isLocalModel, type LocalModel } from './src/local/models.mjs';
import { defaults } from './src/config/validate.js';
import { FFmpegRecorder } from './src/audio/ffmpeg-recorder.js';
import { cleanupOrphans } from './src/audio/wav-writer.js';
import { VoiceController } from './src/core/controller.js';
import { userError } from './src/core/types.js';
import { createProvider } from './src/providers/factory.js';
import { VoiceIndicator } from './src/ui/voice-indicator.js';
import { InputGate, normalizeFunctionKey } from './src/ui/input-gate.js';
import { settings } from './src/ui/settings.js';
import { doctor } from './src/ui/doctor.js';

export default function voiceControl(pi: ExtensionAPI): void {
  for (const [flag, description] of [['voice-model', 'Whisper local: tiny, base ou small'], ['voice-language', 'Idioma do ditado']] as const) {
    pi.registerFlag(flag, { type: 'string', description });
  }
  const flags = () => {
    const result: Record<string, unknown> = {};
    const model = pi.getFlag('voice-model'); if (typeof model === 'string' && model) result.transcription = { model };
    const language = pi.getFlag('voice-language'); if (typeof language === 'string' && language) result.language = language;
    return result;
  };
  // Loading is synchronous and small; no FFmpeg spawn/network work at extension startup.
  let initial: LoadedConfig | undefined;
  try { initial = loadConfig(process.cwd(), process.env, flags()); } catch { /* Report after UI exists; never fall back to defaults for capture. */ }
  const shortcut = initial?.config.shortcut ?? defaults.shortcut;
  let gate = new InputGate(initial?.config.debounceMs);
  let runtime: { ctx: ExtensionContext; loaded: LoadedConfig; recorder: FFmpegRecorder; controller: VoiceController; indicator: VoiceIndicator } | undefined;
  let unsubscribe: (() => void) | undefined;
  let setupAbort: AbortController | undefined;
  let setupTask: Promise<unknown> | undefined;
  let modalDepth = 0; let permittedAt = -Infinity; let initialized = false;
  let modelOverride: LocalModel | undefined;
  const refresh = (ctx: ExtensionContext) => {
    const loaded = loadConfig(ctx.cwd, process.env, flags());
    if (modelOverride) loaded.config.transcription.model = modelOverride;
    return loaded;
  };
  const get = (ctx: ExtensionContext) => {
    if (!ctx.hasUI || !process.stdin.isTTY || !process.stdout.isTTY) { ctx.ui.notify('Voz requer Pi interativo em terminal local; RPC/print não capturam áudio.', 'warning'); return undefined; }
    if (runtime) return runtime;
    const loaded = refresh(ctx); const recorder = new FFmpegRecorder(loaded.ffmpegPath);
    let controller!: VoiceController;
    const indicator = new VoiceIndicator(ctx.ui, loaded.config.ui, () => controller.snapshot());
    controller = new VoiceController(recorder, c => createProvider(c.transcription.model), {
      update: v => indicator.update(v), paste: text => ctx.ui.pasteToEditor(text), notify: (message, kind) => ctx.ui.notify(message, kind),
    });
    if (loaded.migrated) ctx.ui.notify('Voz agora usa somente Whisper local. Configuração antiga adaptada; Ctrl+S em /voice salva o novo formato.', 'info');
    runtime = { ctx, loaded, recorder, controller, indicator }; gate = new InputGate(loaded.config.debounceMs);
    unsubscribe = ctx.ui.onTerminalInput(data => {
      if (data === '\x1b[I' || data === '\x1b[O') { gate.focus(data === '\x1b[I'); return { consume: true }; }
      const normalized = normalizeFunctionKey(data, shortcut);
      if (!normalized && !matchesKey(data, shortcut as KeyId)) return;
      const kind = isKeyRelease(data) ? 'release' : isKeyRepeat(data) ? 'repeat' : data.endsWith('u') || /:\d/.test(data) ? 'press' : 'legacy';
      if (modalDepth || setupAbort || !gate.press(kind)) return { consume: true };
      permittedAt = performance.now(); return normalized && normalized !== data ? { data: normalized } : undefined;
    });
    if (!initialized) { initialized = true; void cleanupOrphans().catch(() => ctx.ui.notify('Limpeza de temporários antigos indisponível.', 'warning')); }
    // Focus reporting only; no cursor positioning, hooks or global keyboard listeners.
    process.stdout.write('\x1b[?1004h');
    return runtime;
  };
  const protect = async (ctx: ExtensionContext, work: () => Promise<void>) => { try { await work(); } catch (error) { ctx.ui.notify(userError(error), 'error'); } };
  pi.registerShortcut(shortcut as KeyId, { description: 'Voice: iniciar/parar ditado', handler: ctx => protect(ctx, async () => {
    const r = get(ctx); if (!r || modalDepth || setupAbort || !gate.focused) return;
    // Only native input may start capture; no API tool is registered.
    if (performance.now() - permittedAt > 100) return;
    permittedAt = -Infinity;
    if (r.controller.state === 'RECORDING') await r.controller.stop();
    else if (!r.controller.busy) { const l = refresh(ctx); await r.controller.start(l.config); }
    else ctx.ui.notify('Voz ocupada; /voice cancel para cancelar.', 'warning');
  }) });
  pi.registerCommand('voice', { description: 'Abrir menu de voz (Ctrl+S salva); start, stop, cancel, status, settings, doctor, model', handler: (args, ctx) => protect(ctx, async () => {
    const [command = '', ...rest] = args.trim().split(/\s+/);
    const r = get(ctx); if (!r) return;
    if (command === 'cancel') { setupAbort?.abort(); await r.controller.cancel(); return; }
    if (setupAbort) { ctx.ui.notify('Configuração/diagnóstico em andamento.', 'warning'); return; }
    if (command === 'start') { if (!gate.focused) { ctx.ui.notify('Terminal sem foco.', 'warning'); return; } const l = refresh(ctx); await r.controller.start(l.config); }
    else if (command === 'stop') await r.controller.stop();
    else if (command === 'status') {
      const l = refresh(ctx); const c = l.config;
      ctx.ui.notify(`Voz: ${r.controller.state} | microfone: ${c.capture.deviceId} | modelo local: ${c.transcription.model} | idioma: ${c.language} | atalho: ${shortcut}${shortcut !== c.shortcut ? ' (/reload pendente)' : ''}`);
    } else if (command === 'model') {
      const name = rest.join(' ');
      if (!name) ctx.ui.notify(`Modelos locais: tiny, base, small; ativo: ${refresh(ctx).config.transcription.model}. Use /voice para baixar e salvar.`);
      else if (!isLocalModel(name)) ctx.ui.notify('Escolha tiny, base ou small.', 'warning');
      else { modelOverride = name; ctx.ui.notify(`Whisper ${name} selecionado para a sessão. Se necessário, abra /voice e prepare o modelo.`); }
    } else if (command === '' || command === 'settings' || command === 'doctor') {
      if (r.controller.busy && command === 'doctor') { ctx.ui.notify('Encerre ou cancele a gravação antes de diagnosticar.', 'warning'); return; }
      setupAbort = new AbortController(); const abort = setupAbort;
      let action: string | undefined;
      try {
        const l = refresh(ctx);
        if (command !== 'doctor') { setupTask = settings(ctx.ui, l, r.recorder, abort.signal, { state: r.controller.state, busy: r.controller.busy, shortcut, onSaved: () => { modelOverride = undefined; } }); action = await setupTask as string | undefined; }
        else { setupTask = doctor(l, r.recorder, abort.signal, shortcut); ctx.ui.notify(await setupTask as string); }
      } finally { if (setupAbort === abort) { setupAbort = undefined; setupTask = undefined; } }
      if (abort.signal.aborted) return;
      if (action === 'start' && gate.focused) { const l = refresh(ctx); await r.controller.start(l.config); }
      if (action === 'stop') await r.controller.stop();
      if (action === 'cancel') await r.controller.cancel();
    } else ctx.ui.notify(`Voz: ${r.controller.state}. ${shortcut.toUpperCase()} inicia/para; /voice start | stop | cancel | status | settings | doctor | model [tiny|base|small]. Texto é colado para revisão, sem envio automático.`);
  }) });
  pi.on('ui_prompt_start', () => { ++modalDepth; });
  pi.on('ui_prompt_end', () => { modalDepth = Math.max(0, modalDepth - 1); });
  pi.on('session_start', async (_event, ctx) => {
    await protect(ctx, async () => { get(ctx); });
  });
  const teardown = async () => {
    setupAbort?.abort(); unsubscribe?.(); unsubscribe = undefined;
    await setupTask?.catch(() => {});
    const r = runtime; runtime = undefined;
    if (r) { await r.controller.dispose(); r.indicator.clear(); }
    if (process.stdout.isTTY && initialized) process.stdout.write('\x1b[?1004l');
    modalDepth = 0; permittedAt = -Infinity;
  };
  pi.on('session_shutdown', teardown);
  pi.on('session_before_switch', teardown);
  pi.on('session_before_fork', teardown);
  pi.on('session_before_tree', teardown);
}
