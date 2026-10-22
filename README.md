# Infinity Snap

Snap your fingers and turn to purple dust, while the room stays exactly as it is.

## Install (Chrome / Edge / Brave)
1. Unzip this folder.
2. Open `chrome://extensions`, switch on **Developer mode**.
3. **Load unpacked** and pick the `thanos-snap` folder.
4. Click the extension icon, press **Wake the camera**, and allow camera access.

## Use
- Put the camera on a stable surface and do not move it.
- Step out of frame for 2-3 seconds, or move sideways, so **Room** reaches ~90%+.
- Step back in. Snap, or clench a fist for about a second. Press Space or **Snap** to trigger manually.
- Snap again, or press **Bring me back**, to return.

## How it works
- MediaPipe Selfie Segmentation (bundled, on-device) finds your body.
- The room is memorised from pixels where you are not. Pixels you always covered are filled by interpolation.
- Only pixels inside your body mask are ever replaced. Everything else is the untouched live camera frame.
- A purple front sweeps across you; dust particles spawn at the front and drift away.
- MediaPipe Hands detects a thumb-to-middle-finger pinch with a fast release (the snap) or a clenched fist.
  "Listen for audible snap" adds microphone detection, accepted only when a hand is visible.
