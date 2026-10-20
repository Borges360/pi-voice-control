import { fork } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const LOCAL_MODEL = 'onnx-community/whisper-tiny';
export const LOCAL_REVISION = 'ff4177021cc41f7db950912b73ea4fdf7d01d8e7';
export const localCache = () => join(homedir(), '.pi', 'agent', 'cache', 'voice-control');

/** @param {string} code */
function failure(code) { return Object.assign(new Error(code), { code }); }

/**
 * A disposable service process. No inference library is imported by the Pi host.
 * @param {{task: 'install'|'probe'|'transcribe', path?: string, language?: string}} job
 * @param {{signal: AbortSignal, timeoutMs?: number, cacheDir?: string, worker?: URL, onProgress?: (message: string) => void}} options
 * @returns {Promise<{text?: string}>}
 */
export function runLocal(job, options) {
  if (options.signal.aborted) return Promise.reject(failure('CANCELLED'));
  return new Promise((resolve, reject) => {
    // Intentionally do not inherit API keys, NODE_OPTIONS, proxy auth or Pi flags.
    const childEnv = {};
    for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'HOME', 'USERPROFILE', 'TMP', 'TEMP', 'TMPDIR', 'LOCALAPPDATA', 'APPDATA']) {
      if (process.env[key]) childEnv[key] = process.env[key];
    }
    const child = fork(options.worker ?? new URL('./worker.mjs', import.meta.url), [], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true, execArgv: [], env: childEnv,
    });
    let result; let fault; let finished = false;
    const kill = () => { if (child.exitCode === null) child.kill('SIGKILL'); };
    const abort = () => { fault = failure('CANCELLED'); kill(); };
    const timer = setTimeout(() => { fault = failure('LOCAL_TIMEOUT'); kill(); }, options.timeoutMs ?? 120_000);
    process.once('exit', kill);
    options.signal.addEventListener('abort', abort, { once: true });
    const finish = () => {
      if (finished) return; finished = true;
      clearTimeout(timer); process.removeListener('exit', kill); options.signal.removeEventListener('abort', abort);
      if (fault) reject(fault);
      else if (result) resolve(result);
      else reject(failure('LOCAL_PROCESS'));
    };
    child.on('message', message => {
      if (!message || typeof message !== 'object') return;
      if (message.kind === 'progress') { try { options.onProgress?.('Baixando e preparando Whisper local…'); } catch {} return; }
      if (message.kind === 'result') result = { ...(typeof message.text === 'string' && message.text.length <= 100_000 ? { text: message.text } : {}) };
      if (message.kind === 'error') {
        fault = failure(['LOCAL_NOT_READY', 'LOCAL_AUDIO', 'LOCAL_INSTALL', 'LOCAL_INFERENCE'].includes(message.code) ? message.code : 'LOCAL_PROCESS');
      }
    });
    child.once('error', () => { fault = failure('LOCAL_PROCESS'); kill(); });
    child.once('close', finish);
    child.send({ ...job, cacheDir: options.cacheDir ?? localCache() }, error => { if (error) { fault = failure('LOCAL_PROCESS'); kill(); } });
    if (options.signal.aborted) abort();
  });
}
