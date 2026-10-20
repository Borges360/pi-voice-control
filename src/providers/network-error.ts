import { VoiceError } from '../core/types.js';
import type { HttpProfile } from '../security/endpoint-policy.js';

/** Only known codes are inspected. Never expose upstream messages, bodies or credentials. */
export function networkError(error: unknown, signal: AbortSignal, profile: HttpProfile): VoiceError {
  if (error instanceof VoiceError) return error;
  if (signal.aborted) return new VoiceError(signal.reason?.name === 'TimeoutError' ? 'STT_TIMEOUT' : 'CANCELLED', 'Requisição STT cancelada ou excedeu o timeout.');
  const codes = new Set<string>();
  const inspect = (e: unknown, depth = 0) => {
    if (!e || typeof e !== 'object' || depth > 4) return;
    const item = e as { code?: string; cause?: unknown; errors?: unknown[] };
    if (typeof item.code === 'string') codes.add(item.code);
    inspect(item.cause, depth + 1);
    if (Array.isArray(item.errors)) item.errors.slice(0, 8).forEach(x => inspect(x, depth + 1));
  };
  inspect(error);
  const origin = new URL(profile.endpoint).origin;
  if (codes.has('ECONNREFUSED')) return new VoiceError('STT_REFUSED', `Nenhum serviço STT responde em ${origin}. Em /voice, selecione Local incluído ou configure a URL correta do servidor.`);
  if (codes.has('ENOTFOUND') || codes.has('EAI_AGAIN')) return new VoiceError('STT_DNS', `Não foi possível resolver ${origin}. Confira o endereço e a conexão/VPN em /voice.`);
  if ([...codes].some(c => /CERT|TLS|SSL|SELF_SIGNED/.test(c))) return new VoiceError('STT_TLS', `Certificado HTTPS inválido em ${origin}. Corrija a cadeia de confiança do servidor; não desative a validação TLS.`);
  return new VoiceError('STT_NETWORK', `Não foi possível acessar ${origin}. Confira rede/proxy e use Testar conexão em /voice.`);
}
