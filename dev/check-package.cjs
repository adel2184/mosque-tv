'use strict';
// Development-only structural audit of the actual delivered document.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
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
