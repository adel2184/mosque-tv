'use strict';
// Data-only reader. No upstream scripts, binaries, notes, or archive paths are executed/extracted.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const ROOT=path.resolve(__dirname,'..'),PIN='3cd274f866b71ec15e4f7d8c796514b0baa8033c';
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
  const match=/\b(?:Android(?:\s+TV)?|Google\s+TV)\s+(\d{1,2})(?:\b|\.)/i.exec(os);
  return match&&Number(match[1])>=1&&Number(match[1])<=99?Number(match[1]):null;
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
function generate(options={}){
  const archive=options.archive||path.join(ROOT,'research/cleanyourtv-pinned.zip'),treePath=options.tree||path.join(ROOT,'research/cleanyourtv-tree.json');
  const tree=JSON.parse(fs.readFileSync(treePath,'utf8'));
  if(tree.sha!==PIN||tree.truncated||!Array.isArray(tree.tree))throw Error('Pinned Git tree is missing or truncated.');
  const blobs=new Map(tree.tree.filter(row=>row.type==='blob').map(row=>[row.path,row]));
  const read=zipReader(fs.readFileSync(archive)),verified=[];
  function selected(file){
    const reference=blobs.get(file);if(!reference||reference.mode!=='100644'||!/^([a-f0-9]{40})$/.test(reference.sha))throw Error('Selected source is not a regular pinned blob: '+file);
    const bytes=read('cleanyourtv-'+PIN+'/'+file);
    if(gitBlob(bytes)!==reference.sha)throw Error('Selected source Git blob mismatch: '+file);
    verified.push({path:file,gitBlobSHA:reference.sha,bytes:bytes.length});return bytes;
  }
  const license=selected('LICENSE');
  if(!license.toString('utf8').startsWith('MIT License\n\nCopyright (c) 2026 Gathin\n'))throw Error('Unexpected pinned license.');
  const files=[...blobs.keys()].filter(name=>/^examples\/[a-z0-9][a-z0-9-]*\/tv\.json$/.test(name)).sort();
  if(files.length!==416)throw Error('Pinned catalogue should contain 416 profile records, not a device-validation claim.');
  const profiles=files.map(file=>{
    const id=file.split('/')[1],tv=JSON.parse(selected(file).toString('utf8'));
    if(!tv||typeof tv.brand!=='string'||!tv.brand.trim()||tv.brand.length>128||/[\x00-\x1f]/.test(tv.brand))throw Error('Invalid source brand: '+id);
    return {id,brand:tv.brand.trim(),osMajor:osMajor(tv.os),modelSlug:modelSlug(id,tv.brand),packages:packages(selected('examples/'+id+'/debloat.txt').toString('utf8'))};
  });
  const document={schemaVersion:1,source:{repository:REPOSITORY,commit:PIN,license:'MIT'},profiles};
  const json=JSON.stringify(document)+'\n';
  const notice='CleanYourTV community profile data\n\nSource: '+REPOSITORY+'\nPinned commit: '+PIN+'\nPinned source paths: examples/*/tv.json and examples/*/debloat.txt; root LICENSE.\n\n416 community profile records are included. This count does not mean 416 TVs were\nvalidated by Mosque TV, and the upstream lists are not an automatic safety verdict.\nOnly profile ID, brand, explicit Android/Google TV major version, a model slug\nderived from the ID, and active valid package names are retained. Freeform notes,\nsource device descriptions, code, scripts, binary programs and fonts are excluded.\nEach selected raw source blob was verified against the pinned Git tree before\ngeneration. No upstream scripts were executed and no archive was fully extracted.\n\nDerived by dev/generate-device-profiles.cjs. Runtime package protection and explicit\noperator confirmation remain mandatory; exact model/version matching may refuse\nunknown, ambiguous or unsupported devices. No model or device aliases are invented.\n\nCopyright (c) 2026 Gathin. MIT license reproduced verbatim in CleanYourTV-MIT.txt.\nThe root license also mentions the upstream Outfit font; that font is not included.\n';
  if(options.write!==false){
    fs.writeFileSync(path.join(ROOT,'android/device-profiles.json'),json);
    fs.writeFileSync(path.join(ROOT,'licenses/CleanYourTV-MIT.txt'),license);
    fs.writeFileSync(path.join(ROOT,'licenses/CleanYourTV-NOTICE.txt'),notice);
  }
  return {document,json,license,notice,verified};
}
module.exports={PIN,REPOSITORY,PACKAGE,gitBlob,normalize,modelSlug,osMajor,packages,zipReader,generate};
if(require.main===module){const result=generate();console.log(JSON.stringify({profiles:result.document.profiles.length,verifiedBlobs:result.verified.length,packages:result.document.profiles.reduce((sum,row)=>sum+row.packages.length,0),missingAndroidVersion:result.document.profiles.filter(row=>row.osMajor===null).length,bytes:Buffer.byteLength(result.json),sha256:crypto.createHash('sha256').update(result.json).digest('hex')}));}
