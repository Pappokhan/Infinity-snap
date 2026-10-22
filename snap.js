(() => {
  'use strict';
  const E = self.SnapEffect, G = self.SnapGesture;
  const $ = (s) => document.querySelector(s);
  const el = {
    video: $('#cam'), view: $('#view'), stage: $('#stage'), hud: $('#hud'), status: $('#status'), hint: $('#hint'),
    flash: $('#flash'), gate: $('#gate'), gateMsg: $('#gateMsg'), dock: $('#dock'),
    chipHand: $('#chipHand'), chipBody: $('#chipBody'), chipRoom: $('#chipRoom'), roomPct: $('#roomPct'),
    start: $('#btnStart'), snap: $('#btnSnap'), back: $('#btnBack'), scan: $('#btnScan'), rec: $('#btnRec'), full: $('#btnFull'),
    mode: $('#selMode'), sens: $('#rngSens'), dur: $('#rngDur'),
    sound: $('#chkSound'), fx: $('#chkFx'), mirror: $('#chkMirror'), debug: $('#chkDebug'),
  };

  const PW = 640;
  const END = 1.12;
  const S = {
    running: false, W: 0, H: 0, vw: 0, vh: 0,
    ph: 'live',
    progress: 0, prev: 0, t0: 0, dur: 4500, dir: 1,
    hands: [], lastHand: -1e9, hasPerson: false, handsBusy: false,
    plate: null, thr: null, lastPlate: 0,
    maskChan: -1,
  };
  let seg, hands, bg, parts, gesture, rnd = Math.random;
  let pc, pctx, mc, mctx, oc, octx, pcl, pclx, dctx;
  let rawMask, stickyMask, learnMask, compMask, tmpMask, overImg, partImg, partU32;
  let toastT = 0, statusLock = 0;

  function say(line, hint, warn) {
    el.status.textContent = line;
    if (hint !== undefined) el.hint.textContent = hint;
    el.hud.classList.toggle('warn', !!warn);
  }
  function setChip(chip, on) { chip.classList.toggle('on', !!on); }

  function dilate(src, dst, tmp, w, h, r) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let m = 0; const a = Math.max(0, x - r), b = Math.min(w - 1, x + r);
        for (let k = a; k <= b; k++) { const v = src[row + k]; if (v > m) m = v; }
        tmp[row + x] = m;
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let m = 0; const a = Math.max(0, y - r), b = Math.min(h - 1, y + r);
        for (let k = a; k <= b; k++) { const v = tmp[k * w + x]; if (v > m) m = v; }
        dst[y * w + x] = m;
      }
    }
  }
  function blur(buf, tmp, w, h, r) {
    const d = r * 2 + 1;
    for (let y = 0; y < h; y++) {
      const row = y * w; let s = 0;
      for (let k = -r; k <= r; k++) s += buf[row + Math.min(w - 1, Math.max(0, k))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = s / d;
        s += buf[row + Math.min(w - 1, x + r + 1)] - buf[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
      for (let y = 0; y < h; y++) {
        buf[y * w + x] = s / d;
        s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
  }

  async function startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: 'user' },
      audio: false,
    });
    el.video.srcObject = stream;
    await el.video.play();
    await new Promise((r) => (el.video.videoWidth ? r() : el.video.addEventListener('loadedmetadata', r, { once: true })));
    S.vw = el.video.videoWidth; S.vh = el.video.videoHeight;
    S.W = PW; S.H = Math.max(2, Math.round(PW * S.vh / S.vw));
    el.view.width = S.vw; el.view.height = S.vh;
    el.stage.style.aspectRatio = S.vw + ' / ' + S.vh;
  }

  function allocate() {
    const { W, H } = S, n = W * H;
    const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    pc = mk(W, H); pctx = pc.getContext('2d', { willReadFrequently: true });
    mc = mk(W, H); mctx = mc.getContext('2d', { willReadFrequently: true });
    oc = mk(W, H); octx = oc.getContext('2d');
    pcl = mk(W, H); pclx = pcl.getContext('2d');
    dctx = el.view.getContext('2d');
    rawMask = new Uint8Array(n); stickyMask = new Uint8Array(n); learnMask = new Uint8Array(n);
    compMask = new Uint8Array(n); tmpMask = new Uint8Array(n);
    overImg = octx.createImageData(W, H);
    partImg = pclx.createImageData(W, H); partU32 = new Uint32Array(partImg.data.buffer);
    bg = new E.Background(W, H);
    parts = new E.Particles(45000, W, H, rnd);
    gesture = new G.GestureDetector({ mode: el.mode.value, sensitivity: +el.sens.value });
  }

  async function loadModels() {
    seg = new SelfieSegmentation({ locateFile: (f) => 'lib/' + f });
    seg.setOptions({ modelSelection: 1, selfieMode: false });
    seg.onResults(onSeg);
    hands = new Hands({ locateFile: (f) => 'lib/' + f });
    hands.setOptions({ maxNumHands: 2, modelComplexity: 0, minDetectionConfidence: 0.5, minTrackingConfidence: 0.45, selfieMode: false });
    hands.onResults(onHands);
    pctx.drawImage(el.video, 0, 0, S.W, S.H);
    await seg.send({ image: el.video });
    await hands.send({ image: el.video });
  }

  function onSeg(res) {
    const { W, H } = S, n = W * H;
    mctx.clearRect(0, 0, W, H);
    mctx.drawImage(res.segmentationMask, 0, 0, W, H);
    const d = mctx.getImageData(0, 0, W, H).data;
    if (S.maskChan < 0) {
      let sr = 0, sa = 0, mr = 0, ma = 0;
      for (let i = 0; i < n; i += 7) { mr += d[i * 4]; ma += d[i * 4 + 3]; }
      mr /= n / 7; ma /= n / 7;
      for (let i = 0; i < n; i += 7) { sr += Math.abs(d[i * 4] - mr); sa += Math.abs(d[i * 4 + 3] - ma); }
      S.maskChan = sa > sr * 1.5 ? 3 : 0;
    }
    const ch = S.maskChan;
    for (let i = 0; i < n; i++) {
      const v = d[i * 4 + ch];
      rawMask[i] = v < 70 ? 0 : v > 175 ? 255 : ((v - 70) * 255 / 105) | 0;
    }
    for (let i = 0; i < n; i++) {
      const v = rawMask[i], s = stickyMask[i] * 0.72;
      stickyMask[i] = v > s ? v : s;
    }
    dilate(stickyMask, learnMask, tmpMask, W, H, 7);
    dilate(rawMask, compMask, tmpMask, W, H, 2);
    blur(compMask, tmpMask, W, H, 1);
    let area = 0;
    for (let i = 0; i < n; i += 3) if (rawMask[i] > 128) area++;
    S.hasPerson = area * 3 > 600;
  }

  function onHands(res) {
    S.hands = res.multiHandLandmarks || [];
    if (S.hands.length) S.lastHand = performance.now();
  }

  function trigger(source) {
    if (S.ph === 'dusting' || S.ph === 'restoring') return;
    const now = performance.now();
    if (S.ph === 'live') {
      if (!S.hasPerson) { say('I cannot see you.', 'Step into frame, then snap.', true); return; }
      const noise = E.makeNoise(S.W, S.H, E.mulberry32((Math.random() * 1e9) | 0));
      const bt = E.buildThreshold(noise, S.W, S.H, rawMask, 200);
      if (!bt) { say('I cannot see you.', 'Step into frame, then snap.', true); return; }
      S.thr = bt.thr;
      S.plate = E.buildPlate(bg); S.lastPlate = now;
      S.ph = 'dusting'; S.dir = 1; S.progress = S.prev = 0; S.t0 = now;
      parts.clear();
      say('I don’t feel so good…', '');
      statusLock = now + 1500;
      fx.snap();
      el.flash.classList.remove('go'); void el.flash.offsetWidth; el.flash.classList.add('go');
    } else if (S.ph === 'gone') {
      S.ph = 'restoring'; S.dir = -1; S.t0 = now; S.progress = S.prev = END;
      say('Reality, restored.', '');
      statusLock = now + 1500;
      fx.snap();
    }
    syncButtons();
  }

  function syncButtons() {
    el.snap.disabled = S.ph !== 'live';
    el.back.disabled = !(S.ph === 'gone');
  }

  async function loop() {
    if (!S.running) return;
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0.001, (now - (loop.last || now)) / 1000)); loop.last = now;
    const { W, H } = S;
    try {
      pctx.drawImage(el.video, 0, 0, W, H);
      await seg.send({ image: el.video });
      if (!S.handsBusy && gesture.mode !== 'off') {
        S.handsBusy = true;
        try { await hands.send({ image: el.video }); } finally { S.handsBusy = false; }
        const r = gesture.update(S.hands, performance.now(), W, H);
        if (r.event) trigger(r.event);
      } else if (gesture.mode === 'off') S.hands = [];
      pollAudio(now);
    } catch (e) {
      console.error(e);
      say('Something went wrong.', String(e && e.message || e), true);
    }

    const frame = pctx.getImageData(0, 0, W, H).data;
    bg.update(frame, learnMask, S.ph === 'live' ? 0.03 : 0.02);

    S.prev = S.progress;
    if (S.ph === 'dusting' || S.ph === 'restoring') {
      const k = Math.min(1, (now - S.t0) / S.dur), e = 0.35 * k * k * (3 - 2 * k) + 0.65 * k;
      S.progress = S.dir > 0 ? e * END : (1 - e) * END;
      if (k >= 1) {
        if (S.ph === 'dusting') { S.ph = 'gone'; S.progress = END; say('Perfectly balanced, as all things should be.', 'Snap again (or press Bring me back) to return.'); }
        else { S.ph = 'live'; S.progress = 0; S.plate = null; S.thr = null; say('Ready.', hintFor()); }
        syncButtons();
      }
    }
    if (S.ph !== 'live' && now - S.lastPlate > 1200) { S.plate = E.buildPlate(bg); S.lastPlate = now; }

    const mir = el.mirror.checked;
    dctx.save();
    if (mir) { dctx.translate(S.vw, 0); dctx.scale(-1, 1); }
    dctx.drawImage(el.video, 0, 0, S.vw, S.vh);
    if (S.ph !== 'live' && S.plate) {
      const spawnRate = S.ph === 'restoring' ? 0.25 : 0.4;
      E.composite({
        w: W, h: H, frame, plate: S.plate, mask: compMask, out: overImg.data, thr: S.thr,
        progress: S.progress, prevProgress: S.prev, band: 0.07, gain: bg.gain,
        spawn: (x, y, r, g, b) => parts.spawn(x, y, r, g, b, S.dir), spawnProb: spawnRate, rnd,
      });
      octx.putImageData(overImg, 0, 0);
      dctx.drawImage(oc, 0, 0, S.vw, S.vh);
    }
    if (parts.n > 0) {
      parts.step(dt, now / 1000, S.dir > 0 ? 1 : -1);
      parts.render(partImg.data, partU32);
      pclx.putImageData(partImg, 0, 0);
      dctx.globalCompositeOperation = 'lighter';
      dctx.drawImage(pcl, 0, 0, S.vw, S.vh);
      if ('filter' in dctx) {
        dctx.filter = 'blur(' + Math.max(3, S.vw / 160) + 'px)';
        dctx.drawImage(pcl, 0, 0, S.vw, S.vh);
        dctx.filter = 'none';
      }
      dctx.globalCompositeOperation = 'source-over';
    }
    if (el.debug.checked) drawHands(mir);
    dctx.restore();

    setChip(el.chipHand, now - S.lastHand < 400);
    setChip(el.chipBody, S.hasPerson);
    const cov = bg.coverage();
    el.roomPct.textContent = Math.round(cov * 100) + '%';
    setChip(el.chipRoom, cov > 0.9);
    if (S.ph === 'live' && now > statusLock) {
      if (!S.hasPerson) say('Waiting for you…', 'Step into frame.');
      else say('Ready.', hintFor());
    }
    requestAnimationFrame(loop);
  }

  function hintFor() {
    const cov = bg.coverage();
    const how = { both: 'Snap your fingers, or clench a fist.', snap: 'Snap your fingers.', fist: 'Clench a fist.', off: 'Press Snap.' }[el.mode.value];
    if (cov < 0.7) return how + '  Tip: step aside briefly so I can learn the room (' + Math.round(cov * 100) + '%).';
    return how;
  }

  function drawHands(mir) {
    dctx.save();
    dctx.fillStyle = '#d8b4fe'; dctx.strokeStyle = 'rgba(216,180,254,.6)'; dctx.lineWidth = 2;
    for (const lm of S.hands) {
      for (const p of lm) { dctx.beginPath(); dctx.arc(p.x * S.vw, p.y * S.vh, 3.5, 0, 6.283); dctx.fill(); }
      const m = G.metrics(lm, S.W, S.H);
      dctx.beginPath(); dctx.moveTo(lm[4].x * S.vw, lm[4].y * S.vh); dctx.lineTo(lm[12].x * S.vw, lm[12].y * S.vh); dctx.stroke();
      dctx.restore(); dctx.save();
      if (mir) { dctx.translate(S.vw, 0); dctx.scale(-1, 1); }
      dctx.fillStyle = '#e8b04a'; dctx.font = '16px ui-monospace,monospace';
      dctx.save(); dctx.translate(lm[0].x * S.vw, lm[0].y * S.vh + 24);
      if (mir) dctx.scale(-1, 1);
      dctx.fillText('pinch ' + m.pinch.toFixed(2) + ' curl ' + m.curled, 0, 0); dctx.restore();
      dctx.fillStyle = '#d8b4fe';
    }
    dctx.restore();
  }

  const audio = { ac: null, an: null, buf: null, base: 0, last: 0, stream: null };
  async function enableMic(on) {
    if (!on) {
      if (audio.stream) audio.stream.getTracks().forEach((t) => t.stop());
      if (audio.ac) audio.ac.close();
      audio.ac = audio.an = audio.stream = null; return;
    }
    try {
      audio.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      audio.ac = new AudioContext();
      const src = audio.ac.createMediaStreamSource(audio.stream);
      audio.an = audio.ac.createAnalyser(); audio.an.fftSize = 1024; audio.an.smoothingTimeConstant = 0;
      src.connect(audio.an); audio.buf = new Uint8Array(audio.an.frequencyBinCount);
    } catch (e) {
      el.sound.checked = false; say('Microphone unavailable.', 'Allow microphone access to hear audible snaps.', true);
    }
  }
  function pollAudio(now) {
    if (!audio.an || S.ph !== 'live' && S.ph !== 'gone') return;
    audio.an.getByteFrequencyData(audio.buf);
    const bins = audio.buf.length, hz = audio.ac.sampleRate / 2 / bins;
    let s = 0, c = 0;
    for (let i = Math.floor(2000 / hz); i < Math.min(bins, Math.floor(9000 / hz)); i++) { s += audio.buf[i]; c++; }
    const hi = c ? s / c : 0, sens = +el.sens.value;
    const spike = hi > audio.base * (2.3 / sens) + 18 && hi > 55;
    audio.base = audio.base * 0.97 + hi * 0.03;
    if (spike && now - audio.last > 1200 && now - S.lastHand < 700 && gesture.mode !== 'off') { audio.last = now; trigger('sound'); }
  }

  const fx = {
    ac: null,
    snap() {
      if (!el.fx.checked) return;
      try {
        const ac = this.ac || (this.ac = new AudioContext()), t = ac.currentTime;
        const nb = ac.createBuffer(1, ac.sampleRate * 0.25, ac.sampleRate), d = nb.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 6);
        const ns = ac.createBufferSource(); ns.buffer = nb;
        const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
        const g1 = ac.createGain(); g1.gain.value = 0.5; ns.connect(hp).connect(g1).connect(ac.destination); ns.start(t);
        const o = ac.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(140, t + 0.04); o.frequency.exponentialRampToValueAtTime(34, t + 1.3);
        const g2 = ac.createGain(); g2.gain.setValueAtTime(0.0001, t + 0.04); g2.gain.exponentialRampToValueAtTime(0.7, t + 0.09); g2.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
        o.connect(g2).connect(ac.destination); o.start(t + 0.04); o.stop(t + 1.6);
        const w = ac.createBuffer(1, ac.sampleRate * 3, ac.sampleRate), wd = w.getChannelData(0);
        for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;
        const ws = ac.createBufferSource(); ws.buffer = w;
        const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.5;
        bp.frequency.setValueAtTime(400, t + 0.1); bp.frequency.exponentialRampToValueAtTime(3200, t + 2.6);
        const g3 = ac.createGain(); g3.gain.setValueAtTime(0.0001, t + 0.1); g3.gain.exponentialRampToValueAtTime(0.16, t + 0.9); g3.gain.exponentialRampToValueAtTime(0.0001, t + 3);
        ws.connect(bp).connect(g3).connect(ac.destination); ws.start(t + 0.1);
      } catch (e) {  }
    },
  };

  let rec = null, recChunks = [];
  function toggleRec() {
    if (rec) { rec.stop(); return; }
    const stream = el.view.captureStream(30);
    const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 8e6 } : undefined);
    recChunks = [];
    rec.ondataavailable = (e) => e.data.size && recChunks.push(e.data);
    rec.onstop = () => {
      const url = URL.createObjectURL(new Blob(recChunks, { type: 'video/webm' }));
      const a = document.createElement('a'); a.href = url; a.download = 'infinity-snap-' + Date.now() + '.webm'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      rec = null; el.rec.textContent = '● Record'; el.rec.classList.remove('rec');
    };
    rec.start(); el.rec.textContent = '■ Stop & save'; el.rec.classList.add('rec');
  }

  async function boot() {
    el.start.disabled = true;
    el.gateMsg.classList.remove('err');
    el.gateMsg.textContent = 'Starting camera…';
    try {
      await startCamera();
      allocate();
      el.gateMsg.textContent = 'Loading on-device AI models…';
      await loadModels();
    } catch (e) {
      console.error(e);
      el.start.disabled = false;
      el.gateMsg.classList.add('err');
      el.gateMsg.textContent = e && e.name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow it in the address bar, then try again.'
        : 'Could not start: ' + (e && e.message || e);
      return;
    }
    el.gate.hidden = true; el.hud.hidden = false; el.dock.hidden = false;
    S.running = true; syncButtons(); say('Waiting for you…', 'Step into frame.');
    requestAnimationFrame(loop);
  }

  el.start.addEventListener('click', boot);
  el.snap.addEventListener('click', () => trigger('button'));
  el.back.addEventListener('click', () => trigger('button'));
  el.scan.addEventListener('click', () => { if (bg) { bg.reset(); stickyMask.fill(0); say('Re-learning the room…', 'Keep the camera still and step out of the way.'); statusLock = performance.now() + 2500; } });
  el.rec.addEventListener('click', toggleRec);
  el.full.addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else el.stage.requestFullscreen(); });
  el.mode.addEventListener('change', () => { if (gesture) { gesture.mode = el.mode.value; gesture.reset(); } });
  el.sens.addEventListener('input', () => { if (gesture) gesture.sensitivity = +el.sens.value; });
  el.dur.addEventListener('input', () => { S.dur = +el.dur.value * 1000; });
  el.sound.addEventListener('change', () => enableMic(el.sound.checked));
  S.dur = +el.dur.value * 1000;
  window.addEventListener('keydown', (e) => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); if (S.running) trigger('key'); }
    else if (e.key === 'f' || e.key === 'F') el.full.click();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.running) loop.last = performance.now(); });
})();
