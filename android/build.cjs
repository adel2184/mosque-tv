/* Developer build, no Gradle/Node installation is needed on the television. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const tools=path.join(root,'.android-tools');
const find=(base,file)=>{if(!fs.existsSync(base))return null;for(const item of fs.readdirSync(base,{withFileTypes:true})){const full=path.join(base,item.name);if(item.isFile()&&item.name.toLowerCase()===file.toLowerCase())return full;if(item.isDirectory()){const found=find(full,file);if(found)return found;}}return null;};
const java=process.env.MOSQUE_JAVA_HOME?path.join(process.env.MOSQUE_JAVA_HOME,'bin/java.exe'):find(path.join(tools,'jdk'),'java.exe');
const javac=java&&path.join(path.dirname(java),'javac.exe'),keytool=java&&path.join(path.dirname(java),'keytool.exe');
const aapt2=process.env.MOSQUE_BUILD_TOOLS?path.join(process.env.MOSQUE_BUILD_TOOLS,'aapt2.exe'):find(path.join(tools,'build-tools'),'aapt2.exe');
const buildTools=aapt2&&path.dirname(aapt2);
const androidJar=process.env.MOSQUE_ANDROID_JAR||find(path.join(tools,'platform'),'android.jar');
if(!java||!aapt2||!androidJar)throw Error('Missing developer Java, Android Build Tools or platform android.jar. See docs/DEVELOPMENT.md.');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const releaseBuild = process.env.MOSQUE_RELEASE === '1';
const work=path.join(__dirname,'build',stamp);
const out=releaseBuild ? path.join(__dirname,'dist') : path.join(__dirname,'build','development-dist');
for(const part of ['classes','dex','assets/web','compiled-res'])fs.mkdirSync(path.join(work,part),{recursive:true});fs.mkdirSync(out,{recursive:true});
// Some native SDK utilities use the Windows ANSI path API. Relative ASCII paths
// keep the project usable even when its parent folder has an Arabic name.
const run=(exe,args,quiet=false)=>{args=args.map(arg=>typeof arg==='string'&&arg.startsWith(root+path.sep)?path.relative(root,arg):arg);const result=cp.spawnSync(exe,args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});if(result.stdout&&!quiet)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);if(result.error)throw result.error;if(result.status!==0)throw Error(path.basename(exe)+' failed with exit '+result.status);return result;};
const walk=(folder,extension)=>fs.readdirSync(folder,{withFileTypes:true}).flatMap(item=>{const full=path.join(folder,item.name);return item.isDirectory()?walk(full,extension):(!extension||full.endsWith(extension)?[full]:[]);});
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const bridge=fs.readFileSync(path.join(__dirname,'tv-bridge.js'),'utf8');new Function(bridge);
html=html.replace('<script id="application-code">',()=>'<script id="android-tv-bridge">\n'+bridge+'\n</script>\n<script id="application-code">');
// Authorize the known inline programs after inserting the native bridge. WebView's HTML
// parser normalizes CR and CRLF before CSP hashes the script's UTF-8 text.
const scriptIds = ['prayer-calculation-library', 'location-engine-code', 'profile-store-code',
  'locale-code', 'setup-provider-code', 'android-tv-bridge', 'application-code'];
const scriptHashes = scriptIds.map(id => {
  const tag = '<script id="' + id + '">';
  const start = html.indexOf(tag);
  const end = html.indexOf('</script>', start + tag.length);
  if (start < 0 || end < 0 || html.indexOf(tag, start + tag.length) !== -1) {
    throw Error('Missing or duplicate packaged script: ' + id);
  }
  const script = html.slice(start + tag.length, end).replace(/\r\n?/g, '\n');
  return "'sha256-" + crypto.createHash('sha256').update(script, 'utf8').digest('base64') + "'";
});
const policy = "script-src 'self' " + scriptHashes.join(' ') + "; worker-src blob:; child-src blob:";
if (!html.includes('<head>')) throw Error('Cannot apply packaged document policy');
html = html.replace('<head>', '<head>\n<meta http-equiv="Content-Security-Policy" content="' + policy + '">');
fs.writeFileSync(path.join(work,'assets/web/index.html'),html,'utf8');
// Everything copied here becomes readable by anyone holding the signed APK.
const assetGroups = [
  ['assets', 'web/assets', [
    'announcements/donation-qr.jpg', 'announcements/etiquette.svg',
    'data/location-catalog.js', 'fonts/NotoSansArabic-Arabic.woff2',
    'fonts/NotoSansArabic-Latin.woff2', 'fonts/OFL.txt', 'fonts/SOURCE.txt'
  ]],
  ['licenses', 'web/licenses', [
    'CleanYourTV-MIT.txt', 'CleanYourTV-NOTICE.txt', 'Unicode-3.0.txt',
    'adhan-MIT.txt', 'geonames-CC-BY-4.0.txt', 'geonames-NOTICE.txt',
    'hijridate-MIT.txt', 'location-display-names-NOTICE.txt', 'qrcodegen-MIT.txt'
  ]],
  ['services/reports/public', 'reports', [
    'index.html', 'report-form.js', 'report-schema.js', 'report.css'
  ]]
];
const canonicalRoot = fs.realpathSync(root);
for (const [source, destination, files] of assetGroups) {
  for (const name of files) {
    const input = path.join(canonicalRoot, source, name);
    if (fs.realpathSync(input) !== input || !fs.lstatSync(input).isFile()) {
      throw Error('Expected a regular packaged asset: ' + name);
    }
    const output = path.join(work, 'assets', destination, name);
    fs.mkdirSync(path.dirname(output), {recursive:true});
    fs.copyFileSync(input, output);
  }
}
fs.copyFileSync(path.join(root,'DATA_SOURCES.md'),path.join(work,'assets/web/DATA_SOURCES.md'));
fs.copyFileSync(path.join(__dirname,'SOURCES_LICENSES.md'),path.join(work,'assets/web/ANDROID_SOURCES_LICENSES.md'));
fs.copyFileSync(path.join(__dirname,'update-config.json'),path.join(work,'assets/update-config.json'));
fs.copyFileSync(path.join(__dirname,'phone.html'),path.join(work,'assets/phone.html'));
const deviceProfiles=JSON.parse(fs.readFileSync(path.join(__dirname,'device-profiles.json'),'utf8'));
fs.copyFileSync(path.join(__dirname,'device-profiles.json'),path.join(work,'assets/device-profiles.json'));
const profilePackages=[...new Set(deviceProfiles.profiles.flatMap(profile=>profile.packages))];
if(profilePackages.some(name=>!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(name)))throw Error('Invalid model package query.');
const packagedManifest=path.join(work,'AndroidManifest.xml');
const manifest=fs.readFileSync(path.join(__dirname,'AndroidManifest.xml'),'utf8');
const minSdk=Number(manifest.match(/android:minSdkVersion="(\d+)"/)?.[1]);
const targetSdk=Number(manifest.match(/android:targetSdkVersion="(\d+)"/)?.[1]);
if(!Number.isInteger(minSdk)||!Number.isInteger(targetSdk)||minSdk<24||targetSdk<minSdk)throw Error('Invalid SDK versions in AndroidManifest.xml');
fs.writeFileSync(packagedManifest,manifest.replace('</queries>',profilePackages.map(name=>'<package android:name="'+name+'" />').join('\n')+'\n</queries>'));
run(aapt2,['compile','--dir',path.join(__dirname,'res'),'-o',path.join(work,'resources.zip')]);
run(aapt2,['link','-o',path.join(work,'unsigned.apk'),'--manifest',packagedManifest,'-I',androidJar,'--java',path.join(work,'generated'),'-A',path.join(work,'assets'),path.join(work,'resources.zip')]);
const bootClasspath=[androidJar,path.join(buildTools,'core-lambda-stubs.jar')].map(file=>path.relative(root,file)).join(path.delimiter);
run(javac,['-encoding','UTF-8','-source','8','-target','8','-bootclasspath',bootClasspath,'-d',path.join(work,'classes'),...walk(path.join(__dirname,'src'),'.java'),...walk(path.join(__dirname,'vendor/qrcodegen'),'.java'),...walk(path.join(work,'generated'),'.java')]);
run(java,['-cp',path.join(buildTools,'lib/d8.jar'),'com.android.tools.r8.D8','--min-api',String(minSdk),'--lib',androidJar,'--output',path.join(work,'dex'),...walk(path.join(work,'classes'),'.class')]);
// Put DEX at the required ZIP root; preserve the compiled Android resources.
const jar=path.join(path.dirname(java),'jar.exe');
run(jar,['uf',path.join(work,'unsigned.apk'),'-C',path.join(work,'dex'),'classes.dex']);
// This packaging helper runs on the build JDK. Only the app classes target Android.
run(javac,['-encoding','UTF-8','-d',path.join(work,'helper'),path.join(__dirname,'tools/NormalizeApk.java')]);
run(java,['-cp',path.join(work,'helper'),'NormalizeApk',path.join(work,'unsigned.apk'),path.join(work,'normalized.apk')]);
run(path.join(buildTools,'zipalign.exe'),['-f','4',path.join(work,'normalized.apk'),path.join(work,'aligned.apk')]);
const defaultSigning = path.join(root, '.android-signing');
const signing = releaseBuild
  ? path.resolve(process.env.MOSQUE_RELEASE_SIGNING_DIR || defaultSigning)
  : path.join(defaultSigning, 'development');
if (!releaseBuild) fs.mkdirSync(signing, {recursive:true});
const key=path.join(signing,'mosque-display.p12'),password=path.join(signing,'password.txt');
if(!fs.existsSync(key)){
  if(releaseBuild)throw Error('Original release signing key is required; refusing to create a replacement key.');
  fs.writeFileSync(password,crypto.randomBytes(32).toString('hex'),{mode:0o600});
  run(keytool,['-genkeypair','-keystore',key,'-storetype','PKCS12','-alias','mosque-display','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Mosque Display Local Build','-storepass:file',password,'-keypass:file',password]);
}
const apk=path.join(out,'mosque-display-tv.apk');
run(java,['-jar',path.join(buildTools,'lib/apksigner.jar'),'sign','--ks',key,'--ks-key-alias','mosque-display','--ks-pass','file:'+password,'--out',apk,path.join(work,'aligned.apk')]);
const verify=run(java,['-jar',path.join(buildTools,'lib/apksigner.jar'),'verify','--verbose','--print-certs',apk]);
const badging=run(aapt2,['dump','badging',apk]);
const manifestTree=run(aapt2,['dump','xmltree','--file','AndroidManifest.xml',apk],true);
const sha=crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex');
const sdkMatches=(key,value)=>new RegExp('^'+key+":'"+value+"'\\s*$",'m').test(badging.stdout);
if(!sdkMatches('minSdkVersion',minSdk)||!sdkMatches('targetSdkVersion',targetSdk))throw Error('Packaged SDK versions differ from AndroidManifest.xml');
const report={builtAt:new Date().toISOString(),apk:'mosque-display-tv.apk',package:'sa.mosque.display',minSdk,targetSdk,sha256:sha,bytes:fs.statSync(apk).size,sourceIndexSHA256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'index.html'))).digest('hex'),signatureVerification:verify.stdout.trim(),badging:badging.stdout.trim(),manifestTree:manifestTree.stdout.trim(),deviceTests:'Device testing is separate from the build; see the release audit.',sourceFolder:work};
fs.writeFileSync(path.join(out,'build-report.json'),JSON.stringify(report,null,2));
fs.writeFileSync(path.join(out,'SHA256SUMS.txt'),sha+'  mosque-display-tv.apk\n');
console.log('Built signed APK: '+apk+' ('+report.bytes+' bytes)');
