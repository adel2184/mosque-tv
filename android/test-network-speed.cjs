'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
const find=(dir,name)=>{for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory()){const found=find(file,name);if(found)return found;}else if(item.name===name)return file;}return null;};
const java=process.env.MOSQUE_JAVA_HOME?path.join(process.env.MOSQUE_JAVA_HOME,'bin/java.exe'):find(path.join(root,'.android-tools/jdk'),'java.exe');
const out=path.join(__dirname,'build/network-speed-tests');fs.mkdirSync(out,{recursive:true});
const run=(exe,args)=>{const result=cp.spawnSync(exe,args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:15000});if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);if(result.error)throw result.error;if(result.status)process.exit(result.status);};
run(path.join(path.dirname(java),'javac.exe'),['-encoding','UTF-8','-d',out,path.join(__dirname,'src/sa/mosque/display/NetworkSpeedProbe.java'),path.join(__dirname,'tests/NetworkSpeedProbeTest.java')]);
run(java,['-cp',out,'sa.mosque.display.NetworkSpeedProbeTest']);
