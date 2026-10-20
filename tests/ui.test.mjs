import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleWidth, matchesKey, isKeyRelease, isKeyRepeat } from '@earendil-works/pi-tui';
import { indicatorLine,VoiceIndicator,WIDGET_KEY } from '../dist/src/ui/voice-indicator.js';
import { InputGate,normalizeFunctionKey } from '../dist/src/ui/input-gate.js';
import { defaults } from '../dist/src/config/validate.js';
test('indicator aligned and bounded at 0/1/4/32/40/80/120/200 columns',()=>{
  const view={ state:'RECORDING',startedAt:0,rms:0.2 },levels=Array(14).fill(3);
  for(const width of [0,1,4,32,40,80,120,200]) {
    const line=indicatorLine(width,view,levels,defaults.ui,12000); assert.equal(visibleWidth(line),width);
    if(width>=40) assert.match(line,/00:12/); if(width>=80) assert.match(line,/▄▄▄▄/); if(width===32) assert.equal(line.trim(),'● REC');
  }
  assert.equal(indicatorLine(80,{ ...view,state:'IDLE' },levels,defaults.ui),'');
});
test('widget coexists with other extension keys, only 8FPS recording and zero idle frames',async()=>{
  const widgets=new Map([['other',['preserved']]]),statuses=new Map([['other','preserved']]); let frames=0,view={ state:'STARTING',startedAt:performance.now(),rms:0.5 };
  const ui={ setWidget:(k,value,options)=>{ if(value) { assert.equal(options.placement,'belowEditor'); widgets.set(k,value({ requestRender:()=>++frames },{ fg:(_color,s)=>s })); } else widgets.delete(k); }, setStatus:(k,value)=>value===undefined?statuses.delete(k):statuses.set(k,value) };
  const indicator=new VoiceIndicator(ui,defaults.ui,()=>view); indicator.update(view); const startingFrames=frames;
  await new Promise(r=>setTimeout(r,140)); assert.equal(frames,startingFrames);
  view={ ...view,state:'RECORDING' }; indicator.update(view); const before=frames;
  await new Promise(r=>setTimeout(r,430)); assert.ok(frames-before>=2); assert.ok(frames-before<=4);
  assert.ok(widgets.get(WIDGET_KEY).render(80)[0].includes('● REC'));
  indicator.update({ ...view,state:'SUCCESS' }); const end=frames; await new Promise(r=>setTimeout(r,140)); assert.equal(frames,end);
  assert.ok(!widgets.has(WIDGET_KEY)); assert.deepEqual(widgets.get('other'),['preserved']); assert.equal(statuses.get('other'),'preserved'); indicator.clear();
});
test('status fallback remains composable and disappears on cancel',()=>{
  const statuses=new Map([['other','x']]); const view={ state:'RECORDING',startedAt:performance.now(),rms:0 };
  const ui={ setWidget(){},setStatus:(k,v)=>v===undefined?statuses.delete(k):statuses.set(k,v) };
  const indicator=new VoiceIndicator(ui,{ ...defaults.ui,placement:'status' },()=>view); indicator.update(view); assert.match(statuses.get(WIDGET_KEY),/REC/);
  indicator.update({ ...view,state:'CANCELLED' }); assert.equal(statuses.size,1); indicator.clear();
});
test('input gate ignores held repeats, duplicates and terminal blur',()=>{
  const gate=new InputGate(); assert.equal(gate.press('press',0),true); assert.equal(gate.press('repeat',500),false); assert.equal(gate.press('press',1000),false);
  gate.press('release',1100); assert.equal(gate.press('press',1500),true); gate.focus(false); assert.equal(gate.press('press',2000),false);
  gate.focus(true); assert.equal(gate.press('press',2500),true);
  const legacy=new InputGate(); assert.equal(legacy.press('legacy',0),true); assert.equal(legacy.press('legacy',500),false);
  for(let time=550;time<2000;time+=50) assert.equal(legacy.press('legacy',time),false);
  assert.equal(legacy.press('legacy',2400),true);
});
test('Pi key parser recognizes F8 and Kitty press/repeat/release',()=>{
  assert.equal(matchesKey('\x1b[19~','f8'),true);
  assert.equal(matchesKey(normalizeFunctionKey('\x1b[19;1:1~','f8'),'f8'),true);
  assert.equal(normalizeFunctionKey('\x1b[57371;1:1u','f8'),'\x1b[19~');
  assert.equal(normalizeFunctionKey('\x1b[19;5:1~','f8'),undefined);
  assert.equal(isKeyRepeat('\x1b[19;1:2~'),true); assert.equal(isKeyRelease('\x1b[19;1:3~'),true);
});
