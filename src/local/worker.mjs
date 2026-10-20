import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { LOCAL_MODEL, LOCAL_REVISION } from './process.mjs';

// IPC is the only output channel. Neither WAV data nor transcript goes to logs.
process.on('disconnect', () => process.exit(0));
const reply = message => new Promise(resolve => process.send?.(message, () => resolve()));
process.once('message', async job => {
  let pipeline;
  try {
    const marker = join(job.cacheDir, `ready-${LOCAL_REVISION}.json`);
    if (job.task !== 'install') {
      try { await access(marker); } catch { throw Object.assign(new Error(), { code: 'LOCAL_NOT_READY' }); }
    }
    if (job.task !== 'install') globalThis.fetch = async () => { throw new Error('Offline inference: network disabled'); };
    const { WhisperForConditionalGeneration, WhisperProcessor, WhisperFeatureExtractor, WhisperTokenizer, AutoTokenizer, AutomaticSpeechRecognitionPipeline, env } = await import('@huggingface/transformers');
    env.cacheDir = job.cacheDir;
    env.allowRemoteModels = job.task === 'install';
    env.allowLocalModels = true;
    env.localModelPath = join(job.cacheDir, 'models');
    // Inference never downloads anything. Only explicit install can contact the model hub.
    let lastProgress = 0;
    const options = {
      dtype: 'q8', device: 'cpu', revision: LOCAL_REVISION, local_files_only: job.task !== 'install',
      ...(job.task === 'install' ? { progress_callback: () => { if (Date.now() - lastProgress > 250) { lastProgress = Date.now(); process.send?.({ kind: 'progress' }); } } } : {}),
    };
    // Explicit components avoid pipeline metadata discovery, which may query the hub even in offline mode.
    let model, tokenizer, processor;
    if (job.task === 'install') {
      [model, tokenizer, processor] = await Promise.all([
        WhisperForConditionalGeneration.from_pretrained(LOCAL_MODEL, options),
        AutoTokenizer.from_pretrained(LOCAL_MODEL, options),
        WhisperProcessor.from_pretrained(LOCAL_MODEL, options),
      ]);
    } else {
      // Transformers 4's auto-tokenizer discovers metadata over HTTP, even with local_files_only.
      // Construct the fixed Whisper components directly from the pinned cache instead.
      const root = join(job.cacheDir, LOCAL_MODEL, LOCAL_REVISION);
      const json = async name => JSON.parse(await readFile(join(root, name), 'utf8'));
      const [tokenizerJSON, tokenizerConfig, processorConfig, loadedModel] = await Promise.all([
        json('tokenizer.json'), json('tokenizer_config.json'), json('preprocessor_config.json'),
        WhisperForConditionalGeneration.from_pretrained(LOCAL_MODEL, options),
      ]);
      model = loadedModel;
      tokenizer = new WhisperTokenizer(tokenizerJSON, tokenizerConfig);
      processor = new WhisperProcessor({}, { tokenizer, feature_extractor: new WhisperFeatureExtractor(processorConfig) }, null);
    }
    pipeline = new AutomaticSpeechRecognitionPipeline({ task: 'automatic-speech-recognition', model, tokenizer, processor });
    if (job.task === 'install') {
      await mkdir(job.cacheDir, { recursive: true, mode: 0o700 });
      await writeFile(marker, JSON.stringify({ model: LOCAL_MODEL, revision: LOCAL_REVISION }), { mode: 0o600 });
    }
    let text;
    if (job.task === 'transcribe') {
      const wav = await readFile(job.path);
      if (wav.length < 44 || wav.length > 3_840_044 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE' || wav.readUInt16LE(20) !== 1 || wav.readUInt16LE(22) !== 1 || wav.readUInt32LE(24) !== 16000 || wav.readUInt16LE(34) !== 16 || wav.toString('ascii', 36, 40) !== 'data') throw Object.assign(new Error(), { code: 'LOCAL_AUDIO' });
      const samples = new Float32Array((wav.length - 44) / 2);
      for (let i = 0; i < samples.length; ++i) samples[i] = wav.readInt16LE(44 + i * 2) / 32768;
      const output = await pipeline(samples, {
        task: 'transcribe', ...(job.language !== 'auto' ? { language: job.language } : {}),
        chunk_length_s: 25, stride_length_s: 5, return_timestamps: false,
      });
      text = output.text;
    }
    await pipeline.dispose(); pipeline = undefined;
    await reply({ kind: 'result', ...(text !== undefined ? { text } : {}) });
  } catch (error) {
    await pipeline?.dispose().catch(() => {});
    await reply({ kind: 'error', code: error.code === 'LOCAL_NOT_READY' || error.code === 'LOCAL_AUDIO' ? error.code : job.task === 'install' ? 'LOCAL_INSTALL' : job.task === 'transcribe' ? 'LOCAL_INFERENCE' : 'LOCAL_NOT_READY' });
  } finally { process.disconnect?.(); }
});
