# Ephemeris / Stargaze — implementation v0.1

Date: 16 September 2026. This versioned implementation note accompanies the first prototype; later validation notes are stored separately rather than replacing it.

## Delivered

A Python 3.10+ standard-library server; a real Aladin Lite survey viewer; mouse and participant-calibrated MediaPipe gaze inputs; sky-coordinate trajectories; catalogue object-region enter/dwell/exit events; browser sound preview; an explicitly armed, bounded monophonic Web MIDI engine; optional separate colour-CC destination; and timestamped session JSON / trajectory CSV export.

A real SIMBAD snapshot provides 72 objects across Pleiades, Orion and Andromeda. Live cone searches are bounded and cached, with an explicitly labelled fallback. Catalogue attributes—not stretched survey pixels—drive pitch and colour. Observer/date determine approximate horizontal coordinates. The bundled snapshot includes query and retrieval metadata.

The original Flask sketcher is preserved under `legacy/v0.0/`; `Reference/StargazeProjectProposal.pdf`, the CNS3/ARICNS reference and existing submodule remain unchanged. The active application is in `site/`; the README has the requested final Trello link.

## Relationship to the original proposal

The proposal separates object-derived interval/pitch information from a second layer based on trajectory length, orientation, curvature and timing. This version implements the direct object-data response first and exports enough timestamped coordinates to explore trajectory-derived mappings next. It does not implement the proposed neural-network musical layer or claim physiological fixation/saccade measurements.

## Validation boundary

34 automated local tests passed: 13 geometry/calibration/region tests, eight MIDI tests and 13 Python API/catalogue tests. The live SIMBAD snapshot query succeeded in [Actions run 35073256162](https://github.com/AdrianArtacho/Ephemeris/actions/runs/35073256162). Version-pinned Aladin and MediaPipe resources were checked for successful HTTP delivery.

Browser integration reports are produced by `.github/workflows/browser.yml`; consult the separately versioned validation report for the final run outcome. Real participant webcam calibration and a physical Disklavier were not available for testing. Synthetic calibration and mock MIDI tests do not establish gaze accuracy or instrument behaviour.

## Important limitations

Gaze is an experimental calibrated estimate, not a direct MediaPipe output or a measure of attention. Catalogue coverage is incomplete. Altitude/azimuth is approximate, not telescope-grade astrometry. Acoustic piano loudness is set at note attack; colour CC is intended for an additional electronic instrument, not acoustic-piano timbre. The first prototype is intentionally monophonic and conservative.

## Start

```bash
python3 app.py
```

Open `http://127.0.0.1:8765` in desktop Chrome/Edge, start with mouse and browser preview, then test calibration and the physical MIDI output separately. Detailed instructions: [README](../README.md), [architecture](../docs/architecture.md), [testing](../docs/testing.md).
