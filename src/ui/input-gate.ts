export class InputGate {
  focused = true;
  private held = false;
  private last = -Infinity;
  private accepted = -Infinity;
  private enhanced = false;
  constructor(readonly debounceMs = 250) {}
  focus(value: boolean) { this.focused = value; this.held = false; }
  press(kind: 'press' | 'repeat' | 'release' | 'legacy', now = performance.now()): boolean {
    if (kind === 'release' || kind === 'repeat') this.enhanced = true;
    if (kind === 'release') { this.held = false; return false; }
    if (kind === 'legacy' && this.enhanced) kind = 'press';
    const previous = this.last; this.last = now;
    if (!this.focused || kind === 'repeat') return false;
    if (kind === 'press') {
      if (this.held) return false;
      this.held = true;
    }
    // Legacy VT cannot distinguish key-up from repeat. Reject the initial repeat delay
    // and continuous bursts; enhanced keyboard protocols use exact release tracking.
    const minimum = kind === 'legacy' ? Math.max(750, this.debounceMs) : this.debounceMs;
    if (now - this.accepted < minimum || now - previous < this.debounceMs) return false;
    this.accepted = now; return true;
  }
}

/** Pi 1.3's function-key matcher only accepts legacy packets. Normalize an
 * equivalent enhanced packet after checking its modifiers; never alter other keys. */
export function normalizeFunctionKey(data: string, shortcut: string): string | undefined {
  const keys = [11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 23, 24];
  const index = Number(shortcut.slice(1)) - 1;
  const match = data.match(/^\x1b\[(\d+)(?:;(\d+)(?::[123])?)?([u~])$/);
  if (!match || index < 0 || index > 11) return undefined;
  const modifier = Number(match[2] ?? 1) - 1;
  if ((modifier & ~192) !== 0) return undefined; // Ignore caps/num lock only.
  const code = Number(match[1]);
  if (code !== (match[3] === 'u' ? 57364 + index : keys[index])) return undefined;
  return `\x1b[${keys[index]}~`;
}
