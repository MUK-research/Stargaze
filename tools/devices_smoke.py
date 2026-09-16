#!/usr/bin/env python3
"""Device selector regression: synthetic cameras/MIDI ports, no user's devices.
Run app.py first. This does not test physical hardware or OS-level IAC routing.
"""
import argparse
import json
import shutil
import traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_smoke import MOCK_SKY

FIXTURES = r"""
window.cameraCalls=[];
window.fixtureCameras=[
 {kind:'videoinput',deviceId:'obs-fixture',label:'OBS Virtual Camera (test)'},
 {kind:'videoinput',deviceId:'webcam-fixture',label:'Built-in webcam (test)'}];
window.fixtureTracks=[];
const capture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
Object.defineProperty(navigator.mediaDevices,'enumerateDevices',{value:async()=>window.fixtureCameras});
Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async options=>{
 window.cameraCalls.push(options);
 const id=options.video.deviceId?.exact||window.fixtureCameras[0]?.deviceId;
 const device=window.fixtureCameras.find(d=>d.deviceId===id);
 if(!device)throw new DOMException('Requested camera is absent','OverconstrainedError');
 const stream=await capture({audio:false,video:true});
 const track=stream.getVideoTracks()[0],settings=track.getSettings.bind(track);
 Object.defineProperty(track,'getSettings',{value:()=>({...settings(),deviceId:id})});
 Object.defineProperty(track,'label',{value:device.label});
 window.fixtureTracks.push(track);return stream;
}});
// A deliberately fake inference worker isolates device selection/lifecycle.
const NativeWorker=window.Worker;
window.Worker=class {
 constructor(url){if(!String(url).endsWith('/vision-worker.js'))return new NativeWorker(url);this.ended=false;}
 postMessage(data){
  if(data.type==='init')setTimeout(()=>{if(!this.ended)this.onmessage?.({data:{type:'ready',delegate:'TEST FIXTURE'}});},5);
  if(data.type==='frame'){
   data.bitmap.close();setTimeout(()=>{if(!this.ended)this.onmessage?.({data:{type:'result',time:data.time,faceLandmarks:[],faceBlendshapes:[]}});},1);
  }
 }
 terminate(){this.ended=true;}
};
window.midiMessages=[];window.midiRequests=[];window.denyMidi=false;
const access={outputs:new Map(),inputs:new Map(),onstatechange:null};
window.addOutput=(id,name)=>{
 const p={id,name,manufacturer:'Test fixture',state:'connected',connection:'closed',
  open:async()=>{p.connection='open';access.onstatechange?.({port:p});},
  send:(data,time)=>window.midiMessages.push({id,data:[...data],time}),clear:()=>{}};
 access.outputs.set(id,p);access.onstatechange?.({port:p});return p;
};
window.removeOutput=id=>{const p=access.outputs.get(id);p.state='disconnected';access.outputs.delete(id);access.onstatechange?.({port:p});};
window.addInput=()=>{access.inputs.set('keyboard',{id:'keyboard',state:'connected'});access.onstatechange?.();};
Object.defineProperty(navigator,'requestMIDIAccess',{value:async options=>{
 window.midiRequests.push(options);
 if(window.denyMidi)throw new DOMException('Denied for test','NotAllowedError');
 return access;
}});
"""


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default='http://127.0.0.1:8765')
    parser.add_argument('--output',default='build/devices')
    args=parser.parse_args()
    output=Path(args.output);output.mkdir(parents=True,exist_ok=True)
    report={'scope':'synthetic cameras/MIDI/worker and mock sky; no hardware or gaze accuracy test','checks':[],'errors':[]}
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path=shutil.which('chromium') or None,
            args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
        context=browser.new_context(viewport={'width':1440,'height':1000},permissions=['camera'])
        page=context.new_page();page.set_default_timeout(12000)
        page.add_init_script(FIXTURES)
        page.on('pageerror',lambda e:report['errors'].append(str(e)))
        page.route('https://aladin.cds.unistra.fr/**',lambda route:route.fulfill(body=MOCK_SKY,content_type='text/javascript'))
        fixture={'source':'TEST FIXTURE','objects':[{'id':'TEST A','ra':56.75,'dec':24.1167,'mag_v':3,'bv':.2}]}
        page.route('**/data/seed.json',lambda route:route.fulfill(body=json.dumps(fixture),content_type='application/json'))
        try:
            page.goto(args.url,wait_until='domcontentloaded')
            page.wait_for_function('window.ephemeris?.getState().ready')
            assert page.evaluate('window.cameraCalls.length')==0
            assert page.locator('#cameraDevice option').count()==3
            page.locator('#cameraDevice').select_option('webcam-fixture')
            page.locator('#camera').click()
            page.wait_for_function('window.ephemeris.getState().gaze.frames >= 2')
            assert page.evaluate('window.cameraCalls.at(-1).video.deviceId.exact')=='webcam-fixture'
            assert 'Built-in webcam' in page.locator('#cameraDeviceStatus').inner_text()
            report['checks'].append('No camera auto-start; built-in webcam selected explicitly despite OBS being browser default')
            page.locator('#calibrate').click()
            page.locator('#cameraDevice').select_option('obs-fixture')
            assert not page.locator('#calibration').is_visible()
            assert page.evaluate('window.fixtureTracks[0].readyState')=='ended'
            assert not page.evaluate('window.ephemeris.getState().gaze.running')
            page.locator('#camera').click()
            page.wait_for_function('window.ephemeris.getState().gaze.running')
            assert page.evaluate('window.cameraCalls.at(-1).video.deviceId.exact')=='obs-fixture'
            report['checks'].append('Camera source change stops the old stream and cancels calibration before explicit restart')
            page.evaluate("window.fixtureCameras=window.fixtureCameras.filter(d=>d.deviceId!=='obs-fixture');navigator.mediaDevices.dispatchEvent(new Event('devicechange'))")
            page.wait_for_function('!window.ephemeris.getState().gaze.running')
            assert page.locator('#cameraDevice').input_value()=='obs-fixture'
            page.wait_for_function("document.querySelector('#cameraDevice option:checked')?.disabled === true")
            assert page.locator('#cameraDevice option:checked').evaluate('(option)=>option.disabled'), 'Unavailable camera option must remain disabled'
            report['checks'].append('Removed camera remains visibly unavailable; no fallback to a different source')
            page.locator('#cameraDevice').select_option('webcam-fixture')
            page.reload(wait_until='domcontentloaded');page.wait_for_function('window.ephemeris?.getState().ready')
            assert page.locator('#cameraDevice').input_value()=='webcam-fixture'
            assert page.evaluate('window.cameraCalls.length')==0
            report['checks'].append('Camera preference restored across reload without activating the camera')
            page.locator('#midi').click()
            assert '0 output ports' in page.locator('#midiDevicesStatus').inner_text()
            assert page.evaluate('window.midiRequests[0].software') is True
            assert page.evaluate('window.midiRequests[0].sysex') is False
            page.evaluate('window.addInput()')
            assert '1 input port' in page.locator('#midiDevicesStatus').inner_text()
            report['checks'].append('Empty/input-only MIDI states distinguished; software support explicitly requested')
            page.evaluate("window.addOutput('iac','IAC Driver Ephemeris');window.addOutput('usb','USB MIDI interface')")
            assert page.locator('#output option').count()==3
            page.locator('#output').select_option('iac')
            assert page.locator('#midiTest').is_disabled()
            assert not any((m['data'][0]&0xf0)==0x90 for m in page.evaluate('window.midiMessages'))
            page.locator('#preview').uncheck();page.locator('#arm').click()
            page.wait_for_function('window.ephemeris.getState().armed')
            page.locator('#midiTest').click()
            messages=page.evaluate('window.midiMessages')
            assert any(m['id']=='iac' and m['data'][0]==0x90 for m in messages)
            assert any(m['id']=='iac' and m['data'][0]==0x80 and m.get('time') for m in messages)
            page.wait_for_timeout(120)
            assert not any(e['kind']=='note_off' and e.get('objectId')=='test-note' for e in page.evaluate('window.ephemeris.getState().events')), 'Routing test was cut off by the absent sky cursor'
            report['checks'].append('Closed virtual output opens on arm; explicit test note reaches it with a scheduled note-off and survives passive cursor loss')
            page.evaluate("window.removeOutput('iac')")
            assert not page.evaluate('window.ephemeris.getState().armed')
            assert page.locator('#output').input_value()=='iac'
            assert page.locator('#output option:checked').evaluate('(option)=>option.disabled'), 'Disconnected MIDI option must remain disabled'
            page.evaluate("window.addOutput('iac','IAC Driver Ephemeris')")
            assert not page.evaluate('window.ephemeris.getState().armed')
            assert page.locator('#output').input_value()=='iac'
            page.locator('#midiRefresh').click()
            assert page.locator('#output').input_value()=='iac'
            assert not page.evaluate('window.ephemeris.getState().armed')
            report['checks'].append('MIDI hot-unplug disarms; reconnect and refresh retain chosen port without re-arming or rerouting')
            page.evaluate('window.denyMidi=true');page.locator('#midiRefresh').click()
            assert 'permission denied' in page.locator('#midiDevicesStatus').inner_text()
            assert not page.evaluate('window.ephemeris.getState().armed')
            report['checks'].append('MIDI permission denial is visible, actionable and silent')
            assert not report['errors'],report['errors']
            report['passed']=True
        except Exception as error:
            report['passed']=False;report['failure']=repr(error);report['traceback']=traceback.format_exc();raise
        finally:
            (output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
            print(json.dumps(report,indent=2))
            page.screenshot(path=str(output/'screenshot.png'));browser.close()

if __name__=='__main__':main()
