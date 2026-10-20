import { runLocal } from '../src/local/process.mjs';

if (process.env.PI_VOICE_SKIP_LOCAL_SETUP === '1' || process.env.CI) {
  console.log('Voice: download local adiado. /voice → Preparar motor local quando desejar.');
} else {
  const abort = new AbortController();
  const cancel = () => abort.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  console.log('Voice: preparando Whisper local (download único do modelo multilíngue). Nenhum áudio é enviado.');
  let last = 0;
  try {
    await runLocal({ task: 'install' }, { signal: abort.signal, timeoutMs: 10 * 60_000, onProgress: () => {
      if (Date.now() - last > 10_000) { last = Date.now(); console.log('Voice: baixando/preparando modelo…'); }
    } });
    console.log('Voice: motor local pronto, sem servidor ou API. Abra /voice.');
  } catch {
    // Offline installation must still allow remote providers and an in-product repair.
    console.warn('Voice: instalação do modelo local pendente. Abra /voice → Preparar motor local para tentar novamente.');
  } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
