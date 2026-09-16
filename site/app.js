import {VERSION,defaults,clamp,RegionGate,mapStar,horizontal} from './core.js';
import {SoundEngine} from './midi.js';
import {GazeTracker} from './gaze.js';
import {CameraDevices} from './cameras.js';

const $=id=>document.getElementById(id), stage=$('stage'), canvas=$('overlay'), ctx=canvas.getContext('2d');
const config={...defaults};
const session={schema:'ephemeris.session/1',version:VERSION,started_at:new Date().toISOString(),
  samples:[],events:[],catalogues:[],objects:new Map(),truncated:false};
const t0=performance.now(), gate=new RegionGate();
let aladin=null,skyOverlay=null,ready=false,api=false,catalogue=[],seed=null;
let cursor=null,mouse=null,gazePoint=null,smoothed=null,dragging=false,viewUntil=0;
let width=1,height=1,lastFrame=0,lastSample=0,lastOverlay=0,segment=0,broken=true;
let trailDirty=false,querySeq=0,queryController=null,autoTimer=null,lastReadout=0;
let manualSegment=-1;
const trace=[], fields={pleiades:[56.75,24.1167,8],orion:[83.8,-3,20],andromeda:[10.6847,41.2688,5],galactic:[266.4168,-29.0078,10]};
const message=text=>$('message').textContent=text;
const log=e=>{
  if(session.events.length>=5000){session.events.shift();session.truncated=true;}
  session.events.push({t_ms:Math.round(performance.now()-t0),utc:new Date().toISOString(),...e});
};
const sound=new SoundEngine(log);
const cameras=new CameraDevices();
let cameraChoice={id:'',label:''};
try {
  const saved=JSON.parse(localStorage.getItem('ephemeris.camera.v1')||'null');
  if(saved && typeof saved.id==='string' && typeof saved.label==='string') cameraChoice=saved;
} catch {}
const gaze=new GazeTracker($('video'),point=>{
  gazePoint=point;
  if(!point){smoothed=null;if($('input').value==='gaze')breakInput('tracking unavailable');}
},text=>{
  $('gazeStatus').textContent=text;
  if(!gaze.loading) {
    $('camera').textContent=gaze.running?'Stop camera':'Start camera';
    $('camera').disabled=false;$('calibrate').disabled=!gaze.running;
    $('video').hidden=!gaze.running;
    if(!gaze.running)$('calibration').hidden=true;
  }
  updateCameraStatus();
});

