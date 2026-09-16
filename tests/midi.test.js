import test from 'node:test';import assert from 'node:assert/strict';
import {SoundEngine} from '../site/midi.js';
const mapping={note:60,velocity:80,duration:700,color:{value:90}},config={channel:1,colorCC:74,sendCC:false};
function engine(){const bytes=[],output={id:'test',name:'test',state:'connected',send:(data,time)=>bytes.push({data,time}),clear:()=>bytes.push({clear:true})};const s=new SoundEngine();s.preview=false;s.output=output;return {s,bytes,output};}
test('no note before explicit arming',()=>{const {s,bytes}=engine();assert.equal(s.play(mapping,config,'star'),false);assert.equal(bytes.length,0);});
test('note-on is paired with an independently scheduled note-off',async()=>{const {s,bytes}=engine();await s.arm();assert.equal(s.play(mapping,config,'star'),true);assert.deepEqual(bytes[0].data,[0x90,60,80]);assert.deepEqual(bytes[1].data,[0x80,60,0]);assert.ok(bytes[1].time>performance.now()+500);s.panic();});
test('rate limit prevents repeated frame-rate attacks',async()=>{const {s}=engine();await s.arm();assert.equal(s.play(mapping,config,'a'),true);assert.equal(s.play(mapping,config,'b'),false);s.panic();});
test('release clears queued note-off before same-pitch re-use',async()=>{const {s,bytes}=engine();await s.arm();s.play(mapping,config,'a');s.release();assert.ok(bytes.some(b=>b.clear));assert.deepEqual(bytes.at(-1).data,[0x80,60,0]);assert.equal(s.active,null);});
test('panic is channel-local, sends sustain-off and disarms',async()=>{const {s,bytes}=engine();await s.arm();s.play(mapping,{...config,channel:3},'a');s.panic();assert.equal(s.armed,false);assert.deepEqual(bytes.slice(-3).map(b=>b.data),[[0xB2,64,0],[0xB2,120,0],[0xB2,123,0]]);});
test('CC is opt-in and sent only to separately selected destination',async()=>{const {s,bytes}=engine();const cc=[];s.ccOutput={send:data=>cc.push(data)};await s.arm();s.play(mapping,config,'a');assert.equal(cc.length,0);s.lastOn=-Infinity;s.play(mapping,{...config,sendCC:true},'b');assert.deepEqual(cc,[[0xB0,74,90]]);assert.equal(bytes.filter(b=>b.data?.[0]===0xB0).length,0);s.panic();});
test('unknown colour does not produce invented CC',async()=>{const {s}=engine();const cc=[];s.ccOutput={send:d=>cc.push(d)};await s.arm();s.play({...mapping,color:{value:null}},{...config,sendCC:true},'a');assert.equal(cc.length,0);s.panic();});
test('non-finite MIDI payload rejected',()=>{const {s}=engine();assert.throws(()=>s.play({...mapping,note:NaN},config,'a'),/Invalid MIDI/);});

