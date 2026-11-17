/* Development only: package all runtime logic/data into one file. No build needed by operator. */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const jsonScript=(id,file)=>'<script id="'+id+'" type="application/json">'+JSON.stringify(JSON.parse(read(file))).replace(/</g,'\\u003c')+'</script>';
const data=[['config-data','dev/config.json'],['calendar-data','data/calendar.json'],['calendar-fixtures','data/calendar-fixtures.json'],['prayer-data','data/timetable.json'],['slides-data','dev/slides.json'],['display-content-data','dev/display-content.json']].map(([id,file])=>jsonScript(id,file)).join('\n');
const source=read('dev/app.js');
new Function(source);
const html=read('dev/shell.html').replace('<!--EMBEDDED_DATA-->',()=>data).replace('<!--APPLICATION_SCRIPT-->',()=>'<script id="application-code">\n'+source+'\n</script>');
fs.writeFileSync(path.join(root,'index.html'),html,'utf8');
console.log('Built index.html: '+Buffer.byteLength(html)+' bytes; inline CSS, classic JS and JSON.');
