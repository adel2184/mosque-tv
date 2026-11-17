'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),windows=process.platform==='win32',binary=name=>name+(windows?'.exe':'');
function find(dir,name){if(!fs.existsSync(dir))return null;for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory()){const found=find(file,name);if(found)return found;}else if(item.name===name)return file;}return null;}
const javaRoot=process.env.MOSQUE_JAVA_HOME||process.env.JAVA_HOME;
const javac=javaRoot?path.join(javaRoot,'bin',binary('javac')):find(path.join(root,'.android-tools/jdk'),binary('javac'));
if(!javac||!fs.existsSync(javac))throw Error('A JDK is required. Set MOSQUE_JAVA_HOME or JAVA_HOME.');
const java=path.join(path.dirname(javac),binary('java')),out=path.join(__dirname,'build/device-optimization-tests');fs.mkdirSync(out,{recursive:true});
function run(executable,args){const result=cp.spawnSync(executable,args,{cwd:root,encoding:'utf8',windowsHide:true});if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);}
run(javac,['-encoding','UTF-8','-source','8','-target','8','-d',out,path.join(__dirname,'src/sa/mosque/display/DeviceOptimization.java'),path.join(__dirname,'tests/DeviceOptimizationTest.java')]);
run(java,['-cp',out,'sa.mosque.display.DeviceOptimizationTest']);
