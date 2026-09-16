# Prototype architecture / v0.1

## Separate data, perception and sound

Aladin Lite 3.8.2, participant-specific ridge regression, region selection, trace rendering, browser audio and Web MIDI run on the browser main thread. MediaPipe Tasks Vision 0.10.21 (Face Landmarker model v1) runs in a separate worker. Python serves `site/` and proxies bounded public SIMBAD TAP queries. There is no video streaming to Python and no identification of faces.

The pipeline is: camera landmarks → calibration → estimated screen point → Aladin `pix2world` → ICRS cursor position. Separately, catalogue object ICRS coordinates pass through Aladin `world2pix` for screen-space region selection. A short dwell chooses one object; its catalogue attributes and local horizontal position determine the musical mapping. Mouse input exercises the identical downstream path without camera uncertainty.

Camera/video coordinates remain unmirrored for the estimator. Only the preview video is mirrored in CSS. Predictions are learned in coordinates normalised to the sky viewport, not the entire browser window. Aladin conversions use CSS pixels relative to that viewport; the transparent canvas is independently scaled for device pixel ratio. Resizing invalidates calibration. Do not multiply Aladin input coordinates by the device pixel ratio.

## Gaze limitations

MediaPipe supplies facial/iris landmarks, not a point of regard. Features comprise two iris centres relative to rotated eye axes, face position/scale, nose-position and roll proxies, and a few second-order eye terms. Ridge regression learns screen x/y from nine targets. Five different targets provide held-out validation. The displayed error is target-level screen RMS, not measured angular eye-tracking accuracy. The gross acceptance threshold is 18% of viewport diagonal: deliberately permissive for an artistic prototype, not a scientific quality criterion. The displayed region radius increases with validation error, up to 250 CSS pixels.

No face, multiple detected faces, high blink scores, a collapsed eye aperture, stale frames (>200 ms), or out-of-viewport predictions suppress selection and release notes. A ~65 ms display smoother trades immediacy for cursor stability. Processing is throttled to at most about 22 Hz and runs in a dedicated classic Web Worker (`site/vision-worker.js`). The pinned MediaPipe API is dynamically imported there, and its WASM bootstrap is executed with `importScripts`, isolating it from the sky viewer. Only one transferable ImageBitmap is in flight; each is closed after inference. Original capture timestamps reject results more than 200 ms old rather than treating delayed results as fresh gaze. A dedicated eye-tracker adapter remains a possible accuracy upgrade. Neither this sampling rate nor this estimator supports claims of valid physiological saccade/fixation measurement. Looking at an object also does not prove attention to it.

## Astronomical conventions

Catalogue and trace positions are ICRS right ascension and declination in degrees. `horizontal()` approximates ICRS by mean J2000 coordinates, applies a classical precession rotation to date and converts using local sidereal time. Longitude is east-positive; azimuth is north=0°, east=90°. UTC approximates UT1. The implementation omits frame bias, nutation, aberration, atmospheric refraction, parallax and stellar proper motion. It is an artistic control signal, not precision astrometry. Azimuth is undefined at zenith/nadir; the mapping falls back to the configured root.

Changing observer/date changes harmonic mapping, not the archived survey photographs. Fixed time is entered as UTC, despite the browser's generic date-time input styling. The current sky imagery is not a contemporaneous webcam or planetary ephemeris. SIMBAD targets objects outside the Solar System; planets and moving bodies require a separate ephemeris source.

## Catalogue provenance and failure behaviour

The server queries `basic` joined to `allfluxes`, requesting identifiers, ICRS positions, object types, spectral types and B/V photometry. Derived B−V is used only when both measurements exist; this is a colour index, not a full spectrum. The query is limited to 500 rows and a 15° cone, uses finite bounded numeric inputs, a response-size limit and a 20-second upstream timeout. The browser defaults to 300 rows and explicitly labels capped/wide-field coverage. Requests are initiated on demand or after a debounced view change when Auto is enabled—not every gaze frame.

