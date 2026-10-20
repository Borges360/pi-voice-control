import type { VoiceConfig } from '../config/validate.js';
import { requireConsent } from '../security/endpoint-policy.js';
import { sanitizeTranscript } from '../security/transcript.js';
import { VoiceError, userError, type AudioCapture, type CaptureSession, type RecordedAudio, type TranscriptionProvider, type VoiceState } from './types.js';

export interface VoiceView { state: VoiceState; startedAt: number; rms: number }
export interface ControllerHooks {
  update(view: VoiceView): void; paste(text: string): void;
  notify(message: string, type?: 'info' | 'warning' | 'error'): void;
}
interface Operation {
  id: number; abort: AbortController; config: VoiceConfig; capture?: CaptureSession;
  starting?: Promise<void>; stopping?: Promise<void>; audio?: RecordedAudio;
  timer?: ReturnType<typeof setTimeout>; invalid: boolean; inserted: boolean;
}
export class VoiceController {
  state: VoiceState = 'IDLE';
  private generation = 0;
  private active?: Operation;
  private disposed = false;
  private lastLevelAt = 0;
  private view: VoiceView = { state: 'IDLE', startedAt: 0, rms: 0 };
  constructor(private readonly recorder: AudioCapture, private readonly provider: (config: VoiceConfig) => TranscriptionProvider, private readonly hooks: ControllerHooks) {}
  get busy() { return !!this.active; }
  private current(op: Operation) { return this.active === op && !op.invalid && op.id === this.generation && !this.disposed; }
  private change(state: VoiceState) { this.state = state; this.view = { ...this.view, state }; this.hooks.update({ ...this.view }); }
  async start(config: VoiceConfig, consents: readonly string[]): Promise<void> {
    if (this.disposed) return;
    if (this.active) { this.hooks.notify('Voz já está ocupada; /voice cancel para cancelar.', 'warning'); return; }
    const op: Operation = { id: ++this.generation, abort: new AbortController(), config: structuredClone(config), invalid: false, inserted: false };
    this.active = op; this.view = { state: 'IDLE', startedAt: 0, rms: 0 }; this.change('STARTING');
    op.starting = this.begin(op, consents); await op.starting;
  }
  private async begin(op: Operation, consents: readonly string[]): Promise<void> {
    try {
      requireConsent(op.config.transcription.profiles[op.config.transcription.profile]!, consents);
      const provider = this.provider(op.config);
      if (provider.prepare) {
        await provider.prepare(op.abort.signal);
        if (!this.current(op)) return;
      }
      const capture = await this.recorder.start({ ...op.config.capture, onLevel: rms => {
        if (this.current(op)) { this.view.rms = rms; this.lastLevelAt = performance.now(); }
      } }, op.abort.signal);
      op.capture = capture;
      if (!this.current(op)) { await capture.cancel(); return; }
      this.view.startedAt = performance.now(); this.change('RECORDING');
      op.timer = setTimeout(() => {
        if (!this.current(op) || this.state !== 'RECORDING') return;
        this.hooks.notify(`Limite de ${op.config.capture.maxSeconds}s atingido; finalizando.`);
        void this.stop();
      }, op.config.capture.maxSeconds * 1000);
      void capture.completed.then(result => {
        if (this.current(op) && this.state === 'RECORDING') {
          if (!result.error) this.hooks.notify('Captura encerrada; transcrevendo.');
          void this.stop();
        }
      });
    } catch (error) {
      if (this.current(op)) { this.change('ERROR'); this.hooks.notify(userError(error), 'error'); await this.release(op); }
    }
  }
  snapshot(): VoiceView { return { ...this.view, rms: performance.now() - this.lastLevelAt > 250 ? 0 : this.view.rms }; }
  async stop(): Promise<void> {
    const op = this.active;
    if (!op || !this.current(op)) return;
    if (op.stopping) return op.stopping;
    if (this.state !== 'RECORDING') { this.hooks.notify('Aguarde a operação atual; /voice cancel para descartar.', 'warning'); return; }
    if (op.timer) clearTimeout(op.timer);
    this.change('FINALIZING'); op.stopping = this.finalize(op); await op.stopping;
  }
  private async finalize(op: Operation): Promise<void> {
    try {
      const audio = await op.capture!.stop(); op.audio = audio;
      if (!this.current(op)) return;
      if (audio.durationMs < op.config.capture.minMs) throw new VoiceError('TOO_SHORT', `Gravação curta demais; fale por pelo menos ${op.config.capture.minMs} ms.`);
      if (audio.peakRms < op.config.capture.silenceRms) { this.hooks.notify('Nenhuma fala detectada.'); this.change('SUCCESS'); return; }
      this.change('TRANSCRIBING');
      const { text } = await this.provider(op.config).transcribe(audio, {
        model: op.config.transcription.profiles[op.config.transcription.profile]!.model,
        language: op.config.language, timeoutMs: op.config.transcription.timeoutMs, signal: op.abort.signal,
      });
      if (!this.current(op) || op.inserted) return;
      const clean = sanitizeTranscript(text);
      if (clean) { op.inserted = true; this.hooks.paste(clean); }
      else this.hooks.notify('Nenhuma fala detectada.');
      this.change('SUCCESS');
    } catch (error) {
      if (this.current(op)) { this.change('ERROR'); this.hooks.notify(userError(error), 'error'); }
    } finally { await this.release(op); }
  }
  private async release(op: Operation): Promise<void> {
    if (op.timer) clearTimeout(op.timer);
    try { await op.capture?.cancel(); await op.audio?.cleanup(); }
    catch { if (this.current(op)) this.hooks.notify('Falha ao excluir áudio temporário; execute /voice doctor.', 'warning'); }
    finally { if (this.active === op && !op.invalid) { this.active = undefined; this.change('IDLE'); } }
  }
  async cancel(): Promise<void> {
    const op = this.active; if (!op) return;
    op.invalid = true; ++this.generation; if (op.timer) clearTimeout(op.timer);
    this.change('CANCELLED'); op.abort.abort();
    // Wait for a late-starting recorder before unlocking; it must not overlap the next capture.
    await op.starting;
    await this.release(op);
    if (this.active === op) { this.active = undefined; this.change('IDLE'); }
  }
  async dispose(): Promise<void> { this.disposed = true; await this.cancel(); this.change('IDLE'); }
}
