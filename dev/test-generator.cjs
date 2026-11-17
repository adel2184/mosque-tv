/* Exercises the actual generator with leap-year coverage, keeping output in memory. */
'use strict';
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const {createRequire}=require('node:module');
const filename=path.join(__dirname,'generate-data.cjs');const realRequire=createRequire(filename);const captured=new Map();
const interceptedFS={...fs,mkdirSync(){},writeFileSync(name,value){captured.set(path.basename(name),String(value));}};
const sandbox={require(name){return ['node:fs','fs'].includes(name)?interceptedFS:realRequire(name);},__dirname,__filename:filename,process:{env:process.env,argv:[process.execPath,filename,'--year','2027'],version:process.version},console:{log(){}},Date,Intl,Set,Map,Buffer};
vm.runInNewContext(fs.readFileSync(filename,'utf8'),sandbox,{filename,timeout:30000});
const table=JSON.parse(captured.get('timetable.json'));const report=JSON.parse(captured.get('generation-report.json'));
if(table.records.length!==733||report.yearCounts['2027']!==365||report.yearCounts['2028']!==366||!table.records.some(row=>row.date==='2028-02-29'))throw Error('Leap-year output mismatch');
fs.mkdirSync(path.join(__dirname,'../qa'),{recursive:true});fs.writeFileSync(path.join(__dirname,'../qa/leap-generator-report.json'),JSON.stringify({...report,testMethod:'Actual generate-data.cjs executed with --year 2027; writes intercepted in memory; delivered 2026/2027 data unchanged.'},null,2));console.log(JSON.stringify({targetYear:2027,totalRecords:table.records.length,yearCounts:report.yearCounts,leapDay:true},null,2));
