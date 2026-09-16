# Ephemeris / Stargaze

**Look into the sky. Let a melody emerge.**

A first playable prototype of Adrián Artacho's *Stargaze*: explore real astronomical survey images, move a cursor with the mouse or calibrated webcam gaze, and let encounters with catalogue objects produce MIDI for a Disklavier or an electronic instrument.

## Status and deliverables

The camera startup has been revised to use a separate browser worker. See the [versioned validation and handover report](artifacts/validation-v0.1-r2.md) for exactly what has been tested and what still needs a local webcam / Disklavier check. The earlier [implementation note](artifacts/implementation-v0.1.md) remains unchanged. Tracked-source ZIPs can be built through the **Prototype package** GitHub Actions workflow; the application itself still needs no build step.

## Run

Python **3.10+**, an internet connection and a desktop browser are enough. No Python packages or JavaScript build step are required.

```bash
python3 app.py
```

Open **http://127.0.0.1:8765** in **Chrome or Edge**. A different port is available with `python3 app.py --port 8766`. Camera and sound are off at startup. The original Flask sketcher is preserved in [`legacy/v0.0/`](legacy/v0.0/).

## First play

Start with **Mouse / trackpad** and **Browser sound preview**. The Pleiades field opens by default. Press **Arm sound**, approach a marked object and dwell briefly: one note sounds. Leave the region to release the note; return to trigger it again. Drag or zoom the sky to explore. **Stop / Esc** silences and disarms output.

**Load objects in view** queries SIMBAD around the view centre. A bundled, provenance-labelled SIMBAD snapshot contains 72 objects across the Pleiades, Orion and Andromeda fields, so these examples do not depend on a successful live catalogue query. Survey imagery and external libraries still require internet access. The catalogue is intentionally limited: not every visible speck is identified, and blank catalogue coverage is not an empty sky.

## Camera and MIDI device selection

Use **Camera source** to choose your actual webcam rather than the browser default (which may be OBS). **Allow / refresh cameras** reveals device names after permission; it may briefly open and release a camera for that permission request. The chosen camera is remembered in this browser. Changing it stops tracking and clears calibration; press **Start camera → Calibrate** again.

**Enable MIDI → MIDI note output** lists all output ports exposed by the browser, physical or virtual, without requiring a Disklavier. **Refresh outputs** rescans; the list also follows device-connect/disconnect events. A selected destination stays selected on refresh, but output stays disarmed after a disconnect. **Arm sound → Test MIDI note** sends one short note to check routing. It does not send a note merely by scanning or selecting a device.

An empty list now distinguishes missing permission from zero output ports or input-only devices. For a virtual destination on macOS, enable **IAC Driver → Device is online** in **Audio MIDI Setup → Window → Show MIDI Studio**, create a bus, and refresh outputs. Choose that bus as the input in your receiving instrument app. See [camera/MIDI setup and troubleshooting](docs/device-routing.md), also available through the interface's **No MIDI outputs? / Virtual routing** section.

## Webcam gaze

Press **Start camera → Calibrate**. Look at each of the nine dots and press **Space** to capture it, keeping your head comfortably still. Five separate validation dots follow. A passing result enables gaze mode and reports the held-out error in screen pixels. Check that the cursor broadly follows your eyes before arming sound.

This is **an experimental, participant-calibrated gaze estimate**, not MediaPipe-provided gaze and not a measurement of attention. Lighting, glasses, camera position and head movement can substantially affect it. A failed validation keeps mouse mode available. Resizing or entering fullscreen invalidates calibration. Blinks, a missing face, multiple detected faces, stale samples and out-of-screen estimates suppress interaction. Use larger regions for coarse control.

Camera processing stays in a separate worker in the browser. The status display distinguishes missing faces, unclear eyes and overly slow frames. No webcam frames are uploaded or included in exports. Library/model downloads and astronomical service requests still contact third-party servers.

## Disklavier / MIDI

Connect the instrument through its available MIDI interface, press **Enable MIDI**, explicitly choose its output and check the MIDI channel. Disable browser preview when using the piano alone. Start with the conservative default note range **48–84**, velocities **25–88**, and a short note length. Then arm sound.

The prototype is monophonic, with at most four attacks per second, one strike per region visit, timed note-offs, note-offs on exit, and automatic disarming on window blur or hidden tabs. There is no automatic sustain-on. **Stop / Esc** also sends sustain-off, all-sound-off and all-notes-off on the selected channel. These are software safeguards, not a substitute for testing the physical instrument at low dynamics. Hardware behaviour and instrument-specific routing still need a local check.

