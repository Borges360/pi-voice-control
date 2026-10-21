import type { LoadedConfig } from '../config/load.js';
import type { AudioCapture } from '../core/types.js';
import { userError } from '../core/types.js';
import { hostWarning, probeProcess } from '../audio/device-discovery.js';
import { createProvider } from '../providers/factory.js';

export async function doctor(loaded: LoadedConfig, recorder: AudioCapture, signal: AbortSignal, shortcut: string): Promise<string> {
  const c = loaded.config; const lines = [`Pi voice | ${process.platform} ${process.arch} | Node ${process.versions.node}`, `Atalho registrado: ${shortcut}; configuração: ${c.shortcut}${shortcut !== c.shortcut ? ' (execute /reload)' : ''}`];
  const warning = hostWarning(); if (warning) lines.push(`AVISO: ${warning}`);
  try {
    const result = await probeProcess(loaded.ffmpegPath, ['-version'], signal);
    lines.push(result.code === 0 ? 'OK: FFmpeg executável.' : 'FALHA: FFmpeg retornou erro.');
    const devices = await recorder.listDevices(signal);
    const selected = c.capture.deviceId === 'default' ? devices[0] : devices.find(d => d.id === c.capture.deviceId);
    lines.push(`Microfones enumerados: ${devices.length}; seleção ${selected || (c.capture.deviceId === 'default' && process.platform === 'linux') ? 'disponível' : 'não encontrada'}.`);
    lines.push('Permissão/ocupação/níveis reais: validar com o teste curto em /voice settings.');
  } catch (error) { lines.push(userError(error)); }
  lines.push(`Whisper ${c.transcription.model}; processo separado, offline; idioma: ${c.language}; PCM 16kHz mono int16.`);
  try {
    await createProvider(c.transcription.model).healthcheck(signal);
    lines.push('OK: modelo local instalado e carregado fora do Pi, com rede bloqueada.');
  } catch (error) { lines.push(userError(error)); }
  lines.push('Use Testar ditado em /voice para validar a transcrição com captura explícita.');
  lines.push('Colisões: Pi emite diagnóstico ao carregar; bindings do Windows Terminal devem ser conferidos pelo usuário.');
  lines.push('Foco: eventos do terminal; key-up exato com Kitty, proteção temporal no VT legado. Nenhum áudio foi enviado por este diagnóstico.');
  return lines.join('\n');
}
