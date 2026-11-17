'use strict';
// Assemble the specifically requested USB bundle. Never executes a third-party APK.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'mosque-tv-launchapp-usb');
const vendor = path.join(root, 'third-party', 'launchapp');
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const mosqueHash = 'af0918b189179baf6cc33e331064c853afb719c27d731501b24f3921997c9c15';
const launchHash = 'e4735f8d973c84b2732ff521d6ab6791b3517e3b5483f0536e8b19309866ed26';
const release = JSON.parse(fs.readFileSync(path.join(vendor, 'release-metadata.json'), 'utf8').replace(/^\uFEFF/, ''));
const asset = release.assets.find(a => a.name === 'LaunchAPP-release.apk');
if (!asset || asset.digest !== 'sha256:' + launchHash) throw Error('Publisher asset digest mismatch');
if (hash(path.join(root, 'mosque-display-tv.apk')) !== mosqueHash) throw Error('Mosque APK differs from verified v1.1');
if (hash(path.join(vendor, 'LaunchAPP-release.apk')) !== launchHash) throw Error('LaunchAPP APK mismatch');
const signature = fs.readFileSync(path.join(vendor, 'signature-verification.txt'), 'utf8');
if (!signature.includes('Verified using v2 scheme (APK Signature Scheme v2): true') || !signature.includes('2e7eb9d0351008776d66bc9bc2eed19a31b2ba1b0e6d94524511ccb20c0af796')) throw Error('Missing verified LaunchAPP signature');
const guide = fs.readFileSync(path.join(__dirname, 'LAUNCHAPP_SETUP_AR.md'), 'utf8');
if (!guide.includes('1.0.0') || guide.includes('مسودة بانتظار')) throw Error('Guide still incomplete');
const files = [
  ['mosque-display-tv.apk', 'mosque-display-tv.apk'],
  ['third-party/launchapp/LaunchAPP-release.apk', 'LaunchAPP-release.apk'],
  ['android/LAUNCHAPP_SETUP_AR.md', 'LAUNCHAPP_SETUP_AR.md'],
  ['android/README_TV_AR.md', 'README_TV_AR.md'],
  ['android/TEST_REPORT_TV.md', 'TEST_REPORT_TV.md'],
  ['third-party/launchapp/THIRD_PARTY_NOTICE.txt', 'verification/THIRD_PARTY_NOTICE.txt'],
  ['third-party/launchapp/release-metadata.json', 'verification/launchapp-release-metadata.json'],
  ['third-party/launchapp/asset-metadata.json', 'verification/launchapp-asset-metadata.json'],
  ['third-party/launchapp/badging.txt', 'verification/launchapp-badging.txt'],
  ['third-party/launchapp/signature-verification.txt', 'verification/launchapp-signature-verification.txt'],
  ['third-party/launchapp/manifest-decoded.txt', 'verification/launchapp-manifest-decoded.txt'],
  ['third-party/launchapp/STATIC_AUDIT.md', 'verification/launchapp-static-audit.md'],
];
// Fixed output is confined to this workspace. No cleanup or unrelated file writes.
fs.mkdirSync(out, {recursive:true});
for (const [source, destination] of files) {
  const dest = path.join(out, destination);
  fs.mkdirSync(path.dirname(dest), {recursive:true});
  fs.copyFileSync(path.join(root, source), dest);
}
const start = fs.readFileSync(path.join(__dirname, 'LAUNCHAPP_START_AR.txt'), 'utf8').replace(/^\uFEFF/, '');
fs.writeFileSync(path.join(out, '01-ابدأ-هنا.txt'), '\uFEFF' + start, 'utf8');
const entries = [...files.map(f => f[1]), '01-ابدأ-هنا.txt'].sort();
const report = {
  assembledAt: new Date().toISOString(),
  purpose: 'Private USB preparation requested by the mosque operator',
  mosque: {package:'sa.mosque.display',version:'1.1',versionCode:2,sha256:mosqueHash},
  launchapp: {package:'com.tv.launchapp',version:'1.0.0',versionCode:1,edition:'Publisher Fire TV release; TCL Google TV compatibility untested',sha256:launchHash,source:asset.browser_download_url,publisherAssetDigest:asset.digest},
  deviceTests: 'NOT RUN: installation, startup, standby/wake and offline behavior not tested on TCL or emulator.',
  files: entries.map(name => ({name,bytes:fs.statSync(path.join(out,name)).size,sha256:hash(path.join(out,name))}))
};
fs.writeFileSync(path.join(out,'BUNDLE_REPORT.json'), JSON.stringify(report,null,2)+'\n');
const checks = [...entries,'BUNDLE_REPORT.json'].sort().map(name=>hash(path.join(out,name))+'  '+name).join('\n')+'\n';
fs.writeFileSync(path.join(out,'SHA256SUMS.txt'),checks,'utf8');
console.log(JSON.stringify({folder:out,files:entries.length+2,mosqueSHA256:mosqueHash,launchappSHA256:launchHash}));
