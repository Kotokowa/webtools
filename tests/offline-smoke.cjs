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
  assert.equal(await page.locator('#colormap').inputValue(),'jet');
  assert.equal(await page.locator('.module[open]').count(),0);
  assert.equal(await page.locator('[data-task]').count(),5);
  const guide=await context.newPage();await guide.goto(url+'/guide.html');
  assert.equal(await guide.locator('#toc nav a').count(),15);
  await guide.locator('img').evaluateAll(images=>images.forEach(img=>img.loading='eager'));
  await guide.waitForFunction(()=>[...document.images].every(img=>img.complete&&img.naturalWidth>0));
  assert.equal(await guide.locator('img').count(),6);await guide.close();
  const restored=await page.evaluate(async()=>{
   const worker=new Worker('worker.js');let seq=0;const pending=new Map();worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.error?p.reject(Error(data.error)):p.resolve(data.result);};const call=message=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});worker.postMessage({id,message});});
   try{await call({op:'boot'});const ref=await call({op:'demo',reference:true});const image=await call({op:'demo',phase:.2});const s=await call({op:'start',data:ref.data,settings:{config:{water_depth_mm:20,masking:false,coordinate_calibration:false,displacement_calibration:false},exports:['rms_npz','rms_mat']}});await call({op:'frame',session:s.session,data:image.data,name:'demo_0001.png',frame_id:1,time_s:0});const result=await call({op:'finish',session:s.session});const bytes=await call({op:'artifact_chunk',artifact:result.artifact,offset:0});return {size:result.size,shape:result.field.shape,chunk:bytes.size};}finally{worker.terminate();}
  });assert(restored.size>1000);assert.deepEqual(restored.shape,[236,236]);assert(restored.chunk>0);
  const decoded=await page.evaluate(async b64=>{const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0)),worker=new Worker('video-worker.js');let seq=0;const pending=new Map();worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p||data.progressText)return;pending.delete(data.id);data.error?p.reject(Error(data.error)):p.resolve(data.result);};const call=m=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});worker.postMessage({id,...m});});try{const info=await call({op:'open',file:new File([bytes],'test.avi')});const frame=await call({op:'frame',index:1});return {info,bytes:frame.bytes.byteLength};}finally{worker.terminate();}},aviFixture().toString('base64'));
  assert.equal(decoded.info.count,3);assert.equal(decoded.info.fps,10);assert(decoded.bytes>128*128*3);
  await page.locator('#demo').click();await page.waitForFunction(()=>document.getElementById('run').disabled===false,{},{timeout:120000});await page.locator('#run').click();await page.waitForFunction(()=>document.getElementById('download').hidden===false,{},{timeout:120000});
  assert.equal(await page.locator('#focal-condition option').count(),1);assert.deepEqual(pageErrors,[]);assert.deepEqual(external,[]);
  const priorPreview=await page.locator('#result').getAttribute('src');await page.locator('#colormap').selectOption('gray');
  await page.waitForFunction(prior=>document.getElementById('result').src!==prior,priorPreview);
  assert(await page.locator('#result').evaluate(img=>{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const d=ctx.getImageData(0,0,c.width,c.height).data;for(let i=0;i<d.length;i+=4)if(d[i]!==d[i+1]||d[i]!==d[i+2])return false;return true;}));
  await page.evaluate(async()=>{const storage=await navigator.storage.getDirectory(),root=await storage.getDirectoryHandle('test-batch',{create:true});const ref=await rpc({op:'demo',reference:true});async function put(name,data){const h=await root.getFileHandle(name,{create:true}),w=await h.createWritable();await w.write(Uint8Array.from(atob(data),c=>c.charCodeAt(0)));await w.close();}for(const run of ['006','007']){await put(run+'_jt.png',ref.data);for(let i=1;i<=3;i++)await put(`${run}_20mm_frame_${String(i).padStart(5,'0')}.png`,(await rpc({op:'demo',phase:i*.4})).data);}window.showDirectoryPicker=async()=>root;});
  await page.locator('[data-task=batch]').click();await page.locator('#batch-directory').click();await page.locator('#batch-format').fill('{run}_{depth}mm_frame_{frame:05d}.png');await page.locator('#static-format').fill('{run}_jt.png');await page.locator('#batch-repeats').fill('3');await page.locator('#batch-run').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('逐工况'),null,{timeout:180000});
  assert.equal(await page.locator('#focal-condition option').count(),2);assert.equal(await page.locator('#repeat-notice').textContent(),'部分数据实际实验次数2次，小于设置次数3次');
  const saved=await page.evaluate(async()=>{const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('test-batch'),results=await root.getDirectoryHandle('results');const dirs=[];for await(const h of results.values())dirs.push(h);const log=JSON.parse(await(await(await dirs[0].getFileHandle('tasks.json')).getFile()).text());return log;});assert(saved.every(t=>t.status==='complete'));
  await page.locator('[data-task=focus]').click();await page.locator('#reference-rms-file').setInputFiles('test-results/reference.npz');await page.waitForFunction(()=>document.getElementById('reference-field-name').textContent==='reference.npz',null,{timeout:60000});
  await page.locator('#rms-file').setInputFiles('test-results/lens.npz');await page.waitForFunction(()=>document.getElementById('focal-condition').selectedOptions[0]?.textContent==='lens.npz',null,{timeout:60000});
  await page.locator('#focus-x').fill('0');await page.locator('#focus-y').fill('12.6');await page.locator('#focus-save').click();await page.locator('#focus-analyze').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='聚焦分析完成',null,{timeout:180000});
  const metrics=JSON.parse(await page.locator('#focal-metrics').textContent());assert(Math.abs(metrics.fit_gain.line_gain-4)<.01);assert(Math.abs(metrics.fit_gain.area_gain-4)<.01);
  assert.deepEqual(pageErrors,[]);assert.deepEqual(external,[]);
  console.log('PASS: native launcher, signature, illustrated guide, fresh offline Python/RMS/MAT, AVI, UI recovery, directory batch writes, manual focus and reference gain, no external requests');
 }finally{if(browser)await browser.close();proc.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
