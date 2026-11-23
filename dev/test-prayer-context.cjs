'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {prepareDay, resolve} = require('./prayer-context.js');
const {timestamp, dateKey, hijriFromCalendar} = require('./location-engine.js');
const calendar = require('../data/setup-calendar.json');
const {fridayProgram} = require('./config.json');

const MINUTE = 60000;
const settings = {silentPhoneReminder: true, postPrayerMinutes: 5, fridayProgram};
const riyadh = 'Asia/Riyadh';
const friday = '2026-02-20'; // 3 Ramadan 1447 in the bundled Umm al-Qura calendar.
const fajrAt = timestamp(friday, '04:40', riyadh);
const sunriseAt = timestamp(friday, '06:05', riyadh);
const noticeAt = timestamp(friday, '11:00', riyadh);
const dhuhrAt = timestamp(friday, '12:15', riyadh);
const maghribAt = timestamp(friday, '18:10', riyadh);
const nextFajrAt = timestamp('2026-02-21', '04:39', riyadh);
function prayer(date, name, adhan) {
  return {date, prayer: name, adhan, iqama: adhan + 10 * MINUTE, end: adhan + 25 * MINUTE};
}
function state(phase, active = null, previous = null) {
  return {phase, active, previous};
}
const fajr = {...prayer(friday, 'fajr', fajrAt), deadline: sunriseAt};
const dhuhr = prayer(friday, 'dhuhr', dhuhrAt);
const events = [fajr, dhuhr, prayer(friday, 'maghrib', maghribAt),
  prayer('2026-02-21', 'fajr', nextFajrAt)];
const waiting = state('WAITING_FOR_ADHAN');
function fridayDay(timetable = events, programme = fridayProgram, zone = riyadh, date = friday) {
  return prepareDay(timetable, date, hijriFromCalendar(date, calendar), undefined,
    programme, (key, time) => timestamp(key, time, zone));
}
const day = fridayDay();
function display(ms, base, options = settings, localDay = day) {
  return resolve(ms, base, localDay, options, {});
}

test('adhan, iqama, prayer end, adhkar and ten-minute exit use half-open windows', () => {
  const entrance = state('WAITING_FOR_IQAMA', fajr);
  const rows = state('PRAYER_MODE', fajr);
  const after = state('WAITING_FOR_NEXT_ADHAN', null, fajr);
  assert.equal(display(fajr.adhan - 1, waiting).cue, 'none');
  assert.equal(display(fajr.adhan, entrance).cue, 'entrance');
  assert.equal(display(fajr.iqama - 2 * MINUTE - 1, entrance).phone, false);
  assert.equal(display(fajr.iqama - 2 * MINUTE, entrance).phone, true);
  assert.equal(display(fajr.iqama - 1, entrance).cue, 'entrance');
  assert.equal(display(fajr.iqama, rows).cue, 'rows');
  assert.equal(display(fajr.iqama + 9999, rows).phone, true);
  assert.equal(display(fajr.iqama + 10000, rows).phone, false);
  assert.equal(display(fajr.end - 1, rows).cue, 'rows');
  assert.equal(display(fajr.end, after).postStart, fajr.end);
  assert.equal(display(fajr.end + 5 * MINUTE - 1, after).cue, 'adhkar');
  assert.equal(display(fajr.end + 5 * MINUTE, after).cue, 'exit');
  assert.equal(display(fajr.end + 15 * MINUTE - 1, after).cue, 'exit');
  assert.equal(display(fajr.end + 15 * MINUTE, after).cue, 'none');
});

test('all four durations and missing optional fields use the configured completion time', () => {
  const after = state('WAITING_FOR_NEXT_ADHAN', null, fajr);
  for (const minutes of [0, 3, 5, 7]) {
    const options = {...settings, postPrayerMinutes: minutes};
    const start = fajr.end + minutes * MINUTE;
    assert.equal(display(fajr.end, after, options).cue, minutes ? 'adhkar' : 'exit');
    assert.equal(display(start, after, options).cue, 'exit');
    assert.equal(display(start + 10 * MINUTE, after, options).cue, 'none');
  }
  assert.equal(display(fajr.end + 5 * MINUTE - 1, after, {}).cue, 'adhkar');
  assert.equal(display(fajr.iqama, state('PRAYER_MODE', fajr), {}).phone, true);
});

