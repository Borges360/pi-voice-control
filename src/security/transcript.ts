import { VoiceError } from '../core/types.js';
export function sanitizeTranscript(value: unknown): string {
  if (typeof value !== 'string' || value.length > 100_000) throw new VoiceError('RESPONSE_TEXT', 'Resposta STT inválida ou longa demais.');
  return value
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim();
}
