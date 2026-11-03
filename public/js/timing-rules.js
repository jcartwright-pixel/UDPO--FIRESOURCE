/*
 * The Operations app's timing rules, all in one place (Joe 11-2-26 and 11-3-26: "Everything centralized goes to one location
 * instead of random bits of code scattered throughout the program"). Every screen, email and server job reads its times here.
 *
 *   A. The clock: the plant's time zone, the 6:00 AM day change, the plant's wall clock, reading a typed time ("430p" is
 *      4:30 PM), writing a time ("4:30 PM") and a length of time ("1 hr 12 min").
 *   B. When a truck leaves: Load Day / Delivery Day, the next-morning rule for a Load Day time before 6 AM, the
 *      Saturday-for-Monday rule, and a blank Load Day (1 day before delivery).
 *   C. On time, early and late (Joe 11-2-26, items 1 and 2): one rule for every place, green within 30 minutes either side of
 *      the leaving time, yellow from 30 to 60 minutes, red past 60 minutes late or early. Each place (the plant, the sales
 *      status, the Driver Scorecard) has its own small settings in SOURCES so its numbers can be tuned here.
 *   D. The other timers, each named once in TIMERS (walk-through checks, yard check lock, "Entered later", and so on).
 *
 * The Late Forecast's own settings (loading speeds, the history build-up) stay in plant-rules.js FORECAST (Joe 11-2-26, item 6).
 *
 * Plain JavaScript with no imports, so it runs in Node (require) and in the browser (window.UDTiming). The browser copy,
 * public/js/timing-rules.js, is written by `npm run sync-logic`; a test fails if the two differ, and
 * functions/test/unit/timing-rules.test.js fails when another file keeps its own copy of one of these rules.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UDTiming = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- A. The clock ---------- */

  var TIME_ZONE = 'America/New_York';
  // The plant's day changes at 6:00 AM: at 5:59 AM it is still yesterday's shift.
  var DAY_ROLL_HOUR = 6;
  var DAY_ROLL = DAY_ROLL_HOUR * 60;
  var DAY = 1440;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function text(v) { return v === null || v === undefined ? '' : String(v).trim(); }

  // yyyy-mm-dd as a day number (days since 1/1/1970), and back.
  function dayNum(key) { var p = String(key || '').split('-').map(Number); return p.length === 3 && p.every(isFinite) && p[0] ? Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000) : null; }
  function dayKey(n) { return new Date(n * 86400000).toISOString().slice(0, 10); }

  function zoneParts(ms) {
    var parts = {};
    new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(ms)).forEach(function (p) { parts[p.type] = p.value; });
    return parts;
  }
  // The plant's wall clock (New York) as minutes counted from 1/1/1970.
  function wallClock(ms) {
    var p = zoneParts(ms === undefined ? Date.now() : ms);
    return dayNum(p.year + '-' + p.month + '-' + p.day) * DAY + Number(p.hour) % 24 * 60 + Number(p.minute);
  }
  // The minute of the day (0 to 1439) on the plant's clock.
  function minuteOfDay(ms) { return ((wallClock(ms) % DAY) + DAY) % DAY; }
  // The calendar day in New York (no 6 AM change), yyyy-mm-dd.
  function calendarDay(ms) { var p = zoneParts(ms === undefined ? Date.now() : (ms instanceof Date ? ms.getTime() : ms)); return p.year + '-' + p.month + '-' + p.day; }
  // The operating day (the 6 AM day change) a wall minute falls in, as a day number, and the 6 AM it ends at.
  function opDayOfWall(wall) { return Math.floor((wall - DAY_ROLL) / DAY); }
  function dayStartWall(n) { return n * DAY + DAY_ROLL; }
  function shiftEndAfter(wall) { return dayStartWall(opDayOfWall(wall) + 1); }
  // The plant's operating day for a time (a Date, ms, or now): at 5:59 AM it is still yesterday.
  function operatingDay(now) { return dayKey(opDayOfWall(wallClock(now === undefined || now === null ? Date.now() : (now instanceof Date ? now.getTime() : now)))); }

  // A saved time as the plant's wall clock. The app writes UTC stamps; the sheet writes plant time ("10/8/2026 4:30 PM").
  function wallMinutes(v) {
    var s = text(v), m, d, h;
    if (!s) return null;
    if (/(Z|[+-]\d{2}:?\d{2})$/i.test(s) && /\d{4}-\d{2}-\d{2}T/.test(s)) { var t = Date.parse(s); return isFinite(t) ? wallClock(t) : null; }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/);
    if (m) { d = dayNum(m[1] + '-' + m[2] + '-' + m[3]); h = Number(m[4]); return d === null ? null : d * DAY + h * 60 + Number(m[5]); }
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T]+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)?/i);
    if (!m) return null;
    d = dayNum(m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2)); h = Number(m[4]);
    var ap = String(m[6] || '').toUpperCase();
    if (ap) { if (h === 12) h = 0; if (ap === 'PM') h += 12; }
    return d === null ? null : d * DAY + h * 60 + Number(m[5]);
  }

  // A stored time as minutes after midnight: 4:00:00 AM, 16:30, 4:30 PM, a fraction of a day (the sheet), or minutes already.
  // Returns null when it is not a time.
  function clockMinutes(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return !isFinite(value) ? null : value >= 0 && value < 1 ? Math.round(value * DAY) % DAY : value;
    var m = String(value).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp])\.?\s*([Mm])?\.?$/) || String(value).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return null;
    var h = +m[1], min = +m[2], ap = (m[4] || '').toUpperCase();
    if (min > 59 || h > 23 || (ap && (h < 1 || h > 12))) return null;
    if (ap === 'P' && h < 12) h += 12;
    if (ap === 'A' && h === 12) h = 0;
    return h * 60 + min;
  }

  // The one time fixer (Joe 11-3-26: "no matter what you type in … it also spits out the exact format that we have throughout
  // the whole system"). A time typed the way people type it: 5, 530, 0530, 5:30, 5a, 5p, 430p, 4:30 p, 5:30pm, 5:30 p.m., 17:30,
  // 1730, 4:00:00 AM. Returns minutes after midnight, or null when it is not a time. With no AM / PM and an hour from 1 to 12
  // it is AM, unless the box held a PM time (wasMinutes, minutes after midnight) - then it stays PM.
  function typedTime(typed, wasMinutes) {
    var t = String(typed == null ? '' : typed).trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, '');
    var m = t.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?(a|p|am|pm)?$/) || t.match(/^(\d{1,2})(\d{2})(a|p|am|pm)?$/);
    if (!m) return null;
    var h = +m[1], min = m[2] === undefined ? 0 : +m[2], ap = m[3] ? m[3].charAt(0) : '';
    if (min > 59 || h > 23) return null;
    if (ap) {
      if (h < 1 || h > 12) return null;
      return (h % 12 + (ap === 'p' ? 12 : 0)) * 60 + min;
    }
    if (h === 0 || h > 12 || /^0\d/.test(t)) return h * 60 + min;
    var pm = typeof wasMinutes === 'number' && wasMinutes >= 720;
    return (h % 12 + (pm ? 12 : 0)) * 60 + min;
  }

  // The one way a time is shown: 4:30 PM. Minutes after midnight (a wall minute works too).
  function timeText(minutes) {
    if (minutes === null || minutes === undefined || minutes === '' || !isFinite(Number(minutes))) return '';
    var t = ((Math.round(Number(minutes)) % DAY) + DAY) % DAY, h = Math.floor(t / 60), m = t % 60;
    return ((h % 12) || 12) + ':' + pad(m) + ' ' + (h >= 12 ? 'PM' : 'AM');
  }
  // A saved moment (ms, a Date or ISO text) as its time on the plant's clock: 4:30 PM ('' when it is not a time).
  function clockOf(v) { var t = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v || ''); return v === null || v === undefined || v === '' || !isFinite(t) ? '' : timeText(minuteOfDay(t)); }
  // "16:30" (what a stored HH:MM time looks like) from minutes, and the minutes from it.
  function hhmm(minutes) { if (minutes === null || minutes === undefined || minutes === '') return ''; var t = ((Math.round(Number(minutes)) % DAY) + DAY) % DAY; return pad(Math.floor(t / 60)) + ':' + pad(t % 60); }

  // The one way a length of time is written (Joe 11-3-26, item 5): 35 min, 1 hr, 1 hr 12 min; past a day 1 day 2 hr, 3 days
  // (Joe 10/11, polish 5: "2 days 7 h" instead of "55 h 51").
  function spanText(minutes) {
    var m = Math.max(0, Math.round(Math.abs(Number(minutes) || 0))), d = Math.floor(m / DAY), h = Math.floor((m % DAY) / 60), r = m % 60;
    if (d) return d + (d === 1 ? ' day' : ' days') + (h ? ' ' + h + ' hr' : '');
    return h ? h + ' hr' + (r ? ' ' + r + ' min' : '') : r + ' min';
  }
  // The same from milliseconds or seconds.
  function spanTextMs(ms) { return spanText((Number(ms) || 0) / 60000); }

  /* ---------- B. When a truck leaves ---------- */

  // A blank Load Day is 1 day before delivery (offset -1). Offsets run 0 to -6.
  var DEFAULT_LOAD_DAY_OFFSET = -1;
  function loadDayOffset(v) {
    if (v === null || v === undefined || v === '') return DEFAULT_LOAD_DAY_OFFSET;
    var n = Number(v);
    return isFinite(n) ? Math.max(-6, Math.min(0, Math.round(n))) : DEFAULT_LOAD_DAY_OFFSET;
  }

  function leavesOnOf(v) { var s = text(v).toUpperCase(); return /LOAD/.test(s) ? 'LOAD DAY' : /DELIVER/.test(s) ? 'DELIVERY DAY' : ''; }
  // When a route leaves, as a wall minute, or null with no time (audit batch 1, Joe 10/22: every screen agrees). Joe 10/22
  // (desktopRouteConfigRunDaySettingsV0321_ LOAD_DAY_SAME_TIME / DELIVERY_DAY_SAME_TIME): the route's Departure Day (Route Master
  // departure_day) picks the date, Load Day = the load date (Tuesday's Jersey, -1, leaves Monday), Delivery Day = the delivery
  // date, at the dispatch time on that date. Only a run copied before the runs carried it keeps the 6 a.m. guess.
  // x: { departureDate, deliveryDate, loadDate, leavesOn, dispatchTime (or departureTime), minutes after midnight }.
  function departWall(x) {
    var departDay = dayNum(x.departureDate || x.deliveryDate || x.loadDate), t = x.departureTime !== undefined ? x.departureTime : x.dispatchTime, load = dayNum(x.loadDate), on = leavesOnOf(x.leavesOn);
    if (departDay === null || t === null || t === undefined || t === '' || !isFinite(Number(t))) return null;
    t = Number(t);
    // Joe 10/21 (Sun Valley 849, Load Day at 4:00 AM): a Load Day time before the 6 a.m. day change is the end of that load
    // day's shift, the next morning (it cannot leave before the shift that loads it has started).
    // Joe 10/31 ("this is Saturday loadout for Monday deliveries ... not leaving until Sunday"; "it's delivery day minus the
    // offset"): a load built early (Monday's loads on Saturday, Load Day 2 days before) still leaves the day before its delivery
    // at its time, never on the early load day, so a Monday Jersey loaded Saturday is not late until Sunday at 1:00 PM.
    var delivery = dayNum(x.deliveryDate), leaveDay = load === null ? departDay : delivery !== null && load < delivery - 1 ? delivery - 1 : load;
    if (on === 'LOAD DAY') return (leaveDay + (t < DAY_ROLL ? 1 : 0)) * DAY + t;
    if (on === 'DELIVERY DAY') return departDay * DAY + t;
    return (load !== null && load < departDay && t >= DAY_ROLL ? departDay - 1 : departDay) * DAY + t;
  }

  /* ---------- C. On time, early and late ---------- */

  // Joe 11-2-26 ("the route can start 1/2 hour before or 1/2 hour after … cautious yellow. Anything within an hour … late, or in
  // some cases extremely early departing"; "Item number two is a yes"): minutes from the leaving time, either way.
  //   green  within onTime minutes before or after
  //   yellow onTime to caution minutes early or late
  //   red    more than caution minutes late, or more than caution minutes early ("extremely early")
  // Each place has its own settings. early: false = leaving (or loading) early never counts there.
  var WINDOWS = { onTime: 30, caution: 60 };
  var SOURCES = {
    // Loadout, Manager Center, the plant area page, the shift report email, "Loaded late", the Late Forecast and Reports:
    // a load not loaded yet (now against the leaving time), a load's finish, or its estimated finish. Loading early is fine.
    plant: { onTime: WINDOWS.onTime, caution: WINDOWS.caution, early: false },
    // The sales email and the sales app's Route Status: when the truck really left (GPS).
    sales: { onTime: WINDOWS.onTime, caution: WINDOWS.caution, early: true },
    // The Driver Scorecard's time grade: leaving the yard early costs a point past onTime (Joe 11-2-26: 15 minutes early is
    // green), and back at the yard more than backLate minutes past the expected return costs one.
    scorecard: { onTime: WINDOWS.onTime, caution: WINDOWS.caution, early: true, backLate: 30, backEarly: 15 }
  };
  function sourceOf(name) { return SOURCES[name] || SOURCES.plant; }

  // How a time stands against its leaving time. minutes = minutes after the leaving time (negative = before it).
  // Returns { tone: 'ok' | 'caution' | 'late', color: 'green' | 'yellow' | 'red', early, late (true past the on-time window),
  // minutes, words } or null with no time. words: "On time", "40 min late", "1 hr 20 min early".
  function departTiming(minutes, source) {
    if (minutes === null || minutes === undefined || !isFinite(Number(minutes))) return null;
    var s = sourceOf(source), m = Math.round(Number(minutes)), early = m < 0, off = Math.abs(m);
    if (early && !s.early) off = 0;
    var tone = off <= s.onTime ? 'ok' : off <= s.caution ? 'caution' : 'late';
    return {
      tone: tone, color: tone === 'ok' ? 'green' : tone === 'caution' ? 'yellow' : 'red', early: early && tone !== 'ok', late: !early && tone !== 'ok',
      minutes: m, words: tone === 'ok' ? 'On time' : spanText(off) + (early ? ' early' : ' late')
    };
  }
  // Past the on-time window after the leaving time (yellow or red): a load not loaded by then is late.
  function pastOnTime(minutes, source) { var t = departTiming(minutes, source); return !!t && t.late; }
  // The worse of two tones (red over yellow over green).
  function worseTone(a, b) { var r = { ok: 0, caution: 1, late: 2 }; return (r[b] || 0) > (r[a] || 0) ? b : a || 'ok'; }

  /* ---------- D. The other timers (Joe 11-2-26, item 7: listed once, each with its own number) ---------- */

  var TIMERS = {
    walkEveryMinutes: 120,        // Manager Center walk-through: each check is due every 2 hours ...
    walkLateMinutes: 60,          // ... and past due 1 hour after that
    yardLockMinutes: 120,         // a checked trailer leaves the Active Yard Queue for 2 hours
    typedLaterMinutes: 5,         // Reports: a time saved more than 5 minutes from the time it says shows "Entered later"
    textsDoneHours: 12,           // a load-done text is sent only within 12 hours of the load
    gpsNearDispatchMinutes: 240,  // Scorecard: a yard leave more than 4 hours from dispatch is another trip's
    gpsReturnMaxMinutes: 360,     // Scorecard: a return more than 6 hours past expected is the truck's next trip
    gpsTripWindowHours: 6         // GPS trip fuel: trips are read in 6-hour pieces
  };

  /* ---------- E. Time boxes (Joe 11-3-26, item 5: "no matter what you type in … the exact format we have throughout") ---------- */

  // Every box a time is typed into is a plain text box marked data-time (not the device's own clock box, which looks and works
  // differently on a phone, a tablet and a laptop). Whatever is typed ("430p", "4:30 p", "1730") turns into "4:30 PM" when the
  // box is left; a box that is not a time is marked red. Times are still saved as HH:MM ("16:30").
  function hhmmOf(typed) { var m = typedTime(typed); return m === null ? '' : hhmm(m); }
  function boxText(v) { var m = typeof v === 'number' ? v : clockMinutes(text(v)); return m === null || m === undefined || text(v) === '' ? '' : timeText(m); }
  function nowBoxText() { return timeText(minuteOfDay(Date.now())); }
  if (typeof document !== 'undefined' && document.addEventListener) {
    var fixBox = function (e) {
      var el = e.target;
      if (!el || !el.matches || !el.matches('input[data-time]')) return;
      var v = text(el.value), m = v ? typedTime(v) : null;
      if (!v) { el.classList.remove('bad-time'); el.removeAttribute('aria-invalid'); return; }
      if (m === null) { el.classList.add('bad-time'); el.setAttribute('aria-invalid', 'true'); el.title = 'Type a time like 4:30 PM'; return; }
      el.classList.remove('bad-time'); el.removeAttribute('aria-invalid'); el.title = '';
      el.value = timeText(m);
    };
    // Capture, so the box reads "4:30 PM" before the screen's own change handler reads it.
    document.addEventListener('change', fixBox, true);
    document.addEventListener('focusout', fixBox, true);
  }

  return {
    hhmmOf: hhmmOf, boxText: boxText, nowBoxText: nowBoxText,
    TIME_ZONE: TIME_ZONE, DAY_ROLL_HOUR: DAY_ROLL_HOUR, DAY_ROLL: DAY_ROLL, DAY: DAY,
    dayNum: dayNum, dayKey: dayKey, wallClock: wallClock, minuteOfDay: minuteOfDay, calendarDay: calendarDay, opDayOfWall: opDayOfWall, dayStartWall: dayStartWall,
    shiftEndAfter: shiftEndAfter, operatingDay: operatingDay, wallMinutes: wallMinutes, clockMinutes: clockMinutes, typedTime: typedTime, timeText: timeText, clockOf: clockOf, hhmm: hhmm,
    spanText: spanText, spanTextMs: spanTextMs,
    DEFAULT_LOAD_DAY_OFFSET: DEFAULT_LOAD_DAY_OFFSET, loadDayOffset: loadDayOffset, leavesOnOf: leavesOnOf, departWall: departWall,
    WINDOWS: WINDOWS, SOURCES: SOURCES, departTiming: departTiming, pastOnTime: pastOnTime, worseTone: worseTone,
    TIMERS: TIMERS
  };
});
