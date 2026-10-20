import { open, mkdtemp, rm, readdir, lstat, readFile, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VoiceError, type RecordedAudio } from '../core/types.js';

const PREFIX = 'pi-voice-control-';
export function wavHeader(bytes: number): Buffer {
  const b = Buffer.alloc(44);
  b.write('RIFF'); b.writeUInt32LE(bytes + 36, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(bytes, 40); return b;
}
export class WavWriter {
  private bytes = 0;
  private closed = false;
  private constructor(readonly directory: string, readonly path: string, private readonly handle: FileHandle, private readonly maxBytes: number) {}
  static async create(maxSeconds: number): Promise<WavWriter> {
    const dir = await mkdtemp(join(tmpdir(), PREFIX));
    try {
      await writeFile(join(dir, 'owner.json'), JSON.stringify({ pid: process.pid, started: Date.now() }), { flag: 'wx', mode: 0o600 });
      const path = join(dir, 'audio.wav'); const handle = await open(path, 'wx+', 0o600);
      try { await handle.write(wavHeader(0)); } catch (error) { await handle.close(); throw error; }
      return new WavWriter(dir, path, handle, maxSeconds * 32000);
    } catch (error) { await rm(dir, { recursive: true, force: true }); throw error; }
  }
  async append(chunk: Buffer): Promise<boolean> {
    if (this.closed) return false;
    const data = chunk.subarray(0, Math.max(0, this.maxBytes - this.bytes));
    let offset = 0;
    while (offset < data.length) {
      const { bytesWritten } = await this.handle.write(data, offset, data.length - offset, 44 + this.bytes + offset);
      if (!bytesWritten) throw new VoiceError('DISK', 'Falha ao gravar áudio temporário.');
      offset += bytesWritten;
    }
    this.bytes += data.length;
    return this.bytes < this.maxBytes;
  }
  async finish(peakRms: number): Promise<RecordedAudio> {
    if (this.closed) throw new VoiceError('CAPTURE_CLOSED', 'Captura já finalizada.');
    // A pipe may end on an odd byte; a WAV must contain whole int16 samples.
    this.bytes -= this.bytes % 2;
    await this.handle.truncate(44 + this.bytes);
    await this.handle.write(wavHeader(this.bytes), 0, 44, 0);
    await this.handle.close(); this.closed = true;
    return { path: this.path, mimeType: 'audio/wav', bytes: this.bytes + 44, durationMs: this.bytes / 32, peakRms, cleanup: () => this.cleanup() };
  }
  async cleanup(): Promise<void> {
    if (!this.closed) { this.closed = true; await this.handle.close(); }
    await rm(this.directory, { recursive: true, force: true });
  }
}
/** Only delete owned, expired session folders whose process is no longer alive. */
export async function cleanupOrphans(now = Date.now()): Promise<void> {
  for (const name of await readdir(tmpdir())) {
    if (!/^pi-voice-control-[A-Za-z0-9]{6}$/.test(name)) continue;
    const dir = join(tmpdir(), name);
    try {
      const info = await lstat(dir);
      if (!info.isDirectory() || info.isSymbolicLink() || now - info.mtimeMs < 86_400_000) continue;
      const ownerPath = join(dir, 'owner.json'); const ownerStat = await lstat(ownerPath);
      if (!ownerStat.isFile() || ownerStat.isSymbolicLink() || ownerStat.size > 1024) continue;
      const owner = JSON.parse(await readFile(ownerPath, 'utf8')) as { pid: number };
      if (!Number.isInteger(owner.pid) || owner.pid <= 0) continue;
      try { process.kill(owner.pid, 0); continue; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') continue; }
      const children = await readdir(dir);
      if (children.some(child => !['owner.json', 'audio.wav'].includes(child))) continue;
      await rm(dir, { recursive: true, force: true });
    } catch { /* Other live instances may remove their session concurrently. */ }
  }
}
