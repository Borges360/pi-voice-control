import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesKey } from '@earendil-works/pi-tui';
import { SettingsPanel } from '../dist/src/ui/settings-panel.js';
import { deferred,tick } from './helpers.mjs';
const theme={fg:(_c,t)=>t,bg:(_c,t)=>t,bold:t=>t};
const keys={matches:(d,k)=>matchesKey(d,({'tui.select.confirm':'enter','tui.select.cancel':'escape','tui.select.up':'up','tui.select.down':'down'})[k])};
function fixture(activate,save=async()=>{}) {
  const abort=new AbortController(); let closed=0;
  const panel=new SettingsPanel({title:'Settings',summary:()=>'',rows:[{id:'field',label:'Campo',value:()=>'',description:'Editar campo',activate}],dirty:()=>false,signal:abort.signal,save},theme,keys,()=>{},()=>++closed);
  return {panel,abort,closed:()=>closed};
}
test('Ctrl+S while editing commits the field then saves; failure remains recoverable',async()=>{
  let value='pt',saved='',attempts=0;
  const f=fixture(async p=>{const result=await p.input('Idioma',value);if(result!==undefined)value=result;},async p=>{++attempts;if(attempts===1)throw Error('upstream private payload');saved=value;p.report('Salvo.');});
  f.panel.handleInput('\r');await tick();f.panel.handleInput('\x15');f.panel.handleInput('en');f.panel.handleInput('\x13');await f.panel.drain();
  assert.equal(value,'en');assert.equal(saved,'');assert.ok(!f.panel.render(80).join('\n').includes('private payload'));
  f.panel.handleInput('\x13');await f.panel.drain();assert.equal(saved,'en');assert.equal(f.closed(),0);f.panel.dispose();
});
test('parent abort closes panel and drains a late operation without late UI writes',async()=>{
  const task=deferred();let cancelled=false;
  const f=fixture(async(p,signal)=>{await task.promise;cancelled=signal.aborted;p.report('late');});
  f.panel.handleInput('\r');await tick();f.abort.abort();assert.equal(f.closed(),1);
  let drained=false;const drain=f.panel.drain().then(()=>{drained=true;});await tick();assert.equal(drained,false);
  task.resolve();await drain;assert.equal(cancelled,true);assert.ok(!f.panel.render(80).join('\n').includes('late'));
});
