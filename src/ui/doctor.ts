import type { LoadedConfig } from '../config/load.js';
import type { AudioCapture } from '../core/types.js';
import { userError } from '../core/types.js';
import { hostWarning, probeProcess } from '../audio/device-discovery.js';
import { endpointPolicy, consentId } from '../security/endpoint-policy.js';
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
  const p = c.transcription.profiles[c.transcription.profile]!; const external = endpointPolicy(p).external;
  lines.push(`Perfil: ${c.transcription.profile}; ${p.type === 'local' ? 'Whisper incluído, processo separado, sem servidor' : external ? 'fora de loopback' : 'servidor loopback'}; idioma: ${c.language}; PCM 16kHz mono int16.`);
  if (external) lines.push(`Consentimento para endpoint/modelo: ${loaded.consents.includes(consentId(p)) ? 'autorizado' : 'BLOQUEADO; /voice settings'}.`);
  try {
    const health = await createProvider(p, loaded.consents).healthcheck(signal);
    lines.push(p.type === 'local' ? 'OK: motor local instalado e carregado fora do Pi.' : health.catalogueAvailable ? `OK: catálogo JSON; modelo ${health.models.includes(p.model) ? 'encontrado' : 'não listado'}.` : 'Servidor alcançável, sem catálogo /models; POST não validado.');
  } catch (error) { lines.push(userError(error)); }
  lines.push('Formato de transcrição POST: use o teste STT opcional em /voice settings (requer captura explícita).');
  lines.push('Colisões: Pi emite diagnóstico ao carregar; bindings do Windows Terminal devem ser conferidos pelo usuário.');
  lines.push('Foco: eventos do terminal; key-up exato com Kitty, proteção temporal no VT legado. Nenhum áudio foi enviado por este diagnóstico.');
  return lines.join('\n');
}
