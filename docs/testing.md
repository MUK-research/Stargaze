# Testing / v0.1

## Automated unit/API tests

```bash
python3 -m unittest discover -s tests -v
npm test
```

The Python tests use a local ephemeral HTTP server and mocked upstream catalogue responses. JavaScript tests use Node's built-in runner, synthetic calibration data and mock MIDI ports. These check algorithms, API contracts and safety logic, not camera accuracy or actual Disklavier mechanics.

## Browser integration

For development only:

```bash
python3 -m pip install playwright
python3 -m playwright install chromium
python3 app.py
# In a second terminal:
python3 tools/browser_smoke.py
```

The default browser check loads the real Aladin library and real survey tiles, while substituting an explicitly labelled mock MIDI output (never a physical instrument). It exercises cursor selection, dwell, preview, note on/off messages, stop, JSON export and refusal to arm uncalibrated gaze. Reports and a screenshot go to `build/browser-smoke/` by default. External-service or WebGL failure must not be mistaken for a successful real-sky test.

`python3 tools/browser_smoke.py --mock-sky` runs a deterministic interface check with a conspicuously labelled synthetic sky fixture. This is useful for layout and event-flow checks; it is not evidence that the real viewer or survey services work. It does not overwrite the bundled real catalogue.

## Local hardware acceptance

First use mouse mode and browser preview. Confirm no sound before arming; one note per dwell; release on leaving; stopping and hiding the tab silence the output. Change fields and zoom while observing that old traces remain fixed to the sky and new trace segments do not bridge camera/view gaps.

Next calibrate the camera at the final window size, with consistent lighting and a stable seat. Examine validation RMS and the actual cursor while looking at several unused points. Deliberately blink, turn away, leave the frame and introduce a second person; interaction should pause. Recalibrate after movement or resizing. Reject unsuitable calibration rather than attributing wrong selections to attention.

Finally select the physical Disklavier output and channel explicitly. Begin at low velocity with a narrow note range, without colour CC. Verify note-off, stop, tab switching, MIDI disconnect and reconnect. Match the instrument's receive mode, latency and channel routing locally. Keep colour CC on a separate synthesizer/electronics destination. Browser automation cannot certify physical piano behaviour.

## Camera-worker regression check

`python3 tools/camera_smoke.py` uses the **real pinned MediaPipe runtime and model** with Chromium's synthetic camera. It verifies worker startup, receipt of processed frames, opening/cancelling calibration, releasing the stream and restarting after teardown. A synthetic pattern is not a human participant: a passing result establishes runtime/lifecycle integration, not landmark accuracy, gaze calibration accuracy or physical-camera compatibility.

The new `tests/gaze.test.js` also checks a complete nine-target training / five-target held-out validation sequence with synthetic features, rejection of absent samples, suppression of stale/multi-face results and worker/stream cleanup. These complement, rather than replace, a participant test at the final screen position.
