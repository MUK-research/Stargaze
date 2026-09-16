import test from 'node:test';
import assert from 'node:assert/strict';
import {GazeTracker} from '../site/gaze.js';

function tracker() {
  return new GazeTracker({srcObject:null},()=>{},()=>{});
}

test('14-target calibration completes only after separate validation',()=>{
  const g=tracker();g.running=true;
  let target=null,done=null;
  g.beginCalibration(1000,700,t=>target=t,r=>done=r);
  for(let n=0;n<14;n++) {
    const [x,y]=target.point;
    assert.equal(target.phase,n<9?'train':'validate');
    g.capture();const t=g.calibration.started;
    for(let i=0;i<25;i++)g.collect([x,y],t+450+i*45);
    g.collect([x,y],t+1610);
  }
  assert.equal(g.calibration,null);
  assert.equal(done.targets,5);
  assert.equal(done.passed,true);
  assert.ok(done.rms<80);
});

test('missing face samples cannot calibrate successfully',()=>{
  const g=tracker();g.running=true;
  let targetCalls=0,done=false;
  g.beginCalibration(1000,700,()=>targetCalls++,()=>done=true);
  g.capture();g.collect(null,g.calibration.started+6600);
  assert.equal(targetCalls,3); // initial dot, capture cue, retry
  assert.equal(g.calibration.index,0);
  assert.equal(g.calibration.collecting,false);
  assert.equal(done,false);assert.equal(g.model,null);
});

test('stale inference and multiple faces never emit a gaze point',()=>{
  const samples=[];const g=tracker();g.running=true;g.onSample=x=>samples.push(x);
  g.consume({time:performance.now()-1000,faceLandmarks:[[]],faceBlendshapes:[]});
  g.consume({time:performance.now(),faceLandmarks:[[],[]],faceBlendshapes:[]});
  assert.deepEqual(samples,[null,null]);assert.equal(g.latest,null);
});

test('stop terminates worker, cancels startup and releases all camera tracks',()=>{
  const g=tracker();let terminated=0,stopped=0,rejected=0;
  const old=globalThis.cancelAnimationFrame;globalThis.cancelAnimationFrame=()=>{};
  try {
    g.worker={terminate:()=>terminated++};g.stream={getTracks:()=>[{stop:()=>stopped++}]};
    g.running=true;g.loading=true;g.rejectStart=()=>rejected++;
    g.stop();assert.equal(terminated,1);assert.equal(stopped,1);assert.equal(rejected,1);
    assert.equal(g.running,false);assert.equal(g.loading,false);assert.equal(g.worker,null);
    assert.equal(g.video.srcObject,null);assert.equal(g.model,null);
  } finally {globalThis.cancelAnimationFrame=old;}
});
