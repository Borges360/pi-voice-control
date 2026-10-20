export type VoiceState = 'IDLE' | 'STARTING' | 'RECORDING' | 'FINALIZING' | 'TRANSCRIBING' | 'SUCCESS' | 'ERROR' | 'CANCELLED';
export interface AudioDevice { id: string; label: string }
export interface RecordedAudio { path: string; mimeType: 'audio/wav'; durationMs: number; bytes: number; peakRms: number; cleanup(): Promise<void> }
export interface CaptureOptions { deviceId: string; sampleRate: 16000; channels: 1; maxSeconds: number; minMs: number; silenceRms: number; onLevel(rms: number): void }
export interface CaptureSession {
  stop(): Promise<RecordedAudio>;
  cancel(): Promise<void>;
  /** Resolves on natural end or failure; never rejects without an observer. */
  completed: Promise<{ error?: VoiceError }>;
}
export interface AudioCapture { listDevices(signal?: AbortSignal): Promise<AudioDevice[]>; start(options: CaptureOptions, signal: AbortSignal): Promise<CaptureSession> }
export interface ProviderHealth { ok: boolean; models: string[]; catalogueAvailable: boolean }
export interface TranscriptionProvider {
  readonly id: string;
  healthcheck(signal: AbortSignal): Promise<ProviderHealth>;
  transcribe(audio: RecordedAudio, options: { model: string; language: string; timeoutMs: number; signal: AbortSignal }): Promise<{ text: string }>;
}
export class VoiceError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'VoiceError'; }
}
export function userError(error: unknown): string {
  return error instanceof VoiceError ? `${error.message} [${error.code}]` : 'Operação de voz falhou; execute /voice doctor. [INTERNAL]';
}