test('phone toggle and shorter-than-two-minute iqama affect only the reminder', () => {
  const short = {...fajr, iqama: fajr.adhan + MINUTE};
  const off = {...settings, silentPhoneReminder: false};
  assert.equal(display(short.adhan, state('WAITING_FOR_IQAMA', short)).phone, true);
  assert.equal(display(short.adhan, state('WAITING_FOR_IQAMA', short), off).cue, 'entrance');
  assert.equal(display(short.adhan, state('WAITING_FOR_IQAMA', short), off).phone, false);
  assert.equal(display(short.iqama, state('PRAYER_MODE', short), off).phone, false);
});

test('the next adhan interrupts an unfinished post-prayer or exit window', () => {
  for (const spacing of [1, 7]) {
    const next = prayer(friday, 'dhuhr', fajr.end + spacing * MINUTE);
    assert.equal(display(next.adhan - 1, state('WAITING_FOR_NEXT_ADHAN', null, fajr)).cue,
      spacing === 1 ? 'adhkar' : 'exit');
    assert.equal(display(next.adhan, state('WAITING_FOR_IQAMA', next, fajr)).cue, 'entrance');
  }
  assert.equal(display(fajr.end + MINUTE, state('WAITING_FOR_NEXT_ADHAN')).cue, 'none');
});

test('Friday cards start at adjusted sunrise, switch at 11:00 and stop exactly at Jumu’ah iqama', () => {
  assert.equal(display(sunriseAt - 1, waiting).friday, 'none');
  assert.equal(display(sunriseAt, waiting).friday, 'adhkar');
  assert.equal(display(noticeAt - 1, waiting).fridayStart, sunriseAt);
  assert.equal(display(noticeAt, waiting).friday, 'listen');
  assert.equal(display(dhuhrAt, state('WAITING_FOR_IQAMA', dhuhr)).friday, 'listen');
  assert.equal(display(dhuhr.iqama - 1, state('WAITING_FOR_IQAMA', dhuhr)).friday, 'listen');
  assert.equal(display(dhuhr.iqama, state('PRAYER_MODE', dhuhr)).friday, 'none');
  assert.equal(display(dhuhr.iqama, state('PRAYER_MODE', dhuhr)).cue, 'rows');
  assert.equal(display(dhuhr.iqama + 1, waiting).friday, 'none'); // A dismissed prayer remains dismissed.
  assert.equal(display(dhuhr.end, state('WAITING_FOR_NEXT_ADHAN', null, dhuhr)).friday, 'none');
  assert.equal(display(dhuhr.end, state('WAITING_FOR_NEXT_ADHAN', null, dhuhr)).cue, 'adhkar');
  const saturday = '2026-02-21';
  const atNoon = timestamp(saturday, '12:00', riyadh);
  const weekendDay = fridayDay([prayer(saturday, 'dhuhr', atNoon)], fridayProgram, riyadh, saturday);
  assert.equal(display(atNoon, waiting, settings, weekendDay).friday, 'none');
});

test('Friday options follow the local clock even when UTC still reads Thursday', () => {
  const zone = 'Pacific/Auckland', localFajr = timestamp(friday, '04:40', zone);
  const start = timestamp(friday, '07:30', zone), notice = timestamp(friday, '10:15', zone);
  assert.equal(new Date(start).getUTCDay(), 4);
  const localEvents = [prayer(friday, 'fajr', localFajr), prayer(friday, 'dhuhr', timestamp(friday, '12:15', zone))];
  const localDay = fridayDay(localEvents, {...fridayProgram, startTime:'07:30', noticeTime:'10:15'}, zone, dateKey(start, zone));
  assert.equal(display(start - 1, waiting, settings, localDay).friday, 'none');
  assert.equal(display(start, waiting, settings, localDay).fridayStart, start);
  assert.equal(display(notice, waiting, settings, localDay).friday, 'listen');
});