function breakTrace(){if(!broken){segment++;broken=true;}cursor=null;}
function breakInput(reason){
  if(gate.current){log({kind:'exit',objectId:gate.current.star.id,reason});}
  gate.reset();sound.release(reason);breakTrace();
}
function panic(reason='Stopped'){
  sound.panic(reason);breakInput(reason);message(reason+' · sound off');
}
function updateTransport(){
  $('armedState').textContent=sound.armed?'ARMED':'SILENT';
  $('armedState').classList.toggle('live',sound.armed);
  $('arm').textContent=sound.armed?'Disarm':'Arm sound';
  $('midiStatus').textContent=sound.armed?
    `Armed · ${sound.output?.name||'browser preview'} · channel ${config.channel} · one strike per visit`:
    `Silent · ${sound.output?.name||'no MIDI output selected'} · preview ${sound.preview?'on':'off'}`;
  $('midiTest').disabled=!sound.armed || !sound.output;
}
function rebuildPorts(){
  const ports=sound.outputs(),enabled=Boolean(sound.access),busy=sound.midiState==='requesting';
  for(const [id,selected,none] of [['output',sound.outputId,'None · preview only'],['ccOutput',sound.ccOutputId,'No CC destination']]){
    const element=$(id);element.replaceChildren(new Option(enabled?none:'Enable MIDI to list outputs',''));
    ports.forEach((p,i)=>{
      const offline=p.state==='disconnected';
      // Do not filter on connection="closed": such ports are available to open.
      const label=`${p.name||'Unnamed output '+(i+1)}${p.manufacturer?' · '+p.manufacturer:''}${offline?' (offline)':''}`;
      const option=new Option(label,p.id);option.disabled=offline;element.add(option);
    });
    if(selected&&!ports.some(p=>p.id===selected)) {
      const option=new Option('Previously selected output (unavailable)',selected);option.disabled=true;element.add(option);
    }
    element.value=selected||'';element.disabled=!enabled||busy;
  }
  const count=ports.filter(p=>p.state!=='disconnected').length;
  const inputs=sound.inputs().filter(p=>p.state!=='disconnected').length;
  $('midi').disabled=busy;$('midiRefresh').disabled=busy;
  $('midi').textContent=busy?'Discovering…':enabled?'MIDI enabled':'Enable MIDI';
  $('midiDevicesStatus').textContent=busy?'Requesting MIDI access and listing outputs…':
    sound.midiError||(!enabled?'MIDI not enabled. Hardware and virtual output ports are supported.':
    `${count} output port${count===1?'':'s'} · ${inputs} input port${inputs===1?'':'s'}. `+
    (!count?'No output ports exposed by the browser. Enable a virtual bus or connect an interface; see Virtual routing below.':
      sound.outputId&&!sound.output?'Selected output unavailable. Reconnect it or choose another; sound stays disarmed.':
      'All available output ports are listed; no Disklavier is required.'));
}
sound.onState=()=>{updateTransport();rebuildPorts();};
function updateCameraStatus(){
  $('cameraDeviceStatus').textContent=gaze.running?
    `Active camera: ${gaze.cameraLabel}. Switching sources stops tracking and requires recalibration.`:
    cameraChoice.id&&!cameras.devices.some(d=>d.id===cameraChoice.id)?
      `Saved camera unavailable or permission required: ${cameraChoice.label||'selected webcam'}. Refresh and choose a source; no automatic substitution.`:
      `${cameras.devices.length} camera source${cameras.devices.length===1?'':'s'} listed. `+
      (cameraChoice.id?`Selected: ${cameraChoice.label}.`:'Browser default may be OBS; choose your webcam explicitly.')+
      (cameras.warning?' '+cameras.warning:'');
}
function rebuildCameras(){
  const element=$('cameraDevice');element.replaceChildren(new Option('Browser default camera',''));
  for(const d of cameras.devices) element.add(new Option(d.label,d.id));
  if(cameraChoice.id&&!cameras.devices.some(d=>d.id===cameraChoice.id)) {
    const option=new Option(`${cameraChoice.label||'Saved camera'} (unavailable / permission needed)`,cameraChoice.id);
    option.disabled=true;element.add(option);
  }
  element.value=cameraChoice.id;updateCameraStatus();
}
async function refreshCameras(requestPermission=false){
  $('cameraRefresh').disabled=true;
  try {
    await cameras.refresh({requestPermission,selectedId:cameraChoice.id,activeStream:gaze.stream});
    if(gaze.running&&gaze.cameraId&&!cameras.devices.some(d=>d.id===gaze.cameraId)) {
      panic('Camera disconnected');gaze.stop('Selected camera disconnected. Choose a camera and recalibrate.');
    }
    rebuildCameras();
  } catch(error) {$('cameraDeviceStatus').textContent=error.message;}
  finally {$('cameraRefresh').disabled=false;}
}
function observationTime(){
  if($('now').checked)return new Date();
  const date=new Date($('fixedTime').value+'Z');
  return Number.isFinite(date.getTime())?date:null;
}
function setConfig(){
  const numeric=['latitude','longitude','radius','dwell','minNote','maxNote','minVelocity','maxVelocity','duration','channel','root','colorCC'];
  const next={...config};
  for(const key of numeric){
    const element=$(key),value=Number(element.value);
    if(!element.value.trim()||!Number.isFinite(value)||!element.checkValidity()){
      element.value=String(config[key]);message(`Invalid ${key}; previous value restored.`);return false;
    }
    next[key]=value;
  }
  if(next.maxNote<next.minNote||next.maxVelocity<next.minVelocity){
    for(const key of numeric)$(key).value=String(config[key]);message('Maximum must not be lower than minimum.');return false;
  }
  for(const key of ['trail','sendCC','horizonOnly'])next[key]=$(key).checked;
  Object.assign(config,next);sound.preview=$('preview').checked;
  $('radiusValue').textContent=`${config.radius} px`;$('dwellValue').textContent=`${config.dwell} ms`;
  log({kind:'settings',config:{...config},input:$('input').value,now:$('now').checked,fixedUtc:$('fixedTime').value});
  return true;
}
function resetView(){
  breakInput('view changed');viewUntil=performance.now()+250;querySeq++;
  queryController?.abort();clearTimeout(autoTimer);
  if($('autoCatalog').checked)autoTimer=setTimeout(loadCatalogue,700);
}
function resize(){
  const r=stage.getBoundingClientRect(),changed=Math.abs(r.width-width)>1||Math.abs(r.height-height)>1;
  width=r.width;height=r.height;
  const dpr=Math.min(window.devicePixelRatio||1,2);
  canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);canvas.style.width=width+'px';canvas.style.height=height+'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);
  if(changed){
    panic('Viewport changed');gaze.invalidate();smoothed=null;gazePoint=null;
    $('calibration').hidden=true;
    if(gaze.running)$('gazeStatus').textContent='Viewport changed. Recalibrate for this screen layout.';
  }
}
new ResizeObserver(resize).observe(stage);

