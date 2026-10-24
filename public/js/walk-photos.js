// Walkthrough pictures (Joe 10/23): Take Picture opens the camera on a phone or tablet (a picture file on a computer). The
// picture is made smaller here, saved, and goes with the next Send Current Report; once emailed it is never sent again, and
// it is kept 30 days (functions/src/walkphotos.js).
import { saveNow, escapeHtml, shortTime } from './app.js';
import { collection, query, where, onSnapshot } from './firebase.js';

const BIG = 1600, SMALL = 240, LIMIT = 880000;

function readImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a picture this phone can open.')); };
    img.src = url;
  });
}
// The picture at most `side` pixels on its long side, as a JPEG data URL under `limit` characters.
function shrink(img, side, limit) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, k = Math.min(1, side / Math.max(w, h, 1));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
  g.drawImage(img, 0, 0, cv.width, cv.height);
  let q = 0.8, out = cv.toDataURL('image/jpeg', q);
  while (out.length > limit && q > 0.35) { q -= 0.1; out = cv.toDataURL('image/jpeg', q); }
  return { data: out, width: cv.width, height: cv.height };
}

export async function savePicture(file, fields) {
  const img = await readImage(file), big = shrink(img, BIG, LIMIT), small = shrink(img, SMALL, 50000);
  if (big.data.length > LIMIT) throw new Error('The picture is too big. Take it again.');
  return saveNow('saveWalkPhoto', Object.assign({ image: big.data, thumb: small.data, width: big.width, height: big.height }, fields || {}));
}
export const removePicture = (photoId) => saveNow('removeWalkPhoto', { photoId });

// The pictures still to be sent, oldest first.
export function watchPictures(db, done, fail) {
  return onSnapshot(query(collection(db, 'walkPhotos'), where('sentAt', '==', '')), s => {
    done(s.docs.map(d => d.data()).sort((a, b) => String(a.takenAt).localeCompare(String(b.takenAt))));
  }, fail || (() => {}));
}

// A hidden file box that opens the back camera; `chosen(file)` gets the picture.
export function cameraInput(chosen) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', 'environment'); input.hidden = true;
  input.className = 'wp-input';
  input.addEventListener('change', () => { const f = input.files && input.files[0]; input.value = ''; if (f) chosen(f); });
  document.body.appendChild(input);
  return input;
}

// Joe 10/23 (later): each picture's caption ("Cleaned the dock 4 area"), saved as it is typed and shown under it in the email.
// What is being typed is kept here, so a screen redrawn while typing keeps the words and the cursor.
const drafts = new Map(), timers = new Map();
const capOf = (p) => drafts.has(p.photoId) ? drafts.get(p.photoId) : (p.note || '');
function saveCaption(id, fail) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  if (!drafts.has(id)) return;
  const note = drafts.get(id);
  saveNow('captionWalkPhoto', { photoId: id, note }).then(() => { if (drafts.get(id) === note) drafts.delete(id); }, e => fail && fail(e));
}
// Typing in a caption box saves a moment after the typing stops, and at once when the box is left.
export function wireCaptions(root, fail) {
  root.addEventListener('input', e => {
    const box = e.target.closest && e.target.closest('.wp-cap');
    if (!box) return;
    drafts.set(box.dataset.photo, box.value);
    clearTimeout(timers.get(box.dataset.photo));
    timers.set(box.dataset.photo, setTimeout(() => saveCaption(box.dataset.photo, fail), 900));
  });
  root.addEventListener('focusout', e => { const box = e.target.closest && e.target.closest('.wp-cap'); if (box) saveCaption(box.dataset.photo, fail); });
}
// Redraws `root` with draw() and puts the cursor back in the caption box that had it.
export function keepCaretIn(root, draw) {
  const a = document.activeElement, box = a && a.classList && a.classList.contains('wp-cap') && root.contains(a) ? { id: a.dataset.photo, s: a.selectionStart, e: a.selectionEnd } : null;
  draw();
  if (!box) return;
  const again = root.querySelector('.wp-cap[data-photo="' + CSS.escape(box.id) + '"]');
  if (again) { again.focus(); try { again.setSelectionRange(box.s, box.e); } catch (err) { /* not a text box */ } }
}
const capBox = (p) => '<input type="text" class="wp-cap" maxlength="300" data-photo="' + escapeHtml(p.photoId) + '" value="' + escapeHtml(capOf(p)) + '" placeholder="Add a caption" aria-label="Caption for the picture taken ' + escapeHtml(shortTime(Date.parse(p.takenAt))) + '">';

// The pictures, oldest first: the small copy, the caption box, when it was taken and Remove (a picture not sent yet can be taken back).
export function thumbsHtml(pics, opts) {
  const o = opts || {};
  if (!pics.length) return '<p class="wp-none">' + escapeHtml(o.none || 'No pictures waiting.') + '</p>';
  return '<ul class="wp-thumbs">' + pics.map((p, i) => '<li><img src="' + escapeHtml(p.thumb || '') + '" alt="Picture taken ' + escapeHtml(shortTime(Date.parse(p.takenAt))) + '">' +
    '<div class="wp-side">' + (o.caption === false ? '' : capBox(p)) + '<div class="wp-line">' + (o.time === false ? '' : '<span>' + escapeHtml(shortTime(Date.parse(p.takenAt))) + '</span>') +
    (o.remove ? '<button type="button" class="wp-remove" data-photo="' + escapeHtml(p.photoId) + '">Remove</button>' : '') + (i === pics.length - 1 && o.after ? o.after : '') + '</div></div></li>').join('') + '</ul>';
}
