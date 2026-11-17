'use strict';
// Development-only structural audit of the actual delivered document.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
let jsonBlocks=0;
for(const match of html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)){JSON.parse(match[1]);jsonBlocks++;}
if(jsonBlocks!==6)throw Error('Expected six embedded JSON blocks.');
const source=fs.readFileSync(path.join(__dirname,'app.js'),'utf8');new Function(source);
if(/\b(?:fetch|XMLHttpRequest|importScripts)\s*\(/.test(source)||/\b(?:import|export)\s/.test(source))throw Error('Prohibited runtime dependency.');
if(/<(?:script|link)\b[^>]*(?:src|href)=["']https?:/i.test(html))throw Error('External core asset.');
const slides=JSON.parse(fs.readFileSync(path.join(__dirname,'slides.json'),'utf8'));
for(const slide of slides.filter(s=>s.type==='image'))if(!fs.existsSync(path.join(root,slide.path)))throw Error('Missing image '+slide.path);
const donation=JSON.parse(fs.readFileSync(path.join(__dirname,'display-content.json'),'utf8')).donation;
if(!fs.existsSync(path.join(root,donation.image)))throw Error('Missing donation QR image.');
if(slides.filter(s=>s.type==='text').length<10)throw Error('Need ten complete text slides.');
console.log(JSON.stringify({embeddedJsonBlocks:jsonBlocks,classicScriptSyntax:'passed',networkRuntimeCalls:0,textSlides:slides.filter(s=>s.type==='text').length,localImageReferences:'present',bytes:Buffer.byteLength(html)},null,2));