test('Friday programme yields to active prayers and respects early iqama, missing data and disabled programmes', () => {
  const moved = {...dhuhr, adhan: noticeAt - 30 * MINUTE, iqama: noticeAt - 10 * MINUTE};
  const localDay = fridayDay([fajr, moved]);
  assert.equal(display(moved.iqama - 1, waiting, settings, localDay).friday, 'adhkar');
  assert.equal(display(moved.iqama, waiting, settings, localDay).friday, 'none');
  assert.equal(display(noticeAt, waiting, settings, localDay).friday, 'none');
  assert.equal(display(sunriseAt, state('PRAYER_MODE', fajr)).friday, 'none');
  assert.equal(display(noticeAt, waiting, settings, fridayDay([fajr])).friday, 'none');
  const missingSunrise = fridayDay([dhuhr]);
  assert.equal(display(sunriseAt, waiting, settings, missingSunrise).friday, 'none');
  assert.equal(display(noticeAt, waiting, settings, missingSunrise).friday, 'listen');
  const disabled = fridayDay(events, {...fridayProgram, enabled:false});
  assert.equal(display(sunriseAt, waiting, settings, disabled).friday, 'none');
  assert.equal(display(noticeAt, waiting, settings, disabled).friday, 'none');
});

test('a configured Friday start inside a DST gap begins when the mosque clock jumps forward', () => {
  const date = '2026-03-27', zone = 'Asia/Jerusalem';
  const first = timestamp(date, '03:00', zone);
  const localDay = fridayDay([prayer(date, 'dhuhr', timestamp(date, '12:00', zone))],
    {...fridayProgram, startTime:'02:45'}, zone, date);
  assert.equal(display(first - 1, waiting, settings, localDay).friday, 'none');
  assert.equal(display(first, waiting, settings, localDay).fridayStart, first);
});

test('bundled lunar month boundaries enter and leave Ramadan without network or Intl calendars', () => {
  const month = key => hijriFromCalendar(key, calendar).month;
  assert.equal(prepareDay(events, '2026-02-17', month('2026-02-17')).ramadan, false);
  assert.equal(prepareDay(events, '2026-02-18', month('2026-02-18')).ramadan, true);
  const shawwal = calendar.months.find(row => row.month === 10 && row.year === 1447).start;
  assert.equal(prepareDay(events, shawwal, month(shawwal)).ramadan, false);
  assert.equal(prepareDay(events, friday, null).ramadan, false);
});

test('Ramadan switches between Fajr, Maghrib, and next-day Fajr on their exact instants', () => {
  for (const [ms, kind, target] of [
    [fajrAt - 1, 'fajr', fajrAt], [fajrAt, 'iftar', maghribAt],
    [maghribAt - 1, 'iftar', maghribAt], [maghribAt, 'fajr', nextFajrAt]
  ]) {
    const result = display(ms, waiting);
    assert.equal(result.ramadan, kind);
    assert.equal(result.ramadanAt, target);
  }
  const missingTomorrow = prepareDay(events.slice(0, -1), friday, 9);
  assert.equal(display(maghribAt, waiting, settings, missingTomorrow).ramadanAt, null);
  const gap = prepareDay([...events.slice(0, -1), prayer('2026-02-22', 'fajr', nextFajrAt + 86400000)], friday, 9);
  assert.equal(display(maghribAt, waiting, settings, gap).ramadan, 'none');
});

test('spring DST and local midnight point to scheduled Fajr rather than a 24-hour extrapolation', () => {
  const zone = 'America/New_York', saturday = '2026-03-07', sunday = '2026-03-08';
  const ny = [saturday, sunday].flatMap(key => [
    prayer(key, 'fajr', timestamp(key, '05:00', zone)),
    prayer(key, 'maghrib', timestamp(key, '18:00', zone))
  ]);
  assert.equal(ny[2].adhan - ny[0].adhan, 23 * 60 * MINUTE);
  const dayAt = ms => {
    const key = dateKey(ms, zone);
    return prepareDay(ny, key, hijriFromCalendar(key, calendar).month);
  };
  for (const ms of [ny[1].adhan, timestamp(sunday, '00:00', zone), ny[2].adhan - 1]) {
    assert.equal(display(ms, waiting, settings, dayAt(ms)).ramadanAt, ny[2].adhan);
  }
});

