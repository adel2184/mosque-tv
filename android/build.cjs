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
if(!java||!aapt2||!androidJar)throw Error('Missing developer Java / Android Build Tools 35 / platform android.jar. See SOURCES_LICENSES.md.');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const work=path.join(__dirname,'build',stamp),out=path.join(__dirname,'dist');
for(const part of ['classes','dex','assets/web','compiled-res'])fs.mkdirSync(path.join(work,part),{recursive:true});fs.mkdirSync(out,{recursive:true});
// Some native SDK utilities use the Windows ANSI path API. Relative ASCII paths
// keep the project usable even when its parent folder has an Arabic name.
const run=(exe,args,quiet=false)=>{args=args.map(arg=>typeof arg==='string'&&arg.startsWith(root+path.sep)?path.relative(root,arg):arg);const result=cp.spawnSync(exe,args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});if(result.stdout&&!quiet)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);if(result.error)throw result.error;if(result.status!==0)throw Error(path.basename(exe)+' failed with exit '+result.status);return result;};
const walk=(folder,extension)=>fs.readdirSync(folder,{withFileTypes:true}).flatMap(item=>{const full=path.join(folder,item.name);return item.isDirectory()?walk(full,extension):(!extension||full.endsWith(extension)?[full]:[]);});
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const bridge=fs.readFileSync(path.join(__dirname,'tv-bridge.js'),'utf8');new Function(bridge);
html=html.replace('<script id="application-code">',()=>'<script id="android-tv-bridge">\n'+bridge+'\n</script>\n<script id="application-code">');
fs.writeFileSync(path.join(work,'assets/web/index.html'),html,'utf8');
fs.cpSync(path.join(root,'assets'),path.join(work,'assets/web/assets'),{recursive:true});
fs.cpSync(path.join(root,'licenses'),path.join(work,'assets/web/licenses'),{recursive:true});
fs.copyFileSync(path.join(root,'DATA_SOURCES.md'),path.join(work,'assets/web/DATA_SOURCES.md'));
fs.copyFileSync(path.join(__dirname,'SOURCES_LICENSES.md'),path.join(work,'assets/web/ANDROID_SOURCES_LICENSES.md'));
fs.copyFileSync(path.join(__dirname,'update-config.json'),path.join(work,'assets/update-config.json'));
fs.copyFileSync(path.join(__dirname,'phone.html'),path.join(work,'assets/phone.html'));
run(aapt2,['compile','--dir',path.join(__dirname,'res'),'-o',path.join(work,'resources.zip')]);
run(aapt2,['link','-o',path.join(work,'unsigned.apk'),'--manifest',path.join(__dirname,'AndroidManifest.xml'),'-I',androidJar,'--java',path.join(work,'generated'),'-A',path.join(work,'assets'),'--min-sdk-version','24','--target-sdk-version','35',path.join(work,'resources.zip')]);
const bootClasspath=[androidJar,path.join(buildTools,'core-lambda-stubs.jar')].map(file=>path.relative(root,file)).join(path.delimiter);
run(javac,['-encoding','UTF-8','-source','8','-target','8','-bootclasspath',bootClasspath,'-d',path.join(work,'classes'),...walk(path.join(__dirname,'src'),'.java'),...walk(path.join(__dirname,'vendor/qrcodegen'),'.java'),...walk(path.join(work,'generated'),'.java')]);
run(java,['-cp',path.join(buildTools,'lib/d8.jar'),'com.android.tools.r8.D8','--min-api','24','--lib',androidJar,'--output',path.join(work,'dex'),...walk(path.join(work,'classes'),'.class')]);
// Put DEX at the required ZIP root; preserve the compiled Android resources.
const jar=path.join(path.dirname(java),'jar.exe');
run(jar,['uf',path.join(work,'unsigned.apk'),'-C',path.join(work,'dex'),'classes.dex']);
run(javac,['-encoding','UTF-8','--release','8','-d',path.join(work,'helper'),path.join(__dirname,'tools/NormalizeApk.java')]);
run(java,['-cp',path.join(work,'helper'),'NormalizeApk',path.join(work,'unsigned.apk'),path.join(work,'normalized.apk')]);
run(path.join(buildTools,'zipalign.exe'),['-f','4',path.join(work,'normalized.apk'),path.join(work,'aligned.apk')]);
const signing=path.join(root,'.android-signing');fs.mkdirSync(signing,{recursive:true});
const key=path.join(signing,'mosque-display.p12'),password=path.join(signing,'password.txt');
if(!fs.existsSync(key)){
  if(process.env.MOSQUE_RELEASE==='1')throw Error('Original release signing key is required; refusing to create a replacement key.');
  fs.writeFileSync(password,crypto.randomBytes(32).toString('hex'),{mode:0o600});
  run(keytool,['-genkeypair','-keystore',key,'-storetype','PKCS12','-alias','mosque-display','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Mosque Display Local Build','-storepass:file',password,'-keypass:file',password]);
}
const apk=path.join(out,'mosque-display-tv.apk');
run(java,['-jar',path.join(buildTools,'lib/apksigner.jar'),'sign','--ks',key,'--ks-key-alias','mosque-display','--ks-pass','file:'+password,'--out',apk,path.join(work,'aligned.apk')]);
const verify=run(java,['-jar',path.join(buildTools,'lib/apksigner.jar'),'verify','--verbose','--print-certs',apk]);
const badging=run(aapt2,['dump','badging',apk]);
const manifestTree=run(aapt2,['dump','xmltree','--file','AndroidManifest.xml',apk],true);
const sha=crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex');
const report={builtAt:new Date().toISOString(),apk:'mosque-display-tv.apk',package:'sa.mosque.display',minSdk:24,targetSdk:35,sha256:sha,bytes:fs.statSync(apk).size,sourceIndexSHA256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'index.html'))).digest('hex'),signatureVerification:verify.stdout.trim(),badging:badging.stdout.trim(),manifestTree:manifestTree.stdout.trim(),deviceTests:'NOT RUN: no Android TV/emulator connected.',sourceFolder:work};
fs.writeFileSync(path.join(out,'build-report.json'),JSON.stringify(report,null,2));
fs.writeFileSync(path.join(out,'SHA256SUMS.txt'),sha+'  mosque-display-tv.apk\n');
console.log('Built signed APK: '+apk+' ('+report.bytes+' bytes)');
