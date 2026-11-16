import type { LoadedConfig } from '../config/load.js';
import type { AudioCapture } from '../core/types.js';
import { userError } from '../core/types.js';
import { hostWarning, probeProcess } from '../audio/device-discovery.js';
import { createProvider } from '../providers/factory.js';
import { translate, translateText, type Locale } from '../i18n.js';

export async function doctor(loaded: LoadedConfig, recorder: AudioCapture, signal: AbortSignal, shortcut: string,
  locale: () => Locale = () => 'en'): Promise<string> {
  const t = (message: string) => translateText(message, locale());
  const c = loaded.config; const lines = [t(`Pi Voice Control | ${process.platform} ${process.arch} | Node ${process.versions.node}`), t(`Registered shortcut: ${shortcut}; configured shortcut: ${c.shortcut}${shortcut !== c.shortcut ? ' (run /reload)' : ''}`)];
  const warning = hostWarning(); if (warning) lines.push(t(`WARNING: ${warning}`));
  try {
    const result = await probeProcess(loaded.ffmpegPath, ['-version'], signal);
    lines.push(t(result.code === 0 ? 'OK: FFmpeg is executable.' : 'FAIL: FFmpeg returned an error.'));
    const devices = await recorder.listDevices(signal);
    const selected = c.capture.deviceId === 'default' ? devices[0] : devices.find(d => d.id === c.capture.deviceId);
    const availability = selected || (c.capture.deviceId === 'default' && process.platform === 'linux') ? 'available' : 'not found';
    lines.push(translate('doctor.microphones', locale(), {
      count: devices.length,
      selection: translate(availability === 'available' ? 'doctor.available' : 'doctor.notFound', locale()),
    }));
    lines.push(t('Check real permissions, device contention, and levels with the short test in /voice settings.'));
  } catch (error) { lines.push(t(userError(error))); }
  lines.push(t(`Whisper ${c.transcription.model}; separate process, offline; transcription language: ${c.language}; PCM 16 kHz mono int16.`));
  try {
    await createProvider(c.transcription.model).healthcheck(signal);
    lines.push(t('OK: local model installed and loaded outside Pi with network access blocked.'));
  } catch (error) { lines.push(t(userError(error))); }
  lines.push(t('Use Test dictation in /voice to validate transcription with explicit capture.'));
  lines.push(t('Key conflicts: Pi reports conflicts at startup; check Windows Terminal key bindings manually.'));
  lines.push(t('Focus handling uses terminal events, exact Kitty key-up events, and a timing guard for legacy VT. This diagnostic sent no audio.'));
  return lines.join('\n');
}
