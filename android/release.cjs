/* Generate public release metadata from the exact signed APK; never reads signing secrets. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const ORIGINAL_CERT='4cb9564d63fd3f037d12e2ed98af1bf7255a7fb7ef53d6a57aba020b5e9b061e';
function generate(base=root){
  const dist=path.join(base,'android/dist');
  const manifest=fs.readFileSync(path.join(base,'android/AndroidManifest.xml'),'utf8');
  const attr=name=>{const match=manifest.match(new RegExp('\\b'+name+'="([^"]+)"'));if(!match)throw Error('Missing manifest '+name);return match[1];};
  const versionName=attr('android:versionName'),versionCode=Number(attr('android:versionCode')),minSdk=Number(attr('android:minSdkVersion'));
  if(!Number.isSafeInteger(versionCode)||versionCode<1||minSdk<24||!/^\d+\.\d+\.\d+$/.test(versionName))throw Error('Invalid release version/minSdk');
  const report=JSON.parse(fs.readFileSync(path.join(dist,'build-report.json'),'utf8'));
  const name='mosque-display-tv.apk',apk=path.join(dist,name),bytes=fs.readFileSync(apk);
  const sha=crypto.createHash('sha256').update(bytes).digest('hex');
  if(report.apk!==name||report.package!=='sa.mosque.display'||report.minSdk!==minSdk||report.sha256!==sha||report.bytes!==bytes.length||bytes.length>33554432||bytes.length===0)throw Error('APK/build report mismatch');
  const signing=report.signatureVerification||'';
  const signatureLines=signing.split(/\r?\n/);
  const signaturesValid=[2,3].every(v=>signatureLines.includes('Verified using v'+v+' scheme (APK Signature Scheme v'+v+'): true'));
  const originalSigner=['Signer #1','V3.0 Signer:'].some(label=>signatureLines.includes(label+' certificate SHA-256 digest: '+ORIGINAL_CERT));
  if(!signaturesValid||!signatureLines.includes('Number of signers: 1')||!originalSigner)throw Error('Release requires v2 and v3 signatures from the original signer');
  const badging=report.badging||'';
  if(!badging.includes("name='sa.mosque.display'")||!badging.includes("versionCode='"+versionCode+"'")||!badging.includes("versionName='"+versionName+"'")||!badging.includes("minSdkVersion:'"+minSdk+"'"))throw Error('Packaged APK version differs from manifest');
  const tag='v'+versionName;
  if(process.env.RELEASE_TAG&&process.env.RELEASE_TAG!==tag)throw Error('Release tag must equal '+tag);
  const feed={schemaVersion:1,packageName:'sa.mosque.display',versionName,versionCode,minSdk,apk:{name,size:bytes.length,sha256:sha}};
  fs.writeFileSync(path.join(dist,'update.json'),JSON.stringify(feed,null,2)+'\n');
  const checks=[name,'update.json'].map(file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(dist,file))).digest('hex')+'  '+file).join('\n')+'\n';
  fs.writeFileSync(path.join(dist,'SHA256SUMS.txt'),checks);
  const localUpdateNotes = [
    'أصبح الرجوع من إعدادات الجامع دون تعديل أسرع في اختبار المتصفح بجدول لعامين، وخُفّف البحث المتكرر عن الصلاة التالية.',
    'لاستخدام هاتف كمشرف، اتصل بشبكة المشرفين الخاصة وامسح QR، ثم طابق الرمز ووافق بريموت التلفاز. تستخدم الجلسة HTTP محليًا حتى 15 دقيقة. أدخل النصوص الحساسة بالريموت.',
    'من قسم «الإصدار والتحديث» اختر «البحث عن تحديث التطبيق». عندما يجهز الملف اختر «تنزيل التحديث وتثبيته» ووافق في نافذة Android. التثبيت فوق النسخة السابقة يحفظ بيانات الجامع ومواقيته.',
  ].join('\n\n');
  const prayerDisplayNotes=[
    'دعاء دخول المسجد من الأذان إلى الإقامة، وتنبيه الجوالات خلال الدقيقتين الأخيرتين وأول عشر ثوانٍ من شاشة الصفوف.',
    'أذكار بعد انتهاء مدة الصلاة، ثم دعاء الخروج عشر دقائق. مدة الأذكار الافتراضية خمس دقائق. غيّرها أو أوقف التنبيه من إعدادات الجامع ← العرض والأرقام.',
    'تذكيرات الجمعة وعدّاد الإفطار والفجر في رمضان يعملان من ساعة الجهاز والجدول والتقويم المحليين. تبقى الأدعية بالعربية عند اختيار الواجهة الإنجليزية.',
    'يقرأ التحديث ملف الجامع ومواقيته ونسخه الاحتياطية السابقة دون إعادة الإعداد.',
  ].join('\n\n');
  const phoneEditorNotes = [
    'يفتح رمز الاقتران صفحة واحدة على الهاتف فيها الريموت وكتابة النص ومحرر إعدادات الجامع بالعربية والإنجليزية.',
    'عدّل بيانات الجامع وشريط الإعلانات ومواعيد الإقامة والجمعة وتجاوزات الأذان والساعة والتاريخ والتنبيهات. يطبق التلفاز المسودة بعد الحفظ ويؤكد النتيجة على الجهازين.',
    'يمكن تصدير إعدادات الجامع إلى ملف JSON واستعادتها من الهاتف على شبكة المشرفين المحلية. يعمل التحديث فوق 2.4.0 بالتوقيع الأصلي.',
  ].join('\n\n');
  const changes=versionName==='2.5.1'?'\n\nتحسين إدارة جلسة الهاتف وموارد شاشة التلفاز والتحقق من الحزمة الموقّعة عند تجهيز التحديث.':versionName==='2.5.0'?'\n\n'+phoneEditorNotes:versionName==='2.4.0'?'\n\n'+prayerDisplayNotes:versionName==='2.3.3'?'\n\n'+localUpdateNotes:versionName==='2.3.2'?"\n\nتخفيف عبء رسم مركز التحكم وإعدادات الجامع بإزالة تمويه الخلفية الحي والظلال الثقيلة، وإيقاف حركة الشريط خلف القوائم مؤقتًا. تحديث الساعة والعد التنازلي فقط عند تغيّر النص، وتقليل إشعارات حالة الصلاة وتحديثات القوائم المكررة مع الحفاظ على التركيز والمسودات.\n\nلا تغيير في سرعة الريموت على مستوى النظام أو بيانات الجامع. يبقى تكبير عبارة الإقامة من 2.3.1. قياس استجابة الريموت على التلفزيون يجريه المستخدم بعد التحديث؛ لم يُوصل التلفزيون بالكمبيوتر في هذه الجولة.":versionName==='2.3.1'?"\n\nتكبير عبارة الإقامة «أقيموا صفوفكم» وتوسيطها على سطرين، بلون عاجي دافئ وواضح على خلفية سوداء. يتكيف الحجم مع دقة الشاشة مع هوامش آمنة، دون حركة أو وميض. يحافظ التحديث على الإعدادات والمواقيت والباركود والتوقيع الأصلي.\n\nلم تُوصل شاشة الاختبار بالكمبيوتر ولم يُثبّت عليها هذا الإصدار؛ تجربة التحديث من داخل التطبيق يجريها المستخدم بنفسه بعد النشر.":versionName==='2.3.0'?"\n\nتهيئة التلفاز بأربعة أقسام مناسبة للريموت: التطبيقات والحركة والتخزين والاستعادة. حفظ القيم الأصلية قبل تغييرها والتحقق من النتيجة، مع استعادة تطبيق واحد أو جميع تغييرات الأداة. ضبط الحركات اختياري على 0.5، ويعيد الأصل حرفيًا أو يحذف المفتاح الذي لم يكن موجودًا. يُتاح طلب تنظيف الكاش فقط عند انخفاض المساحة عن 1 GiB أو 10%؛ الكاش المحذوف غير قابل للاستعادة.\n\nدليل مجتمعي مثبت من CleanYourTV برخصة MIT؛ لا تُستخدم قائمة إلا عند تطابق غير ملتبس للشركة والموديل وإصدار Android، وتبقى فلاتر خدمات النظام وHOME مفعلة. لا حذف تلقائي للتطبيقات أو النسخة ذات التوقيع المختلف. التقارير اختيارية: معاينة محلية ثم موافقة صريحة قبل HTTPS إلى خدمة المشروع الخاصة، دون إرفاق بيانات الجامع أو معرّفات الأجهزة تلقائيًا.\n\nيحافظ التحديث على إعدادات الجامع والمواقيت والباركود والتوقيع الأصلي. يبقى التشغيل اليومي دون إنترنت. راجع تقرير التحقق لنتائج الاختبارات وحدودها.":versionName==='2.2.0'?'\n\nإعداد أول تشغيل بالعربية أو الإنجليزية: اختيار البلد والمدينة والمنطقة الزمنية ونظام الساعة والتاريخ وطريقة حساب المواقيت واسم الجامع. دليل مدن وتقويم أم القرى الكامل ومحرك الحساب مرفقة للعمل دون إنترنت. الحساب المحلي يحتاج مراجعة؛ جلب UmmahAPI اختياري وصريح عند الاتصال، وليس جدولًا رسميًا. يتوفر استيراد JSON محلي ومراجعة المصدر والتغطية قبل حفظ الملف الشخصي والإعدادات والجدول معًا. لا يُفرض معالج الإعداد على التثبيت السابق، وتبقى بيانات الجامع والحملة الحالية؛ يبدأ التثبيت الجديد ببطاقة تبرع مخفية حتى إعدادها. تبقى النصوص الدينية والأذكار الثمانية عشر بالعربية.':versionName==='2.1.0'?'\n\nمركز تحكم زجاجي جانبي: أربعة اختصارات سريعة، وصفوف قابلة للتخصيص حتى ستة، مع تذكر التركيز وحفظ مستقل على التلفاز. تبقى أقسام إعدادات الجامع متاحة. إيقاف العرض ومؤقته يعرضان السواد داخل التطبيق ولا يطفئان لوحة التلفاز. اختبار سرعة اختياري عند الطلب ينزّل حتى 5 ميجابايت؛ لا اتصال تلقائي. يحافظ التحديث على بيانات الجامع و18 ذكرًا و732 سجل مواقيت والباركود الأصلي.':'';
  fs.writeFileSync(path.join(dist,'RELEASE_NOTES_AR.txt'),'الإصدار '+versionName+' — الرمز '+versionCode+changes+'\n\nتثبيت تحديث للتطبيق الحالي من دون إلغاء تثبيته. احتفظ بنسخة مصدّرة من الإعدادات. التشغيل اليومي والمواقيت والمحتوى المحلي تعمل دون إنترنت؛ البحث عن تحديث وتنزيله يحتاجان اتصالًا مؤقتًا. يتطلب التثبيت موافقة المستخدم في شاشة Android.\n\nاختبارات البناء الآلي ليست اختبارًا على تلفاز فعلي. راجع دليل التثبيت والتقرير المرفقين لنتائج التحقق وحدودها.\n');
  console.log(JSON.stringify({tag,versionName,versionCode,minSdk,bytes:bytes.length,sha256:sha,certificateSHA256:ORIGINAL_CERT},null,2));
  return feed;
}
if(require.main===module)generate();
module.exports={generate,ORIGINAL_CERT};
