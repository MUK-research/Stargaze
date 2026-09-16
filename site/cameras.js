/** Camera enumeration never captures video unless explicitly requested.
 * Device IDs/preferences stay in the browser; no device inventory is uploaded.
 */
export function cameraConstraints(deviceId='') {
  const video={width:{ideal:640},height:{ideal:480}};
  // Exact matters: an unavailable webcam must not silently become an OBS source.
  if(deviceId) video.deviceId={exact:deviceId};
  return {video,audio:false};
}

export function cameraError(error) {
  switch(error?.name) {
    case 'NotAllowedError': case 'SecurityError':
      return 'Camera permission denied. Allow Camera for this site in the browser and in macOS Privacy & Security, then refresh the cameras.';
    case 'NotFoundError': case 'OverconstrainedError':
      return 'The selected camera is unavailable. Refresh cameras and choose an available webcam; no other camera was substituted.';
    case 'NotReadableError': case 'AbortError':
      return 'The camera could not be opened. It may be busy or its virtual-camera software may be stopped. Choose another source or close the app using it.';
    default: return error?.message || String(error);
  }
}

export class CameraDevices {
  constructor(mediaDevices=globalThis.navigator?.mediaDevices) {
    this.media=mediaDevices;this.devices=[];this.warning='';this.sequence=0;
  }
  async refresh({requestPermission=false,selectedId='',activeStream=null}={}) {
    if(!this.media?.enumerateDevices) throw new Error('Camera discovery needs localhost or HTTPS and a browser with webcam support.');
    const sequence=++this.sequence;
    let list=await this.media.enumerateDevices(),warning='';
    const known=list.filter(d=>d.kind==='videoinput');
    const needsPermission=!known.length || known.some(d=>!d.deviceId || !d.label);
    if(requestPermission && needsPermission && !activeStream?.active) {
      let probe=null,problem=null;
      try {probe=await this.media.getUserMedia(cameraConstraints(selectedId));}
      catch(error) {problem=error;}
      finally {probe?.getTracks().forEach(t=>t.stop());}
      // Permission can be granted even when an inactive virtual camera cannot open.
      list=await this.media.enumerateDevices();
      if(problem) {
        if(!list.some(d=>d.kind==='videoinput' && d.deviceId && d.label) || problem.name==='NotAllowedError') throw new Error(cameraError(problem));
        warning=cameraError(problem);
      }
    }
    if(sequence!==this.sequence) return this.devices;
    const seen=new Set();
    this.devices=list.filter(d=>d.kind==='videoinput' && d.deviceId && !seen.has(d.deviceId) && seen.add(d.deviceId))
      .map((d,i)=>({id:d.deviceId,label:d.label||`Camera ${i+1} (allow access to reveal its name)`}));
    this.warning=warning;
    return this.devices;
  }
}
