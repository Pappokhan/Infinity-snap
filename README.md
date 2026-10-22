# Infinity Snap

A browser extension that lets you **snap your fingers and turn to purple dust** on your own camera feed, while the room around you stays exactly as it is.

Only you disappear. The walls, furniture and everything else in the background remain the untouched live camera image.

> Fan project inspired by the Marvel Cinematic Universe. Not affiliated with or endorsed by Marvel or Disney.

## Features

- **On-device AI person segmentation** (MediaPipe Selfie Segmentation) isolates only your body.
- **Clean-plate background**: the extension memorises the room whenever you are out of the way, then reveals it as you dissolve. It also tracks gradual lighting changes.
- **Cinematic disintegration**: a purple energy front sweeps across your body in broken-up waves, spawning glowing dust particles that drift away.
- **Real-time gesture triggers** (MediaPipe Hands):
  - Finger snap (thumb and middle finger pinch, then a fast release)
  - Clenched fist held for about a second
  - Optional audible snap detection through the microphone, accepted only when a hand is visible
  - Manual trigger with the Snap button or the Space key
- **Reversible**: snap again, or press "Bring me back", to return.
- **Record** a clip of the result, with optional snap sound effects, mirror mode and fullscreen.
- **Private**: everything runs locally in your browser. No video or audio leaves your machine.

## Install

Works in Chrome, Edge and Brave (any Chromium browser with Manifest V3 support).

1. Clone or download this repository.
2. Open `chrome://extensions` (`brave://extensions` in Brave) and enable **Developer mode**.
3. Click **Load unpacked** and select the project folder (the one that contains `manifest.json`).
4. Click the Infinity Snap toolbar icon, press **Wake the camera**, and allow camera access.

## Usage

1. Put the camera on a stable surface and **do not move it**.
2. Step out of frame, or move sideways, for 2 to 3 seconds until the **Room** indicator reaches about 90% or more.
3. Step back in and snap your fingers, clench a fist, or press Space.
4. Snap again, or press **Bring me back**, to return.

### Controls

| Control | What it does |
| --- | --- |
| Trigger | Choose finger snap, fist, both, or manual only |
| Sensitivity | Makes gesture detection more or less forgiving |
| Duration | Length of the disintegration (2 to 9 seconds) |
| Listen for audible snap | Adds microphone-based snap detection (experimental) |
| Show hand tracking | Draws hand landmarks and pinch values for debugging |
| Re-scan room | Forgets the learned background and learns it again |

## How it works

1. **Segmentation**: each frame is downscaled to 640 px wide and passed to MediaPipe Selfie Segmentation to get a person mask.
2. **Room memory**: pixels that have been person-free for several frames are stored as the clean plate. The mask is dilated first so edge pixels of your body are never learned as background. Pixels you always covered are filled by interpolation and softened.
3. **Exposure matching**: a per-channel gain estimated from stable background pixels keeps the plate matched to camera auto-exposure.
4. **Compositing**: an overlay that is fully transparent everywhere except inside your mask is drawn on top of the full-resolution video. The background pixels are never modified.
5. **Dust order**: each pixel gets a threshold (a left-to-right sweep broken up by fractal noise). As progress passes a pixel's threshold, your body becomes the plate and particles spawn there.
6. **Gestures**: hand landmarks drive a small state machine for snap (pinch, then fast release) and fist.

## Project structure

```
manifest.json    Extension manifest (Manifest V3)
background.js    Opens the camera page from the toolbar icon
snap.html/css    Camera page UI
snap.js          Camera, model loading, frame loop, controls, audio, recording
effect.js        Background learning, plate filling, compositing, particles
gesture.js       Snap and fist detection from hand landmarks
lib/             Bundled MediaPipe models and WASM (no remote code)
icons/           Extension icons
```

## Limitations

- **The camera must stay still.** A moved camera invalidates the learned background.
- If you stand in frame the whole time, the area behind you is **estimated**, not seen. This is fine on plain walls and visibly approximate on busy backgrounds.
- Person segmentation can leave a faint halo at your outline, especially in low light or against a similar-coloured background.
- Finger-snap detection depends on webcam frame rate and lighting. If it misses, raise Sensitivity or use the fist gesture.
- Audible snap detection is experimental and may need tuning for your microphone.

## Development

There is no build step. Edit the files and reload the extension from `chrome://extensions`.

## Credits

- [MediaPipe](https://github.com/google-ai-edge/mediapipe) Selfie Segmentation and Hands (Apache-2.0), bundled in `lib/`.
