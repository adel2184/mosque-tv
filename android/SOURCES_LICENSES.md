# مكونات ومصادر نسخة التلفاز 2.0.1

واجهة الجامع ووحدات Android كُتبت للمشروع. دُرس تصميم UrTV ولم تُنقل إضافاته غير واضحة الترخيص. لا يُضم LaunchAPP أو UrTV داخل APK.

- Project Nayuki QR Code generator Java 1.8.0، ترخيص MIT. أربع ملفات أصلية في android/vendor/qrcodegen مع إشعاراتها. licenses/qrcodegen-MIT.txt داخل APK. المصدر: https://github.com/nayuki/QR-Code-generator/tree/v1.8.0/java/src/main/java/io/nayuki/qrcodegen . للاقتـران المحلي فقط، ولا يستبدل صورة التبرع.
- Noto Sans Arabic، ترخيص SIL OFL، إشعاره ومصدره داخل assets/fonts ومضمّنان.
- HijriDate 2.3.0 وAdhan JS 4.4.3 بترخيص MIT، استُخدمتا لتوليد البيانات. الإشعارات في licenses والمصادر والمدى وحدود الدقة في DATA_SOURCES.md. لا حاجة لتنزيلهما أثناء التشغيل.
- صورة التبرع والنصوص قدمها المستخدم؛ الصورة ببايتاتها الأصلية. لا ادعاء باعتماد جهة أو اختبار مسح من بعيد.

JDK17 وSDK/Build Tools35 وNode أدوات للمطور فقط، لا تُوزع مع التطبيق. مصادر البناء التاريخية محفوظة محليًا في android/history/v1.1/SOURCES_LICENSES.md. لا تدخل مفاتيح التوقيع وكلمات المرور والأدوات أو جلسة ADB في الحزمة أو المستودع.

العرض يحافظ على الأصل https://appassets.androidplatform.net/assets/index.html والتخزين السابق. أذونات الحزمة INTERNET وACCESS_NETWORK_STATE وREQUEST_INSTALL_PACKAGES لوظائف التحديث والاقتران والتهيئة الصريحة. يبقى طلب الموارد الخارجية في WebView مرفوضًا. لا إذن تخزين عام أو إدارة جهاز أو خدمة وصول أو تراكب أو مستقبل إقلاع جديد.

نجاح التوقيع والبناء لا يثبت تشغيل كل وظائف TCL. تقارير الفحص تميز المعاينة ومحاكاة DOM عن اختبار التلفاز. قرارات HOME والتثبيت وتفويض التهيئة مستقلة عن JSON الجامع.
