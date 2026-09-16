#!/usr/bin/env python3
"""Browser integration check. --mock-sky is explicitly not a real imagery test.
Start app.py first. Requires developer-only playwright and Chromium.
"""
import argparse
import json
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright

MOCK_SKY = """
window.A={init:Promise.resolve(),polyline:points=>({points}),graphicOverlay:()=>({add(){},removeAll(){}}),
 aladin:(selector,options)=>{const div=document.querySelector(selector);let ra=56.75,dec=24.1167,fov=8;const callbacks={};
 div.style.background='#050b16';const caption=document.createElement('span');caption.textContent='TEST FIXTURE — not a sky survey';caption.style='position:absolute;top:70px;left:30px;color:#aaa;font-size:12px';div.append(caption);
 const size=()=>[div.clientWidth,div.clientHeight];return {
 getRaDec:()=>[ra,dec],getFov:()=>[fov,fov*size()[1]/size()[0]],
 pix2world:(x,y)=>[ra+(size()[0]/2-x)*fov/size()[0],dec+(size()[1]/2-y)*fov/size()[0]],
 world2pix:(r,d)=>[size()[0]/2-(r-ra)*size()[0]/fov,size()[1]/2-(d-dec)*size()[0]/fov],
 addOverlay(){},on:(event,f)=>callbacks[event]=f,setImageSurvey(){},
 gotoRaDec:(r,d)=>{ra=r;dec=d;callbacks.positionChanged?.();},setFoV:f=>{fov=f;callbacks.zoomChanged?.();}
 };}};
"""
MOCK_MIDI = """
window.midiMessages=[];
const port={id:'test-piano',name:'TEST MIDI output (no hardware)',state:'connected',
 send:(data,time)=>window.midiMessages.push({data:[...data],time}),clear:()=>window.midiMessages.push({clear:true})};
Object.defineProperty(navigator,'requestMIDIAccess',{value:async()=>({outputs:new Map([[port.id,port]]),onstatechange:null})});
"""

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default='http://127.0.0.1:8765')
    parser.add_argument('--mock-sky',action='store_true')
    parser.add_argument('--output',default='build/browser-smoke')
    args=parser.parse_args();output=Path(args.output);output.mkdir(parents=True,exist_ok=True)
    report={'sky':'mock' if args.mock_sky else 'real Aladin / real survey network','midi':'mock output; no Disklavier attached','camera':'not exercised','checks':[],'errors':[],'network':[]}
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path=shutil.which('chromium') or None,
            args=['--no-sandbox','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        page=browser.new_page(viewport={'width':1440,'height':1000},device_scale_factor=1)
        page.add_init_script(MOCK_MIDI)
        page.on('pageerror',lambda e:report['errors'].append(str(e)))
        def response(r):
            if r.url.startswith('https://') and len(report['network'])<100:report['network'].append({'status':r.status,'url':r.url})
        page.on('response',response)
        if args.mock_sky:
            page.route('https://aladin.cds.unistra.fr/**',lambda route:route.fulfill(body=MOCK_SKY,content_type='text/javascript'))
            fixture={'source':'TEST FIXTURE ONLY','objects':[{'id':'TEST A','name':'TEST A','ra':56.75,'dec':24.1167,'mag_v':3,'bv':.2,'source':'synthetic test fixture'}]}
            page.route('**/data/seed.json',lambda route:route.fulfill(body=json.dumps(fixture),content_type='application/json'))
        try:
            page.goto(args.url,wait_until='domcontentloaded')
            page.wait_for_function('window.ephemeris?.getState().ready',timeout=60000)
            page.wait_for_timeout(1000)
            state=page.evaluate('window.ephemeris.getState()')
            assert state['catalogueCount']>0,'No bundled objects available'
            report['checks'].append('viewer initialised; catalogue loaded')
            rect=page.locator('#stage').bounding_box()
            points=[x for x in state['projected'] if rect and 20<x['xy'][0]<rect['width']-20 and 80<x['xy'][1]<rect['height']-220]
            assert points,'No projected catalogue marker in playable part of view'
            point=min(points,key=lambda x:(x['xy'][0]-rect['width']/2)**2+(x['xy'][1]-rect['height']/2)**2)['xy']
            def hover():page.mouse.move(rect['x']+point[0],rect['y']+point[1]);page.wait_for_timeout(550)
            page.locator('#arm').click();hover()
            state=page.evaluate('window.ephemeris.getState()')
            assert any(x['kind']=='note_on' for x in state['events']),'No preview note after dwell'
            assert state['sampleCount']>0,'Trace not recorded'
            report['checks'].append('mouse dwell produced browser preview note and sky-coordinate trace')
            page.locator('#panic').click();assert not page.evaluate('window.ephemeris.getState().armed')
            page.locator('#midi').click();page.locator('#output').select_option('test-piano')
            assert page.locator('#output').input_value()=='test-piano'
            page.locator('#preview').uncheck()
            page.locator('#arm').click();hover()
            messages=page.evaluate('window.midiMessages')
            assert any(x.get('data',[0])[0]==0x90 for x in messages),'No MIDI note-on'
            assert any(x.get('data',[0])[0]==0x80 and x.get('time') for x in messages),'No timestamped note-off'
            report['checks'].append('selected mock MIDI output received note-on and scheduled note-off')
            page.keyboard.press('Escape');assert not page.evaluate('window.ephemeris.getState().armed')
            report['checks'].append('Escape disarmed transport')
            with page.expect_download() as info:page.locator('#exportJson').click()
            download=info.value;download.save_as(output/'session-test.json')
            session=json.loads((output/'session-test.json').read_text())
            assert session['schema']=='ephemeris.session/1' and session['samples']
            assert 'features' not in json.dumps(session)
            report['checks'].append('session JSON export includes samples and events, no face features')
            page.locator('#input').select_option('gaze');page.locator('#arm').click()
            assert not page.evaluate('window.ephemeris.getState().armed')
            report['checks'].append('uncalibrated gaze cannot arm')
            page.locator('#input').select_option('mouse')
            if not args.mock_sky:
                assert any('/Norder' in x['url'] or 'Allsky' in x['url'] for x in report['network'] if x['status']==200),'No successful survey-tile response observed'
                report['checks'].append('real astronomical survey tiles fetched')
            assert not report['errors'],report['errors']
            report['passed']=True
        except Exception as error:
            report['passed']=False;report['failure']=str(error);raise
        finally:
            page.screenshot(path=str(output/'screenshot.png'),full_page=True)
            (output/'report.json').write_text(json.dumps(report,indent=2))
            print(json.dumps(report,indent=2));browser.close()

if __name__=='__main__':main()
