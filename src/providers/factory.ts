import type { LocalModel } from '../local/models.mjs';
import { LocalProvider } from './local.js';

export const createProvider = (model: LocalModel) => new LocalProvider(model);
