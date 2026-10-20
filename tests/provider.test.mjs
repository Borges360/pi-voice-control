import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WavWriter } from '../dist/src/audio/wav-writer.js';
import { OpenAICompatibleProvider } from '../dist/src/providers/openai-compatible.js';
import { consentId } from '../dist/src/security/endpoint-policy.js';

async function audio() { const w = await WavWriter.create(1); await w.append(Buffer.alloc(32000)); return w.finish(0.2); }
const options = signal => ({ model: 'whisper', language: 'pt', timeoutMs: 1000, signal: signal ?? new AbortController().signal });
async function server(handler, work) {
  const s = createServer(handler); s.listen(0, '127.0.0.1'); await once(s, 'listening');
  try { await work(`http://127.0.0.1:${s.address().port}/v1/audio/transcriptions`); }
  finally { s.closeAllConnections(); await new Promise(resolve => s.close(resolve)); }
}
test('real HTTP multipart local request and JSON response, no fallback or retry', async () => {
  const a = await audio(); let requests = 0;
  try {
    await server(async (req, res) => {
      ++requests; const chunks = []; for await (const b of req) chunks.push(b);
      const body = Buffer.concat(chunks).toString('latin1');
      assert.match(req.headers['content-type'], /^multipart\/form-data; boundary=/);
      for (const field of ['name="file"; filename="audio.wav"','name="model"','whisper','name="language"','pt','RIFF']) assert.ok(body.includes(field));
      res.setHeader('content-type','application/json'); res.end(JSON.stringify({ text: 'Olá\r\nOAuth2\x1b[31m!' }));
    }, async endpoint => {
      const provider = new OpenAICompatibleProvider({ type: 'openai-compatible', endpoint, model: 'whisper' }, []);
      assert.deepEqual(await provider.transcribe(a, options()), { text: 'Olá\nOAuth2!' });
    });
    assert.equal(requests, 1);
  } finally { await a.cleanup(); }
});
for (const status of [401,403,429,500]) test(`HTTP ${status} redacts body and does not retry`, async () => {
  const a = await audio(); let count = 0;
  try { await server((_req,res) => { ++count; res.writeHead(status); res.end('SECRET transcript authorization'); }, async endpoint => {
    const provider = new OpenAICompatibleProvider({ type: 'openai-compatible', endpoint, model: 'whisper' }, []);
    await assert.rejects(provider.transcribe(a, options()), error => error.code === `HTTP_${status}` && !error.message.includes('SECRET'));
  }); assert.equal(count, 1); } finally { await a.cleanup(); }
});
for (const [name, response, code] of [
  ['invalid JSON', () => new Response('{'), 'RESPONSE_JSON'],
  ['missing text', () => Response.json({ response: 'x' }), 'RESPONSE_TEXT'],
  ['huge response', () => new Response('x'.repeat(300000)), 'RESPONSE_SIZE'],
  ['huge content-length', () => new Response('x', { headers: { 'content-length': '1000000' } }), 'RESPONSE_SIZE'],
]) test(name, async () => {
  const a = await audio();
  try { const provider = new OpenAICompatibleProvider({ type: 'openai-compatible', endpoint: 'http://localhost:8000/v1/audio/transcriptions', model: 'whisper' }, [], {}, async () => response());
    await assert.rejects(provider.transcribe(a, options()), e => e.code === code);
  } finally { await a.cleanup(); }
});
test('timeout and cancellation cover hung headers and streamed response bodies', async () => {
  const a = await audio();
  try {
    await server((_req,res) => { res.writeHead(200, { 'content-type':'application/json' }); res.write('{"text":"'); }, async endpoint => {
      const provider = new OpenAICompatibleProvider({ type:'openai-compatible', endpoint, model:'whisper' }, []);
      await assert.rejects(provider.transcribe(a, { ...options(), timeoutMs: 50 }), e => e.code === 'STT_TIMEOUT');
      const abort = new AbortController(); const result = provider.transcribe(a, options(abort.signal)); setTimeout(() => abort.abort(), 30);
      await assert.rejects(result, e => e.code === 'CANCELLED');
    });
  } finally { await a.cleanup(); }
});
test('redirect never forwards microphone audio or credentials', async () => {
  const a = await audio(); let destination = 0;
  try { await server((req,res) => {
    if (req.url === '/v1/audio/transcriptions') { res.writeHead(307, { Location: '/stolen' }); res.end(); }
    else { ++destination; res.end('{}'); }
  }, async endpoint => {
    const provider = new OpenAICompatibleProvider({ type:'openai-compatible', endpoint, model:'whisper' }, []);
    await assert.rejects(provider.transcribe(a, options()), e => e.code === 'STT_REDIRECT');
  }); assert.equal(destination, 0); } finally { await a.cleanup(); }
});
test('external adapter requires exact consent and reads only named env credential', async () => {
  const a = await audio(); let count = 0;
  const p = { type:'openai-compatible', endpoint:'https://example.com/v1/audio/transcriptions', model:'whisper', apiKeyEnv:'VOICE_TEST_KEY' };
  const fetcher = async (_url, init) => { ++count; assert.equal(init.headers.Authorization, 'Bearer test-only'); assert.equal(init.redirect,'manual'); assert.equal(init.body.get('language'), null); return Response.json({ text:'dados' }); };
  try {
    const blocked = new OpenAICompatibleProvider(p, [], { VOICE_TEST_KEY: 'test-only' }, fetcher);
    await assert.rejects(blocked.transcribe(a, options()), /autorize/); await assert.rejects(blocked.healthcheck(new AbortController().signal), /autorize/); assert.equal(count, 0);
    const provider = new OpenAICompatibleProvider(p, [consentId(p)], { VOICE_TEST_KEY:'test-only' }, fetcher);
    assert.deepEqual(await provider.transcribe(a, { ...options(), language:'auto' }), { text:'dados' }); assert.equal(count, 1);
    await assert.rejects(provider.transcribe(a, { ...options(), model:'changed' }), e => e.code === 'MODEL_MISMATCH');
    const missing = new OpenAICompatibleProvider(p, [consentId(p)], {}, fetcher);
    await assert.rejects(missing.transcribe(a, options()), e => e.code === 'API_KEY');
  } finally { await a.cleanup(); }
});
test('healthcheck optional catalogues, bad shape and safe model listing', async () => {
  const p = { type:'openai-compatible', endpoint:'http://localhost:8000/v1/audio/transcriptions', model:'whisper' };
  for (const status of [404,405]) {
    const provider = new OpenAICompatibleProvider(p, [], {}, async () => new Response('', { status }));
    assert.deepEqual(await provider.healthcheck(new AbortController().signal), { ok:true, models:[], catalogueAvailable:false });
  }
  const provider = new OpenAICompatibleProvider(p, [], {}, async url => { assert.ok(String(url).endsWith('/v1/models')); return Response.json({ data:[{ id:'whisper' }, { id:42 }] }); });
  assert.deepEqual((await provider.healthcheck(new AbortController().signal)).models,['whisper']);
  const invalid = new OpenAICompatibleProvider(p, [], {}, async () => Response.json({ nope:true }));
  await assert.rejects(invalid.healthcheck(new AbortController().signal), e => e.code === 'MODELS_FORMAT');
});

