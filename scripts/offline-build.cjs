// Copyright (c) 2026 Kotokowa. MIT License.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),base='https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
async function fetchFile(url,dest,hash){
  if(fs.existsSync(dest)&&(!hash||crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex')===hash))return;
  let last;for(let attempt=0;attempt<4;attempt++)try{const r=await fetch(url,{signal:AbortSignal.timeout(240000)});if(!r.ok)throw Error(url+' HTTP '+r.status);const b=Buffer.from(await r.arrayBuffer());if(hash&&crypto.createHash('sha256').update(b).digest('hex')!==hash)throw Error('Hash mismatch: '+url);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,b);return;}catch(e){last=e;}throw last;
}
function walk(dir,prefix=''){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name),prefix+e.name+'/'):[prefix+e.name]);}
async function prepare(out,codec){
  fs.mkdirSync(out,{recursive:true});cp.execFileSync(process.execPath,[path.join(root,'scripts/build.cjs')],{cwd:root,stdio:'inherit'});
  const tool=path.join(out,'tool');fs.cpSync(path.join(root,'dist/water-wave'),tool,{recursive:true});
  for(const name of ['offline-download.html','offline-download.js','offline-releases.json'])fs.rmSync(path.join(tool,name),{force:true});
  fs.writeFileSync(path.join(tool,'runtime-config.js'),"globalThis.WATERWAVE_RUNTIME=Object.freeze({offline:true,pyodide:'runtime/pyodide/',ffmpeg:'runtime/ffmpeg/'});\n");
  const py=path.join(tool,'runtime/pyodide');
  for(const name of ['pyodide.js','pyodide.asm.js','pyodide.asm.wasm','python_stdlib.zip','pyodide-lock.json'])await fetchFile(base+name,path.join(py,name));
  const lock=JSON.parse(fs.readFileSync(path.join(py,'pyodide-lock.json'),'utf8')),required=new Set();
  function visit(name){if(required.has(name))return;const pkg=lock.packages[name];if(!pkg)throw Error('Missing package '+name);required.add(name);pkg.depends.forEach(visit);}
  ['numpy','scipy','pillow'].forEach(visit);
  for(const name of required){const pkg=lock.packages[name];await fetchFile(base+pkg.file_name,path.join(py,pkg.file_name),pkg.sha256);}
  // Trim the package catalog to the complete dependency closure; a missing package cannot silently fetch online.
  lock.packages=Object.fromEntries([...required].map(k=>[k,lock.packages[k]]));fs.writeFileSync(path.join(py,'pyodide-lock.json'),JSON.stringify(lock));
  fs.cpSync(path.join(codec,'runtime'),path.join(tool,'runtime/ffmpeg'),{recursive:true});
  fs.cpSync(path.join(codec,'sources'),path.join(out,'licenses/ffmpeg'),{recursive:true});
  fs.copyFileSync(path.join(root,'offline/Dockerfile.ffmpeg'),path.join(out,'licenses/ffmpeg/Dockerfile'));
  fs.copyFileSync(path.join(root,'LICENSE'),path.join(out,'LICENSE'));
  fs.copyFileSync(path.join(root,'waterwave/LICENSE-FCD.txt'),path.join(out,'licenses/LICENSE-FCD.txt'));
  for(const [name,url] of Object.entries({Pyodide:'https://cdn.jsdelivr.net/gh/pyodide/pyodide@0.27.7/LICENSE',Python:'https://cdn.jsdelivr.net/gh/python/cpython@v3.12.7/LICENSE',NumPy:'https://cdn.jsdelivr.net/gh/numpy/numpy@v2.0.2/LICENSE.txt',SciPy:'https://cdn.jsdelivr.net/gh/scipy/scipy@v1.14.1/LICENSE.txt',Pillow:'https://cdn.jsdelivr.net/gh/python-pillow/Pillow@10.2.0/LICENSE',OpenBLAS:'https://cdn.jsdelivr.net/gh/OpenMathLib/OpenBLAS@v0.3.26/LICENSE'}))await fetchFile(url,path.join(out,'licenses',name+'.txt'));
  fs.mkdirSync(path.join(out,'source'),{recursive:true});
  fs.cpSync(path.join(root,'offline'),path.join(out,'source/offline'),{recursive:true});
  fs.copyFileSync(__filename,path.join(out,'source/offline-build.cjs'));
  fs.writeFileSync(path.join(out,'THIRD-PARTY-NOTICES.txt'),'Kotokowa original code: MIT. FCD: Sander Wildeman, MIT.\nPyodide/Python/NumPy/SciPy/Pillow/OpenBLAS retain their respective licenses; see licenses/ and wheel *.dist-info licenses.\nOffline FFmpeg is a separately replaceable LGPL build without GPL/nonfree codecs. Corresponding FFmpeg and binding sources and build recipe are in licenses/ffmpeg/. You may modify and replace these libraries and debug such modifications under their licenses.\nThe source of the water-wave UI and Python algorithms is provided directly in tool/.\n');
  fs.writeFileSync(path.join(out,'README.txt'),'Water Wave Lab — kotokowa\nhttps://kotokowa.github.io/webtools/water-wave/\n\nExtract the entire archive. Run waterwave.exe (Windows), start.command (macOS), or waterwave (Linux). Use a current Chrome or Edge for writable directories. No Python installation or internet connection is required. Close the launcher terminal to stop its loopback-only server.\nUnsigned application warnings may be shown by the operating system.\nMIT permits copying, modification, redistribution and commercial use with the copyright and license retained. Dependency licenses also apply.\nprovenance.json and provenance.sig identify an official build. The public key is also published on the online site. Local verification is not DRM and does not prohibit modification.\n');
  fs.writeFileSync(path.join(out,'dependency-manifest.json'),JSON.stringify({pyodide:lock.info,packages:lock.packages,ffmpeg:'LGPL n5.1.4; see licenses/ffmpeg'},null,2));
}
async function pack(common,out,os,arch,variant){
  fs.cpSync(common,out,{recursive:true});
  const key=crypto.createPrivateKey(process.env.WATERWAVE_SIGNING_KEY||fs.readFileSync(process.env.WATERWAVE_SIGNING_KEY_FILE));
  const pub=crypto.createPublicKey(key).export({format:'der',type:'spki'}).subarray(-32).toString('base64');
  const trusted=fs.readFileSync(path.join(root,'offline/publisher-public-key.txt'),'utf8').trim();if(pub!==trusted)throw Error('Publisher key mismatch');
  const exe=os==='windows'?'waterwave.exe':'waterwave';
  cp.execFileSync('go',['build','-trimpath','-ldflags','-s -w -X main.publicKey='+pub,'-o',path.join(out,exe),path.join(root,'offline/main.go')],{env:{...process.env,GOOS:os,GOARCH:arch,CGO_ENABLED:'0'},stdio:'inherit'});
  if(os==='darwin'){fs.writeFileSync(path.join(out,'start.command'),'#!/bin/sh\ncd "$(dirname "$0")"\nexec ./waterwave\n');fs.chmodSync(path.join(out,'start.command'),0o755);}
  if(os!=='windows')fs.chmodSync(path.join(out,exe),0o755);
  if(variant==='gpu'){
    if(arch!=='amd64'||!['windows','linux'].includes(os))throw Error('The GPU bundle targets Windows/Linux x64');
    cp.execFileSync('python',[path.join(root,'scripts/native-bundle.py'),'--directory',path.join(out,'GPU-accelerator')],{stdio:'inherit'});
    fs.appendFileSync(path.join(out,'README.txt'),'\nGPU bundle: the standard offline launcher is still included. For NVIDIA acceleration, first read GPU-accelerator/README.md and use the accelerator launcher in that folder (Python 3.11+ and first-run internet access required).\n');
  }
  fs.writeFileSync(path.join(out,'publisher-public-key.txt'),pub+'\n');
  const files=Object.fromEntries(walk(out).filter(f=>!['provenance.json','provenance.sig'].includes(f)).sort().map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(out,name))).digest('hex')]));
  const manifest=Buffer.from(JSON.stringify({author:'kotokowa',website:'https://kotokowa.github.io/webtools/water-wave/',version:process.env.RELEASE_TAG||'development',platform:os+'-'+arch,variant:variant||'standard',files},null,2));
  fs.writeFileSync(path.join(out,'provenance.json'),manifest);fs.writeFileSync(path.join(out,'provenance.sig'),crypto.sign(null,manifest,key).toString('base64'));
}
if(require.main===module){const [mode,...args]=process.argv.slice(2);(mode==='prepare'?prepare(...args):mode==='pack'?pack(...args):Promise.reject(Error('Use prepare or pack'))).catch(e=>{console.error(e.message);process.exitCode=1;});}
module.exports={prepare,pack,walk};
