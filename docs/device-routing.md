# Camera sources and MIDI destinations

Device-selection update, 16 September 2026. All existing sky, gaze-calibration and musical mappings are retained.

## Choose the webcam, not OBS

The previous version requested the browser's default/front-facing camera; it did not hard-code OBS or save the synthetic camera used by CI. When OBS is the browser default, that request can select it. The new **Camera source** menu lists available video inputs, including physical webcams and virtual cameras.

Choose your built-in or USB webcam by name. If names or cameras are missing, press **Allow / refresh cameras** and grant this site camera permission. Browsers restrict device information before permission. The permission step may open the chosen/default camera briefly, then stops every track; it does not start gaze tracking. If an inactive virtual camera cannot open but permission has revealed the other sources, those choices remain available with an explanation.

Press **Start camera**. The interface displays the actual camera name reported by the active video track. An explicit choice uses `deviceId: {exact: ...}`; a missing webcam does not silently become OBS. **Browser default camera** remains an explicit option. Your chosen camera ID/name is stored locally in this browser, not sent to the server or committed to the repository. Device IDs can change if site data or permissions are reset; reselect when necessary.

Changing the source stops the camera/worker, silences output and cancels calibration. Start the new camera and recalibrate at the final viewport size. Device removal also stops interaction; it does not select the next camera automatically. Browsers or macOS may block access independently of the application: allow Camera in the site's permissions and the browser's macOS Privacy & Security settings. A busy or inactive source produces a specific error.

## Any available MIDI output

Press **Enable MIDI**, allow the browser's request, then select **MIDI note output**. This menu is not limited to a Disklavier or any manufacturer. It includes physical MIDI interfaces and virtual destinations exposed by the OS/browser, including IAC buses, network MIDI sessions and application-created virtual ports when available. The app requests software-synthesizer exposure with `software: true` where implemented, alongside `sysex: false`. Browser and OS support still determine the returned inventory.

The inventory reports output and input counts separately. Input-only controllers cannot be selected as destinations. A port with `connection: closed` but `state: connected` is available and remains selectable; the chosen note port is opened explicitly when you arm. Disconnected entries are disabled, rather than silently replacing the selection. **Refresh outputs** requests an updated inventory and disarms output. Hot-plug changes update the menu automatically. Reconnection retains the same chosen ID but never re-arms sound.

Choose your channel, then press **Arm sound → Test MIDI note**. This sends one short, moderate-velocity note (MIDI 60 constrained to your selected range, velocity at most 45, 350 ms), with a scheduled note-off. It does not send colour CC. Scanning and selecting devices do not trigger note-on messages. Stop/port changes can still send safety messages to a previously selected destination. The test requires an explicitly selected note output and an armed transport.

The **Colour output** menu uses the same complete output inventory for the optional spectral CC layer. Colour CC remains opt-in. Browser preview is independent of MIDI: disable it when listening only to an external instrument.

## macOS virtual routing without a piano

Open **Audio MIDI Setup → Window → Show MIDI Studio**, double-click **IAC Driver**, enable **Device is online**, and add a bus such as **Ephemeris**. Back in the application, press **Refresh outputs** and select the IAC bus. No Disklavier connection is needed.

In Ableton Live or another receiving application, enable that bus as a MIDI input. In Live, enable **Track**, choose it as the instrument track's input and enable monitoring (or arm the track as appropriate). Load an instrument and use **Test MIDI note** to verify reception. Do not route the instrument track's MIDI output back into the same bus: that can create feedback. IAC transports MIDI messages, not audio; the receiving instrument generates the sound.

An installed synthesizer plug-in is not necessarily an OS MIDI endpoint. When it is hosted inside a DAW, send through an exposed virtual bus into the DAW instead. An ordinary sound card/audio output is likewise not a MIDI port. This browser application cannot create system virtual MIDI buses itself.

## Empty list or denied permission

Use desktop Chrome/Edge on the application's localhost URL or HTTPS. **MIDI permission denied** means access was refused; change this site's MIDI permission and retry. **0 output ports** means the request succeeded but the browser exposed no destinations: enable a virtual bus, start the application that owns a virtual port, or connect the interface, then refresh. An input count above zero does not guarantee an output exists. If the OS lists an active port but the browser does not, verify its permissions, then restart the browser after enabling the port. No code in this update can override OS/browser device permissions.

## Implementation and evidence

`site/cameras.js` handles discovery, exact constraints and error messages. `site/gaze.js` applies the selected camera to the existing worker pipeline. `site/midi.js` handles output enumeration, explicit opening, state transitions and preserved selection. The main interface includes permission, inventory and routing guidance.

Unit tests cover enumeration, permission probes, exact constraints, virtual/physical ports, closed ports, refresh, unplug/reconnect and failed access. `tools/devices_smoke.py` exercises the interface with mocked OBS/built-in cameras, mock MIDI destinations, and synthetic video. These tests do not certify a physical webcam, CoreMIDI/IAC on your Mac, human gaze accuracy or the physical piano. The separate existing camera smoke test still loads the real MediaPipe runtime.

## Primary references

- [WebRTC: media devices and selecting cameras](https://webrtc.org/getting-started/media-devices)
- [MDN: enumerateDevices and permission-limited lists](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices)
- [Web MIDI specification: options, ports and connection state](https://www.w3.org/TR/webmidi/)
- [Apple: MIDI transfer between apps using IAC](https://support.apple.com/guide/audio-midi-setup/ams1013/mac)
- [Ableton: setting up a virtual MIDI bus](https://help.ableton.com/hc/en-us/articles/209774225-Setting-up-a-virtual-MIDI-bus)
