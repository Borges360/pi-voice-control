import { spawn } from 'node:child_process';
import type { AudioDevice } from '../core/types.js';
import { VoiceError } from '../core/types.js';

export function hostWarning(env = process.env, platform = process.platform): string | undefined {
  if (env.SSH_CONNECTION || env.SSH_TTY) return 'Pi está em SSH: o microfone pertence ao host remoto. Execute Pi no Windows do microfone.';
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return 'Pi está em WSL: confirme um source PulseAudio acessível ou execute Pi nativo no Windows.';
  if (env.CONTAINER || env.container || (platform === 'linux' && env.KUBERNETES_SERVICE_HOST)) return 'Contêiner precisa de dispositivo/source de áudio explícito; nenhum bridge é instalado.';
  return undefined;
}
export async function probeProcess(executable: string, args: string[], signal?: AbortSignal, timeoutMs = 5000): Promise<{ text: string; code: number | null }> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = ''; let timedOut = false;
    const append = (b: Buffer) => { text = (text + b.toString('utf8')).slice(-64 * 1024); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    const abort = () => { child.kill('SIGKILL'); };
    const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.once('error', () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new VoiceError('FFMPEG_MISSING', 'FFmpeg não encontrado ou não executável; defina PI_VOICE_FFMPEG.')); });
    child.once('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(new VoiceError('CANCELLED', 'Diagnóstico cancelado.'));
      else if (timedOut) reject(new VoiceError('DEVICE_TIMEOUT', 'Enumeração de dispositivos excedeu o tempo limite.'));
      else resolve({ text, code });
    });
  });
}
export function parseDevices(text: string, platform: NodeJS.Platform): AudioDevice[] {
  const devices: AudioDevice[] = [];
  if (platform === 'win32') {
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/\] "(.*)" \(audio\)/);
      if (match) devices.push({ id: match[1]!, label: match[1]! });
    }
  } else if (platform === 'darwin') {
    const audio = text.split('AVFoundation audio devices:')[1] ?? '';
    for (const line of audio.split(/\r?\n/)) {
      const m = line.match(/\] \[(\d+)\] (.+)/); if (m) devices.push({ id: m[1]!, label: m[2]! });
    }
  } else {
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*[ *]?\s*(\S+)\s+\[(.+)\]/);
      if (m) devices.push({ id: m[1]!, label: m[2]! });
    }
  }
  return devices.filter((d, i) => devices.findIndex(other => other.id === d.id) === i);
}
export async function discoverDevices(executable: string, platform = process.platform, signal?: AbortSignal): Promise<AudioDevice[]> {
  const args = platform === 'win32' ? ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy']
    : platform === 'darwin' ? ['-hide_banner', '-list_devices', 'true', '-f', 'avfoundation', '-i', '']
    : ['-hide_banner', '-sources', 'pulse'];
  let result = await probeProcess(executable, args, signal);
  let devices = parseDevices(result.text, platform);
  if (platform === 'linux' && !devices.length) {
    result = await probeProcess(executable, ['-hide_banner', '-sources', 'alsa'], signal);
    devices = parseDevices(result.text, platform).map(d => ({ id: `alsa:${d.id}`, label: d.label }));
  }
  return devices;
}
export function inputArgs(deviceId: string, platform = process.platform): string[] {
  if (platform === 'win32') return ['-f', 'dshow', '-i', `audio=${deviceId}`];
  if (platform === 'darwin') return ['-f', 'avfoundation', '-i', `:${deviceId === 'default' ? 'default' : deviceId}`];
  return deviceId.startsWith('alsa:') ? ['-f', 'alsa', '-i', deviceId.slice(5)] : ['-f', 'pulse', '-i', deviceId];
}
