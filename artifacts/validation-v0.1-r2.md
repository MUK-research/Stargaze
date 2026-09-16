# Ephemeris / Stargaze — validation and handover v0.1, revision 2

**16 September 2026.** This report supplements, rather than replaces, [implementation-v0.1.md](implementation-v0.1.md).

**Status:** the first prototype is ready for a local artistic trial. Real sky rendering, catalogue-based mouse interaction, MIDI-message generation, exports and the MediaPipe camera-runtime lifecycle have passed the tests described below. Human gaze accuracy and a physical Disklavier have **not** been validated.

Tested application commit: [`5fbad5b`](https://github.com/AdrianArtacho/Ephemeris/commit/5fbad5b59f3fa2a79d29d0ebc956b592be567206). The subsequent handover commit changes documentation and validation evidence only.

## Start a first session

From the repository, run:

```bash
python3 app.py
```

Use Python 3.10 or newer. No pip packages or JavaScript build step are required for the application. Open `http://127.0.0.1:8765` in desktop Chrome or Edge. An internet connection is required for the pinned libraries, model and survey tiles. The server binds only to localhost; this is not a public deployment.

**First, test the musical interaction with the mouse.** Keep Browser sound preview selected. Press Arm sound, approach a marked object and dwell briefly. One attack is triggered; leaving the region releases it. Move to another marker to hear a different mapping. Stop / Escape disarms the output. Pan and zoom to explore; the saved trace remains attached to celestial coordinates.

**Then test your webcam.** Choose the final window/fullscreen layout before calibration. Press Start camera, then Calibrate. Look at each of nine targets and press Space to capture; five different validation targets follow. Inspect the reported screen error and the cursor at unused positions before arming. A failed validation leaves mouse mode available. Recalibrate after moving the camera, changing seat position or resizing the viewport. Gaze remains an experimental calibrated estimate, not a direct measure of attention.

**Finally connect the piano.** Press Connect MIDI, explicitly choose the Disklavier's MIDI port and receive channel, and disable browser preview for piano-only output. Begin with conservative velocities and a narrow pitch range. Verify note release, Stop, tab switching and reconnect behaviour on the physical instrument. Optional spectral-colour CC belongs on a separately selected synthesizer/electronics destination, not an assumed acoustic-piano timbre control.

## Implemented musical interpretation

| Source parameter | Current compositional mapping |
| --- | --- |
| Object azimuth | Twelve sectors advancing the root around the circle of fifths |
| Object elevation | Six modal bands, from Locrian through Lydian |
| Apparent V magnitude | Brighter objects map higher in the chosen register, then to the current scale |
| Screen-space cursor proximity | Nearer the selected object means higher note-on velocity |
| B−V colour index, or spectral-class fallback | Optional colour CC, bluer higher; unknown colour sends no CC |
| Entry, dwell and exit | One strike after dwell, with note-off on exit or duration limit |

These are editable compositional choices. Catalogue magnitude and colour are not read from stretched or colour-composited image pixels. Missing V magnitude uses a labelled neutral register. "Proximity" is cursor-to-marker distance on the screen, not the star's distance from Earth. Acoustic loudness is set at the attack: approaching an already sounding piano note does not cause a crescendo.

Observer latitude/longitude (editable Vienna default) and current or fixed UTC determine approximate geometric elevation and azimuth. This is an atlas of archived imagery rather than a real-time horizon simulation or telescope-pointing system. A 72-object SIMBAD snapshot covers the Pleiades, Orion and Andromeda examples. Live, bounded SIMBAD queries expand the catalogue on demand; neither dataset is a promise to identify every visible object.

## What was tested

| Check | Result and scope | Evidence |
| --- | --- | --- |
| Python API/catalogue tests | **13 passed.** Local HTTP routes, input validation, private-file exclusion, legacy trajectory persistence, catalogue parsing/cache/fallback. Upstream responses mocked for unit tests. | [Verify prototype](https://github.com/AdrianArtacho/Ephemeris/actions/runs/35077913219) |
| JavaScript tests | **25 passed.** Geometry, mapping, region gate, calibration/validation, MIDI bounds, scheduled note-offs, cleanup. Synthetic features and mock MIDI ports. | Same run; also passed locally |
| Real-sky browser integration | **Passed.** Real Aladin library and survey tiles; mouse dwell, sky-coordinate trace, browser preview invocation, mock MIDI note on/off, Escape, JSON export, manual trace and refusal to arm uncalibrated gaze. | [Browser integration](https://github.com/AdrianArtacho/Ephemeris/actions/runs/35077913450) |
| Deterministic browser fixture | **Passed.** The same interface/event checks against a clearly labelled mock sky and catalogue. Not evidence of real imagery by itself. | Same browser run |
| Real MediaPipe camera lifecycle | **Passed.** Real pinned model/runtime, processed video frames in a worker, calibration opening/cancellation, stream release and restart. Input was Chromium's synthetic pattern, **not a person**. | Same browser run |
| Public catalogue acquisition | **Passed previously.** Real SIMBAD queries produced the source snapshot, with query/retrieval metadata retained. | [Catalogue snapshot](https://github.com/AdrianArtacho/Ephemeris/actions/runs/35073256162) |

Total unit/API count: **38 passed**. Machine-readable summaries are saved alongside this document in [validation-v0.1-r2.json](validation-v0.1-r2.json). The browser workflow's `browser-integration` artifact contains the original JSON reports and screenshots.

The synthetic-camera run recorded five processed frames at its inspection point, zero valid-face frames and zero detected faces, as expected for a non-person test pattern. It proves startup, execution and lifecycle integration, **not** correct human iris landmarks or successful participant gaze calibration. A separate unit test exercises the complete nine-target/five-target sequence using synthetic numerical features.

One survey-mirror metadata request logged a CORS warning during the camera test. Real survey tiles loaded in the real-sky test, the inspected screenshot shows the expected star field, and no uncaught page errors were recorded. External-service availability is still a runtime dependency. Browser-audio checks confirm the software event path, not an acoustic listening test.

## Camera failure repaired during continuation

The previous main-thread MediaPipe startup failed with `ModuleFactory not set`. The first worker revision then exposed an unavailable `vision_bundle.js` loading path. The tested fix imports the verified `vision_bundle.mjs` API in a **classic Web Worker** and explicitly executes the WASM bootstrap returned by `FilesetResolver` with `importScripts` before model creation. The upstream library is not edited. GPU inference is attempted first, with CPU fallback.

Only one transferable ImageBitmap is in flight. Original capture timestamps are preserved; results older than 200 ms are rejected rather than treated as fresh gaze. Stop terminates the worker and stops camera tracks. Cancelled startup generations cannot revive an old camera or stop a newer instance. The UI reports missing/multiple faces, unclear eyes and slow frames. No video or face landmarks are uploaded or included in session exports.

## Boundaries for the local trial

The calibration acceptance threshold is deliberately permissive (18% of viewport diagonal). It is a coarse artistic usability check, not a scientific eye-tracking criterion. Enlarge object regions when the cursor is imprecise; do not interpret every object crossing as confirmed attention. The original proposal's neural musical layer and physiological fixation/saccade analysis are not implemented.

MIDI is explicitly armed and monophonic, with a maximum of four attacks per second, bounded note lengths, no automatic sustain-on, release on invalid input/exit, and stop messages on the selected channel. These controls need verification against the actual instrument's latency, routing and receive mode. No physical Disklavier was available for the automated tests.

Recordings stay in browser memory until exported and disappear on reload. Buffers are bounded and truncation is flagged. Keep gaze-derived participant exports out of Git unless there is consent to share them. Local processing does not imply offline operation: third-party library and astronomy requests still occur.

## Preserved material and deliverables

The original proposal and CNS3/ARICNS file in `Reference/`, the existing `reveal` submodule, and the saved Flask sketcher in `legacy/v0.0/` are preserved. The earlier implementation note is not replaced. Source is in `site/`, with architecture and testing instructions in `docs/`.

The **Prototype package** workflow produces a ZIP of tracked files, named with its commit hash. It does not include `.git`, local recordings or populated submodule contents. Packaging runs when versioned artifacts are committed or when manually dispatched. No GitHub Pages deployment was enabled; static hosting supports the bundled catalogue but not the Python live-query endpoint.

The README ends with the requested [📝 To-Do](https://trello.com/c/s5q6ejqY/94-stargaze-ephemeris) link.
