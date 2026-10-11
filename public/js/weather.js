// The Driver Room weather window (Joe 10/10): Open-Meteo's free forecast (no key), read by the board itself every 15 minutes.
// The old Driver Room screen kept a place for it but was never connected to a weather source.
export const PLANTS = { Uniontown: { lat: 40.9748, lon: -81.4082, place: 'Uniontown, OH' } };

const WMO = [
  [[0], 'Clear', '☀'], [[1], 'Mostly clear', '\u{1F324}'], [[2], 'Partly cloudy', '⛅'], [[3], 'Cloudy', '☁'],
  [[45, 48], 'Fog', '\u{1F32B}'], [[51, 53, 55, 56, 57], 'Drizzle', '\u{1F326}'], [[61, 63, 65, 66, 67, 80, 81, 82], 'Rain', '\u{1F327}'],
  [[71, 73, 75, 77, 85, 86], 'Snow', '❄'], [[95, 96, 99], 'Thunderstorms', '⛈']
];
export function describe(code) {
  const hit = WMO.find(([codes]) => codes.indexOf(Number(code)) >= 0);
  return hit ? { text: hit[1], symbol: hit[2] } : { text: 'Weather', symbol: '☀' };
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
    now: r(c.temperature_2m) + '°F · ' + now.text,
    today: 'High ' + r(d.temperature_2m_max[0]) + '° · Low ' + r(d.temperature_2m_min[0]) + '° · Rain ' + r((d.precipitation_probability_max || [])[0]) + '% · Wind ' + r(c.wind_speed_10m) + ' mph',
    tomorrow: tomorrow ? 'Tomorrow: ' + tomorrow.text + ', ' + r(d.temperature_2m_max[1]) + '° / ' + r(d.temperature_2m_min[1]) + '°' : ''
  };
}
