/* Development only: package all runtime logic/data into one file. No build needed by operator. */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
// Keep the checked-in offline bundle identical on CRLF and LF checkouts.
const read=name=>fs.readFileSync(path.join(root,name),'utf8').replace(/\r\n?/g,'\n');
const jsonScript=(id,file)=>'<script id="'+id+'" type="application/json">'+JSON.stringify(JSON.parse(read(file))).replace(/</g,'\\u003c')+'</script>';
const data=[['config-data','dev/config.json'],['calendar-data','data/calendar.json'],['calendar-fixtures','data/calendar-fixtures.json'],['prayer-data','data/timetable.json'],['slides-data','dev/slides.json'],['display-content-data','dev/display-content.json'],['setup-calendar-data','data/setup-calendar.json']].map(([id,file])=>jsonScript(id,file)).join('\n');
fs.mkdirSync(path.join(root,'assets/data'),{recursive:true});
const catalogBytes=zlib.gunzipSync(fs.readFileSync(path.join(root,'data/location-catalog.json.gz')),{maxOutputLength:5*1024*1024});
const catalogManifest=JSON.parse(read('dev/vendor/geonames/source-manifest.json')).output;
if(catalogBytes.length!==catalogManifest.catalogBytes||crypto.createHash('sha256').update(catalogBytes).digest('hex')!==catalogManifest.catalogSHA256)throw Error('Location catalog differs from its source manifest.');
// Recreate the ignored development JSON before tests; the browser still receives the same classic JS asset.
fs.writeFileSync(path.join(root,'data/location-catalog.json'),catalogBytes);
fs.writeFileSync(path.join(root,'assets/data/location-catalog.js'),'window.MosquePlaces='+JSON.stringify(JSON.parse(catalogBytes.toString('utf8'))).replace(/</g,'\\u003c')+';\n');
const preload='<script src="assets/data/location-catalog.js"></script>\n'+[['prayer-calculation-library','dev/vendor/adhan/adhan.umd.cjs'],['location-engine-code','dev/location-engine.js'],['profile-store-code','dev/profile-store.js'],['locale-code','dev/locale.js'],['setup-provider-code','dev/setup-provider.js']].map(([id,file])=>'<script id="'+id+'">\n'+read(file)+'\n</script>').join('\n');
const source=['dev/prayer-context.js','dev/phone-settings.js','dev/app.js','dev/control-center.js','dev/setup-wizard.js','dev/profile-adapter.js'].map(read).join('\n');
new Function(source);
const html=read('dev/shell.html').replace('</style>',()=>['dev/control-center.css','dev/setup-wizard.css','dev/locale.css','dev/prayer-display.css'].map(read).join('\n')+'\n</style>').replace('<!--EMBEDDED_DATA-->',()=>data).replace('<!--APPLICATION_SCRIPT-->',()=>preload+'\n<script id="application-code">\n'+source+'\n</script>');
fs.writeFileSync(path.join(root,'index.html'),html,'utf8');
console.log('Built index.html: '+Buffer.byteLength(html)+' bytes; inline CSS, classic JS and JSON.');
