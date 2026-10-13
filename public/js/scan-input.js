// Joe 10/13: Receiving scans two ways on the same screen, either one at any time.
//   - The Wasp scanner (or any scanner that types like a keyboard, USB or Bluetooth): it types the code and Enter. The scan box
//     takes it with no on-screen keyboard popping up (inputmode none), and a scan that arrives while nothing is being typed in
//     another box is caught too, so the person never has to tap the scan box first.
//   - The Galaxy tablet's camera: Use camera opens it full screen; Chrome on Android reads the barcode itself (BarcodeDetector).
// Both hand the same text to onScan, which reads it with scan-rules.js (UDScan.parseScan).

const FAST_MS = 60, MIN_LENGTH = 4, GS = String.fromCharCode(29);
const CAMERA_FORMATS = ['code_128', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'data_matrix', 'qr_code'];

const typing = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) && !el.hasAttribute('data-scan-box');

// A short beep (good scan) or a low buzz (not read), so the person need not look at the tablet.
export function beep(good = true) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = beep.ctx || (beep.ctx = new Ctx()), o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = good ? 1760 : 220; o.type = good ? 'sine' : 'square';
    g.gain.value = 0.15; o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + (good ? 0.09 : 0.3));
  } catch (e) { /* no sound is fine */ }
}

// box: the scan box (an <input>), optional: any box marked data-scan-box (a screen that redraws makes a new one each time)
// is a scan box. Returns a stop function.
const isBox = (el) => !!(el && el.hasAttribute && el.hasAttribute('data-scan-box'));
export function listenForScans({ box, onScan }) {
  let buffer = '', last = 0;
  const send = (raw) => { const s = String(raw || '').replace(/[\r\n]+$/, ''); if (s.trim().length >= MIN_LENGTH) onScan(s); };
  if (box) {
    box.setAttribute('data-scan-box', '');
    box.setAttribute('inputmode', 'none');
    box.setAttribute('autocomplete', 'off');
    box.setAttribute('autocapitalize', 'off');
    box.setAttribute('spellcheck', 'false');
  }
  const onKey = (e) => {
    const now = Date.now();
    // Some scanners type the GS1 separator as Ctrl+]; keep it as the real separator.
    const ch = e.ctrlKey && (e.key === ']' || e.code === 'BracketRight') ? GS : e.key.length === 1 && !e.ctrlKey && !e.metaKey ? e.key : '';
    if (isBox(e.target)) {
      const el = e.target;
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); const v = el.value; el.value = ''; send(v); }
      else if (ch === GS) { e.preventDefault(); el.value += GS; }
      return;
    }
    if (typing(e.target)) { buffer = ''; return; }
    if (now - last > FAST_MS) buffer = '';
    last = now;
    if (e.key === 'Enter' || e.key === 'Tab') {
      // stopPropagation: the Enter that ends a scan must not also press whatever has the focus (a card's header).
      if (buffer.length >= MIN_LENGTH) { e.preventDefault(); e.stopPropagation(); send(buffer); }
      buffer = '';
    } else if (ch) buffer += ch;
  };
  document.addEventListener('keydown', onKey, true);
  return () => document.removeEventListener('keydown', onKey, true);
}

export const cameraReads = () => 'BarcodeDetector' in window && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

// The camera, full screen, until one barcode is read or Close is tapped. Resolves with the text read, or '' when closed.
export async function scanWithCamera() {
  if (!cameraReads()) throw new Error('This tablet\'s browser cannot read barcodes with the camera. Use the scanner.');
  const supported = await window.BarcodeDetector.getSupportedFormats().catch(() => CAMERA_FORMATS);
  const detector = new window.BarcodeDetector({ formats: CAMERA_FORMATS.filter(f => supported.indexOf(f) >= 0) });
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
  const layer = document.createElement('div');
  layer.className = 'scan-camera';
  layer.innerHTML = '<video playsinline muted></video><div class="scan-camera-aim"></div>' +
    '<p class="scan-camera-tip">Point the camera at the barcode</p><button type="button" class="scan-camera-close">Close</button>';
  document.body.appendChild(layer);
  const video = layer.querySelector('video');
  video.srcObject = stream;
  await video.play().catch(() => {});
  return new Promise(resolve => {
    let done = false, timer = 0;
    const finish = (value) => {
      if (done) return;
      done = true; clearTimeout(timer);
      stream.getTracks().forEach(t => t.stop());
      layer.remove();
      resolve(value);
    };
    layer.querySelector('.scan-camera-close').addEventListener('click', () => finish(''));
    const look = async () => {
      if (done) return;
      try {
        const found = await detector.detect(video);
        if (found && found.length && found[0].rawValue) { finish(found[0].rawValue); return; }
      } catch (e) { /* the next frame */ }
      timer = setTimeout(look, 150);
    };
    look();
  });
}