test('OpenRouter sends native STT JSON and discovers only transcription models',async()=>{
  const a=await audio(); let calls=0;
  const p={type:'openrouter',endpoint:'https://openrouter.ai/api/v1/audio/transcriptions',model:'openai/whisper-1',apiKeyEnv:'VOICE_TEST_KEY'};
  try {
    const fetcher=async(url,init)=>{
      ++calls; assert.equal(init.headers.Authorization,'Bearer fixture-only'); assert.equal(init.redirect,'manual');
      if(!init.method){ assert.match(String(url),/models\?output_modalities=transcription$/); return Response.json({data:[{id:p.model}]}); }
      assert.equal(init.headers['Content-Type'],'application/json'); const body=JSON.parse(init.body);
      assert.equal(body.model,p.model); assert.equal(body.language,'pt'); assert.equal(body.input_audio.format,'wav');
      assert.equal(Buffer.from(body.input_audio.data,'base64').toString('ascii',0,4),'RIFF'); assert.equal(body.messages,undefined);
      return Response.json({text:'Ditado literal; sem reformulação.'});
    };
    const provider=new OpenAICompatibleProvider(p,[consentId(p)],{VOICE_TEST_KEY:'fixture-only'},fetcher);
    await provider.healthcheck(new AbortController().signal);
    assert.deepEqual(await provider.transcribe(a,{...options(),model:p.model}),{text:'Ditado literal; sem reformulação.'}); assert.equal(calls,2);
    const blocked=new OpenAICompatibleProvider(p,[],{VOICE_TEST_KEY:'fixture-only'},fetcher);
    await assert.rejects(blocked.transcribe(a,{...options(),model:p.model}),e=>e.code==='CONSENT_REQUIRED'); assert.equal(calls,2);
  }finally{await a.cleanup();}
});
