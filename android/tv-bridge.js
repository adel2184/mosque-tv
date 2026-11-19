/* Bundled only in the Android APK. The desktop index.html stays unchanged. */
(function () {
  'use strict';
  if (!window.MosqueAndroid) return;
  var native = window.MosqueAndroid;
  if (!Element.prototype.replaceChildren) {
    Element.prototype.replaceChildren = function () {
      while (this.firstChild) this.removeChild(this.firstChild);
      for (var i = 0; i < arguments.length; i++) this.appendChild(arguments[i]);
    };
  }
  var blobs = new Map();
  var createObjectURL = URL.createObjectURL.bind(URL);
  var revokeObjectURL = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = function (blob) { var url = createObjectURL(blob); blobs.set(url, blob); return url; };
  URL.revokeObjectURL = function (url) { blobs.delete(url); return revokeObjectURL(url); };
  function message(value, error) {
    var node = document.getElementById('settingsMessage');
    if (node) { node.textContent = value; node.className = error ? 'error' : 'success'; }
  }
  // A WebView cannot send blob: downloads to DownloadManager. Export the original
  // Blob through the user's Android document picker, with no storage permission.
  document.addEventListener('click', function (event) {
    var anchor = event.target.closest ? event.target.closest('a[download]') : null;
    if (!anchor || !blobs.has(anchor.href)) return;
    event.preventDefault();
    var blob = blobs.get(anchor.href), name = anchor.download || 'mosque-settings.json';
    if (blob.size > 3 * 1024 * 1024) { message('ملف التصدير أكبر من الحد المسموح.', true); return; }
    var reader = new FileReader();
    reader.onload = function () {
      try { message('اختر مكان حفظ ملف JSON في نافذة التلفزيون.'); native.exportJson(name, String(reader.result)); }
      catch (_) { message('تعذر فتح نافذة حفظ الملف. حاول مجددًا.', true); }
    };
    reader.onerror = function () { message('تعذرت قراءة ملف التصدير.', true); };
    reader.readAsText(blob, 'UTF-8');
  }, true);
  window.addEventListener('mosque-native-export-result', function (event) {
    var detail = event.detail || {};
    message(detail.message || (detail.success ? 'حُفظ الملف في المكان المختار.' : detail.cancelled ? 'أُلغي حفظ الملف.' : 'تعذر حفظ الملف.'), !detail.success && !detail.cancelled);
  });
  var reportedPrayer;
  function reportPrayer() {
    var active = document.body.classList.contains('praying');
    if (active === reportedPrayer) return;
    // Body classes also change for focus/idle UI. Only notify a real prayer
    // transition, and retain a failed delivery for the next observer retry.
    try { native.prayerState(active); reportedPrayer = active; } catch (_) {}
  }
  new MutationObserver(reportPrayer).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  reportPrayer();
  var style = document.createElement('style');
  // The native Activity already owns immersive fullscreen; hide the desktop-only action.
  style.textContent = '.tv-focus{outline:3px solid #d7bc7a!important;outline-offset:4px!important}#fullscreenButton{display:none!important}';
  document.head.appendChild(style);
  document.addEventListener('focusin', function (event) {
    document.querySelectorAll('.tv-focus').forEach(function (node) { node.classList.remove('tv-focus'); });
    if (event.target.classList) event.target.classList.add('tv-focus');
  });
  function controls() {
    var dialog = document.getElementById('settingsDialog');
    var root = dialog && dialog.open ? dialog : document;
    return Array.from(root.querySelectorAll('button:not([disabled]), input:not([disabled]):not([type="hidden"]):not([type="file"]), select:not([disabled]), textarea:not([disabled])')).filter(function (node) {
      var rect = node.getBoundingClientRect(), computed = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && computed.visibility !== 'hidden' && computed.display !== 'none';
    });
  }
  document.addEventListener('keydown', function (event) {
    if (document.body.classList.contains('praying') || event.ctrlKey || event.altKey) return;
    if ((window.MosqueTV && window.MosqueTV.isOpen()) || (window.MosqueControl && window.MosqueControl.isOpen())) return; // Each panel owns its explicit focus graph.
    var key = event.key || ({37:'ArrowLeft',38:'ArrowUp',39:'ArrowRight',40:'ArrowDown'})[event.keyCode];
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(key)) return;
    var active = document.activeElement;
    if (active && active.tagName === 'SELECT') return;
    var textInput = active && (active.tagName === 'TEXTAREA' || (active.tagName === 'INPUT' && !['checkbox','radio','button','submit'].includes(active.type)));
    if (textInput && (key === 'ArrowLeft' || key === 'ArrowRight')) return;
    var candidates = controls();
    if (!candidates.length) return;
    if (!candidates.includes(active)) { event.preventDefault(); candidates[0].focus(); return; }
    // Deterministic DOM order is the fallback for legacy panels, never screen geometry.
    var direction = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
    var index = candidates.indexOf(active), next = candidates[Math.max(0, Math.min(candidates.length - 1, index + direction))];
    if (next && next !== active) { event.preventDefault(); next.focus(); if (next.scrollIntoView) next.scrollIntoView({block:'nearest',inline:'nearest'}); }
  });
  function refreshHomeStatus() {
    if (window.MosqueTV && window.MosqueTV.isOpen()) { window.MosqueTV.refreshNative(); return; }
    var node = document.getElementById('tv-home-status');
    if (!node) return;
    var request = document.getElementById('tv-request-home');
    var text;
    try {
      var state = JSON.parse(String(native.homeStatus()));
      if (typeof state.isDefaultHome !== 'boolean' || typeof state.canRequestHomeRole !== 'boolean' || typeof state.canOpenHomeSettings !== 'boolean') throw Error('status');
      request.disabled = state.isDefaultHome || (!state.canRequestHomeRole && !state.canOpenHomeSettings);
      text = state.isDefaultHome
        ? 'مفعّل: اختير التطبيق واجهةً للبدء في النظام. اختبر إعادة تشغيل التلفاز والاستيقاظ من السكون.'
        : state.canRequestHomeRole || state.canOpenHomeSettings
          ? 'لم يُختر التطبيق واجهةً للبدء بعد. اختره في نافذة النظام، وحدد «دائمًا» إن ظهر الخيار.'
          : 'لا يعرض هذا النظام خيار تغيير واجهة البدء عبر التطبيق. راجع إعدادات التلفاز؛ التشغيل التلقائي غير مؤكّد.';
      text = homeMessage(state, text);
    } catch (_) {
      request.disabled = true;
      text = 'تعذر قراءة إعداد واجهة البدء. افتح إعدادات التلفاز للتحقق.';
    }
    // Do not write an unchanged string: this panel is observed for settings redraws.
    if (node.textContent !== text) node.textContent = text;
  }
  function ensureStartupPanel() {
    if (window.MosqueTV) return;
    var body = document.getElementById('settingsBody');
    if (!body || document.getElementById('tv-startup-settings')) return;
    var section = document.createElement('section');section.id = 'tv-startup-settings';section.className = 'settings-section';
    var title = document.createElement('h3');title.textContent = 'بدء التشغيل مع التلفاز';section.appendChild(title);
    var status = document.createElement('p');status.id = 'tv-home-status';status.className = 'notice';section.appendChild(status);
    function action(id, text, invoke) {
      var button = document.createElement('button');button.id = id;button.type = 'button';button.textContent = text;
      button.addEventListener('click', function () {
        if (document.body.classList.contains('praying')) return;
        try { invoke(); } catch (_) { message('تعذر فتح هذا الخيار. راجع إعدادات التلفاز.', true); }
      });
      section.appendChild(button);
      return button;
    }
    action('tv-request-home', 'اختيار التطبيق كواجهة البدء', function () { native.requestHomeRole(); }).disabled = true;
    action('tv-change-home', 'تغيير واجهة البدء', function () { native.openHomeSettings(); });
    action('tv-system-settings', 'إعدادات التلفزيون', function () { native.openSystemSettings(); });
    var note = document.createElement('p');note.className = 'notice';
    note.textContent = 'اختيار واجهة البدء يغيّر وظيفة زر Home بعد موافقتك في نافذة النظام، بصورة مستقلة عن حفظ مسودة بيانات الجامع. يمكنك الرجوع إلى واجهة TCL من «تغيير واجهة البدء» أو إعدادات التلفزيون. تعمل هذه الخطوة محليًا دون إنترنت، وتختلف إتاحتها بحسب نظام الشاشة.';
    section.appendChild(note);
    // Append only after the subtree is complete, avoiding a partially built observer update.
    body.appendChild(section);refreshHomeStatus();
  }
  window.addEventListener('focus', refreshHomeStatus);
  window.addEventListener('mosque-native-home-result', refreshHomeStatus);
  // Small native-only adapters. Mosque data still uses the app's versioned JSON draft.
  var powerDraft = null;
  var nativeSectionTitles = {
    'tv-home':'بدء التشغيل مع التلفاز',
    'tv-system':'الجهاز والاتصالات',
    'tv-power':'الطاقة وجدول العرض',
    'tv-update':'الإصدار والتحديث',
    'tv-device-setup':'تهيئة التلفاز'
  };
  function homeMessage(state, fallback) {
    return typeof state.message === 'string' && state.message.trim() ? state.message.slice(0, 500) : fallback;
  }
  function readState(method, fallback) {
    try { if (typeof native[method] !== 'function') return fallback; var state = JSON.parse(String(native[method]())); return state && typeof state === 'object' && !Array.isArray(state) ? state : fallback; }
    catch (_) { return fallback; }
  }
  function invoke(method, argument) {
    if (document.body.classList.contains('praying')) return;
    if (typeof native[method] !== 'function') throw Error('هذا الخيار غير متاح في نسخة التطبيق المثبتة.');
    return argument === undefined ? native[method]() : native[method](argument);
  }
  function nativeAction(id, label, method, argument, help) { return { id: id, label: label, value: 'فتح', help: help || '', kind: 'action', action: function () { invoke(method, argument); } }; }
  window.MosqueTVNative = {
    onClose: function () { powerDraft = null; },
    onControlClose: function () { if (typeof native.cancelSpeedTest === 'function') native.cancelSpeedTest(); },
    controlStatus: function () {
      var device=readState('deviceStatus',{}), network=device.network||{}, flags=device.available||{}, power=readState('powerStatus',{}), update=readState('updateStatus',{}), speed=readState('speedStatus',{});
      return {device:[device.manufacturer,device.model].filter(Boolean).join(' '),available:{bluetooth:flags.bluetooth!==false,mirror:flags.mirror===true,network:flags.wifi!==false,sound:flags.sound!==false,tv:flags.tv!==false,display:flags.display!==false,screensaver:flags.screensaver===true,speed:network.validated===true,phone:typeof native.openControl==='function',deviceSetup:typeof native.deviceSetup==='function'},rows:{network:(network.label||'إعدادات الشبكة')+(network.connected&&!network.validated?' · دون إنترنت':''),sound:device.audioOutput||'اختيار مخرج الصوت من إعدادات التلفاز',speed:speed.message||'قياس تنزيل عند الطلب؛ حتى 5 ميجابايت',update:(update.installedVersion||'')+' · '+(update.availableVersion?'يتوفر تحديث':'البحث عند الطلب فقط'),home:'اختيار واجهة البدء واستعادتها',power:power.mode==='always'?'عرض مستمر طوال اليوم':power.mode==='scheduled'?'جدول يومي: '+power.start+' — '+power.end:'السكون حسب إعدادات التلفاز',sleep:power.sleepMinutes?'يتوقف العرض بعد نحو '+power.sleepMinutes+' دقيقة':'مؤقت مؤقت لهذه الجلسة؛ لا يطفئ التلفاز'}};
    },
    controlAction: function (id) {
      if (id==='speed') return invoke(readState('speedStatus',{}).running?'cancelSpeedTest':'startSpeedTest');
      if (id==='sleep') return invoke('sleepMenu');
      if (id==='power') return invoke('displayOff');
      if (id==='deviceSetup') return invoke('deviceSetup');
      var map={network:'network',sound:'audio-output',bluetooth:'bluetooth',mirror:'mirror',tv:'tv',phone:'phone',display:'display',screensaver:'screensaver'};
      if (!Object.prototype.hasOwnProperty.call(map,id)) throw Error('اختصار غير معروف.');
      return invoke('openControl',map[id]);
    },
    getSections: function (titlesOnly) {
      if (titlesOnly) return Object.keys(nativeSectionTitles).map(function (id) {
        return {id:id, title:nativeSectionTitles[id], rows:[]};
      });
      var home = readState('homeStatus', {}), power = readState('powerStatus', {}), update = readState('updateStatus', {}), device = readState('deviceStatus', {});
      var validHome = typeof home.isDefaultHome === 'boolean' && typeof home.canRequestHomeRole === 'boolean' && typeof home.canOpenHomeSettings === 'boolean';
      var homeText = !validHome ? 'تعذر قراءة إعداد واجهة البدء.' : home.isDefaultHome ? 'التطبيق هو واجهة البدء الافتراضية.' : 'التطبيق ليس واجهة البدء الافتراضية.';
      if (validHome) homeText = homeMessage(home, homeText);
      if (!powerDraft) powerDraft = { mode: ['always','scheduled','system'].includes(power.mode) ? power.mode : 'always', start: typeof power.start === 'string' ? power.start : '04:00', end: typeof power.end === 'string' ? power.end : '23:00' };
      var editingPower = powerDraft;
      var request = nativeAction('tv-request-home', 'اختيار التطبيق كواجهة البدء', 'requestHomeRole');
      request.disabled = !validHome || home.isDefaultHome || (!home.canRequestHomeRole && !home.canOpenHomeSettings);
      var systemRows = [['wifi','الشبكة وWi-Fi'],['bluetooth','البلوتوث والريموت'],['sound','الصوت'],['display','الصورة والشاشة'],['power','إعدادات الطاقة في التلفاز'],['apps','التطبيقات'],['mirror','العرض والبث من جهاز آخر'],['tv','إعدادات التلفزيون'],['app','معلومات تطبيق الجامع'],['phone','التحكم من الهاتف على الشبكة المحلية']].map(function (item) { return nativeAction('tv-control-' + item[0], item[1], 'openControl', item[0]); });
      var mode = { id:'tv-power-mode', label:'وضع تشغيل الشاشة', kind:'select', value:editingPower.mode, options:[['always','تشغيل مستمر وإبقاء الشاشة يقظة'],['scheduled','جدول عرض مع تعتيم خارج المدة'],['system','السماح بسكون التلفاز حسب النظام']], commit:function(value){ editingPower.mode=value; powerDraft=editingPower; } };
      var start = { id:'tv-power-start', label:'بداية العرض اليومي', kind:'time', value:editingPower.start, maxLength:5, help:'المنطقة الزمنية: '+(power.timezone||'Asia/Riyadh')+' — HH:mm (24h).', commit:function(value){editingPower.start=value;powerDraft=editingPower;} };
      var end = { id:'tv-power-end', label:'نهاية العرض اليومي', kind:'time', value:editingPower.end, maxLength:5, help:'المنطقة الزمنية: '+(power.timezone||'Asia/Riyadh')+' — يمكن أن تمتد المدة عبر منتصف الليل؛ الوقتان مختلفان.', commit:function(value){editingPower.end=value;powerDraft=editingPower;} };
      var savePower = { id:'tv-power-save', label:'حفظ إعداد الطاقة الآن', kind:'action', value:'تطبيق مستقل', action:function(){ if(editingPower.mode==='scheduled'&&(!/^([01]\d|2[0-3]):[0-5]\d$/.test(editingPower.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(editingPower.end)||editingPower.start===editingPower.end)) throw Error('أدخل وقتين صحيحين ومختلفين لجدول العرض.'); invoke('savePower',JSON.stringify(editingPower)); } };
      var check = nativeAction('tv-update-check','البحث عن تحديث التطبيق','checkUpdate',undefined,'يحتاج اتصالًا عند البحث فقط؛ يستمر العرض المحلي دون اتصال.');check.disabled=!update.supported||!update.configured;
      var install = nativeAction('tv-update-install','تنزيل التحديث وتثبيته','installUpdate');install.disabled=!update.supported||!update.configured||!update.availableVersion;
      return [
        {id:'tv-home',title:nativeSectionTitles['tv-home'],help:'اختيار HOME إعداد نظام مستقل عن مسودة بيانات الجامع، ويغيّر وظيفة زر Home. لا يعطل مشغّل TCL الأصلي.',rows:[{id:'tv-home-status',label:'الحالة الحالية',kind:'info',value:homeText},request,nativeAction('tv-change-home','تغيير واجهة البدء','openHomeSettings'),nativeAction('tv-system-settings','إعدادات التلفزيون','openSystemSettings')]},
        {id:'tv-system',title:nativeSectionTitles['tv-system'],help:device.message||'تفتح هذه الخيارات صفحات النظام المتاحة في طرازك. الرجوع يعيدك إلى شاشة الجامع.',rows:systemRows},
        {id:'tv-power',title:nativeSectionTitles['tv-power'],help:(power.message||'')+'\nهذه إعدادات جهاز مستقلة. غيّر الحقول ثم اختر «حفظ إعداد الطاقة الآن». الجدول يعتم العرض داخل التطبيق؛ لا يعد بإطفاء التلفاز كهربائيًا أو إيقاظه من الاستعداد.',rows:[{id:'tv-power-status',label:'حالة الطاقة',kind:'info',value:power.screenBlack?'العرض معتم الآن':power.active?'العرض نشط':'حسب إعداد النظام'},mode,start,end,savePower]},
        {id:'tv-update',title:nativeSectionTitles['tv-update'],help:'فحص التحديث اختياري. التثبيت يحتاج موافقتك في نافذة Android؛ لا يغيّر التطبيق نفسه بصمت.',rows:[{id:'tv-update-status',label:'الإصدار والحالة',kind:'info',value:(update.installedVersion||'غير محدد')+' — '+(update.message||'خدمة التحديث غير مهيأة')+(typeof update.progress==='number'&&update.progress>0?' — '+update.progress+'%':'')},check,install,nativeAction('tv-update-cancel','إلغاء مهمة التحديث','cancelUpdate')]},
        {id:'tv-device-setup',title:nativeSectionTitles['tv-device-setup'],help:'تعرض خطة إعداد الجهاز قبل أي تغيير. إعدادات الجامع والمواقيت مستقلة عنها.',rows:[nativeAction('tv-device-setup-open','فتح تهيئة التلفاز','deviceSetup')]}
      ];
    }
  };
  function refreshNativePanel(event) {
    if (event && event.type === 'mosque-native-power-result' && event.detail && event.detail.saved === true) powerDraft = null;
    if (window.MosqueTV && window.MosqueTV.isOpen()) window.MosqueTV.refreshNative();
    if (event && event.detail && event.detail.message) message(String(event.detail.message),event.detail.success===false);
  }
  window.addEventListener('mosque-native-update-result',refreshNativePanel);
  window.addEventListener('mosque-native-power-result',refreshNativePanel);
  window.addEventListener('mosque-native-control-result',function(){if(window.MosqueControl)window.MosqueControl.refreshNative();});
  var dialog = document.getElementById('settingsDialog');
  if (dialog) new MutationObserver(function () {
    if (dialog.open) ensureStartupPanel();
    if (dialog.open && !dialog.contains(document.activeElement)) { var first = controls()[0]; if (first) first.focus(); }
  }).observe(dialog, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
})();
