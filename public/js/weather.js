// The Driver Room weather window (Joe 10/10): Open-Meteo's free forecast (no key), read by the board itself every 15 minutes.
// The old Driver Room screen kept a place for it but was never connected to a weather source.
export const PLANTS = { Uniontown: { lat: 40.9748, lon: -81.4082, place: 'Uniontown, OH' } };

const WMO = [
  [[0], 'Clear', '☀', 'sun'], [[1], 'Mostly clear', '\u{1F324}', 'suncloud'], [[2], 'Partly cloudy', '⛅', 'suncloud'], [[3], 'Cloudy', '☁', 'cloud'],
  [[45, 48], 'Fog', '\u{1F32B}', 'fog'], [[51, 53, 55, 56, 57], 'Drizzle', '\u{1F326}', 'rain'], [[61, 63, 65, 66, 67, 80, 81, 82], 'Rain', '\u{1F327}', 'rain'],
  [[71, 73, 75, 77, 85, 86], 'Snow', '❄', 'snow'], [[95, 96, 99], 'Thunderstorms', '⛈', 'storm']
];
export function describe(code) {
  const hit = WMO.find(([codes]) => codes.indexOf(Number(code)) >= 0);
  return hit ? { text: hit[1], symbol: hit[2], icon: hit[3] } : { text: 'Weather', symbol: '☀', icon: 'sun' };
}

// Joe 10/27 (Raspberry Pi): a screen with no picture-letter font showed an empty box for the weather sign, so the window
// draws its own (white lines, any screen).
const SUN = '<circle cx="20" cy="20" r="7"/><path d="M20 5v4M20 31v4M5 20h4M31 20h4M9.4 9.4l2.8 2.8M27.8 27.8l2.8 2.8M9.4 30.6l2.8-2.8M27.8 12.2l2.8-2.8"/>';
const CLOUD = '<path d="M14 40h24a8 8 0 0 0 0-16 11 11 0 0 0-21-3 9 9 0 0 0-3 19z"/>';
const UP = '<g transform="translate(0 -8)">' + CLOUD + '</g>';
const ICONS = {
  sun: '<g transform="translate(8 8)">' + SUN + '</g>',
  suncloud: '<g transform="translate(-2 -4) scale(.8)">' + SUN + '</g>' + CLOUD,
  cloud: CLOUD,
  fog: '<path d="M8 22h40M12 30h36M8 38h32M14 46h28"/>',
  rain: UP + '<path d="M20 40l-2 7M30 40l-2 7M40 40l-2 7"/>',
  snow: UP + '<path d="M20 43h.1M30 43h.1M40 43h.1M25 50h.1M35 50h.1" stroke-width="4"/>',
  storm: UP + '<path d="M31 37l-5 8h7l-4 8"/>'
};
export function iconSvg(name) {
  return '<svg viewBox="0 0 56 56" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.sun) + '</svg>';
}

export function forecastUrl(p) {
  return 'https://api.open-meteo.com/v1/forecast?latitude=' + p.lat + '&longitude=' + p.lon +
    '&current=temperature_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FNew_York&forecast_days=2';
}

// Open-Meteo's answer -> what the window shows: now, today's high/low, rain chance and wind, and tomorrow.
export function summary(data) {
  const c = data && data.current, d = data && data.daily;
  if (!c || !d || !Array.isArray(d.temperature_2m_max)) return null;
  const r = (n) => n === null || n === undefined || n === '' ? '—' : Math.round(Number(n));
  const now = describe(c.weather_code), tomorrow = d.weather_code && d.weather_code.length > 1 ? describe(d.weather_code[1]) : null;
  return {
    symbol: now.symbol,
    icon: now.icon,
    now: r(c.temperature_2m) + '°F · ' + now.text,
    today: 'High ' + r(d.temperature_2m_max[0]) + '° · Low ' + r(d.temperature_2m_min[0]) + '° · Rain ' + r((d.precipitation_probability_max || [])[0]) + '% · Wind ' + r(c.wind_speed_10m) + ' mph',
    tomorrow: tomorrow ? 'Tomorrow: ' + tomorrow.text + ', ' + r(d.temperature_2m_max[1]) + '° / ' + r(d.temperature_2m_min[1]) + '°' : ''
  };
}
