const assert=require('node:assert/strict'),path=require('node:path'),cp=require('node:child_process');
const {chromium}=require('playwright');const {aviFixture}=require('./avi-fixture.cjs');
(async()=>{
 const dir=path.resolve(process.argv[2]),exe=path.join(dir,process.platform==='win32'?'waterwave.exe':'waterwave');
 const proc=cp.spawn(exe,[],{env:{...process.env,WATERWAVE_NO_BROWSER:'1'},stdio:['ignore','pipe','pipe']});let errors='';proc.stderr.on('data',b=>errors+=b);
 let browser;
 try{
  const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('launcher timeout '+errors)),30000);proc.stdout.on('data',b=>{const m=b.toString().match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});proc.on('exit',c=>{clearTimeout(timer);reject(Error('launcher exit '+c+' '+errors));});});
  browser=await chromium.launch({headless:true});const context=await browser.newContext();const external=[];
  await context.route('**/*',route=>{const u=route.request().url();if(!u.startsWith(url+'/')&&!u.startsWith('blob:')&&!u.startsWith('data:')){external.push(u);return route.abort();}return route.continue();});
  const page=await context.newPage();const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));await page.goto(url);
  const health=await (await fetch(url+'/offline-status')).json();assert.equal(health.integrity,'verified');
  assert.equal(await page.locator('footer a').getAttribute('href'),'https://kotokowa.github.io/webtools/water-wave/');
  const restored=await page.evaluate(async()=>{
   const worker=new Worker('worker.js');let seq=0;const pending=new Map();worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.error?p.reject(Error(data.error)):p.resolve(data.result);};const call=message=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});worker.postMessage({id,message});});
   try{await call({op:'boot'});const ref=await call({op:'demo',reference:true});const image=await call({op:'demo',phase:.2});const s=await call({op:'start',data:ref.data,settings:{config:{water_depth_mm:20,masking:false,coordinate_calibration:false,displacement_calibration:false},exports:['rms_npz','rms_mat']}});await call({op:'frame',session:s.session,data:image.data,name:'demo_0001.png',frame_id:1,time_s:0});const result=await call({op:'finish',session:s.session});const bytes=await call({op:'artifact_chunk',artifact:result.artifact,offset:0});return {size:result.size,shape:result.field.shape,chunk:bytes.size};}finally{worker.terminate();}
  });assert(restored.size>1000);assert.deepEqual(restored.shape,[236,236]);assert(restored.chunk>0);
  const decoded=await page.evaluate(async b64=>{const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0)),worker=new Worker('video-worker.js');let seq=0;const pending=new Map();worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p||data.progressText)return;pending.delete(data.id);data.error?p.reject(Error(data.error)):p.resolve(data.result);};const call=m=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});worker.postMessage({id,...m});});try{const info=await call({op:'open',file:new File([bytes],'test.avi')});const frame=await call({op:'frame',index:1});return {info,bytes:frame.bytes.byteLength};}finally{worker.terminate();}},aviFixture().toString('base64'));
  assert.equal(decoded.info.count,3);assert.equal(decoded.info.fps,10);assert(decoded.bytes>128*128*3);
  await page.locator('#demo').click();await page.waitForFunction(()=>document.getElementById('run').disabled===false,{},{timeout:120000});await page.locator('#run').click();await page.waitForFunction(()=>document.getElementById('download').hidden===false,{},{timeout:120000});
  assert.equal(await page.locator('#focal-condition option').count(),1);assert.deepEqual(pageErrors,[]);assert.deepEqual(external,[]);
  console.log('PASS: native launcher, official signature, fresh offline Python/RMS/MAT, AVI, UI recovery, no external requests');
 }finally{if(browser)await browser.close();proc.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
