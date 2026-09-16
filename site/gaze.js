/** MediaPipe landmarks -> participant-specific screen calibration.
 * Frames never leave the browser. No identity recognition or attention inference.
 */
import {eyeFeatures,fitCalibration,predictGaze,validateCalibration} from './core.js';
import {cameraConstraints,cameraError} from './cameras.js';
const TRAIN=[[.12,.15],[.5,.15],[.88,.15],[.88,.5],[.5,.5],[.12,.5],[.12,.85],[.5,.85],[.88,.85]];
const VALIDATE=[[.27,.28],[.73,.28],[.73,.72],[.27,.72],[.5,.4]];

export class GazeTracker {
  constructor(video,onSample,onStatus) {
    this.video=video; this.onSample=onSample; this.onStatus=onStatus;
    this.stream=null; this.model=null; this.worker=null; this.running=false;
    this.loading=false; this.pendingFrame=false; this.rejectStart=null;
    this.lastVideo=-1; this.lastFrame=0; this.latest=null; this.validation=null;
    this.calibration=null; this.raf=0; this.generation=0;
    this.processedFrames=0; this.validFrames=0; this.faceCount=0;
    this.lastStatus=0; this.delegate=null;this.cameraId='';this.cameraLabel='';
  }
  async start(deviceId='') {
    if(this.running || this.loading) return;
    if(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
      throw new Error('Camera needs localhost or HTTPS. Open the Python server in Chrome/Edge.');
    if(typeof Worker==='undefined' || typeof createImageBitmap==='undefined')
      throw new Error('This browser cannot run the local camera worker. Use desktop Chrome/Edge.');
    const generation=++this.generation;
    this.loading=true;
    this.onStatus('Loading MediaPipe in a local worker. No webcam frames are uploaded.');
    try {
      // Do not set type: "module": the pinned WASM loader needs importScripts.
      const worker=new Worker(new URL('./vision-worker.js',import.meta.url));
      this.worker=worker;
      await new Promise((resolve,reject)=>{
        let ready=false;
        const timer=setTimeout(()=>fail(new Error('MediaPipe download timed out. Check your internet connection and try again.')),60000);
        const fail=error=>{
          clearTimeout(timer);
          if(!ready) reject(error);
          else if(generation===this.generation) this.stop(`Tracking stopped: ${error.message}`);
        };
        this.rejectStart=error=>{clearTimeout(timer);reject(error);};
        worker.onerror=event=>{event.preventDefault();fail(new Error(event.message||'Camera worker failed to load.'));};
        worker.onmessage=({data})=>{
          if(generation!==this.generation) return;
          if(data.type==='ready') {
            ready=true;clearTimeout(timer);this.rejectStart=null;
            this.delegate=data.delegate;resolve();
          } else if(data.type==='error') fail(new Error(data.message));
          else if(data.type==='result') {
            this.pendingFrame=false;this.processedFrames++;
            try {this.consume(data);} catch(error) {fail(error);}
          }
        };
        worker.postMessage({type:'init'});
      });
      if(generation!==this.generation) return;
      const stream=await navigator.mediaDevices.getUserMedia(cameraConstraints(deviceId));
      if(generation!==this.generation) {stream.getTracks().forEach(t=>t.stop());return;}
      this.stream=stream;
      const track=stream.getVideoTracks()[0];
      this.cameraId=track?.getSettings?.().deviceId||deviceId;
      this.cameraLabel=track?.label||'Selected camera';
      this.video.srcObject=stream; await this.video.play();
      if(generation!==this.generation) return;
      this.running=true; this.loading=false; this.lastVideo=-1;this.lastFrame=0;
      this.processedFrames=0;this.validFrames=0;this.faceCount=0;
      for(const track of stream.getVideoTracks()) {
        track.onended=()=>{if(generation===this.generation)this.stop('Camera disconnected. Start it again to recalibrate.');};
      }
      this.onStatus(`Camera ready (${this.delegate} worker). Run calibration before using gaze.`);
      this.loop();
    } catch(error) {
      // A cancelled, old startup must not stop a newer camera instance.
      if(generation!==this.generation) return;
      const detail=cameraError(error);this.stop(`Camera unavailable: ${detail}`);throw new Error(detail);
    }
  }
  stop(reason='Camera off.') {
    ++this.generation; this.running=false; this.loading=false;
    cancelAnimationFrame(this.raf);
    this.rejectStart?.(new Error('Camera startup cancelled.'));this.rejectStart=null;
    this.worker?.terminate();this.worker=null;this.pendingFrame=false;
    this.stream?.getTracks().forEach(t=>t.stop()); this.stream=null;
    this.video.srcObject=null;this.cameraId='';this.cameraLabel='';
    this.latest=null;this.model=null;this.validation=null;this.calibration=null;
    this.onSample(null);this.onStatus(reason);
  }
  invalidate() {this.model=null;this.validation=null;this.calibration=null;this.onSample(null);}
  beginCalibration(width,height,onTarget,onDone) {
    if(!this.running) throw new Error('Start the camera first.');
    this.invalidate();
    this.calibration={phase:'train',index:0,training:[],validation:[],collecting:false,
      buffer:[],started:0,width,height,onTarget,onDone};
    this.showTarget();
  }
  showTarget() {
    const c=this.calibration;
    const targets=c.phase==='train'?TRAIN:VALIDATE;
    c.collecting=false;c.buffer=[];
    c.onTarget({point:targets[c.index],phase:c.phase,index:c.index+1,total:targets.length,
      message:'Look at the dot; hold your head comfortably still. Press Space to capture.'});
  }
  capture() {
    const c=this.calibration;if(!c||c.collecting)return;
    c.started=performance.now();c.buffer=[];c.collecting=true;
    c.onTarget({point:(c.phase==='train'?TRAIN:VALIDATE)[c.index],phase:c.phase,index:c.index+1,
      total:c.phase==='train'?9:5,message:'Keep looking at the dot…'});
  }
  collect(features,now) {
    const c=this.calibration;if(!c?.collecting)return;
    if(now-c.started>400 && features) c.buffer.push(features);
    if(now-c.started<1600)return;
    if(c.buffer.length<12) {
      if(now-c.started>6500) {this.showTarget();this.onStatus('Not enough clear eye samples. Improve light and press Space to retry.');}
      return;
    }
    const targets=c.phase==='train'?TRAIN:VALIDATE;
    const output=c.phase==='train'?c.training:c.validation;
    output.push(...c.buffer.map(features=>({features,target:targets[c.index]})));
    c.index++;
    if(c.index<targets.length) {this.showTarget();return;}
    if(c.phase==='train') {
      try {this.model=fitCalibration(c.training);}
      catch(error) {this.calibration=null;c.onDone({passed:false,error:error.message});return;}
      c.phase='validate';c.index=0;this.showTarget();return;
    }
    const result=validateCalibration(this.model,c.validation,c.width,c.height);
    this.calibration=null;this.validation=result;
    if(!result.passed)this.model=null;
    c.onDone(result);
  }
  consume(result) {
    if(!this.running) return;
    const now=performance.now();
    // Keep the original capture timestamp: delayed inference is not fresh gaze.
    const fresh=now-result.time<=200;
    this.faceCount=result.faceLandmarks.length;
    const features=fresh && result.faceLandmarks.length===1?
      eyeFeatures(result.faceLandmarks[0],result.faceBlendshapes?.[0]?.categories||[]):null;
    this.latest=features?{features,time:result.time}:null;
    if(features)this.validFrames++;
    if(now-this.lastStatus>1000 && !this.calibration) {
      this.lastStatus=now;
      const status=!fresh?'Frames too slow; reduce camera/browser load.':
        this.faceCount>1?'Multiple faces detected; cursor paused.':
        !this.faceCount?'No face detected; cursor paused.':
        !features?'Eyes not clear or closed; cursor paused.':
        this.validation?.passed?'Calibrated gaze tracking.':'Face and eyes detected. Run calibration.';
      this.onStatus(status);
    }
    this.collect(features,now);
    if(features && this.model && !this.calibration && this.validation?.passed) {
      const point=predictGaze(this.model,features);
      this.onSample(point.every(Number.isFinite)?{x:point[0],y:point[1],time:result.time}:null);
    } else this.onSample(null);
  }
  loop() {
    if(!this.running) return;
    const now=performance.now(),generation=this.generation;
    if(!this.pendingFrame && now-this.lastFrame>=45 && this.video.readyState>=2 && this.video.currentTime!==this.lastVideo) {
      this.lastFrame=now;this.lastVideo=this.video.currentTime;this.pendingFrame=true;
      createImageBitmap(this.video).then(bitmap=>{
        if(generation!==this.generation || !this.running || !this.worker) {bitmap.close();return;}
        try {this.worker.postMessage({type:'frame',bitmap,time:now},[bitmap]);}
        catch(error) {bitmap.close();throw error;}
      }).catch(error=>{
        if(generation===this.generation)this.stop(`Camera frame failed: ${error.message}`);
      });
    }
    this.raf=requestAnimationFrame(()=>this.loop());
  }
}