Optional **spectral-colour CC** has its own explicitly selected MIDI destination, defaults to CC74 and is off initially. Use it for a synthesizer or electronics layer. It does **not** change an acoustic Disklavier's timbre. Piano loudness is set at the attack; moving closer cannot crescendo an already struck acoustic note.

## Mapping

| Input | Prototype mapping |
| --- | --- |
| Object azimuth | Twelve sectors around a circle-of-fifths root sequence |
| Object elevation | Six modal bands: Locrian → Aeolian → Dorian → Mixolydian → Ionian → Lydian |
| Apparent V magnitude | Brighter objects produce higher pitches, quantised to the current mode |
| Cursor-to-object distance | Closer produces higher attack velocity within the selected bounds |
| B−V colour index; spectral class fallback | Optional colour CC; bluer → higher value |
| Region entry / dwell / exit | One note after dwell; release on exit or duration limit |

These are **compositional choices**, not natural laws relating stars to sound. Magnitudes and colour indices come from the catalogue, not from survey-image pixel colours. Unknown magnitude uses an explicitly labelled neutral register; unknown colour sends no CC. “Distance” here means screen-space proximity, not the star's distance from Earth.

Observer latitude/longitude and current or fixed **UTC** determine approximate geometric elevation and azimuth. Vienna is an editable city-level default. This is a sky atlas, not a horizon-limited planetarium: below-horizon regions remain visible unless their notes are filtered. Positions are not suitable for telescope pointing. See [`docs/architecture.md`](docs/architecture.md) for conventions and limitations.

## Traces and data

Trajectories are drawn as Aladin sky-coordinate polylines, so they remain attached to the sky when the view moves. Gaps in tracking and changes of view start new segments. RA/Dec points can also be added manually.

**Export session JSON** saves timestamped cursor/ICRS coordinates, region and note events, mapping settings, catalogue provenance and validation results. **Trace CSV** is a simpler coordinate table. Recordings stay in browser memory until explicitly exported; reloading discards them. Visible traces are capped at 2,000 points; exports retain the latest 20,000 samples and 5,000 events and flag truncation. Clearing the visible trace does not delete earlier session samples. Do not commit participant recordings without consent.

The original `/api/trajectory` GET/POST/DELETE interface remains available to scripts and persists separately under ignored `.local/`; the new live interface does not silently upload gaze samples to it.

## Structure and development

```text
app.py                    Local static/API server (Python standard library)
catalog.py                Validated SIMBAD queries, cache and fallback
site/                     Aladin interface, calibrated gaze and MIDI engine
site/data/seed.json        Real, limited SIMBAD snapshot with provenance
Reference/                Original proposal and historical CNS3/ARICNS notes
legacy/v0.0/              Preserved original Flask version
artifacts/                Versioned implementation notes / deliverables
tests/                    Geometry, calibration, MIDI and API tests
tools/                    Catalogue refresh and browser integration checks
```

Run developer tests with `python3 -m unittest discover -s tests -v` and `npm test` (Node 22+). Browser checks use the optional developer dependency Playwright; see [`docs/testing.md`](docs/testing.md). No npm install is needed to run the application or the pure JavaScript tests.

`site/` can also be hosted as static files over HTTPS, including on GitHub Pages after Pages is configured. Static mode supports bundled objects, gaze, preview and Web MIDI, but **not the Python live-catalogue endpoint**. Pages deployment is not enabled automatically.

New catalogue snapshots can be generated without overwriting previous ones:

```bash
python3 tools/refresh_catalog.py
```

The old CNS3/ARICNS file is kept as a historical reference, not silently treated as a modern ICRS catalogue. Its original coordinate/epoch conventions must be established and converted before ingestion. The proposal's trajectory-shape mappings and neural-network layer remain future work; this version implements the direct object-data response first.

## Credits and data

Concept and development: **[Adrián Artacho](https://www.artacho.at/)**.

Built with **[Aladin Lite / CDS](https://aladin.cds.unistra.fr/AladinLite/)**, **[SIMBAD / CDS](https://simbad.cds.unistra.fr/)** and **[MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js)**. Third-party code and models retain their respective upstream licence terms. No third-party library or model binaries are bundled here.

This project makes use of the SIMBAD database, operated at CDS, Strasbourg, France. Reference: Wenger et al. (2000), *The SIMBAD astronomical database*, A&AS 143, 9–22. Bundled catalogue data is provided under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/); query and retrieval metadata accompany the data. Image attribution belongs to the selected survey; consult its Aladin survey metadata. This repository does not relicense survey images.

---

## [📝 To-Do](https://trello.com/c/s5q6ejqY/94-stargaze-ephemeris)
