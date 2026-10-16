// Send to TV (Joe 10/16: "send to the TV my driver's kiosk station" with nothing typed on the TV). His Vizio has no web
// browser, only Chromecast built in, so Chrome on a PC or Android phone casts our own Cast receiver to it: the TV opens
// driver-station.html?tv=1&cast=1 and runs the Driver's Kiosk Station by itself. The PC or phone can close after sending.
// Turning the TV off ends it; Send to TV again the next time it is turned on.
import { callServer } from './app.js';

export const CAST_NS = 'urn:x-cast:com.uniteddairy.tv';
const SENDER = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
const stationCall = (op, f) => callServer('stationRelease', Object.assign({ op }, f));

let loading = null;
// The Google Cast sender library; false where the browser cannot cast (Safari, Firefox, iPhone).
function castReady() {
  if (loading) return loading;
  loading = new Promise(resolve => {
    if (!/Chrome\//.test(navigator.userAgent) || /CriOS|EdgiOS/.test(navigator.userAgent)) { resolve(false); return; }
    const done = setTimeout(() => resolve(false), 15000);
    window.__onGCastApiAvailable = (ok) => { clearTimeout(done); resolve(!!ok && !!(window.cast && window.cast.framework)); };
    const s = document.createElement('script'); s.src = SENDER; s.onerror = () => { clearTimeout(done); resolve(false); };
    document.head.appendChild(s);
  });
  return loading;
}

// The TVs to send to and the Cast App ID ('' until Joe registers it in Administration > Driver Station Codes).
export const tvList = () => stationCall('tvList', {});

// Casts the receiver to the TV the person picks in Chrome's list, then signs it in as that Driver's Kiosk Station.
// Returns the message to show.
export async function sendToTv(station, castAppId) {
  if (!castAppId) throw new Error('Send to TV is not set up yet: Administration > Driver Station Codes needs the Cast App ID.');
  if (!(await castReady())) throw new Error('Send to TV works in Google Chrome on a PC or an Android phone. Open this page in Chrome and try again.');
  const ctx = window.cast.framework.CastContext.getInstance();
  ctx.setOptions({ receiverApplicationId: castAppId, autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED });
  // Chrome shows its own list of TVs here; picking none ends with "cancel".
  const err = await ctx.requestSession().catch(e => e || 'error');
  if (err) {
    if (String(err) === 'cancel') return '';
    throw new Error(String(err) === 'receiver_unavailable' ? 'No TV found. The PC or phone must be on the same Wi-Fi as the TV, and the TV must be on.' : 'The TV did not open the Driver\'s Kiosk Station (' + err + '). Try Send to TV again.');
  }
  const out = await stationCall('tvSend', { key: station.key });
  if (!out.ok) throw new Error(out.message || 'Could not send to the TV.');
  const session = ctx.getCurrentSession();
  await session.sendMessage(CAST_NS, { token: out.token, station: out.station });
  return 'Sent. ' + (session.getCastDevice().friendlyName || 'The TV') + ' is showing the ' + out.station.name + '. You can close this page or turn this computer off; the TV keeps running it until it is turned off.';
}
