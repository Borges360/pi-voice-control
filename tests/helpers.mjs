import { defaults } from '../dist/src/config/validate.js';
export function deferred() { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; }
export const tick = () => new Promise(resolve => setImmediate(resolve));
export function configuration() { return structuredClone(defaults); }
export function fakeCapture(overrides = {}) {
  const end = deferred(); const calls = { start: 0, stop: 0, cancel: 0, cleanup: 0 };
  const audio = { path: '/fake.wav', bytes: 32044, durationMs: 1000, peakRms: 0.1, mimeType: 'audio/wav', cleanup: async () => { ++calls.cleanup; }, ...overrides.audio };
  const session = { completed: end.promise, stop: async () => { ++calls.stop; return audio; }, cancel: async () => { ++calls.cancel; }, ...overrides.session };
  const recorder = { listDevices: async () => [{ id: 'mic', label: 'Mic' }], start: async options => { ++calls.start; options.onLevel(0.2); return session; }, ...overrides.recorder };
  return { recorder, session, audio, calls, end };
}
