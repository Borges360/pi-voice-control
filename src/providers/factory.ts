import type { Profile } from '../security/endpoint-policy.js';
import { LocalProvider } from './local.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';

export const createProvider = (profile: Profile, consents: readonly string[]) => profile.type === 'local'
  ? new LocalProvider(profile) : new OpenAICompatibleProvider(profile, consents);
