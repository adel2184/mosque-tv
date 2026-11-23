'use strict';
// Data-only reader. No upstream scripts, binaries, notes, or archive paths are executed/extracted.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const ROOT=path.resolve(__dirname,'..'),PIN='fe6cdcefa817da9f6facd3a17a3c5a086124f258';
const BASELINE_PIN='3cd274f866b71ec15e4f7d8c796514b0baa8033c';
const sources={
  baseline:{commit:BASELINE_PIN,count:416,index:'161408be79b4051c66de1e412a11b1810e60645a7f7ac8215db5c3b2e78d3b8a',archive:'cleanyourtv-pinned.zip',tree:'cleanyourtv-tree.json'},
  current:{commit:PIN,count:508,index:'c1cddbf09a95070d130844e731d46d72e19d33e3e6c1d3943acf5c21337263fc',archive:'cleanyourtv-'+PIN+'.zip',tree:'cleanyourtv-'+PIN+'.tree.json'}
};
const REPOSITORY='https://github.com/Gathin23/cleanyourtv';
const PACKAGE=/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
function gitBlob(bytes){return crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');}
function normalize(value){return String(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');}
function modelSlug(id,brand){
  const parts=id.split('-');
  for(let n=parts.length;n>0;n--)if(normalize(parts.slice(0,n).join('-'))===normalize(brand))return parts.slice(n).join('-');
  return id;
}
function osMajor(os){
  if(typeof os!=='string')return null;
  const versions=new Set();
  for(const match of os.matchAll(/\b(?:Android(?:\s+TV)?|Google\s+TV)\s+(\d{1,2})\b(?:\.\d+)*(?:\s*(?:\/|,|-|and|or|to)\s*(\d{1,2})\b)?/gi)){
    versions.add(Number(match[1]));
    if(match[2])versions.add(Number(match[2]));
  }
  const [version]=versions;
  return versions.size===1&&version>=1&&version<=99?version:null;
}
function packages(text){
  const result=new Set();
  for(const line of text.replace(/^\uFEFF/,'').split(/\r?\n/)){
    const value=line.split('#',1)[0].trim();if(!value)continue;
    if(!PACKAGE.test(value)||value.length>255)throw Error('Invalid active package line: '+value);
    result.add(value);
  }
  return [...result].sort();
}
function zipReader(bytes){
  let end=-1;
  for(let at=bytes.length-22;at>=Math.max(0,bytes.length-65557);at--)if(bytes.readUInt32LE(at)===0x06054b50&&at+22+bytes.readUInt16LE(at+20)===bytes.length){end=at;break;}
  if(end<0||bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6))throw Error('Unsupported ZIP end record.');
  const count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12),start=bytes.readUInt32LE(end+16);
  if(count===65535||bytes.readUInt16LE(end+8)!==count||start+size!==end)throw Error('Unsupported or malformed ZIP directory.');
  const entries=new Map();let at=start;
  for(let i=0;i<count;i++){
    if(at+46>end||bytes.readUInt32LE(at)!==0x02014b50)throw Error('Invalid ZIP central header.');
    const nameLength=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),next=at+46+nameLength+extra+comment;
    if(next>end)throw Error('ZIP name exceeds central directory.');
    const name=bytes.subarray(at+46,at+46+nameLength).toString('utf8');
    if(entries.has(name))throw Error('Duplicate ZIP path.');
    entries.set(name,{flags:bytes.readUInt16LE(at+8),method:bytes.readUInt16LE(at+10),compressed:bytes.readUInt32LE(at+20),length:bytes.readUInt32LE(at+24),offset:bytes.readUInt32LE(at+42)});at=next;
  }
  if(at!==end)throw Error('ZIP directory size mismatch.');
  return name=>{
    const item=entries.get(name);if(!item)throw Error('Missing selected ZIP file: '+name);
    const offset=item.offset;
    if(item.flags&1||![0,8].includes(item.method)||item.length>256*1024||offset+30>start||bytes.readUInt32LE(offset)!==0x04034b50)throw Error('Unsafe selected ZIP entry.');
    const nameLength=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28),data=offset+30+nameLength+extra;
    if(data+item.compressed>start||bytes.readUInt16LE(offset+8)!==item.method||bytes.readUInt16LE(offset+6)&1||bytes.subarray(offset+30,offset+30+nameLength).toString('utf8')!==name)throw Error('ZIP local entry differs from directory.');
    const compressed=bytes.subarray(data,data+item.compressed),raw=item.method===0?Buffer.from(compressed):zlib.inflateRawSync(compressed,{maxOutputLength:256*1024});
    if(raw.length!==item.length)throw Error('ZIP uncompressed length mismatch.');return raw;
  };
}
function snapshot(source){
  const tree=JSON.parse(fs.readFileSync(path.join(ROOT,'research',source.tree),'utf8'));
  if(tree.sha!==source.commit||tree.truncated||!Array.isArray(tree.tree))throw Error('Pinned Git tree is missing or truncated.');
  const blobs=new Map(tree.tree.filter(row=>row.type==='blob').map(row=>[row.path,row]));
  const read=zipReader(fs.readFileSync(path.join(ROOT,'research',source.archive))),verified=[];
  function selected(file){
    const reference=blobs.get(file);if(!reference||reference.mode!=='100644'||!/^([a-f0-9]{40})$/.test(reference.sha))throw Error('Selected source is not a regular pinned blob: '+file);
    const bytes=read('cleanyourtv-'+source.commit+'/'+file);
    if(gitBlob(bytes)!==reference.sha)throw Error('Selected source Git blob mismatch: '+file);
    verified.push({path:file,gitBlobSHA:reference.sha,bytes:bytes.length});return bytes;
  }
  const license=selected('LICENSE');
  if(!license.toString('utf8').startsWith('MIT License\n\nCopyright (c) 2026 Gathin\n'))throw Error('Unexpected pinned license.');
  const files=[...blobs.keys()].filter(name=>/^examples\/[a-z0-9][a-z0-9-]*\/tv\.json$/.test(name)).sort();
  if(files.length!==source.count)throw Error('Unexpected pinned catalogue size.');
  const profiles=files.map(file=>{
    const id=file.split('/')[1],tv=JSON.parse(selected(file).toString('utf8'));
    if(!tv||typeof tv.brand!=='string'||!tv.brand.trim()||tv.brand.length>128||/[\x00-\x1f]/.test(tv.brand))throw Error('Invalid source brand: '+id);
    return {id,brand:tv.brand.trim(),osMajor:osMajor(tv.os),modelSlug:modelSlug(id,tv.brand),packages:packages(selected('examples/'+id+'/debloat.txt').toString('utf8'))};
  });
  const index=verified.map(row=>row.path+' '+row.gitBlobSHA).sort().join('\n');
  if(crypto.createHash('sha256').update(index).digest('hex')!==source.index)throw Error('Pinned package and model source index mismatch.');
  return {profiles,license,verified};
}
function generate(options={}){
  const baseline=snapshot(sources.baseline),current=snapshot(sources.current);
  const oldById=new Map(baseline.profiles.map(row=>[row.id,row]));
  const withdrawn=new Set();
  for(const row of current.profiles){
    const old=oldById.get(row.id);
    if(!old)continue;
    const currentNames=new Set(row.packages);
    for(const name of old.packages)if(!currentNames.has(name))withdrawn.add(name);
  }
  const profiles=current.profiles.map(row=>{
    const old=oldById.get(row.id);
    const sameIdentity=old&&old.brand===row.brand&&old.modelSlug===row.modelSlug&&row.osMajor!==null&&old.osMajor===row.osMajor;
    const retained=sameIdentity?row.packages.filter(name=>old.packages.includes(name)&&!withdrawn.has(name)):[];
    return {...row,packages:retained};
  });
  const active=new Set(profiles.flatMap(row=>row.packages));
  const previous=new Set(baseline.profiles.flatMap(row=>row.packages));
  const restoreOnly=[...previous].filter(name=>!active.has(name)).sort();
  const document={schemaVersion:2,source:{repository:REPOSITORY,commit:PIN,baselineCommit:BASELINE_PIN,license:'MIT'},profiles,restoreOnly};
  const json=JSON.stringify(document)+'\n';
  const license=current.license;
  if(!license.equals(baseline.license))throw Error('Review the changed upstream license before updating the catalogue.');
  const notice=`CleanYourTV community profile data

Source: ${REPOSITORY}
Pinned commit: ${PIN}
Previous package eligibility baseline: ${BASELINE_PIN}
Selected source files: examples/*/tv.json, examples/*/debloat.txt and LICENSE.

The catalogue contains ${profiles.length} upstream model records. The count measures
source coverage. Mosque TV has not physically validated these devices.
Each record retains the ID, brand, an explicit single Android/Google TV major
version when available, and a model slug derived from the ID. New records
supply identification only. Package suggestions require inclusion for the
same identity in both snapshots. A package withdrawn for any reviewed model
is withheld across all records. Previously eligible names retained solely
for recovery can only restore a change recorded in the local app journal.

Derived by dev/generate-device-profiles.cjs. Each selected blob and the index
of selected blob identifiers were verified for both pins. Only data is read.
Runtime package protection and operator confirmation apply on the device.

Copyright (c) 2026 Gathin. MIT license reproduced verbatim in CleanYourTV-MIT.txt.
The root license also mentions the upstream Outfit font, which is not bundled.
`;
  if(options.write!==false){
    fs.writeFileSync(path.join(ROOT,'android/device-profiles.json'),json);
    fs.writeFileSync(path.join(ROOT,'licenses/CleanYourTV-MIT.txt'),license);
    fs.writeFileSync(path.join(ROOT,'licenses/CleanYourTV-NOTICE.txt'),notice);
  }
  return {document,json,license,notice,baseline,current,withdrawn:[...withdrawn].sort()};
}
module.exports={PIN,BASELINE_PIN,sources,REPOSITORY,PACKAGE,gitBlob,normalize,modelSlug,osMajor,packages,zipReader,generate};
if(require.main===module){const r=generate();console.log(JSON.stringify({profiles:r.document.profiles.length,verifiedBlobs:[r.baseline.verified.length,r.current.verified.length],packages:r.document.profiles.reduce((sum,row)=>sum+row.packages.length,0),missingAndroidVersion:r.document.profiles.filter(row=>row.osMajor===null).length,restoreOnly:r.document.restoreOnly,withdrawn:r.withdrawn,bytes:Buffer.byteLength(r.json),sha256:crypto.createHash('sha256').update(r.json).digest('hex')}));}
