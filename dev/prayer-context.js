/* Contextual displays use the same mosque-local timetable and clock as the main screen. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MosquePrayerContext = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  const MINUTE = 60000;

  // Called when the mosque's civil date or its prepared timetable changes. buildEvents()
  // sorts by adjusted adhan and validates prayer order, including adjacent local dates.
  function prepareDay(events, dateKey, hijriDate, nextHijriMonth) {
    const noon = Date.parse(dateKey + 'T12:00:00Z');
    const hijriMonth = typeof hijriDate === 'number' ? hijriDate : hijriDate?.month;
    const day = {
      friday: new Date(noon).getUTCDay() === 5,
      ramadan: hijriMonth === 9,
      nextRamadan: (nextHijriMonth === undefined ? hijriMonth : nextHijriMonth) === 9,
      previousMaghrib: null, fajr: null, dhuhr: null, maghrib: null, nextFajr: null, nextMaghrib: null
    };
    if (!day.friday && !day.ramadan) return day;

    let first = 0, end = events.length;
    while (first < end) {
      const mid = first + Math.floor((end - first) / 2);
      if (events[mid].date < dateKey) first = mid + 1;
      else end = mid;
    }
    let index = first;
    while (index < events.length && events[index].date === dateKey) {
      const event = events[index++];
      if (event.prayer === 'fajr' || event.prayer === 'dhuhr' || event.prayer === 'maghrib') {
        day[event.prayer] = event.adhan;
      }
    }
    if (day.ramadan && index > first) {
      // A high-latitude schedule (or a mosque's adjustment) can place a boundary
      // on the opposite side of civil midnight. Use the adjoining dated events.
      const priorDate = new Date(noon - 86400000).toISOString().slice(0, 10);
      if (hijriDate?.day !== 1) {
        for (let i = first - 1; i >= 0 && events[i].date === priorDate; i--) {
          if (events[i].prayer === 'maghrib') { day.previousMaghrib = events[i].adhan; break; }
        }
      }
      const nextDate = new Date(noon + 86400000).toISOString().slice(0, 10);
      for (; index < events.length && events[index].date === nextDate; index++) {
        if (events[index].prayer === 'fajr') day.nextFajr = events[index].adhan;
        if (events[index].prayer === 'maghrib') day.nextMaghrib = events[index].adhan;
      }
    }
    return day;
  }

  // The caller reuses out on each existing display tick. previous is supplied only for
  // supported, unsuppressed prayers by the existing binary-search state resolver.
  function resolve(ms, state, day, settings, out) {
    out.cue = 'none';
    out.phone = false;
    out.friday = 'none';
    out.ramadan = 'none';
    out.ramadanAt = null;
    out.postStart = null;

    const active = state.active;
    if (state.phase === 'WAITING_FOR_IQAMA' && active) {
      out.cue = 'entrance';
      out.phone = settings.silentPhoneReminder !== false && ms >= active.iqama - 2 * MINUTE;
    } else if (state.phase === 'PRAYER_MODE' && active) {
      out.cue = 'rows';
      out.phone = settings.silentPhoneReminder !== false && ms < active.iqama + 10000;
    } else if (state.previous && ms >= state.previous.end) {
      const start = state.previous.end;
      const end = start + (settings.postPrayerMinutes ?? 5) * MINUTE;
      if (ms < end) {
        out.cue = 'adhkar';
        out.postStart = start;
      } else if (ms < end + 10 * MINUTE) {
        out.cue = 'exit';
      }
    }

    if (!day || state.phase === 'UNAVAILABLE') return out;
    if (day.friday) {
      if (day.fajr !== null && day.dhuhr !== null && ms >= day.fajr && ms < day.dhuhr) {
        out.friday = 'morning';
      } else if (active?.prayer === 'dhuhr' && (out.cue === 'entrance' || out.cue === 'rows')) {
        out.friday = 'listen';
      }
    }
    if (day.ramadan && day.fajr !== null && day.maghrib !== null) {
      if (day.previousMaghrib !== null && ms < day.previousMaghrib) {
        out.ramadan = 'iftar';
        out.ramadanAt = day.previousMaghrib;
      } else if (ms < day.fajr) {
        out.ramadan = 'fajr';
        out.ramadanAt = day.fajr;
      } else if (ms < day.maghrib) {
        out.ramadan = 'iftar';
        out.ramadanAt = day.maghrib;
      } else if (day.nextFajr !== null && ms < day.nextFajr) {
        out.ramadan = day.nextRamadan ? 'fajr' : 'fajr-only';
        out.ramadanAt = day.nextFajr;
      } else if (day.nextRamadan && day.nextFajr !== null && day.nextMaghrib !== null && ms < day.nextMaghrib) {
        out.ramadan = 'iftar';
        out.ramadanAt = day.nextMaghrib;
      }
    }
    return out;
  }

  return {prepareDay, resolve};
});
