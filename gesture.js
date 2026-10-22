(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SnapGesture = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const dist = (a, b, w, h) => Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
  const FINGERS = [[8, 6], [12, 10], [16, 14], [20, 18]];

  function metrics(lm, w, h) {
    const handSize = Math.max(1e-3, dist(lm[0], lm[9], w, h));
    const pinch = dist(lm[4], lm[12], w, h) / handSize;
    let curled = 0;
    for (const [tip, pip] of FINGERS) {
      if (dist(lm[tip], lm[0], w, h) < dist(lm[pip], lm[0], w, h) * 1.02) curled++;
    }
    return { handSize, pinch, curled, fist: curled === 4 };
  }

  class GestureDetector {
    constructor(opts) {
      opts = opts || {};
      this.mode = opts.mode || 'both';
      this.sensitivity = opts.sensitivity || 1;
      this.cooldownMs = opts.cooldownMs || 2500;
      this.reset();
    }
    reset() { this.hands = []; this.lastFire = -1e9; }

    update(handsLm, t, w, h) {
      const s = this.sensitivity;
      const ON = 0.40 * s, HYS = ON + 0.10, REL = 0.75 / s, MAXREL = 200 * s, HOLD = 700 / s;
      const snapOn = this.mode === 'both' || this.mode === 'snap';
      const fistOn = this.mode === 'both' || this.mode === 'fist';
      let event = null;
      const info = [];
      const n = Math.max(handsLm.length, this.hands.length);

      for (let i = 0; i < n; i++) {
        const lm = handsLm[i];
        let st = this.hands[i];
        if (!st) st = this.hands[i] = { count: 0, armed: false, lastPinchT: 0, pinchFrames: 0, fistSince: 0, fistFired: false };

        if (!lm) {
          if (snapOn && st.armed && st.pinchFrames >= 3 && t - st.lastPinchT <= 350) event = event || 'snap';
          st.count = 0; st.armed = false; st.fistSince = 0; st.fistFired = false;
          continue;
        }

        const m = metrics(lm, w, h);
        info.push(m);

        if (st.locked) {
          if (m.pinch > HYS) { st.locked = false; st.count = 0; }
        } else if (!st.armed) {
          if (m.pinch < ON) {
            st.count++;
            if (st.count >= 2) { st.armed = true; st.armT = t; st.lastPinchT = t; st.pinchFrames = st.count; }
          } else st.count = 0;
        } else if (m.pinch < HYS) {
          st.lastPinchT = t; st.pinchFrames++;
          if (t - st.armT > 900) { st.armed = false; st.locked = true; }
        } else {
          const since = t - st.lastPinchT;
          if (m.pinch > REL && since <= MAXREL) {
            if (snapOn) event = event || 'snap';
            st.armed = false; st.count = 0;
          } else if (since > MAXREL) {
            st.armed = false; st.count = 0;
          }
        }

        if (m.fist) {
          if (!st.fistSince) st.fistSince = t;
          else if (!st.fistFired && t - st.fistSince >= HOLD) {
            st.fistFired = true;
            if (fistOn) event = event || 'fist';
          }
        } else { st.fistSince = 0; st.fistFired = false; }
      }
      this.hands.length = handsLm.length;

      if (event) {
        if (t - this.lastFire < this.cooldownMs) event = null;
        else this.lastFire = t;
      }
      return { event, hands: info };
    }
  }

  return { metrics, GestureDetector };
});
