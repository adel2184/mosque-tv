/* Development-only acceptance checks. Calls the application's real test API. */
(function (root) {
  'use strict';
  async function runMosqueAcceptance(call, get) {
    const results = [];
    const check = async (name, fn) => {
      try { await fn(); results.push({name, pass: true}); }
      catch (error) { results.push({name, pass: false, error: error.message || String(error)}); }
    };
    const assert = (condition, message) => { if (!condition) throw new Error(message || 'لم تتحقق النتيجة المتوقعة'); };
    const eq = (a, b, message) => assert(a === b, (message || '') + ' المتوقع ' + JSON.stringify(b) + '، الفعلي ' + JSON.stringify(a));
    const clone = value => JSON.parse(JSON.stringify(value));
    const throws = async fn => { let rejected = false; try { await fn(); } catch (_) { rejected = true; } assert(rejected, 'يجب رفض القيمة غير الصالحة'); };
    const stamp = value => Date.parse(value + (value.includes('+') ? '' : '+03:00'));
    const raw = await get('database');
    const defaults = await get('defaults');
    const db = await call('validateTimetable', raw);
    const settings = await call('validateSettings', defaults);
    const events = await call('buildEvents', db, settings);
    const todayEvents = events.filter(event => event.date === '2026-11-16');
    await check('قاعدة البيانات: 365 يوماً لكل سنة وسجلان للحدود', async () => {
      eq(raw.records.length, 732);
      eq(raw.records.filter(row => row.date.startsWith('2026-')).length, 365);
      eq(raw.records.filter(row => row.date.startsWith('2027-')).length, 365);
      assert(raw.records.some(row => row.date === '2025-12-31'));
      assert(raw.records.some(row => row.date === '2028-01-01'));
      eq(new Set(raw.records.map(row => row.date)).size, raw.records.length);
    });
    await check('المواقيت: رفض التكرار واليوم الناقص والوقت المشوه والتاريخ غير الصحيح', async () => {
      let candidate = clone(raw); candidate.records.push(candidate.records[1]); await throws(() => call('validateTimetable', candidate));
      candidate = clone(raw); candidate.records.splice(50, 1); await throws(() => call('validateTimetable', candidate));
      candidate = clone(raw); candidate.records[1].fajr = '25:90'; await throws(() => call('validateTimetable', candidate));
      candidate = clone(raw); candidate.records[1].date = '2027-02-29'; await throws(() => call('validateTimetable', candidate));
      candidate = clone(raw); delete candidate.records[1].sunrise; await throws(() => call('validateTimetable', candidate));
    });
    await check('مخطط الإعدادات: رفض الأنواع والأطوال والفواصل غير المسموحة', async () => {
      for (const mutate of [candidate=>candidate.iqama.offsets.fajr=0,candidate=>candidate.prayerModeMinutes=1.5,candidate=>candidate.digitStyle='invalid',candidate=>candidate.mosque.fields.name.value='x'.repeat(181),candidate=>candidate.mosque.enabled='true']) {
        const candidate=clone(defaults);mutate(candidate);await throws(()=>call('validateSettings',candidate));
      }
      eq(settings.iqama.confirmed,false,'يجب أن تكون أمثلة الإقامة غير مؤكدة أولاً');
    });
    await check('الإقامة الثابتة: ترتيب الجمعة وتقدم التاريخ على اليوم الأسبوعي ورفض التداخل', async () => {
      let candidate=clone(defaults);
      candidate.iqama.overrides=[{id:'test-friday',kind:'weekday',match:'5',prayer:'dhuhr',time:'13:00',label:'مثال اختبار فقط'},{id:'test-date',kind:'date',match:'2026-11-20',prayer:'dhuhr',time:'12:30',label:'مثال اختبار فقط'}];
      let modified=await call('buildEvents',db,await call('validateSettings',candidate));
      eq(modified.find(event=>event.date==='2026-11-20'&&event.prayer==='dhuhr').iqama,stamp('2026-11-20T12:30:00'));
      eq(modified.find(event=>event.date==='2026-11-27'&&event.prayer==='dhuhr').iqama,stamp('2026-11-27T13:00:00'));
      candidate=clone(defaults);candidate.iqama.offsets.dhuhr=180;await throws(()=>call('buildEvents',db,candidate));
      candidate=clone(defaults);candidate.iqama.overrides=[{id:'bad-time',kind:'date',match:'2026-11-16',prayer:'fajr',time:'01:00',label:''}];await throws(()=>call('buildEvents',db,candidate));
    });
    await check('تاريخ الرياض مستقل عن منطقة الجهاز عند منتصف الليل', async () => {
      eq(await call('dateKey', Date.parse('2026-11-15T21:00:00Z')), '2026-11-16');
      eq(await call('dateKey', Date.parse('2026-11-15T20:59:59Z')), '2026-11-15');
      eq(await call('addDays', '2027-12-31', 1), '2028-01-01');
      eq(await call('addDays', '2028-02-28', 1), '2028-02-29');
      eq(await call('addDays', '2028-02-29', 1), '2028-03-01');
    });
    await check('الساعة: الظهر ومنتصف الليل بصيغة 12 ساعة', async () => {
      const midnight = await call('formatClock', stamp('2026-11-16T00:00:00'), 'western');
      const noon = await call('formatClock', stamp('2026-11-16T12:00:00'), 'western');
      eq(midnight.time, '12:00:00'); eq(midnight.period, 'ص');
      eq(noon.time, '12:00:00'); eq(noon.period, 'م');
    });
    await check('الأحداث: خمس صلوات يومياً والشروق لا ينشئ إقامة', async () => {
      eq(todayEvents.length, 5);
      assert(!events.some(event => /sunrise|الشروق/.test(event.prayer)));
      todayEvents.forEach(event => { assert(event.adhan < event.iqama); assert(event.iqama < event.end); });
    });
    for (const event of todayEvents) {
      await check('حدود الأذان والإقامة ونهاية الصلاة: ' + event.prayer, async () => {
        const beforeAdhan = await call('resolveState', event.adhan - 1000, events, db);
        assert(['WAITING_FOR_ADHAN', 'WAITING_FOR_NEXT_ADHAN'].includes(beforeAdhan.phase));
        eq(beforeAdhan.targetAt, event.adhan);
        let state = await call('resolveState', event.adhan, events, db);
        eq(state.phase, 'WAITING_FOR_IQAMA'); eq(state.targetAt, event.iqama);
        state = await call('resolveState', event.iqama - 1000, events, db);
        eq(state.phase, 'WAITING_FOR_IQAMA'); eq(state.targetAt, event.iqama);
        state = await call('resolveState', event.iqama, events, db);
        eq(state.phase, 'PRAYER_MODE'); eq(state.active.id, event.id);
        state = await call('resolveState', event.iqama + 6 * 60000, events, db);
        eq(state.phase, 'PRAYER_MODE'); eq(state.active.end - (event.iqama + 6 * 60000), 9 * 60000);
        state = await call('resolveState', event.end, events, db);
        assert(state.phase !== 'PRAYER_MODE', 'يجب أن تنتهي الشاشة السوداء في اللحظة المحددة');
        eq((await call('resolveState', event.end + 1000, events, db)).phase, state.phase);
      });
    }
    await check('إعادة التحميل والقفز الزمني لا يعيدان صلاة منتهية', async () => {
      const first = todayEvents[0]; const last = todayEvents[4];
      eq((await call('resolveState', first.iqama + 1000, events, db)).phase, 'PRAYER_MODE');
      const afterSleep = await call('resolveState', last.end + 60000, events, db);
      assert(afterSleep.phase !== 'PRAYER_MODE');
      const back = await call('resolveState', first.iqama + 1000, events, db);
      eq(back.phase, 'PRAYER_MODE');
    });
    await check('فاصل الصلاة الممتد من اليوم السابق عبر منتصف الليل', async () => {
      const event = {id:'synthetic-midnight', date:'2026-11-15', prayer:'isha', adhan:stamp('2026-11-15T23:30:00'), iqama:stamp('2026-11-15T23:55:00'), end:stamp('2026-11-16T00:10:00'), deadline:stamp('2026-11-16T05:00:00')};
      const state = await call('resolveState', stamp('2026-11-16T00:01:00'), [event, ...todayEvents], db);
      eq(state.phase, 'PRAYER_MODE'); eq(state.active.id, event.id);
      assert((await call('resolveState', event.end, [event, ...todayEvents], db)).phase !== 'PRAYER_MODE');
    });
    await check('تجاوز الصيانة يخص فاصل الصلاة الحالي فقط', async () => {
      const first = todayEvents[0]; const next = todayEvents[1];
      assert((await call('resolveState', first.iqama + 1000, events, db, first.id)).phase !== 'PRAYER_MODE');
      eq((await call('resolveState', next.iqama + 1000, events, db, first.id)).phase, 'PRAYER_MODE');
    });
    await check('نهاية سنة التغطية: فجر السنة التالية من سجل الحدود الحقيقي', async () => {
      const isha = events.filter(event => event.date === '2027-12-31').at(-1);
      const state = await call('resolveState', isha.end + 1000, events, db);
      eq(state.next.date, '2028-01-01');
      eq(state.next.adhan, stamp('2028-01-01T' + raw.records.find(row => row.date === '2028-01-01').fajr + ':00'));
      eq((await call('resolveState', stamp('2028-01-01T12:00:00'), events, db)).phase, 'UNAVAILABLE');
      eq((await call('resolveState', stamp('2025-12-31T12:00:00'), events, db)).phase, 'UNAVAILABLE');
    });
    await check('إقامة العشاء الثابتة تعبر آخر منتصف ليل دون إعادة تشغيل مدتها', async () => {
      const candidate=clone(defaults);candidate.iqama.overrides=[{id:'last-isha',kind:'date',match:'2027-12-31',prayer:'isha',time:'23:55',label:'مثال اختبار فقط'}];
      const modified=await call('buildEvents',db,await call('validateSettings',candidate));
      const active=await call('resolveState',stamp('2028-01-01T00:01:00'),modified,db);
      eq(active.phase,'PRAYER_MODE');eq(active.active.date,'2027-12-31');eq(active.active.end,stamp('2028-01-01T00:10:00'));
      eq((await call('resolveState',stamp('2028-01-01T00:10:00'),modified,db)).phase,'UNAVAILABLE');
      candidate.iqama.overrides[0].time='00:05';
      const delayed=await call('buildEvents',db,await call('validateSettings',candidate));
      const waiting=await call('resolveState',stamp('2028-01-01T00:00:00'),delayed,db);
      eq(waiting.phase,'WAITING_FOR_IQAMA');eq(waiting.targetAt,stamp('2028-01-01T00:05:00'));
      eq((await call('resolveState',stamp('2028-01-01T00:05:00'),delayed,db)).phase,'PRAYER_MODE');
      eq((await call('resolveState',stamp('2028-01-01T00:20:00'),delayed,db)).phase,'UNAVAILABLE');
    });
    await check('تقويم أم القرى: مراجع رمضان وانتقال السنة الموثقة', async () => {
      // Subset of data/calendar-fixtures.json, sourced from the vendored Umm al-Qura table.
      const fixtures = [
        ['2026-02-17',1447,8,29],['2026-02-18',1447,9,1],
        ['2026-03-19',1447,9,30],['2026-03-20',1447,10,1],
        ['2026-06-15',1447,12,29],['2026-06-16',1448,1,1],
        ['2027-02-07',1448,8,30],['2027-02-08',1448,9,1],
        ['2027-03-08',1448,9,29],['2027-03-09',1448,10,1]
      ];
      for (const [date,year,month,day] of fixtures) {
        const result=await call('hijriFallback',date);
        eq(result.year,year);eq(result.month,month);eq(result.day,day);
      }
    });
    await check('تقويم أم القرى البديل: بداية كل شهر ونهايته ونطاق الصيانة', async () => {
      const calendar = await get('calendar');
      const months = calendar.months;
      for (let i = 0; i < months.length - 1; i++) {
        const month = months[i]; const next = months[i + 1];
        const hijri = await call('hijriFallback', month.start);
        eq(hijri.year, month.year); eq(hijri.month, month.month); eq(hijri.day, 1);
        const lastKey = await call('addDays', next.start, -1);
        const last = await call('hijriFallback', lastKey);
        eq(last.year, month.year); eq(last.month, month.month); assert([29,30].includes(last.day));
      }
      eq(await call('hijriFallback', '1900-01-01'), null);
      eq(await call('hijriFallback', '2100-01-01'), null);
    });
    await check('الشرائح: صفر وشريحة واحدة والالتفاف إلى البداية', async () => {
      eq(await call('slideAdvance', 0, 0), 0);
      eq(await call('slideAdvance', 0, 1), 0);
      eq(await call('slideAdvance', 2, 3), 0);
      eq(await call('slideAdvance', 0, 3), 1);
    });
    return {executedAt:new Date().toISOString(), total:results.length, passed:results.filter(result => result.pass).length, failed:results.filter(result => !result.pass).length, results};
  }
  root.runMosqueAcceptance = runMosqueAcceptance;
  if (typeof module === 'object' && module.exports) module.exports = runMosqueAcceptance;
})(typeof globalThis !== 'undefined' ? globalThis : this);
