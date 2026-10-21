import { fork } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { modelInfo, isLocalModel } from './models.mjs';
import { readFileSync } from 'node:fs';

export const localCache = () => join(homedir(), '.pi', 'agent', 'cache', 'voice-control');
/** @param {string} cacheDir @returns {import('./models.mjs').LocalModel} */
export function installedDefault(cacheDir = localCache()) {
  try { const name = JSON.parse(readFileSync(join(cacheDir, 'default-model.json'), 'utf8')).model; if (isLocalModel(name)) return name; } catch {}
  return 'tiny';
}
/** @param {import('./models.mjs').LocalModel} model @param {string} cacheDir */
export function readyMarker(model, cacheDir = localCache()) { return join(cacheDir, `ready-${modelInfo(model).revision}.json`); }

/** @param {string} code */
function failure(code) { return Object.assign(new Error(code), { code }); }

/**
 * A disposable service process. No inference library is imported by the Pi host.
 * @param {{task: 'install'|'probe'|'transcribe', model?: import('./models.mjs').LocalModel, path?: string, language?: string}} job
 * @param {{signal: AbortSignal, timeoutMs?: number, cacheDir?: string, worker?: URL, onProgress?: (message: string) => void}} options
 * @returns {Promise<{text?: string}>}
 */
export function runLocal(job, options) {
  if (options.signal.aborted) return Promise.reject(failure('CANCELLED'));
  try { modelInfo(job.model ?? 'tiny'); } catch { return Promise.reject(failure('LOCAL_MODEL')); }
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
        fault = failure(['LOCAL_NOT_READY', 'LOCAL_AUDIO', 'LOCAL_INSTALL', 'LOCAL_INFERENCE', 'LOCAL_MODEL'].includes(message.code) ? message.code : 'LOCAL_PROCESS');
      }
    });
    child.once('error', () => { fault = failure('LOCAL_PROCESS'); kill(); });
    child.once('close', finish);
    child.send({ ...job, model: job.model ?? 'tiny', cacheDir: options.cacheDir ?? localCache() }, error => { if (error) { fault = failure('LOCAL_PROCESS'); kill(); } });
    if (options.signal.aborted) abort();
  });
}
