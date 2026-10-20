import { spawn, type ChildProcess } from 'node:child_process';
import { VoiceError, type AudioCapture, type CaptureOptions, type CaptureSession, type RecordedAudio } from '../core/types.js';
import { discoverDevices, inputArgs, hostWarning } from './device-discovery.js';
import { AudioMeter } from './audio-meter.js';
import { WavWriter } from './wav-writer.js';

const children = new Set<ChildProcess>();
let exitRegistered = false;
const killOnExit = () => { for (const child of children) child.kill('SIGKILL'); };
function track(child: ChildProcess) {
  children.add(child);
  if (!exitRegistered) { process.on('exit', killOnExit); exitRegistered = true; }
  child.once('close', () => {
    children.delete(child);
    if (!children.size && exitRegistered) { process.off('exit', killOnExit); exitRegistered = false; }
  });
}
export class FFmpegRecorder implements AudioCapture {
  constructor(readonly executable = 'ffmpeg', readonly platform = process.platform, private readonly launch: typeof spawn = spawn, private readonly timeouts = { startupMs: 8000, killMs: 1000 }) {}
  listDevices(signal?: AbortSignal) { return discoverDevices(this.executable, this.platform, signal); }
  async start(options: CaptureOptions, signal: AbortSignal): Promise<CaptureSession> {
    signal.throwIfAborted();
    const warning = hostWarning();
    if (warning && options.deviceId === 'default') throw new VoiceError('REMOTE_HOST', warning);
    let device = options.deviceId;
    if (device === 'default' && this.platform !== 'linux') {
      const devices = await this.listDevices(signal); signal.throwIfAborted();
      if (!devices.length) throw new VoiceError('NO_DEVICE', 'Nenhum microfone disponível; use /voice settings.');
      device = devices[0]!.id;
    }
    const writer = await WavWriter.create(options.maxSeconds);
    if (signal.aborted) { await writer.cleanup(); signal.throwIfAborted(); }
    const args = ['-hide_banner', '-loglevel', 'error', ...inputArgs(device, this.platform), '-t', String(options.maxSeconds), '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1'];
    let child: ReturnType<typeof spawn>;
    try { child = this.launch(this.executable, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { await writer.cleanup(); throw new VoiceError('FFMPEG_MISSING', 'Não foi possível iniciar FFmpeg.'); }
    track(child);
    // Do not retain or expose device names / OS logs from stderr.
    child.stderr!.resume(); child.stdin!.on('error', () => {});
    let failure: VoiceError | undefined; let requestedStop = false; let cancelled = false; let sawSamples = false;
    let resolveReady!: () => void;
    const ready = new Promise<void>(r => { resolveReady = r; });
    const meter = new AudioMeter(options.onLevel);
    let resolveClose!: () => void;
    const closed = new Promise<void>(r => { resolveClose = r; });
    child.once('error', () => { failure = new VoiceError('FFMPEG_MISSING', 'FFmpeg não encontrado ou não executável.'); });
    child.once('close', (code, killed) => {
      if (!requestedStop && (code !== 0 || killed)) failure ??= new VoiceError('CAPTURE_FAILED', 'Microfone indisponível, ocupado ou desconectado; use /voice doctor.');
      resolveReady(); resolveClose();
    });
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const terminate = () => {
      if (requestedStop) return;
      requestedStop = true;
      if (child.exitCode !== null || child.signalCode !== null) return;
      // FFmpeg handles q on Windows too. Fall back to a direct process kill, no shell/process tree.
      child.stdin!.write('q\n');
      killTimer = setTimeout(() => child.kill('SIGKILL'), this.timeouts.killMs);
    };
    const stream = (async () => {
      try {
        for await (const data of child.stdout!) {
          const chunk = data as Buffer;
          if (cancelled) continue;
          meter.push(chunk);
          const room = await writer.append(chunk);
          if (chunk.length >= 2 && !sawSamples) { sawSamples = true; resolveReady(); }
          if (!room) terminate();
        }
      } catch { failure ??= new VoiceError('CAPTURE_IO', 'Falha ao capturar ou gravar áudio temporário.'); terminate(); }
    })();
    const completed = (async () => {
      await closed; await stream;
      if (killTimer) clearTimeout(killTimer);
      return { error: failure };
    })();
    let finish: Promise<RecordedAudio> | undefined;
    let cancellation: Promise<void> | undefined;
    const stop = (): Promise<RecordedAudio> => finish ??= (async () => {
      terminate(); const result = await completed;
      signal.removeEventListener('abort', abort);
      if (cancelled || signal.aborted) throw new VoiceError('CANCELLED', 'Gravação cancelada.');
      if (result.error) throw result.error;
      if (!sawSamples) throw new VoiceError('NO_FRAMES', 'Microfone não produziu áudio.');
      return writer.finish(meter.peak);
    })();
    const cancel = (): Promise<void> => cancellation ??= (async () => {
      cancelled = true; terminate(); await completed;
      if (finish) await finish.catch(() => {});
      signal.removeEventListener('abort', abort); await writer.cleanup();
    })();
    const abort = () => { void cancel().catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const startupTimer = setTimeout(() => { failure = new VoiceError('CAPTURE_TIMEOUT', 'Microfone não respondeu em 8 segundos.'); terminate(); }, this.timeouts.startupMs);
    try {
      await ready;
      signal.throwIfAborted();
      if (failure) throw failure;
      if (!sawSamples) throw new VoiceError('NO_FRAMES', 'Microfone não produziu áudio.');
      return { stop, cancel, completed };
    } catch (error) { await cancel(); throw error; }
    finally { clearTimeout(startupTimer); }
  }
}
