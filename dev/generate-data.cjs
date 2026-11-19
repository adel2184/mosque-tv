#!/usr/bin/env node
'use strict';
/** Development only. No npm, network or Python is needed: dependencies are vendored.
 * Use: node dev/generate-data.cjs --year 2026 --lat 26.4207 --lon 50.0888
 * Adhan expects Gregorian date components in its Date argument; pin its development
 * process timezone to UTC, then format its absolute results at explicit UTC+03:00.
 */
process.env.TZ = 'UTC';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const adhan = require('./vendor/adhan/adhan.umd.cjs');
const DAY = 86400000;
const args = process.argv.slice(2);
function option(name, fallback) {
  const i = args.indexOf('--' + name);
  return i < 0 ? fallback : Number(args[i + 1]);
}
const year = option('year', 2026);
const latitude = option('lat', 26.4207);
const longitude = option('lon', 50.0888);
if (!Number.isInteger(year) || year < 1925 || year > 2075 || !Number.isFinite(latitude) || latitude < -60 || latitude > 60 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
  throw Error('Invalid --year / --lat / --lon. Calendar supports full years 1925–2076; latitude must be within ±60°.');
}
if (new Date(Date.UTC(2026, 0, 1)).getTimezoneOffset() !== 0) throw Error('This Node runtime did not honor TZ=UTC. Run generator with a UTC process timezone.');
const key = ms => new Date(ms).toISOString().slice(0, 10);
const stamp = text => Date.parse(text + 'T00:00:00Z');
const pyPath = path.join(__dirname, 'vendor/hijridate/ummalqura.py');
const py = fs.readFileSync(pyPath, 'utf8');
const block = py.match(/MONTH_STARTS[^=]*=\s*\(([\s\S]*?)\)/);
if (!block) throw Error('Cannot find source month-start table.');
const reducedJulianDays = block[1].match(/\d+/g).map(Number);
if (reducedJulianDays.length !== 1897 || reducedJulianDays[0] !== 23999) throw Error('Unexpected HijriDate 2.6.0 source data.');
const allMonths = reducedJulianDays.map((rjd, i) => ({
  start: key((rjd + 2400000 - 2440588) * DAY),
  year: 1343 + Math.floor(i / 12),
  month: i % 12 + 1
}));
const firstRequired = `${year - 1}-12-31`;
const lastRequired = `${year + 2}-01-01`;
let firstMonth = 0;
while (firstMonth + 1 < allMonths.length && allMonths[firstMonth + 1].start <= firstRequired) firstMonth++;
const finalSentinel = allMonths.findIndex(m => m.start > lastRequired);
if (finalSentinel < 0) throw Error('Calendar has no final boundary sentinel.');
const months = allMonths.slice(firstMonth, finalSentinel + 1);
const calendar = {
  schemaVersion: 1,
  calendar: 'islamic-umalqura',
  source: 'HijriDate 2.6.0 by Mohammed Alshehri, ummalqura.py MONTH_STARTS (MIT)',
  sourceUrl: 'https://github.com/dralshehri/hijridate/blob/v2.6.0/src/hijridate/ummalqura.py',
  sourceDocumentation: 'https://hijridate.readthedocs.io/en/stable/background.html',
  sourceSHA256: crypto.createHash('sha256').update(py).digest('hex'),
  license: 'MIT — licenses/hijridate-MIT.txt',
  convention: 'Saudi civil Umm al-Qura calendar; date changes at midnight Asia/Riyadh, not sunset.',
  sourceFullRange: ['1924-08-01', '2077-11-16'],
  rangeStart: months[0].start,
  rangeEnd: key(stamp(months[months.length - 1].start) - DAY),
  months
};
function hijri(date) {
  if (date < calendar.rangeStart || date > calendar.rangeEnd) throw Error('Date outside source Umm al-Qura coverage: ' + date);
  let lo = 0, hi = months.length - 1;
  while (lo + 1 < hi) { const mid = Math.floor((lo + hi) / 2); if (months[mid].start <= date) lo = mid; else hi = mid; }
  return { year: months[lo].year, month: months[lo].month, day: Math.round((stamp(date) - stamp(months[lo].start)) / DAY) + 1 };
}
function hhmm(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw Error('Calculation returned invalid timestamp.');
  return new Date(date.getTime() + 3 * 3600000).toISOString().slice(11, 16);
}
const start = Date.UTC(year - 1, 11, 31);
const end = Date.UTC(year + 2, 0, 1);
const fields = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
const records = [];
for (let ms = start; ms <= end; ms += DAY) {
  const date = key(ms);
  const h = hijri(date);
  const params = adhan.CalculationMethod.UmmAlQura();
  params.madhab = adhan.Madhab.Shafi; // Standard shadow factor 1.
  params.rounding = adhan.Rounding.Nearest; // ≥30 seconds rounds upward.
  params.ishaInterval = h.month === 9 ? 120 : 90; // Exactly once; no +30 adjustment.
  const times = new adhan.PrayerTimes(new adhan.Coordinates(latitude, longitude), new Date(ms), params);
  const record = { date };
  fields.forEach(field => { record[field] = hhmm(times[field]); });
  records.push(record);
}
const generatedOnIndex = args.indexOf('--generated-on');
// Pin --generated-on when reproducing a released snapshot; otherwise record today.
const generatedOn = generatedOnIndex < 0 ? new Date().toISOString().slice(0, 10) : args[generatedOnIndex + 1];
if (!/^\d{4}-\d{2}-\d{2}$/.test(generatedOn) || !Number.isFinite(stamp(generatedOn)) || key(stamp(generatedOn)) !== generatedOn) throw Error('Invalid --generated-on date.');
const timetable = {
  metadata: {
    schemaVersion: 1,
    dataVersion: `dammam-${year}-${year + 1}-calculated-1`,
    targetYear: year,
    displayYears: [year, year + 1],
    city: 'الدمام',
    timezone: 'Asia/Riyadh',
    utcOffset: '+03:00',
    coordinates: { latitude, longitude, note: 'Approximate central Dammam; not surveyed mosque coordinates.' },
    rangeStart: key(start),
    rangeEnd: key(end),
    displayStart: `${year}-01-01`,
    displayEnd: `${year + 1}-12-31`,
    boundaryOnly: [key(start), key(end)],
    source: 'Calculated during development using locally vendored Adhan JS 4.4.6 (Batoul Apps, MIT). Not an official or mosque-approved timetable.',
    sourceUrl: 'https://github.com/batoulapps/adhan-js/tree/v4.4.6',
    generatedOn,
    verificationStatus: 'calculated-needs-review',
    statusArabic: 'مواقيت محسوبة — تحتاج مراجعة',
    calculation: {
      library: 'Adhan JS 4.4.6', method: 'UmmAlQura', fajrAngle: 18.5,
      asrShadowFactor: 1, ishaMinutesOutsideRamadan: 90, ishaMinutesRamadan: 120,
      ramadanCalendar: 'HijriDate 2.6.0 verified Umm al-Qura month-start table',
      ramadanRule: 'Set ishaInterval to 120 only on Saudi civil Ramadan dates; no separate +30 minute adjustment.',
      adjustmentsMinutes: { fajr: 0, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
      rounding: 'Nearest whole minute; seconds >= 30 round upward (Adhan Rounding.Nearest).',
      highLatitudeRule: 'MiddleOfTheNight library default; no high-latitude approximation needed at central Dammam.',
      elevationMeters: 0
    }
  },
  records
};
function validate() {
  const seen = new Set();
  records.forEach((r, i) => {
    if (seen.has(r.date)) throw Error('Duplicate: ' + r.date);
    seen.add(r.date);
    if (r.date !== key(start + i * DAY)) throw Error('Missing/out-of-order date: ' + r.date);
    let prev = -1;
    fields.forEach(f => {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(r[f])) throw Error('Malformed time: ' + r.date + ' ' + f);
      const m = Number(r[f].slice(0, 2)) * 60 + Number(r[f].slice(3));
      if (m <= prev) throw Error('Prayer order: ' + r.date);
      prev = m;
    });
    const interval = (Number(r.isha.slice(0, 2)) * 60 + Number(r.isha.slice(3))) - (Number(r.maghrib.slice(0, 2)) * 60 + Number(r.maghrib.slice(3)));
    if (interval !== (hijri(r.date).month === 9 ? 120 : 90)) throw Error('Isha Ramadan interval: ' + r.date);
  });
  if (records.length !== (end - start) / DAY + 1) throw Error('Coverage mismatch.');
  [year, year + 1].forEach(y => {
    const expected = (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / DAY;
    if (records.filter(r => r.date.startsWith(String(y) + '-')).length !== expected) throw Error('Year count: ' + y);
  });
}
validate();
const fixtureDates = new Set([calendar.rangeStart, firstRequired, `${year}-01-01`, `${year + 1}-12-31`, `${year + 2}-01-01`, calendar.rangeEnd]);
months.forEach(m => {
  if (m.start >= `${year}-01-01` && m.start <= `${year + 1}-12-31`) {
    fixtureDates.add(m.start);
    fixtureDates.add(key(stamp(m.start) - DAY));
  }
});
const fixtures = {
  source: calendar.sourceUrl,
  note: 'Reference vectors extracted from vendored verified month-start data; independently cross-checked against Node Intl islamic-umalqura, not religious sighting declarations.',
  fixtures: Array.from(fixtureDates).sort().map(date => ({ date, ...hijri(date) }))
};
let nativeChecked = 0;
const fmt = new Intl.DateTimeFormat('en-US-u-ca-islamic-umalqura-nu-latn', {timeZone:'Asia/Riyadh', calendar:'islamic-umalqura', year:'numeric', month:'numeric', day:'numeric'});
if (fmt.resolvedOptions().calendar !== 'islamic-umalqura') throw Error('Development verification requires native Umm al-Qura support.');
for (let ms = start; ms <= end; ms += DAY) {
  const date = key(ms), h = hijri(date);
  const parts = Object.fromEntries(fmt.formatToParts(new Date(date + 'T12:00:00+03:00')).map(p => [p.type, p.value]));
  if (+parts.year !== h.year || +parts.month !== h.month || +parts.day !== h.day) throw Error('Independent native calendar mismatch on ' + date);
  nativeChecked++;
}
fixtures.fixtures.forEach(f => {
  const parts = Object.fromEntries(fmt.formatToParts(new Date(f.date + 'T12:00:00+03:00')).map(p => [p.type, p.value]));
  if (+parts.year !== f.year || +parts.month !== f.month || +parts.day !== f.day) throw Error('Fixture native mismatch on ' + f.date);
});
fs.mkdirSync(path.join(root, 'data'), {recursive:true});
for (const [name, object] of Object.entries({timetable, calendar, 'calendar-fixtures': fixtures})) {
  fs.writeFileSync(path.join(root, 'data', name + '.json'), JSON.stringify(object, null, 2) + '\n');
}
const report = {
  runDate: generatedOn, node: process.version,
  targetYear: year, totalRecords: records.length,
  yearCounts: Object.fromEntries([year, year + 1].map(y => [y, records.filter(r => r.date.startsWith(y + '-')).length])),
  guards: timetable.metadata.boundaryOnly,
  checks: ['no duplicate dates','continuous exact dates','normal/leap year counts','six HH:mm fields','strict chronological times','Isha 90/120 minute intervals','metadata matches coverage'],
  nativeCalendarCrossCheckedDays: nativeChecked,
  nativeCalendarFixtures: fixtures.fixtures.length,
  officialTimetableComparison: 'NOT PERFORMED — dataset remains calculated and requires review.'
};
fs.writeFileSync(path.join(root, 'data/generation-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
