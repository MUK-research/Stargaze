import test from 'node:test';
import assert from 'node:assert/strict';
import {CameraDevices,cameraConstraints,cameraError} from '../site/cameras.js';
const camera=(id,label)=>({kind:'videoinput',deviceId:id,label});

test('selected webcam is requested exactly, with no microphone or facing-mode override',()=>{
  const c=cameraConstraints('built-in');
  assert.deepEqual(c.video.deviceId,{exact:'built-in'});assert.equal(c.audio,false);
  assert.equal('facingMode' in c.video,false);assert.equal('deviceId' in cameraConstraints().video,false);
});
test('enumeration lists OBS and the built-in webcam without activating either',async()=>{
  let captures=0;
  const devices=new CameraDevices({enumerateDevices:async()=>[
    camera('obs','OBS Virtual Camera'),camera('built-in','FaceTime HD Camera'),
    {kind:'audioinput',deviceId:'mic',label:'Microphone'},camera('obs','duplicate')],
    getUserMedia:async()=>captures++});
  assert.deepEqual((await devices.refresh()).map(d=>d.id),['obs','built-in']);
  assert.equal(captures,0);
});
test('explicit permission refresh releases its temporary camera stream',async()=>{
  let granted=false,stops=0,options=null;
  const devices=new CameraDevices({enumerateDevices:async()=>granted?[camera('built-in','Webcam')]:[camera('','')],
    getUserMedia:async c=>{options=c;granted=true;return {getTracks:()=>[{stop:()=>stops++}]};}});
  await devices.refresh({requestPermission:true});
  assert.equal(stops,1);assert.equal(options.audio,false);assert.equal(devices.devices[0].label,'Webcam');
});
test('refreshing named cameras or an active stream does not reopen the default OBS device',async()=>{
  let captures=0;
  const devices=new CameraDevices({enumerateDevices:async()=>[camera('cam','Webcam')],getUserMedia:async()=>captures++});
  await devices.refresh({requestPermission:true});
  devices.media.enumerateDevices=async()=>[camera('cam','')];
  await devices.refresh({requestPermission:true,activeStream:{active:true}});
  assert.equal(captures,0);
});
test('permission granted but unavailable OBS still reveals alternative cameras',async()=>{
  let granted=false;
  const devices=new CameraDevices({enumerateDevices:async()=>granted?[camera('obs','OBS'),camera('cam','Webcam')]:[camera('','')],
    getUserMedia:async()=>{granted=true;throw Object.assign(new Error('Busy'),{name:'NotReadableError'});}});
  await devices.refresh({requestPermission:true});
  assert.equal(devices.devices.length,2);assert.match(devices.warning,/Choose another source/);
});
test('permission denial is not misreported as no webcam',async()=>{
  const devices=new CameraDevices({enumerateDevices:async()=>[camera('','')],
    getUserMedia:async()=>{throw Object.assign(new Error('Denied'),{name:'NotAllowedError'});}});
  await assert.rejects(devices.refresh({requestPermission:true}),/permission denied/);
});
test('unavailable explicit camera reports no substitution',()=>{
  assert.match(cameraError({name:'OverconstrainedError'}),/no other camera was substituted/);
});
test('older enumerate result cannot overwrite a newer device list',async()=>{
  let release;const media={enumerateDevices:()=>new Promise(r=>release=r)};
  const devices=new CameraDevices(media),old=devices.refresh();
  media.enumerateDevices=async()=>[camera('new','New camera')];await devices.refresh();
  release([camera('old','Old camera')]);await old;
  assert.equal(devices.devices[0].id,'new');
});
