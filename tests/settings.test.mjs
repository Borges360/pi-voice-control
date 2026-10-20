import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm,stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { settings } from '../dist/src/ui/settings.js';
import { defaults } from '../dist/src/config/validate.js';
import { consentId } from '../dist/src/security/endpoint-policy.js';

for(const mode of ['local','remote-approved','remote-declined','cancelled']) test(`settings ${mode}: explicit selection and atomic global persistence`,async()=>{
  const dir=await mkdtemp(join(tmpdir(),'voice-settings-test-')); const globalPath=join(dir,'voice-control.json');
  const notices=[]; let captured=0;
  const recorder={ listDevices:async()=>[{ id:'Mic José',label:'Mic José' }], start:async()=>{ ++captured; throw new Error('No capture authorized'); } };
  const ui={
    select:async(title,options)=>title.startsWith('Microfone')?(mode==='cancelled'?undefined:options[0]):mode.startsWith('remote')?options[1]:options[0],
    input:async(title,placeholder)=>title.startsWith('Idioma')?'pt':title.startsWith('URL')?(mode.startsWith('remote')?'https://stt.example/v1/audio/transcriptions':placeholder):title.startsWith('Nome')?'VOICE_TEST_KEY':title.startsWith('ID')?'multilingual-model':title.startsWith('Atalho')?'f9':placeholder,
    confirm:async(title)=>title.startsWith('Autorizar')?mode==='remote-approved':false,
    notify:m=>notices.push(m),
  };
  try {
    const saved=await settings(ui,{ config:structuredClone(defaults),consents:[],globalPath,projectPath:join(dir,'project.json'),ffmpegPath:'ffmpeg' },recorder,new AbortController().signal);
    assert.equal(captured,0);
    if(['cancelled','remote-declined'].includes(mode)) { assert.equal(saved,false); await assert.rejects(stat(globalPath),{ code:'ENOENT' }); }
    else {
      assert.equal(saved,true); const data=JSON.parse(await readFile(globalPath,'utf8')); assert.equal(data.shortcut,'f9'); assert.equal(data.capture.deviceId,'Mic José');
      assert.equal(data.transcription.profile,mode==='local'?'local':'remote');
      if(mode==='remote-approved') { assert.deepEqual(data.remoteConsents,[consentId(data.transcription.profiles.remote)]); assert.equal(data.transcription.profiles.remote.apiKeyEnv,'VOICE_TEST_KEY'); }
      else assert.deepEqual(data.remoteConsents,[]);
    }
  } finally { await rm(dir,{ recursive:true,force:true }); }
});
