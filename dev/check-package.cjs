'use strict';
// Development-only structural audit of the actual delivered document.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const {createHash}=require('node:crypto');
// Hashes identify the published upstream UMD and calendar table used offline.
const setupCalendar=JSON.parse(fs.readFileSync(path.join(root,'data/setup-calendar.json'),'utf8'));
for(const [file,expected] of [
  ['dev/vendor/adhan/adhan.umd.cjs','4564a7751a6ad38a10bd5d0e78a5d6c936c20502b95812b2cf2c39e130bb64b2'],
  ['dev/vendor/hijridate/ummalqura.py',setupCalendar.sourceSHA256]
]) {
  const digest=createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
  if(digest!==expected)throw Error('Source provenance mismatch for '+file);
}
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
let jsonBlocks=0;
for(const match of html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)){JSON.parse(match[1]);jsonBlocks++;}
if(jsonBlocks!==7)throw Error('Expected seven embedded JSON blocks.');
const source=['prayer-context.js','phone-settings.js','app.js','control-center.js','setup-wizard.js','profile-adapter.js','location-engine.js','profile-store.js','locale.js','setup-provider.js'].map(file=>fs.readFileSync(path.join(__dirname,file),'utf8')).join('\n');new Function(source);
if(/\b(?:fetch|XMLHttpRequest|importScripts|import)\s*\(/.test(source))throw Error('Prohibited runtime network/module dependency.');
if(/<(?:script|link)\b[^>]*(?:src|href)=["']https?:/i.test(html))throw Error('External core asset.');
const slides=JSON.parse(fs.readFileSync(path.join(__dirname,'slides.json'),'utf8'));
for(const slide of slides.filter(s=>s.type==='image'))if(!fs.existsSync(path.join(root,slide.path)))throw Error('Missing image '+slide.path);
const donation=JSON.parse(fs.readFileSync(path.join(__dirname,'display-content.json'),'utf8')).donation;
if(!fs.existsSync(path.join(root,donation.image)))throw Error('Missing donation QR image.');
if(slides.filter(s=>s.type==='text').length<10)throw Error('Need ten complete text slides.');
console.log(JSON.stringify({embeddedJsonBlocks:jsonBlocks,classicScriptSyntax:'passed',networkRuntimeCalls:0,textSlides:slides.filter(s=>s.type==='text').length,localImageReferences:'present',bytes:Buffer.byteLength(html)},null,2));
