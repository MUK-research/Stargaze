/** Pure, dependency-free geometry, calibration and musical mapping. */
export const VERSION = '0.1.0';
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const mod = (x, n) => ((x % n) + n) % n;
const RAD = Math.PI / 180;
export const MODES = [
  {name:'Locrian', notes:[0,1,3,5,6,8,10]},
  {name:'Aeolian', notes:[0,2,3,5,7,8,10]},
  {name:'Dorian', notes:[0,2,3,5,7,9,10]},
  {name:'Mixolydian', notes:[0,2,4,5,7,9,10]},
  {name:'Ionian', notes:[0,2,4,5,7,9,11]},
  {name:'Lydian', notes:[0,2,4,6,7,9,11]}
];
export const NOTE_NAMES = ['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
export const noteName = n => `${NOTE_NAMES[mod(n,12)]}${Math.floor(n/12)-1}`;
export const defaults = Object.freeze({
  latitude:48.2082, longitude:16.3738, radius:85, dwell:220,
  minNote:48, maxNote:84, minVelocity:25, maxVelocity:88,
  duration:700, root:0, channel:1, colorCC:74, sendCC:false,
  horizonOnly:false, brightMag:-1.5, faintMag:12, trail:true
});

export function angularDistance(ra1, dec1, ra2, dec2) {
  const [r1,d1,r2,d2] = [ra1,dec1,ra2,dec2].map(v=>v*RAD);
  const h = Math.sin((d2-d1)/2)**2 + Math.cos(d1)*Math.cos(d2)*Math.sin((r2-r1)/2)**2;
  return 2*Math.asin(Math.sqrt(clamp(h,0,1)))/RAD;
}

/** Mean-equator J2000 -> date precession, then spherical horizontal coordinates.
 * Artistic precision only: UTC approximates UT1; no nutation, refraction,
 * aberration, parallax or proper motion. Azimuth: N=0, E=90 degrees.
 */
export function horizontal(ra, dec, latitude, longitude, date = new Date()) {
  const jd = date.getTime()/86400000 + 2440587.5;
  const t = (jd-2451545)/36525;
  const zeta = (2306.2181*t + .30188*t*t + .017998*t*t*t)/3600*RAD;
  const z = (2306.2181*t + 1.09468*t*t + .018203*t*t*t)/3600*RAD;
  const theta = (2004.3109*t - .42665*t*t - .041833*t*t*t)/3600*RAD;
  const r=ra*RAD, d=dec*RAD;
  const a=Math.cos(d)*Math.sin(r+zeta);
  const b=Math.cos(theta)*Math.cos(d)*Math.cos(r+zeta)-Math.sin(theta)*Math.sin(d);
  const c=Math.sin(theta)*Math.cos(d)*Math.cos(r+zeta)+Math.cos(theta)*Math.sin(d);
  const rDate=(Math.atan2(a,b)+z)/RAD, dDate=Math.asin(clamp(c,-1,1));
  const lst = mod(280.46061837 + 360.98564736629*(jd-2451545)
    + .000387933*t*t - t*t*t/38710000 + longitude,360);
  const h=mod(lst-rDate+180,360)*RAD-Math.PI, lat=latitude*RAD;
  const east=-Math.cos(dDate)*Math.sin(h);
  const north=Math.sin(dDate)*Math.cos(lat)-Math.cos(dDate)*Math.cos(h)*Math.sin(lat);
  const up=Math.sin(dDate)*Math.sin(lat)+Math.cos(dDate)*Math.cos(h)*Math.cos(lat);
  const azimuth = Math.hypot(east,north)<1e-10 ? null : mod(Math.atan2(east,north)/RAD,360);
  return {altitude:Math.asin(clamp(up,-1,1))/RAD, azimuth};
}

export function spectralColor(star) {
  if (Number.isFinite(star.bv)) return {value:Math.round(127*(1-clamp((star.bv+.4)/2.4,0,1))), basis:'B−V'};
  const match=String(star.spectral_type||'').trim().match(/^(?:sd|d)?([OBAFGKM])/i);
  if (match) return {value:Math.round(127*(1-'OBAFGKM'.indexOf(match[1].toUpperCase())/6)), basis:'spectral class'};
  return {value:null, basis:'unknown'};
}

export function mapStar(star, distance, config, date = new Date()) {
  const c={...defaults,...config};
  const {altitude,azimuth}=horizontal(star.ra,star.dec,c.latitude,c.longitude,date);
  const sector=azimuth===null?0:Math.floor(mod(azimuth+15,360)/30);
  const root=mod(Math.round(c.root)+sector*7,12);
  const mode=MODES[clamp(Math.floor((altitude+90)/30),0,5)];
  const low=clamp(Math.round(c.minNote),21,108), high=clamp(Math.round(c.maxNote),low,108);
  const known=Number.isFinite(star.mag_v);
  const fraction=known?1-clamp((star.mag_v-c.brightMag)/(c.faintMag-c.brightMag),0,1):.5;
  const rawPitch=low+fraction*(high-low);
  let note=null, best=Infinity;
  for (let n=low;n<=high;n++) if (mode.notes.includes(mod(n-root,12)) && Math.abs(n-rawPitch)<best) {
    best=Math.abs(n-rawPitch); note=n;
  }
  if(note===null) note=clamp(Math.round(rawPitch),low,high);
  const proximity=1-clamp(distance/Math.max(1,c.radius),0,1);
  const velocity=Math.round(clamp(c.minVelocity+proximity*(c.maxVelocity-c.minVelocity),1,100));
  return {note, noteName:noteName(note), velocity, root, rootName:NOTE_NAMES[root],
    mode:mode.name, altitude, azimuth, color:spectralColor(star),
    pitchBasis:known?'V magnitude':'neutral fallback (V unknown)', proximity,
    duration:clamp(c.duration,100,1200)};
}

/** Dwell + spatial hysteresis: one strike per region visit, never per video frame. */
export class RegionGate {
  constructor() { this.reset(); }
  reset() { this.current=null; this.entered=0; this.played=false; }
  update(candidates,now,radius,dwell) {
    const sorted=candidates.filter(p=>Number.isFinite(p.distance)).sort((a,b)=>a.distance-b.distance);
    const nearest=sorted.find(p=>p.distance<=radius);
    const retained=this.current && sorted.find(p=>p.star.id===this.current.star.id && p.distance<=radius*1.25);
    let next=nearest||null;
    if (retained && (!nearest || nearest.star.id===retained.star.id || nearest.distance>retained.distance*.65)) next=retained;
    const events=[];
    if(next?.star.id!==this.current?.star.id) {
      if(this.current) events.push({kind:'exit',star:this.current.star});
      this.current=next; this.entered=now; this.played=false;
      if(next) events.push({kind:'enter',star:next.star});
    } else this.current=next;
    if(this.current && !this.played && now-this.entered>=dwell && this.current.distance<=radius) {
      this.played=true; events.push({kind:'dwell',star:this.current.star,distance:this.current.distance});
    }
    return {current:this.current,events,progress:this.current?clamp((now-this.entered)/Math.max(1,dwell),0,1):0};
  }
}

function solve(matrix,vector) {
  const a=matrix.map((row,i)=>[...row,vector[i]]), n=a.length;
  for(let c=0;c<n;c++) {
    let pivot=c;
    for(let r=c+1;r<n;r++) if(Math.abs(a[r][c])>Math.abs(a[pivot][c])) pivot=r;
    [a[c],a[pivot]]=[a[pivot],a[c]];
    if(Math.abs(a[c][c])<1e-12) throw new Error('Calibration is singular; repeat with clearer eye movements.');
    const div=a[c][c]; for(let j=c;j<=n;j++) a[c][j]/=div;
    for(let r=0;r<n;r++) if(r!==c) {
      const factor=a[r][c]; for(let j=c;j<=n;j++) a[r][j]-=factor*a[c][j];
    }
  }
  return a.map(row=>row[n]);
}

export function fitCalibration(samples,lambda=.15) {
  if(samples.length<60) throw new Error('Not enough valid calibration samples.');
  const dim=samples[0].features.length;
  const means=Array.from({length:dim},(_,i)=>samples.reduce((s,p)=>s+p.features[i],0)/samples.length);
  const scales=means.map((m,i)=>Math.max(.00001,Math.sqrt(samples.reduce((s,p)=>s+(p.features[i]-m)**2,0)/samples.length)));
  const x=samples.map(p=>[1,...p.features.map((v,i)=>(v-means[i])/scales[i])]);
  const n=dim+1, xtx=Array.from({length:n},()=>Array(n).fill(0)), bx=Array(n).fill(0), by=Array(n).fill(0);
  for(let k=0;k<x.length;k++) for(let i=0;i<n;i++) {
    bx[i]+=x[k][i]*samples[k].target[0]; by[i]+=x[k][i]*samples[k].target[1];
    for(let j=0;j<n;j++) xtx[i][j]+=x[k][i]*x[k][j];
  }
  for(let i=1;i<n;i++) xtx[i][i]+=lambda*samples.length;
  return {means,scales,x:solve(xtx,bx),y:solve(xtx,by)};
}
export function predictGaze(model,features) {
  const x=[1,...features.map((v,i)=>(v-model.means[i])/model.scales[i])];
  return [model.x,model.y].map(coef=>coef.reduce((s,c,i)=>s+c*x[i],0));
}

/** Both iris centres relative to rotated eye axes, plus head-position proxies.
 * All coordinates are unmirrored input video coordinates. This is not a gaze model.
 */
export function eyeFeatures(landmarks,blendshapes=[]) {
  if(!landmarks || landmarks.length<478) return null;
  const blend=Object.fromEntries(blendshapes.map(c=>[c.categoryName,c.score]));
  if((blend.eyeBlinkLeft||0)>.55 || (blend.eyeBlinkRight||0)>.55) return null;
  function eye(i,a,b,top,bottom) {
    const p=landmarks[i], l=landmarks[a], r=landmarks[b];
    const dx=r.x-l.x,dy=r.y-l.y, w2=dx*dx+dy*dy;
    if(w2<.00003) return null;
    const width=Math.sqrt(w2), aperture=Math.hypot(landmarks[top].x-landmarks[bottom].x,landmarks[top].y-landmarks[bottom].y)/width;
    if(aperture<.10) return null;
    return [((p.x-l.x)*dx+(p.y-l.y)*dy)/w2, (-(p.x-l.x)*dy+(p.y-l.y)*dx)/w2];
  }
  const left=eye(468,33,133,159,145), right=eye(473,362,263,386,374);
  if(!left||!right) return null;
  const a=landmarks[33],b=landmarks[263],nose=landmarks[1];
  const mx=(a.x+b.x)/2,my=(a.y+b.y)/2,w=Math.hypot(b.x-a.x,b.y-a.y);
  if(w<.08) return null;
  const u=(left[0]+right[0])/2,v=(left[1]+right[1])/2;
  const features=[...left,...right,mx,my,w,(nose.x-mx)/w,(nose.y-my)/w,(b.y-a.y)/w,u*u,v*v,u*v];
  return features.every(Number.isFinite)?features:null;
}

export function validateCalibration(model,samples,width,height) {
  if(samples.length<40) throw new Error('Validation needs more samples.');
  const groups=new Map();
  for(const s of samples) {
    const [x,y]=predictGaze(model,s.features), key=s.target.join(',');
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(Math.hypot((x-s.target[0])*width,(y-s.target[1])*height));
  }
  const errors=[...groups.values()].map(v=>Math.sqrt(v.reduce((s,x)=>s+x*x,0)/v.length));
  const rms=Math.sqrt(errors.reduce((s,x)=>s+x*x,0)/errors.length);
  return {rms, worst:Math.max(...errors), targets:errors.length,
    passed:errors.length===5 && rms<.18*Math.hypot(width,height),
    note:'Held-out screen error, not measured angular gaze accuracy.'};
}
