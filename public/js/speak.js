/*
 * The "Speak" button on the drivers' write-up boxes (Joe 10/11, as the current app's microphone): the phone's own speech
 * recognition turns what the driver says into text, added to the end of the box. Shown only where the browser has it.
 */
const Recognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
export const canSpeak = !!Recognition;
let live = null;

function listen(box, button) {
  if (live) { const was = live; was.rec.stop(); if (was.box === box) return; }
  const rec = new Recognition(), start = box.value.trim();
  rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = false;
  live = { rec, box };
  button.classList.add('on'); button.textContent = 'Stop';
  rec.onresult = (e) => {
    const said = [...e.results].map(r => r[0].transcript).join(' ').trim();
    box.value = (start ? start + ' ' : '') + said;
    box.dispatchEvent(new Event('input', { bubbles: true }));
  };
  rec.onend = rec.onerror = () => { button.classList.remove('on'); button.textContent = 'Speak'; if (live && live.rec === rec) live = null; box.dispatchEvent(new Event('change', { bubbles: true })); };
  rec.start();
}

// Every [data-voice] box inside root gets a Speak button at its right end (once).
export function addSpeak(root) {
  if (!canSpeak || !root) return;
  root.querySelectorAll('[data-voice]').forEach(box => {
    if (box.parentNode.classList.contains('speak-box')) return;
    const wrap = document.createElement('span'), button = document.createElement('button');
    wrap.className = 'speak-box' + (box.tagName === 'TEXTAREA' ? ' area' : '');
    button.type = 'button'; button.className = 'speak'; button.textContent = 'Speak'; button.setAttribute('aria-label', 'Speak instead of typing');
    box.parentNode.insertBefore(wrap, box); wrap.appendChild(box); wrap.appendChild(button);
    button.addEventListener('click', () => { try { listen(box, button); } catch (e) { button.classList.remove('on'); button.textContent = 'Speak'; } });
  });
}
