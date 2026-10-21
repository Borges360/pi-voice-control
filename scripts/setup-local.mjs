import { runLocal, installedDefault, localCache } from '../src/local/process.mjs';
import { isLocalModel, modelInfo } from '../src/local/models.mjs';
import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

let savedModel;
try { savedModel = JSON.parse(await readFile(join(homedir(), '.pi', 'agent', 'voice-control.json'), 'utf8')).transcription?.model; } catch {}
const model = process.env.PI_VOICE_MODEL ?? (isLocalModel(savedModel) ? savedModel : installedDefault());
if (!isLocalModel(model)) {
  console.error('Voice: PI_VOICE_MODEL inválido. Use tiny, base ou small.');
  process.exitCode = 1;
} else if (process.env.PI_VOICE_SKIP_LOCAL_SETUP === '1' || process.env.CI) {
  console.log('Voice: download adiado. Escolha Modelo em /voice e use Ctrl+S para baixar e salvar.');
} else {
  const abort = new AbortController();
  const cancel = () => abort.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  console.log(`Voice: preparando Whisper ${model} (~${modelInfo(model).sizeMB} MB), no cache do usuário.`);
  let last = 0;
  const preference = join(localCache(), 'default-model.json');
  const temp = `${preference}.${randomUUID()}.tmp`;
  try {
    await runLocal({ task: 'install', model }, { signal: abort.signal, timeoutMs: 10 * 60_000, onProgress: () => {
      if (Date.now() - last > 10_000) { last = Date.now(); console.log(`Voice: baixando/preparando Whisper ${model}…`); }
    } });
    abort.signal.throwIfAborted();
    await mkdir(localCache(), { recursive: true, mode: 0o700 });
    await writeFile(temp, JSON.stringify({ model }), { mode: 0o600 });
    await rename(temp, preference);
    console.log(`Voice: Whisper ${model} pronto para uso offline. Abra /voice.`);
  } catch {
    // Keep the extension installable offline; capture is blocked until the model is prepared.
    console.warn(`Voice: modelo ${model} pendente. Abra /voice → Modelo → Ctrl+S para baixar ou reparar.`);
  } finally {
    await rm(temp, { force: true });
    process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
  }
}
