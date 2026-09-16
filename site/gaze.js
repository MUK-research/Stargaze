/** MediaPipe landmarks -> participant-specific screen calibration.
 * Frames never leave the browser. No identity recognition or attention inference.
 */
import {eyeFeatures,fitCalibration,predictGaze,validateCalibration} from './core.js';
const CDN='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21';
const MODEL='https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const TRAIN=[[.12,.15],[.5,.15],[.88,.15],[.88,.5],[.5,.5],[.12,.5],[.12,.85],[.5,.85],[.88,.85]];
const VALIDATE=[[.27,.28],[.73,.28],[.73,.72],[.27,.72],[.5,.4]];

export class GazeTracker {
  constructor(video,onSample,onStatus) {
    this.video=video; this.onSample=onSample; this.onStatus=onStatus;
    this.stream=null; this.model=null; this.landmarker=null; this.running=false;
    this.lastVideo=-1; this.lastFrame=0; this.latest=null; this.validation=null;
    this.calibration=null; this.raf=0; this.generation=0;
  }
  async start() {
    const generation=++this.generation;
    if(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
      throw new Error('Camera needs localhost or HTTPS. Open the Python server in Chrome/Edge.');
    this.onStatus('Loading MediaPipe. Camera stays local; external code/model downloads are required.');
    try {
      const {FaceLandmarker,FilesetResolver}=await import(`${CDN}/vision_bundle.mjs`);
      if(generation!==this.generation) return;
      const files=await FilesetResolver.forVisionTasks(`${CDN}/wasm`);
      const options={baseOptions:{modelAssetPath:MODEL,delegate:'GPU'},runningMode:'VIDEO',
        numFaces:2,outputFaceBlendshapes:true,minFaceDetectionConfidence:.6,
        minFacePresenceConfidence:.6,minTrackingConfidence:.6};
      try {this.landmarker=await FaceLandmarker.createFromOptions(files,options);}
      catch {options.baseOptions.delegate='CPU'; this.landmarker=await FaceLandmarker.createFromOptions(files,options);}
      if(generation!==this.generation) {this.landmarker.close();this.landmarker=null;return;}
      const stream=await navigator.mediaDevices.getUserMedia({video:{width:640,height:480,facingMode:'user'},audio:false});
      if(generation!==this.generation) {stream.getTracks().forEach(t=>t.stop());this.landmarker?.close();return;}
      this.stream=stream; this.video.srcObject=stream; await this.video.play();
      this.running=true; this.lastVideo=-1;
      this.onStatus('Camera ready. Run calibration before using gaze.');
      this.loop();
    } catch(error) {this.stop();throw error;}
  }
  stop() {
    ++this.generation; this.running=false; cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach(t=>t.stop()); this.stream=null;
    this.video.srcObject=null; this.landmarker?.close();this.landmarker=null;
    this.latest=null;this.model=null;this.validation=null;this.calibration=null;
    this.onSample(null);this.onStatus('Camera off.');
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
  loop() {
    if(!this.running)return;
    const now=performance.now();
    if(now-this.lastFrame>=45 && this.video.readyState>=2 && this.video.currentTime!==this.lastVideo) {
      this.lastFrame=now;this.lastVideo=this.video.currentTime;
      try {
        const result=this.landmarker.detectForVideo(this.video,now);
        const features=result.faceLandmarks.length===1?
          eyeFeatures(result.faceLandmarks[0],result.faceBlendshapes?.[0]?.categories||[]):null;
        this.latest=features?{features,time:now}:null;
        this.collect(features,now);
        if(features && this.model && !this.calibration && this.validation?.passed) {
          const point=predictGaze(this.model,features);
          this.onSample(point.every(Number.isFinite)?{x:point[0],y:point[1],time:now}:null);
        } else this.onSample(null);
      } catch(error) {this.onStatus(`Tracking stopped: ${error.message}`);this.stop();return;}
    }
    this.raf=requestAnimationFrame(()=>this.loop());
  }
}