function accessFixture(){
  const access={outputs:new Map(),inputs:new Map(),onstatechange:null};
  const add=(id,name,manufacturer='')=>{
    const p={id,name,manufacturer,state:'connected',connection:'closed',sent:[],opened:0,
      clear(){},send(bytes,time){this.sent.push({bytes:[...bytes],time});},
      async open(){this.opened++;this.connection='open';access.onstatechange?.({port:this});}};
    access.outputs.set(id,p);return p;
  };
  return {access,add};
}
async function withMidi(request,fn){
  const descriptor=Object.getOwnPropertyDescriptor(navigator,'requestMIDIAccess');
  Object.defineProperty(navigator,'requestMIDIAccess',{value:request,configurable:true});
  try{await fn();}finally{if(descriptor)Object.defineProperty(navigator,'requestMIDIAccess',descriptor);else delete navigator.requestMIDIAccess;}
}
test('discovery requests software support, lists virtual and hardware ports without automatic note-on',async()=>{
  const {access,add}=accessFixture();const virtual=add('iac','IAC Driver Bus 1','Apple'),hardware=add('usb','USB MIDI');
  await withMidi(async options=>{assert.deepEqual(options,{sysex:false,software:true});return access;},async()=>{
    const s=new SoundEngine();assert.equal((await s.connect()).length,2);
    assert.equal(s.midiState,'ready');assert.equal(s.output,null);assert.equal(s.armed,false);
    assert.equal(virtual.sent.length+hardware.sent.length,0);
  });
});
test('available but closed virtual port opens on arm and receives generated notes',async()=>{
  const {access,add}=accessFixture(),p=add('iac','IAC Driver Bus 1');
  await withMidi(async()=>access,async()=>{
    const s=new SoundEngine();s.preview=false;await s.connect();s.select('iac');
    assert.equal(s.output,p);assert.equal(p.connection,'closed');await s.arm();
    assert.equal(p.opened,1);assert.equal(s.armed,true);s.play(mapping,config,'star');
    assert.ok(p.sent.some(m=>m.bytes[0]===0x90));s.panic();
  });
});
test('hotplug disconnect disarms and reconnect restores the same selected port without arming',async()=>{
  const {access,add}=accessFixture(),p=add('iac','IAC'),other=add('other','Other interface');
  await withMidi(async()=>access,async()=>{
    const s=new SoundEngine();s.preview=false;await s.connect();s.select('iac');await s.arm();
    s.play(mapping,config,'star');p.state='disconnected';access.outputs.delete('iac');access.onstatechange();
    assert.equal(s.armed,false);assert.equal(s.active,null);assert.equal(s.output,null);assert.equal(s.outputId,'iac');
    await assert.rejects(s.arm(),/unavailable/);assert.equal(other.sent.length,0);
    const newPort=add('iac','IAC');access.onstatechange();assert.equal(s.output,newPort);assert.equal(s.armed,false);
  });
});
test('refresh discovers a newly created virtual bus and reports inputs separately',async()=>{
  const first=accessFixture(),second=accessFixture();second.add('virtual','New virtual port');
  second.access.inputs.set('keyboard',{id:'keyboard',state:'connected'});let n=0;
  await withMidi(async()=>++n===1?first.access:second.access,async()=>{
    const s=new SoundEngine();await s.connect();assert.equal(s.outputs().length,0);
    await s.connect();assert.equal(s.outputs().length,1);assert.equal(s.inputs().length,1);
    assert.equal(first.access.onstatechange,null);assert.equal(s.armed,false);
  });
});
test('denied MIDI permission has a distinct actionable state',async()=>{
  await withMidi(async()=>{throw Object.assign(new Error('Denied'),{name:'NotAllowedError'});},async()=>{
    const s=new SoundEngine();await assert.rejects(s.connect(),/MIDI permission denied/);
    assert.equal(s.midiState,'denied');assert.equal(s.access,null);assert.equal(s.armed,false);
  });
});
test('output opening failure leaves transport disarmed',async()=>{
  const {access,add}=accessFixture(),p=add('virtual','Virtual');
  p.open=async()=>{throw new Error('Port unavailable');};
  await withMidi(async()=>access,async()=>{
    const s=new SoundEngine();s.preview=false;await s.connect();s.select('virtual');
    await assert.rejects(s.arm(),/Cannot open MIDI output/);assert.equal(s.armed,false);
    assert.equal(p.sent.filter(m=>m.bytes[0]===0x90).length,0);
  });
});
test('colour output accepts an arbitrary software destination and refresh retains both selected IDs',async()=>{
  const {access,add}=accessFixture(),p=add('note','IAC'),c=add('cc','Software synth');
  await withMidi(async()=>access,async()=>{
    const s=new SoundEngine();s.preview=false;await s.connect();s.select('note');s.selectCC('cc');
    await s.connect();assert.equal(s.output,p);assert.equal(s.ccOutput,c);await s.arm();
    s.play(mapping,{...config,sendCC:true},'test');assert.ok(c.sent.some(m=>m.bytes[1]===74));s.panic();
  });
});
