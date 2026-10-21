/** Incremental 20 ms PCM windows, independent of FFmpeg chunk boundaries. */
export class AudioMeter {
  private carry: number | undefined;
  private sum = 0;
  private count = 0;
  peak = 0;
  latest = 0;
  constructor(private readonly onLevel: (rms: number) => void, private readonly windowSamples = 320) {}
  push(chunk: Buffer): void {
    let i = 0;
    const sample = (raw: number) => {
      const value = (raw >= 32768 ? raw - 65536 : raw) / 32768;
      this.sum += value * value;
      if (++this.count === this.windowSamples) {
        this.latest = Math.sqrt(this.sum / this.count); this.peak = Math.max(this.peak, this.latest);
        this.onLevel(this.latest); this.sum = 0; this.count = 0;
      }
    };
    if (this.carry !== undefined && chunk.length) { sample(this.carry | (chunk[0]! << 8)); i = 1; this.carry = undefined; }
    for (; i + 1 < chunk.length; i += 2) sample(chunk.readUInt16LE(i));
    if (i < chunk.length) this.carry = chunk[i];
  }
}
export class Waveform {
  private amplitude = 0;
  readonly levels: number[];
  constructor(bars = 14, private readonly noiseFloorDb = -60) { this.levels = Array<number>(bars).fill(0); }
  tick(rms: number): number[] {
    const db = 20 * Math.log10(Math.max(1e-9, rms));
    // Speech rarely reaches digital full scale. Expand its useful range for
    // display only, with a gentle lift for quiet microphones above the floor.
    const fullScaleDb = Math.max(-18, this.noiseFloorDb + 12);
    const normalized = Math.max(0, Math.min(1, (db - this.noiseFloorDb) / (fullScaleDb - this.noiseFloorDb)));
    const target = Math.pow(normalized, 0.75);
    // At 8 FPS, follow syllables immediately and release between words.
    this.amplitude += (target - this.amplitude) * (target > this.amplitude ? 0.9 : 0.65);
    this.levels.shift(); this.levels.push(Math.round(this.amplitude * 7)); return this.levels;
  }
}
