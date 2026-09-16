#!/usr/bin/env python3
"""Exercise the real MediaPipe runtime with Chromium's synthetic camera.
This is a lifecycle/dependency test, not a human gaze-accuracy test.
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright


def main():
    output=Path('build/camera');output.mkdir(parents=True,exist_ok=True)
    report={'camera_source':'Chromium synthetic test pattern, not a person',
            'landmarker':'real MediaPipe Tasks Vision 0.10.21 / Face Landmarker model v1',
            'participant_gaze_accuracy':'not tested','checks':[],'errors':[],'console':[]}
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
        context=browser.new_context(viewport={'width':1440,'height':1000},permissions=['camera'])
        page=context.new_page()
        page.on('pageerror',lambda e:report['errors'].append(str(e)))
        page.on('console',lambda m:report['console'].append(m.text) if m.type=='error' and len(report['console'])<12 else None)
        def start_camera():
            page.locator('#camera').click()
            page.wait_for_function('!window.ephemeris.getState().gaze.loading',timeout=65000)
            assert page.evaluate('window.ephemeris.getState().gaze.running'),page.locator('#gazeStatus').text_content()
            page.wait_for_function('window.ephemeris.getState().gaze.frames >= 3',timeout=45000)
        try:
            page.goto('http://127.0.0.1:8765',wait_until='domcontentloaded')
            page.wait_for_function('window.ephemeris?.getState().ready',timeout=60000)
            start_camera()
            assert page.locator('#video').evaluate('(v)=>Boolean(v.srcObject?.active)'),'Camera pipeline stopped unexpectedly'
            assert not page.locator('#calibrate').is_disabled()
            report['worker_state']=page.evaluate('window.ephemeris.getState().gaze')
            report['checks'].append('real MediaPipe runtime/model loaded in classic worker and processed at least three synthetic video frames')
            page.locator('#calibrate').click()
            assert page.locator('#calibration').is_visible()
            page.keyboard.press('Space');page.wait_for_timeout(500)
            assert not page.evaluate('window.ephemeris.getState().armed')
            page.keyboard.press('Escape')
            assert not page.locator('#calibration').is_visible()
            report['checks'].append('calibration screen starts, remains silent and cancels cleanly')
            page.locator('#camera').click()
            assert page.locator('#video').evaluate('(v)=>v.srcObject===null')
            assert page.locator('#calibrate').is_disabled()
            report['checks'].append('stop camera releases the video stream and disables calibration')
            start_camera()
            page.locator('#camera').click()
            assert page.locator('#video').evaluate('(v)=>v.srcObject===null')
            report['checks'].append('camera restarts after full worker/stream teardown')
            assert not report['errors'],report['errors']
            report['passed']=True
        except Exception as error:
            report['passed']=False;report['failure']=str(error);raise
        finally:
            report['status_text']=page.locator('#gazeStatus').text_content()
            (output/'report.json').write_text(json.dumps(report,indent=2))
            page.screenshot(path=str(output/'screenshot.png'))
            print(json.dumps(report,indent=2));browser.close()

if __name__=='__main__':main()
