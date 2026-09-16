# Ephemeris — camera and MIDI device-selection update

16 September 2026. Application commit: `fa4d7fba84794d4f7f1cea6345c16a389cedbf72`.

## Delivered

The interface now has a **Camera source** selector with permission-aware enumeration, a refresh button and the actual active-camera name. The choice is remembered only in the current browser. Explicit camera IDs use exact constraints; a missing or removed webcam is not silently replaced by OBS or another device. Switching sources stops the worker/stream, disarms sound and clears calibration.

The MIDI controls now show every output exposed by the browser, including virtual destinations, without a Disklavier/manufacturer filter. Software-synthesizer exposure is requested where the platform supports it. Inputs and outputs have separate counts; denied permission, zero outputs and unavailable selected ports are distinguished. Refresh and device-change events update the inventory; a connected port remains selectable even when its connection is initially closed. It is opened explicitly when arming.

An armed **Test MIDI note** action checks the chosen destination without needing a gaze encounter. It sends one short note (350 ms, velocity no greater than 45), with a scheduled note-off and no colour CC. The diagnostic note is not cut off by the passive absence of a sky cursor. Explicit Stop, device changes, blur and the duration limit still release it. Ordinary gaze/mouse object notes still release when input is lost.

Setup guidance is in [docs/device-routing.md](../docs/device-routing.md), in the README, and in the application's **No MIDI outputs? / Virtual routing** section. It includes macOS IAC-to-Ableton routing. The README's final Trello link is preserved. No survey/musical mapping, original reference, legacy application or submodule was replaced.

## Validation

The Python API/catalogue suite passes 13 tests and the JavaScript suite passes 42 tests: **55 unit/API tests total**. Both ran locally and the verification workflow passed for the application commit: [Verify prototype](https://github.com/AdrianArtacho/Ephemeris/actions/runs/35082595082).

All four browser checks passed in [Browser integration](https://github.com/AdrianArtacho/Ephemeris/actions/runs/35082594964): real Aladin/survey rendering with mock MIDI, the deterministic mock-sky interface, real MediaPipe startup/teardown with synthetic video, and the new device-selector regression. The latter verified exact webcam selection despite an OBS default, switching/removal, remembered camera choice without automatic capture, virtual MIDI outputs, test-note delivery/duration, unplug/reconnect/refresh and permission denial. No uncaught page errors were reported.

Machine-readable summaries are in [device-routing-v0.1-r3.json](device-routing-v0.1-r3.json). Original browser JSON reports and screenshots are attached to that workflow as artifact `10441570009`.

The initial device-selector check used an unsuitable disabled-state assertion on an HTML option; the updated check verifies the option's actual `disabled` property. The final suite also tests that the MIDI diagnostic note is not cut off by passive cursor loss.

## Scope

Browser device tests use synthetic video, mock camera identities (OBS and built-in webcam), mock MIDI ports and a mock inference worker. They establish selector, event and message behaviour, not actual macOS IAC, a physical webcam, human gaze accuracy or Disklavier response. The separate MediaPipe test uses its real runtime/model with synthetic video; no participant gaze accuracy is claimed.

No permission or OS/browser restriction is bypassed. Devices must actually be exposed to the browser. An installed plug-in or an ordinary audio output is not necessarily a MIDI destination; use an enabled virtual MIDI bus into the receiving instrument app when needed. No device is auto-armed and camera frames remain local.

## Update locally

Stop the Python process, then run:

```bash
git pull --ff-only
python3 app.py
```

Reload the page with a hard refresh to load the revised JavaScript. Choose **Camera source → Start camera → Calibrate**; use **Enable MIDI → MIDI note output → Arm sound → Test MIDI note** for routing. Camera names may require **Allow / refresh cameras** first.
