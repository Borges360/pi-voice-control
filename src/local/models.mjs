/** Only these multilingual, pinned model files may be downloaded. */
export const LOCAL_MODELS = Object.freeze({
  tiny: Object.freeze({ repo: 'onnx-community/whisper-tiny', revision: 'ff4177021cc41f7db950912b73ea4fdf7d01d8e7', sizeMB: 45 }),
  base: Object.freeze({ repo: 'onnx-community/whisper-base', revision: '1846881b6b3a3024392c1eea3ad983695bc23925', sizeMB: 80 }),
  small: Object.freeze({ repo: 'onnx-community/whisper-small', revision: '36050c46d777d46dc4b5f43f6d90574fc38f8732', sizeMB: 255 }),
});
/** @typedef {keyof typeof LOCAL_MODELS} LocalModel */
/** @param {unknown} value @returns {value is LocalModel} */
export function isLocalModel(value) { return typeof value === 'string' && Object.hasOwn(LOCAL_MODELS, value); }
/** @param {unknown} name */
export function modelInfo(name) {
  if (!isLocalModel(name)) throw Object.assign(new Error('Modelo local inválido: use tiny, base ou small.'), { code: 'LOCAL_MODEL' });
  return LOCAL_MODELS[name];
}
