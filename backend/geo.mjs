// Location search for the Site page: place-name geocoding + real annual
// rainfall, via Open-Meteo's free no-key APIs, proxied here so the browser
// has one origin and results get cached for the session.

const searchCache = new Map();
const rainCache = new Map();

const US_STATES = {
  al: 'Alabama', ak: 'Alaska', az: 'Arizona', ar: 'Arkansas', ca: 'California', co: 'Colorado',
  ct: 'Connecticut', de: 'Delaware', fl: 'Florida', ga: 'Georgia', hi: 'Hawaii', id: 'Idaho',
  il: 'Illinois', in: 'Indiana', ia: 'Iowa', ks: 'Kansas', ky: 'Kentucky', la: 'Louisiana',
  me: 'Maine', md: 'Maryland', ma: 'Massachusetts', mi: 'Michigan', mn: 'Minnesota',
  ms: 'Mississippi', mo: 'Missouri', mt: 'Montana', ne: 'Nebraska', nv: 'Nevada',
  nh: 'New Hampshire', nj: 'New Jersey', nm: 'New Mexico', ny: 'New York', nc: 'North Carolina',
  nd: 'North Dakota', oh: 'Ohio', ok: 'Oklahoma', or: 'Oregon', pa: 'Pennsylvania',
  ri: 'Rhode Island', sc: 'South Carolina', sd: 'South Dakota', tn: 'Tennessee', tx: 'Texas',
  ut: 'Utah', vt: 'Vermont', va: 'Virginia', wa: 'Washington', wv: 'West Virginia',
  wi: 'Wisconsin', wy: 'Wyoming'
};

async function rawSearch(name) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=8&language=en&format=json`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Geocoder replied ${response.status}`);
  const data = await response.json();
  return (data.results || []).map((item) => ({
    name: item.name,
    admin1: item.admin1 || '',
    country: item.country || '',
    latitude: item.latitude,
    longitude: item.longitude
  }));
}

// The geocoder matches bare place names only — "corning ny" returns nothing.
// So on a miss, peel trailing tokens off as a region hint ("ny" -> New York,
// "north carolina" as-is) and filter the bare-name results by that hint.
export async function geoSearch(query) {
  const key = query.trim().toLowerCase();
  if (searchCache.has(key)) return searchCache.get(key);
  let results = await rawSearch(query);
  if (!results.length) {
    const words = query.trim().split(/[\s,]+/).filter(Boolean);
    for (const hintLength of [1, 2]) {
      if (words.length <= hintLength) break;
      const base = words.slice(0, -hintLength).join(' ');
      const hintRaw = words.slice(-hintLength).join(' ').toLowerCase();
      const hint = (hintLength === 1 && US_STATES[hintRaw]) ? US_STATES[hintRaw].toLowerCase() : hintRaw;
      const candidates = await rawSearch(base);
      if (!candidates.length) continue;
      const filtered = candidates.filter((item) =>
        item.admin1.toLowerCase().startsWith(hint) || item.country.toLowerCase().startsWith(hint));
      results = filtered.length ? filtered : candidates;
      break;
    }
  }
  searchCache.set(key, results.slice(0, 6));
  return results.slice(0, 6);
}

export async function annualRainInches(latitude, longitude) {
  const key = `${Number(latitude).toFixed(2)},${Number(longitude).toFixed(2)}`;
  if (rainCache.has(key)) return rainCache.get(key);
  // Sum daily precipitation over the last complete calendar year.
  const year = new Date().getFullYear() - 1;
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${latitude}&longitude=${longitude}`
    + `&start_date=${year}-01-01&end_date=${year}-12-31&daily=precipitation_sum&precipitation_unit=inch&timezone=UTC`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Climate archive replied ${response.status}`);
  const data = await response.json();
  const total = (data.daily?.precipitation_sum || []).reduce((sum, value) => sum + (value || 0), 0);
  const inches = Math.round(total);
  rainCache.set(key, inches);
  return inches;
}
