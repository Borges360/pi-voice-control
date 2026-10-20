import { createHash } from 'node:crypto';
import { VoiceError } from '../core/types.js';

export interface Profile {
  type: 'openai-compatible'; endpoint: string; model: string; apiKeyEnv?: string;
  allowInsecureHttp?: boolean;
}
export function endpointPolicy(profile: Profile): { url: URL; external: boolean } {
  let url: URL;
  try { url = new URL(profile.endpoint); } catch { throw new VoiceError('ENDPOINT', 'Endpoint inválido.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/audio/transcriptions')) {
    throw new VoiceError('ENDPOINT', 'Use URL HTTP(S) terminando em /audio/transcriptions, sem credenciais, query ou fragmento.');
  }
  const external = !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
  if (url.protocol !== 'https:' && external && !profile.allowInsecureHttp) {
    throw new VoiceError('HTTPS_REQUIRED', 'Endpoint fora de loopback exige HTTPS; HTTP LAN requer override explícito.');
  }
  return { url, external };
}
export function consentId(profile: Profile): string {
  return createHash('sha256').update(JSON.stringify([endpointPolicy(profile).url.href, profile.model, profile.apiKeyEnv ?? '', !!profile.allowInsecureHttp])).digest('hex');
}
export function requireConsent(profile: Profile, trustedConsents: readonly string[]): void {
  if (endpointPolicy(profile).external && !trustedConsents.includes(consentId(profile))) {
    throw new VoiceError('CONSENT_REQUIRED', 'Áudio externo bloqueado. Selecione e autorize esse perfil em /voice settings.');
  }
}
