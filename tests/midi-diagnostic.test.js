import test from 'node:test';
import assert from 'node:assert/strict';
import {SoundEngine} from '../site/midi.js';

test('explicit routing-test note survives passive cursor loss but obeys Stop',async()=>{
  const s=new SoundEngine();s.preview=false;
  s.output={id:'virtual',state:'connected',send(){},clear(){}};
  await s.arm();s.play({note:60,velocity:45,duration:350,color:{value:null}},{channel:1,sendCC:false},'test-note');
  for(const reason of ['cursor unavailable','tracking unavailable','pointer left sky']){
    s.release(reason);assert.equal(s.active?.objectId,'test-note');
  }
  s.panic('Stop');assert.equal(s.active,null);assert.equal(s.armed,false);
});
test('ordinary object notes still release immediately when tracking is lost',async()=>{
  const s=new SoundEngine();s.preview=false;s.output={id:'virtual',state:'connected',send(){},clear(){}};
  await s.arm();s.play({note:60,velocity:45,duration:350,color:{value:null}},{channel:1,sendCC:false},'star');
  s.release('tracking unavailable');assert.equal(s.active,null);s.panic();
});
