import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import { Waveform } from '../audio/audio-meter.js';
import type { VoiceConfig } from '../config/validate.js';
import type { VoiceView } from '../core/controller.js';

export const WIDGET_KEY = 'pi-voice-control';
const active = new Set(['STARTING', 'RECORDING', 'FINALIZING', 'TRANSCRIBING']);
export function indicatorLine(width: number, view: VoiceView, levels: readonly number[], ui: VoiceConfig['ui'], now = performance.now()): string {
  if (!active.has(view.state) || width <= 0) return '';
  const seconds = Math.max(0, Math.floor((now - view.startedAt) / 1000));
  const time = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const labels = { STARTING: '◌ MICROFONE...', RECORDING: '● REC', FINALIZING: '◌ FINALIZANDO...', TRANSCRIBING: '◌ TRANSCREVENDO...' };
  let line = labels[view.state as keyof typeof labels];
  if (view.state === 'RECORDING') {
    if (width >= 40 && ui.showDuration) line += ` ${time}`;
    if (width >= 80 && ui.waveform) line += ` ${levels.map(l => '▁▂▃▄▅▆▇█'[l] ?? '▁').join('')}`;
  }
  line = Array.from(line).slice(0, width).join('');
  return ' '.repeat(Math.max(0, width - Array.from(line).length)) + line;
}
export class VoiceIndicator {
  private timer?: ReturnType<typeof setInterval>;
  private repaint?: () => void;
  private view: VoiceView = { state: 'IDLE', startedAt: 0, rms: 0 };
  private waveform: Waveform;
  private mounted = false;
  private lastState = 'IDLE';
  constructor(private readonly ui: ExtensionUIContext, private readonly options: VoiceConfig['ui'], private readonly snapshot: () => VoiceView) {
    this.waveform = new Waveform(options.bars, options.noiseFloorDb);
  }
  update(view: VoiceView): void {
    this.view = view;
    if (!active.has(view.state)) { this.clear(); return; }
    if (!this.mounted) {
      this.mounted = true;
      this.waveform = new Waveform(this.options.bars, this.options.noiseFloorDb);
      if (this.options.placement === 'status') this.ui.setStatus(WIDGET_KEY, indicatorLine(40, view, [], this.options).trim());
      else {
        try {
          this.ui.setWidget(WIDGET_KEY, (tui, theme) => {
            this.repaint = () => tui.requestRender();
            return { render: width => {
              const line = indicatorLine(width, this.view, this.waveform.levels, this.options);
              return [process.env.NO_COLOR !== undefined || process.env.TERM === 'dumb' ? line : theme.fg('success', line)];
            }, invalidate() {} };
          }, { placement: 'belowEditor' });
        } catch { this.ui.setStatus(WIDGET_KEY, indicatorLine(40, view, [], this.options).trim()); }
      }
    }
    if (view.state === 'RECORDING' && !this.timer) {
      this.timer = setInterval(() => {
        this.view = this.snapshot();
        this.waveform.tick(this.view.rms);
        if (this.options.placement === 'status' || !this.repaint) this.ui.setStatus(WIDGET_KEY, indicatorLine(40, this.view, [], this.options).trim());
        else this.repaint();
      }, Math.ceil(1000 / Math.min(10, this.options.fps)));
    } else if (view.state !== 'RECORDING' && this.timer) { clearInterval(this.timer); this.timer = undefined; }
    if (view.state !== this.lastState) {
      if (this.options.placement === 'status' || !this.repaint) this.ui.setStatus(WIDGET_KEY, indicatorLine(40, view, [], this.options).trim());
      else this.repaint();
    }
    this.lastState = view.state;
  }
  clear(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.mounted) { this.ui.setWidget(WIDGET_KEY, undefined); this.ui.setStatus(WIDGET_KEY, undefined); }
    this.repaint = undefined; this.mounted = false; this.lastState = 'IDLE';
  }
}