test('adjusted Fajr and Maghrib continue across civil midnight without a missing or inverted countdown', () => {
  const adjacent = [
    prayer('2026-02-19', 'maghrib', timestamp(friday, '00:35', riyadh)),
    ...events.slice(0, -1),
    prayer('2026-02-21', 'fajr', timestamp(friday, '23:45', riyadh)),
    prayer('2026-02-21', 'maghrib', timestamp('2026-02-21', '18:15', riyadh))
  ];
  const info = prepareDay(adjacent, friday, hijriFromCalendar(friday, calendar), 9);
  const beforeYesterdayIftar = display(timestamp(friday, '00:01', riyadh), waiting, settings, info);
  assert.equal(beforeYesterdayIftar.ramadan, 'iftar');
  assert.equal(beforeYesterdayIftar.ramadanAt, adjacent[0].adhan);
  assert.equal(display(adjacent[0].adhan, waiting, settings, info).ramadanAt, fajrAt);
  assert.equal(display(adjacent[4].adhan - 1, waiting, settings, info).ramadanAt, adjacent[4].adhan);
  const afterEarlyFajr = display(adjacent[4].adhan, waiting, settings, info);
  assert.equal(afterEarlyFajr.ramadan, 'iftar');
  assert.equal(afterEarlyFajr.ramadanAt, adjacent[5].adhan);
});

test('the first and last fasting dates do not label an adjacent non-Ramadan day as fasting', () => {
  const first = calendar.months.find(m => m.year === 1447 && m.month === 9).start;
  const shawwal = calendar.months.find(m => m.year === 1447 && m.month === 10).start;
  const priorDate = key => new Date(Date.parse(key+'T12:00:00Z') - 86400000).toISOString().slice(0,10);
  const firstEvents = [
    prayer(priorDate(first), 'maghrib', timestamp(first, '00:30', riyadh)),
    prayer(first, 'fajr', timestamp(first, '04:00', riyadh)),
    prayer(first, 'maghrib', timestamp(first, '18:00', riyadh))
  ];
  const firstDay = prepareDay(firstEvents, first, hijriFromCalendar(first, calendar), 9);
  assert.equal(display(timestamp(first, '00:01', riyadh), waiting, settings, firstDay).ramadanAt, firstEvents[1].adhan);
  const last = priorDate(shawwal);
  const lastEvents = [prayer(last, 'fajr', timestamp(last, '04:00', riyadh)),
    prayer(last, 'maghrib', timestamp(last, '18:00', riyadh)),
    prayer(shawwal, 'fajr', timestamp(shawwal, '04:00', riyadh))];
  const lastDay = prepareDay(lastEvents, last, hijriFromCalendar(last, calendar), hijriFromCalendar(shawwal, calendar).month);
  const afterSunset = display(lastEvents[1].adhan, waiting, settings, lastDay);
  assert.equal(afterSunset.ramadan, 'fajr-only');
  assert.equal(afterSunset.ramadanAt, lastEvents[2].adhan);
  assert.equal(prepareDay(lastEvents, shawwal, hijriFromCalendar(shawwal, calendar), 10).ramadan, false);
});

test('final supported Isha can finish after midnight without inventing new schedule data', () => {
  const end = timestamp('2028-01-01', '00:12', riyadh);
  const previous = {...prayer('2027-12-31', 'isha', end - 30 * MINUTE), end};
  const after = state('UNAVAILABLE', null, previous);
  const unknown = state('UNAVAILABLE');
  assert.equal(display(end, after).cue, 'adhkar');
  assert.equal(display(end + 5 * MINUTE, after).cue, 'exit');
  assert.equal(display(end + 15 * MINUTE, after).cue, 'none');
  assert.equal(display(end, unknown).cue, 'none');
  assert.equal(display(fajrAt, unknown).friday, 'none');
  assert.equal(display(fajrAt, unknown).ramadan, 'none');
});

test('reusing the tick result clears prior states on clock jumps, background resume and unavailable dates', () => {
  const output = {};
  assert.equal(resolve(fajr.iqama, state('PRAYER_MODE', fajr), day, settings, output), output);
  assert.equal(output.phone, true);
  resolve(fajr.end, state('WAITING_FOR_NEXT_ADHAN', null, fajr), day, settings, output);
  assert.equal(output.postStart, fajr.end);
  resolve(fajr.adhan - 1, state('UNAVAILABLE'), null, settings, output);
  assert.deepEqual(output, {cue:'none', phone:false, friday:'none', fridayStart:null, ramadan:'none', ramadanAt:null, postStart:null});
});