function acceptCatalogue(payload){
  const objects=payload.objects||[],seen=new Set();
  catalogue=objects.filter(s=>{const valid=s&&typeof s.id==='string'&&!seen.has(s.id)&&Number.isFinite(s.ra)&&Number.isFinite(s.dec)&&s.ra>=0&&s.ra<360&&s.dec>=-90&&s.dec<=90;if(valid)seen.add(s.id);return valid;}).slice(0,500);
  for(const s of catalogue)session.objects.set(s.id,s);
  session.catalogues.push({...payload,objects:undefined,count:catalogue.length});
  if(session.catalogues.length>50)session.catalogues.shift();
  breakInput('catalogue changed');
  $('catalogStatus').textContent=`${catalogue.length} objects · ${payload.source||'catalogue'}${payload.possibly_truncated?' · capped / incomplete':''}${payload.warning?' · '+payload.warning:''}`;
}
async function loadCatalogue(){
  if(!ready)return;
  if(!api){if(seed)acceptCatalogue({...seed,source:'bundled SIMBAD fields only'});message('Live lookup needs python3 app.py; bundled fields remain playable.');return;}
  const seq=++querySeq;queryController?.abort();queryController=new AbortController();
  const [ra,dec]=aladin.getRaDec(),fov=aladin.getFov();
  const wanted=Math.hypot(fov[0],fov[1]||fov[0])/2;
  const radius=clamp(wanted,.05,15);
  $('catalogStatus').textContent='Querying SIMBAD around view centre… Existing objects remain available.';
  try{
    const response=await fetch(`/api/catalog?${new URLSearchParams({ra,dec,radius,limit:300,mag_limit:12})}`,{signal:queryController.signal});
    const payload=await response.json();if(!response.ok)throw new Error(payload.error||`HTTP ${response.status}`);
    if(seq!==querySeq)return;
    acceptCatalogue(payload);
    if(wanted>15)$('catalogStatus').textContent+=' · only central 15° radius queried; zoom in for fuller coverage';
    message(payload.fallback?'Using a limited fallback catalogue.':'Catalogue ready · hover near a marked object.');
  }catch(error){if(error.name!=='AbortError'&&seq===querySeq){$('catalogStatus').textContent='Lookup failed; existing objects retained.';message(error.message);}}
}
function world(x,y){
  if(!ready||x<0||x>width||y<0||y>height)return null;
  try{const p=aladin.pix2world(x,y);return p&&p.length>=2&&p.every(Number.isFinite)?[p[0],p[1]]:null;}catch{return null;}
}
function pixel(ra,dec){
  try{const p=aladin.world2pix(ra,dec);return p&&p.every(Number.isFinite)&&p[0]>=0&&p[0]<=width&&p[1]>=0&&p[1]<=height?p:null;}catch{return null;}
}
function appendPoint(ra,dec,x,y,source,now,objectId=null){
  if(!Number.isFinite(ra)||!Number.isFinite(dec))return;
  broken=false;
  const point={t_ms:Math.round(now-t0),utc:new Date().toISOString(),observation_utc:observationTime()?.toISOString()||null,
    ra,dec,x,y,source,segment:source==='manual'?manualSegment:segment,objectId};
  if(session.samples.length>=20000){session.samples.shift();session.truncated=true;}
  session.samples.push(point);trace.push(point);if(trace.length>2000)trace.shift();trailDirty=true;
}
function redrawSkyTrace(now){
  if(!skyOverlay||now-lastOverlay<200||!trailDirty)return;
  lastOverlay=now;trailDirty=false;skyOverlay.removeAll();
  if(!config.trail)return;
  const groups=new Map();
  for(const p of trace){if(!groups.has(p.segment))groups.set(p.segment,[]);groups.get(p.segment).push([p.ra,p.dec]);}
  for(const points of groups.values())if(points.length>1)skyOverlay.add(A.polyline(points));
}
function chooseCursor(now){
  if(!ready||dragging||document.hidden||now<viewUntil||gaze.calibration)return null;
  if($('input').value==='mouse')return mouse;
  if(!gazePoint||!gaze.validation?.passed||now-gazePoint.time>200)return null;
  if(gazePoint.x<0||gazePoint.x>1||gazePoint.y<0||gazePoint.y>1)return null;
  const target={x:gazePoint.x*width,y:gazePoint.y*height};
  const alpha=1-Math.exp(-Math.max(1,now-lastFrame)/65);
  smoothed=smoothed?{x:smoothed.x+alpha*(target.x-smoothed.x),y:smoothed.y+alpha*(target.y-smoothed.y)}:target;
  return smoothed;
}
function showObject(current,date){
  if(!current){$('objectName').textContent='Between objects';$('objectInfo').textContent='Approach a catalogue marker. A short dwell triggers one note; leaving releases it.';$('objectLink').hidden=true;return;}
  const s=current.star,m=mapStar(s,current.distance,config,date);
  $('objectName').textContent=s.name||s.id;
  const phot=Number.isFinite(s.mag_v)?`V ${s.mag_v.toFixed(2)}`:'V unknown → neutral pitch';
  const colour=Number.isFinite(s.bv)?`B−V ${s.bv.toFixed(2)}`:`spectrum ${s.spectral_type||'unknown'}`;
  $('objectInfo').textContent=`${s.type||'Object'} · ${phot} · ${colour}\nRA ${s.ra.toFixed(5)}° · Dec ${s.dec.toFixed(5)}°\nAlt ${m.altitude.toFixed(1)}° · Az ${m.azimuth===null?'undefined':m.azimuth.toFixed(1)+'°'} → ${m.rootName} ${m.mode}\n${m.noteName} / MIDI ${m.note} · velocity ${m.velocity} · colour ${m.color.value??'—'} (${m.color.basis})`;
  $('objectLink').href='https://simbad.cds.unistra.fr/simbad/sim-id?Ident='+encodeURIComponent(s.id);$('objectLink').hidden=false;
}
function draw(now){
  ctx.clearRect(0,0,width,height);
  const date=observationTime(),next=chooseCursor(now);lastFrame=now;
  cursor=next&&world(next.x,next.y)?next:null;
  if(!cursor||!date){breakInput('cursor unavailable');}
  const candidates=[];
  for(const star of catalogue){
    const p=pixel(star.ra,star.dec);if(!p)continue;
    if(config.horizonOnly&&date&&horizontal(star.ra,star.dec,config.latitude,config.longitude,date).altitude<0)continue;
    if($('labels').checked){ctx.strokeStyle='rgba(183,213,235,.48)';ctx.lineWidth=1;ctx.beginPath();ctx.arc(p[0],p[1],4,0,Math.PI*2);ctx.stroke();}
    if(cursor)candidates.push({star,x:p[0],y:p[1],distance:Math.hypot(p[0]-cursor.x,p[1]-cursor.y)});
  }
  let state={current:null,progress:0,events:[]};
  if(cursor&&date){
    state=gate.update(candidates,now,config.radius,config.dwell);
    for(const e of state.events){
      log({kind:e.kind,objectId:e.star.id,distance:e.distance});
      if(e.kind==='exit')sound.release('region exit');
      if(e.kind==='dwell'&&sound.armed){
        try{const played=sound.play(mapStar(e.star,e.distance,config,date),config,e.star.id);if(!played)log({kind:'note_suppressed',reason:'rate limit',objectId:e.star.id});}
        catch(error){panic(error.message);}
      }
    }
    // A failed MIDI send can stop the cursor during this frame.
    if(!cursor){requestAnimationFrame(draw);return;}
    const [ra,dec]=world(cursor.x,cursor.y);
    const previous=session.samples.at(-1);
    if(now-lastSample>=80&&(broken||!previous||Math.hypot(cursor.x-previous.x,cursor.y-previous.y)>1||now-lastSample>500)){
      appendPoint(ra,dec,cursor.x,cursor.y,$('input').value,now,state.current?.star.id||null);lastSample=now;
    }
    ctx.strokeStyle='#8ce8d4';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(cursor.x,cursor.y,9,0,Math.PI*2);ctx.stroke();
    ctx.fillStyle='#c6fff0';ctx.beginPath();ctx.arc(cursor.x,cursor.y,2,0,Math.PI*2);ctx.fill();
    if(state.current){
      const p=state.current;ctx.strokeStyle='rgba(119,222,208,.35)';ctx.beginPath();ctx.arc(p.x,p.y,config.radius,0,Math.PI*2);ctx.stroke();
      ctx.beginPath();ctx.moveTo(cursor.x,cursor.y);ctx.lineTo(p.x,p.y);ctx.stroke();
      ctx.strokeStyle='#c6fff0';ctx.lineWidth=3;ctx.beginPath();ctx.arc(p.x,p.y,11,-Math.PI/2,-Math.PI/2+state.progress*2*Math.PI);ctx.stroke();
    }
    if(now-lastReadout>120)$('cursorCoordinates').textContent=`ICRS · RA ${ra.toFixed(5)}° · Dec ${dec.toFixed(5)}°`;
  }
  if(now-lastReadout>120){showObject(state.current,date);$('clock').textContent=date?date.toISOString().replace('T',' ').slice(0,19)+' UTC':'Choose a valid UTC time';lastReadout=now;}
  redrawSkyTrace(now);requestAnimationFrame(draw);
}

