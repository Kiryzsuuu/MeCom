/**
 * WorkPulse AILO Background Segment — virtual background yang benar-benar
 * memisahkan orang dari latar belakang (bukan blur seluruh frame).
 *
 * Jalan sepenuhnya di browser (MediaPipe ImageSegmenter "selfie segmentation"
 * via WASM) — tidak ada frame video yang dikirim ke server manapun.
 */
(function () {
  const MODEL_URL  = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite';
  const VISION_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  const FRAME_MS   = 200; // ~5fps segmentasi — background relatif statis, tidak perlu lebih cepat

  let segmenterPromise = null;

  async function getSegmenter() {
    if (!segmenterPromise) {
      segmenterPromise = (async () => {
        const vision = await import(/* webpackIgnore: true */ VISION_CDN + '/vision_bundle.mjs');
        const fileset = await vision.FilesetResolver.forVisionTasks(VISION_CDN + '/wasm');
        return vision.ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        });
      })().catch((err) => { segmenterPromise = null; throw err; });
    }
    return segmenterPromise;
  }

  /**
   * Mulai proses komposit orang (tajam) + background (blur/warna/gambar) ke sebuah canvas.
   * @param {HTMLVideoElement} videoEl - sumber video mentah (kamera)
   * @param {HTMLCanvasElement} canvasEl - canvas tujuan (harus sudah diberi width/height)
   * @param {() => string} getMode - 'none' | 'blur' | 'color:#hex' | 'upload'
   * @param {() => HTMLImageElement|null} getBgImage - gambar custom untuk mode 'upload'
   */
  function createProcessor(videoEl, canvasEl, getMode, getBgImage) {
    let stopped = false;
    let timer = null;
    const ctx = canvasEl.getContext('2d');
    const personCanvas = document.createElement('canvas');
    const personCtx = personCanvas.getContext('2d');
    const maskCanvas = document.createElement('canvas');
    const maskCtx = maskCanvas.getContext('2d');

    let segmenter = null;
    getSegmenter().then((s) => { if (!stopped) segmenter = s; }).catch((err) => {
      console.warn('[BgSegment] Gagal memuat model segmentasi:', err);
    });

    function drawFrame() {
      if (stopped) return;
      const w = canvasEl.width, h = canvasEl.height;
      if (w > 0 && h > 0 && videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
        const mode = getMode();
        try {
          if (mode === 'none' || !segmenter) {
            ctx.drawImage(videoEl, 0, 0, w, h);
          } else {
            const result = segmenter.segmentForVideo(videoEl, performance.now());
            const mask = result.confidenceMasks && result.confidenceMasks[0];
            if (mask) {
              const maskArr = mask.getAsFloat32Array();
              const mw = mask.width, mh = mask.height;

              // 1) Layer background
              if (mode === 'blur') {
                ctx.filter = 'blur(16px)';
                ctx.drawImage(videoEl, 0, 0, w, h);
                ctx.filter = 'none';
              } else if (mode.indexOf('color:') === 0) {
                ctx.fillStyle = mode.slice(6);
                ctx.fillRect(0, 0, w, h);
              } else if (mode === 'upload') {
                const bgImg = getBgImage && getBgImage();
                if (bgImg && bgImg.complete) ctx.drawImage(bgImg, 0, 0, w, h);
                else { ctx.filter = 'blur(16px)'; ctx.drawImage(videoEl, 0, 0, w, h); ctx.filter = 'none'; }
              } else {
                ctx.drawImage(videoEl, 0, 0, w, h);
              }

              // 2) Layer orang (tajam), dipotong sesuai mask segmentasi
              personCanvas.width = w; personCanvas.height = h;
              personCtx.clearRect(0, 0, w, h);
              personCtx.drawImage(videoEl, 0, 0, w, h);

              maskCanvas.width = mw; maskCanvas.height = mh;
              const imgData = maskCtx.createImageData(mw, mh);
              for (let i = 0; i < maskArr.length; i++) {
                const o = i * 4;
                imgData.data[o] = 255; imgData.data[o + 1] = 255; imgData.data[o + 2] = 255;
                imgData.data[o + 3] = Math.round(maskArr[i] * 255);
              }
              maskCtx.putImageData(imgData, 0, 0);

              personCtx.globalCompositeOperation = 'destination-in';
              personCtx.drawImage(maskCanvas, 0, 0, mw, mh, 0, 0, w, h);
              personCtx.globalCompositeOperation = 'source-over';

              ctx.drawImage(personCanvas, 0, 0);
              mask.close();
            } else {
              ctx.drawImage(videoEl, 0, 0, w, h);
            }
          }
        } catch (err) {
          try { ctx.drawImage(videoEl, 0, 0, w, h); } catch (e2) {}
        }
      }
      timer = setTimeout(drawFrame, FRAME_MS);
    }
    drawFrame();

    return {
      stop() { stopped = true; if (timer) clearTimeout(timer); },
    };
  }

  window.BgSegment = { createProcessor };
})();