A small server cache reduces repeated queries. If the service fails, a labelled local snapshot is filtered to the requested cone; it is never presented as a complete all-sky catalogue. In static mode the full limited snapshot stays available. The image may contain objects missing from the selected catalogue. Closely overlapping catalogue entries can be different components, systems or object types rather than distinct visible points; screen-space nearest-object selection is not image-based source identification.

## Events, musical mapping and safety

`RegionGate` emits entry, dwell and exit events. A selected region is retained out to 1.25 times the acquisition radius unless another object is substantially closer. Dwell produces one attack per visit; no frame-by-frame retriggering. A note lasts at most the selected duration (100–1200 ms), or until region exit, invalid cursor, pan, output change or stop. The engine is monophonic, limits attacks to four per second and caps velocity at 100.

Azimuth chooses twelve 30° sectors centred on compass bearings. Successive sectors advance the root by a perfect fifth modulo twelve. Elevation divides −90…90° into six modal bands. V magnitude maps inversely to register over the chosen note range and is quantised to the mode. V unknown → neutral midpoint. Proximity maps linearly to attack velocity. B−V maps −0.4…2.0 to CC127…0; otherwise O/B/A/F/G/K/M is a coarse fallback. Colour unknown → no CC.

The acoustic piano receives note on/off. Optional colour control has an explicitly selected destination, with CC74 as a suggested default. Acoustic notes cannot change attack velocity after being struck. A scheduled MIDI note-off is queued immediately; later release clears stale queued messages before retriggering the same pitch. Stop sends sustain-off/all-sound-off/all-notes-off only on the selected channel. There is no SysEx, automatic sustain-on or input-to-output MIDI feedback. Physical piano testing remains required.

## Data boundaries

Session exports include cursor samples, UTC and relative timestamps, observation time, region/note events, settings and catalogue provenance. They do not contain video or face-landmark arrays. Sample/event buffers are bounded and truncation is labelled. The server's legacy trajectory API is separate and writes only `.local/trajectory.json`; it is not used as an implicit gaze logger. The server binds only 127.0.0.1, serves only `site/`, rejects non-JSON/cross-origin writes and is not intended for public deployment.

Third-party downloads and sky-data requests reveal ordinary network/request metadata. Local gaze processing does not mean completely offline operation. Obtain consent before collecting another person's gaze-derived session data; keep exports out of Git by default.

## Primary documentation

- Aladin API: https://aladin.cds.unistra.fr/AladinLite/doc/API/
- MediaPipe Face Landmarker: https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js
- MediaPipe Iris limitation: https://github.com/google/mediapipe/blob/master/docs/solutions/iris.md
- SIMBAD TAP access: https://simbad.u-strasbg.fr/Pages/guide/sim-q.htx
- SIMBAD schema/query examples: https://astroquery.readthedocs.io/en/latest/simbad/simbad.html
- Horizontal-frame convention: https://docs.astropy.org/en/stable/api/astropy.coordinates.AltAz.html
- MIDI messages: https://midi.org/summary-of-midi-1-0-messages
- MIDI controllers: https://midi.org/midi-1-0-control-change-messages

## Camera lifecycle revision (16 September 2026)

The initial main-thread bootstrap failed with `ModuleFactory not set` in the browser integration test. The worker revision imports the verified `vision_bundle.mjs` API inside a classic worker and explicitly executes the WASM-loader path returned by `FilesetResolver` with `importScripts` before each creation attempt. This publishes `ModuleFactory` on the worker global without modifying upstream library files. GPU inference is attempted first, with an explicit CPU fallback and both error messages retained if startup fails. Downloads time out, stop terminates the worker and releases the camera, pending starts are cancelled without affecting a later instance, and hardware disconnection resets calibration. The interface reports missing faces, multiple faces, unclear eyes and overly delayed frames. Aggregate frame counts are exposed in the diagnostic state; no images or face-landmark arrays are exported.
