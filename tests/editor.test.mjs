import test from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from '@earendil-works/pi-tui';
import { VoiceController } from '../dist/src/core/controller.js';
import { fakeCapture, configuration, tick, deferred } from './helpers.mjs';
function editor() {
  const identity=s=>s;
  return new Editor({ requestRender(){} },{ borderColor:identity, selectList:{ selectedPrefix:identity, selectedText:identity, description:identity, scrollInfo:identity, noMatch:identity } });
}
for (const original of ['', 'Texto existente.', 'José já usa OAuth2\nKubernetes e MCP.', 'Unicode: 🗣️ ação']) test(`Pi real Editor paste/undo preserves ${JSON.stringify(original)}`,async()=>{
  const e=editor(); e.setText(original); let submitted=0; e.onSubmit=()=>++submitted;
  const f=fakeCapture(); const controller=new VoiceController(f.recorder,()=>({ transcribe:async()=>({ text:'ditado Kafka!' }) }),{ update(){},notify(){},paste:text=>e.handleInput(`\x1b[200~${text}\x1b[201~`) });
  await controller.start(configuration()); await controller.stop();
  assert.equal(e.getExpandedText(),original+'ditado Kafka!'); assert.equal(submitted,0);
  e.handleInput('\x1f'); assert.equal(e.getExpandedText(),original);
});
test('Pi real Editor cursor in middle and multiline long paste',async()=>{
  const e=editor(); e.setText('abcXYZ'); for(let i=0;i<3;i++) e.handleInput('\x1b[D');
  const text='José\nOAuth2 '.repeat(1000); e.handleInput(`\x1b[200~${text}\x1b[201~`);
  assert.equal(e.getExpandedText(),'abc'+text+'XYZ'); e.handleInput('\x1f'); assert.equal(e.getExpandedText(),'abcXYZ');
});
test('cancelled STT cannot change actual editor or submit shell-like text',async()=>{
  const e=editor(); e.setText('Original\n'); let submitted=0; e.onSubmit=()=>++submitted;
  const response=deferred(),f=fakeCapture(); const controller=new VoiceController(f.recorder,()=>({ transcribe:()=>response.promise }),{ update(){},notify(){},paste:t=>e.handleInput(`\x1b[200~${t}\x1b[201~`) });
  await controller.start(configuration()); const stopping=controller.stop(); await tick(); await controller.cancel(); response.resolve({ text:'! rm -rf /\n\x1b[201~' }); await stopping;
  assert.equal(e.getExpandedText(),'Original\n'); assert.equal(submitted,0);
});