stage.addEventListener('pointermove',e=>{
  if(e.target.closest('a,button,#calibration'))return;
  const r=stage.getBoundingClientRect();mouse={x:e.clientX-r.left,y:e.clientY-r.top};
});
stage.addEventListener('pointerleave',()=>{mouse=null;if($('input').value==='mouse')breakInput('pointer left sky');});
stage.addEventListener('pointerdown',e=>{if(!e.target.closest('a,button,#calibration')){dragging=true;breakInput('panning');}});
window.addEventListener('pointerup',()=>{if(dragging){dragging=false;resetView();}});
stage.addEventListener('wheel',resetView,{passive:true});
$('arm').onclick=async()=>{try{if(sound.armed){panic('Disarmed');return;}if(!ready)throw new Error('Wait for the sky viewer to load.');if($('input').value==='gaze'&&!gaze.validation?.passed)throw new Error('Calibrate and validate gaze first.');if(!observationTime())throw new Error('Choose a valid observation time.');if(!setConfig())return;gate.reset();await sound.arm();message('Armed · enter an object region and dwell to play.');}catch(e){message(e.message);}};
$('panic').onclick=()=>panic();
const connectMidi=async()=>{
  try {await sound.connect();message(sound.outputs().some(p=>p.state!=='disconnected')?
    'Select any MIDI output, physical or virtual; then arm sound.':'No MIDI output ports available. Open Virtual routing for setup instructions.');}
  catch(e){message(e.message);}
};
$('midi').onclick=connectMidi;$('midiRefresh').onclick=connectMidi;
$('output').onchange=()=>{try{sound.select($('output').value,config.channel);gate.reset();}catch(e){message(e.message);rebuildPorts();}};
$('ccOutput').onchange=()=>{try{sound.selectCC($('ccOutput').value);gate.reset();}catch(e){message(e.message);rebuildPorts();}};
$('midiTest').onclick=()=>{
  if(!sound.armed||!sound.output){message('Choose a MIDI output and arm sound before testing.');return;}
  gate.reset();breakTrace();
  try {
    const sent=sound.play({note:clamp(60,config.minNote,config.maxNote),velocity:Math.min(45,config.maxVelocity),duration:350,color:{value:null}},
      {...config,sendCC:false},'test-note');
    message(sent?`Test note sent to ${sound.output.name||sound.output.id} · channel ${config.channel}`:'Test not sent: attack-rate limit. Press again after a short pause.');
  }catch(e){panic(e.message);}
};
$('input').onchange=()=>{panic('Input changed');gazePoint=null;smoothed=null;if($('input').value==='gaze'&&!gaze.validation?.passed)message('Start the camera and complete calibration first.');};
for(const key of ['latitude','longitude','radius','dwell','minNote','maxNote','minVelocity','maxVelocity','duration','channel','root','colorCC','sendCC','horizonOnly','preview']){
  $(key).addEventListener('change',()=>{panic('Settings changed');setConfig();sound.channel=config.channel-1;});
}
$('trail').onchange=()=>{config.trail=$('trail').checked;trailDirty=true;};
$('now').onchange=()=>{panic('Observation time changed');$('fixedTime').disabled=$('now').checked;log({kind:'observation_time',now:$('now').checked,utc:$('fixedTime').value});};
$('fixedTime').value=new Date().toISOString().slice(0,19);
$('fixedTime').onchange=()=>{panic('Observation time changed');if(!observationTime())message('Invalid fixed UTC time.');};
$('go').onclick=()=>{if(!ready)return;panic('Field changed');const [ra,dec,fov]=fields[$('field').value];aladin.gotoRaDec(ra,dec);aladin.setFoV(fov);resetView();if(seed)acceptCatalogue({...seed,source:'bundled SIMBAD fields'});};
$('survey').onchange=()=>{if(ready){panic('Survey changed');aladin.setImageSurvey($('survey').value);log({kind:'survey',survey:$('survey').value});}};
$('catalog').onclick=loadCatalogue;
$('clear').onclick=()=>{manualSegment--;trace.length=0;trailDirty=true;breakTrace();log({kind:'trace_cleared'});message('Visible trace cleared. Earlier samples remain in the session export.');};
$('manualAdd').onclick=()=>{
  const ra=Number($('manualRa').value),dec=Number($('manualDec').value);
  if(!$('manualRa').value||!$('manualDec').value||!Number.isFinite(ra)||!Number.isFinite(dec)||ra<0||ra>360||Math.abs(dec)>90){message('RA must be 0–360°, Dec −90–90°.');return;}
  if(session.samples.at(-1)?.source!=='manual')breakTrace();
  appendPoint(ra%360,dec,null,null,'manual',performance.now());message('Manual ICRS point added to the sky trace.');
};
$('cameraRefresh').onclick=()=>refreshCameras(true);
$('cameraDevice').onchange=()=>{
  const id=$('cameraDevice').value;
  cameraChoice={id,label:cameras.devices.find(d=>d.id===id)?.label||''};
  try {localStorage.setItem('ephemeris.camera.v1',JSON.stringify(cameraChoice));} catch {}
  panic('Camera source changed');gaze.stop('Camera source changed. Press Start camera, then recalibrate.');rebuildCameras();
};
navigator.mediaDevices?.addEventListener?.('devicechange',()=>refreshCameras());
$('camera').onclick=async()=>{
  panic('Camera mode changed');
  if(gaze.running){gaze.stop();$('video').hidden=true;$('camera').textContent='Start camera';$('calibrate').disabled=true;return;}
  $('camera').disabled=true;
  try{await gaze.start(cameraChoice.id);await refreshCameras();$('video').hidden=!gaze.running;$('camera').textContent=gaze.running?'Stop camera':'Start camera';$('calibrate').disabled=!gaze.running;}
  catch(e){message(e.message);$('gazeStatus').textContent=e.message;}
  finally{$('camera').disabled=false;}
};
function cancelCalibration(){gaze.invalidate();$('calibration').hidden=true;panic('Calibration cancelled');}
$('calibrate').onclick=()=>{
  panic('Calibration');
  try{
    gaze.beginCalibration(width,height,target=>{
      $('calibration').hidden=false;$('calibrationDot').style.left=`${target.point[0]*100}%`;$('calibrationDot').style.top=`${target.point[1]*100}%`;
      $('calibrationTitle').textContent=`${target.phase==='train'?'Calibration':'Validation'} ${target.index}/${target.total}`;
      $('calibrationText').textContent=target.message;
    },result=>{
      $('calibration').hidden=true;log({kind:'gaze_validation',result});
      if(result.passed){
        $('input').value='gaze';config.radius=clamp(Math.ceil(Math.max(85,result.rms*1.5)),15,250);$('radius').value=config.radius;$('radiusValue').textContent=config.radius+' px';
        $('gazeStatus').textContent=`Validation RMS ${Math.round(result.rms)} px; worst target ${Math.round(result.worst)} px. Coarse artistic cursor, not validated eye tracking.`;
        message('Gaze cursor ready. Check its alignment, then arm sound.');
      }else{$('input').value='mouse';$('gazeStatus').textContent=result.error||`Calibration failed validation (RMS ${Math.round(result.rms)} px). Try again; mouse mode retained.`;}
    });
  }catch(e){message(e.message);}
};
$('cancelCalibration').onclick=cancelCalibration;
$('fullscreen').onclick=async()=>{panic('Fullscreen');try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch(e){message(e.message);}};
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){if(gaze.calibration)cancelCalibration();panic('Emergency stop');}
  if(e.code==='Space'&&gaze.calibration){e.preventDefault();gaze.capture();}
});
window.addEventListener('blur',()=>panic('Window lost focus'));
window.addEventListener('pagehide',()=>{panic('Page closed');gaze.stop();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){panic('Tab hidden');gaze.stop();$('video').hidden=true;$('camera').textContent='Start camera';$('calibrate').disabled=true;$('calibration').hidden=true;}});
function download(name,text,mime){const url=URL.createObjectURL(new Blob([text],{type:mime}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
const stamp=()=>new Date().toISOString().replace(/[:.]/g,'-');
$('exportJson').onclick=()=>{
  const output={...session,objects:[...session.objects.values()],config:{...config},survey:$('survey').value,field:$('field').value,
    screen:{width,height},calibration:gaze.validation,input:$('input').value,
    privacy:'No webcam frames or face landmarks included. Gaze is an estimate, not a measure of attention.'};
  download(`ephemeris-${stamp()}.json`,JSON.stringify(output,null,2),'application/json');
};
$('exportCsv').onclick=()=>{
  const keys=['t_ms','utc','observation_utc','ra','dec','x','y','source','segment','objectId'];
  const escape=v=>{let s=String(v??'');if(/^[=+@]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  download(`ephemeris-trace-${stamp()}.csv`,[keys.join(','),...session.samples.map(p=>keys.map(k=>escape(p[k])).join(','))].join('\r\n'),'text/csv');
};

async function init(){
  try{
    const response=await fetch('data/seed.json');if(response.ok){seed=await response.json();acceptCatalogue({...seed,source:'bundled SIMBAD fields'});}else throw new Error('Bundled catalogue missing');
  }catch(e){$('catalogStatus').textContent=e.message+'; try a live lookup after loading.';}
  try{const response=await fetch('/api/health');api=response.ok&&(await response.json()).catalog==='SIMBAD';}catch{api=false;}
  const until=performance.now()+20000;while(!window.A&&performance.now()<until)await new Promise(r=>setTimeout(r,100));
  if(!window.A)throw new Error('Aladin could not load. Check the internet connection or CDN access.');
  await A.init;
  aladin=A.aladin('#aladin',{survey:'P/DSS2/color',target:'56.75 +24.1167',fov:8,cooFrame:'ICRS',showReticle:false,showCooGrid:false,showGotoControl:false});
  skyOverlay=A.graphicOverlay({color:'#77ded0',lineWidth:2,name:'Gaze / mouse trajectory'});aladin.addOverlay(skyOverlay);
  aladin.on('positionChanged',resetView);aladin.on('zoomChanged',resetView);
  ready=true;$('loading').hidden=true;resize();updateTransport();requestAnimationFrame(draw);
  message('Mouse mode · real survey imagery · arm sound when ready');
  window.ephemeris={getState:()=>({ready,api,armed:sound.armed,catalogueCount:catalogue.length,
    gaze:{running:gaze.running,loading:gaze.loading,frames:gaze.processedFrames,
      validFrames:gaze.validFrames,faceCount:gaze.faceCount,delegate:gaze.delegate,
      cameraId:gaze.cameraId,cameraLabel:gaze.cameraLabel},
    midi:{state:sound.midiState,outputId:sound.outputId,availableOutputs:sound.outputs().filter(p=>p.state!=='disconnected').length},
    current:gate.current?.star.id||null,sampleCount:session.samples.length,events:session.events.slice(-100),
    projected:catalogue.map(star=>({id:star.id,xy:pixel(star.ra,star.dec)})).filter(p=>p.xy)})};
}
rebuildPorts();rebuildCameras();refreshCameras();
init().catch(error=>{$('loading').replaceChildren();const h=document.createElement('h2');h.textContent='Sky viewer unavailable';const p=document.createElement('p');p.textContent=error.message;$('loading').append(h,p);message(error.message);console.error(error);});
