/**
 * WorkPulse AILO Mood Detect — deteksi ngantuk & bahagia dari video call.
 *
 * Jalan SEPENUHNYA di browser (MediaPipe FaceLandmarker via WASM) — tidak
 * ada frame video atau data wajah yang dikirim ke server manapun.
 *
 * Heuristik (bukan model emosi terlatih khusus, jadi kasar):
 *  - Ngantuk: rata-rata skor blendshape "mata menutup" (eyeBlink) selama
 *    beberapa detik terakhir. Makin lama mata terlihat menutup, makin tinggi.
 *  - Bahagia: rata-rata skor blendshape "senyum" (mouthSmile).
 */
(function () {
  const MODEL_URL  = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  const VISION_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  const TICK_MS    = 500;
  const EYE_WINDOW   = 12;
  const SMILE_WINDOW = 8;

  let landmarkerPromise = null;
  const sessions = {}; // tileId -> session state

  async function getLandmarker() {
    if (!landmarkerPromise) {
      landmarkerPromise = (async () => {
        const vision = await import(/* webpackIgnore: true */ VISION_CDN + '/vision_bundle.mjs');
        const fileset = await vision.FilesetResolver.forVisionTasks(VISION_CDN + '/wasm');
        return vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          outputFaceBlendshapes: true,
          numFaces: 1,
        });
      })().catch((err) => { landmarkerPromise = null; throw err; });
    }
    return landmarkerPromise;
  }

  function ensureBadge(tile) {
    let badge = tile.querySelector('.mood-badge');
    if (badge) return badge;
    badge = document.createElement('div');
    badge.className = 'mood-badge';
    badge.innerHTML = `
      <div class="mood-row">
        <span class="mood-dot mood-dot-drowsy"></span>
        <span class="mood-label">Ngantuk</span>
        <span class="mood-pct mood-pct-drowsy">-</span>
      </div>
      <div class="mood-row">
        <span class="mood-dot mood-dot-happy"></span>
        <span class="mood-label">Bahagia</span>
        <span class="mood-pct mood-pct-happy">-</span>
      </div>`;
    tile.appendChild(badge);
    return badge;
  }

  function colorFor(kind, pct) {
    if (kind === 'drowsy') {
      if (pct >= 60) return '#EF4444';
      if (pct >= 30) return '#F59E0B';
      return '#22C55E';
    }
    if (pct >= 60) return '#22C55E';
    if (pct >= 30) return '#F59E0B';
    return '#EF4444';
  }

  function updateBadge(badge, drowsyPct, happyPct) {
    const dDot = badge.querySelector('.mood-dot-drowsy');
    const dPct = badge.querySelector('.mood-pct-drowsy');
    const hDot = badge.querySelector('.mood-dot-happy');
    const hPct = badge.querySelector('.mood-pct-happy');
    if (drowsyPct == null) { dPct.textContent = '-'; dDot.style.background = '#71717A'; }
    else { dPct.textContent = Math.round(drowsyPct) + '%'; dDot.style.background = colorFor('drowsy', drowsyPct); }
    if (happyPct == null) { hPct.textContent = '-'; hDot.style.background = '#71717A'; }
    else { hPct.textContent = Math.round(happyPct) + '%'; hDot.style.background = colorFor('happy', happyPct); }
  }

  function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

  async function start(tile, videoEl) {
    if (!tile || !videoEl || sessions[tile.id]) return;
    const badge = ensureBadge(tile);
    const session = { badge, eyeBuf: [], smileBuf: [], stopped: false, timer: null };
    sessions[tile.id] = session;

    let landmarker;
    try { landmarker = await getLandmarker(); }
    catch (err) {
      console.warn('[MoodDetect] Gagal memuat model deteksi wajah:', err);
      badge.querySelector('.mood-pct-drowsy').textContent = 'n/a';
      badge.querySelector('.mood-pct-happy').textContent = 'n/a';
      return;
    }
    if (session.stopped) return; // sudah di-stop sebelum model selesai dimuat

    const tick = () => {
      if (session.stopped) return;
      if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
        try {
          const result = landmarker.detectForVideo(videoEl, performance.now());
          const categories = result?.faceBlendshapes?.[0]?.categories;
          if (categories && categories.length) {
            const get = (name) => categories.find((c) => c.categoryName === name)?.score || 0;
            const eyeClose = (get('eyeBlinkLeft') + get('eyeBlinkRight')) / 2;
            const smile = (get('mouthSmileLeft') + get('mouthSmileRight')) / 2;

            session.eyeBuf.push(eyeClose); if (session.eyeBuf.length > EYE_WINDOW) session.eyeBuf.shift();
            session.smileBuf.push(smile); if (session.smileBuf.length > SMILE_WINDOW) session.smileBuf.shift();

            updateBadge(badge, Math.min(100, avg(session.eyeBuf) * 130), Math.min(100, avg(session.smileBuf) * 140));
          } else {
            updateBadge(badge, null, null); // wajah tidak terdeteksi
          }
        } catch (err) { /* frame dilewati, coba lagi tick berikutnya */ }
      }
      session.timer = setTimeout(tick, TICK_MS);
    };
    tick();
  }

  function stop(tileId) {
    const session = sessions[tileId];
    if (!session) return;
    session.stopped = true;
    clearTimeout(session.timer);
    session.badge?.remove();
    delete sessions[tileId];
  }

  function stopAll() {
    Object.keys(sessions).forEach(stop);
  }

  window.MoodDetect = { start, stop, stopAll };
})();
