const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../src/water-wave');
test('water-wave tutorial has a top-bar entry and complete local chapters and illustrations',()=>{
 const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.match(index.split('</header>')[0],/id="guide-link" href="guide.html"/);
 const guide=fs.readFileSync(path.join(root,'guide.html'),'utf8');
 const chapters=[...guide.matchAll(/<section id="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(chapters.length,15);assert.equal(new Set(chapters).size,15);
 for(const m of guide.matchAll(/href="#([^"]+)"/g))assert(chapters.includes(m[1]),m[1]);
 const images=[...guide.matchAll(/<img src="([^"]+)" alt="([^"]+)"/g)];
 assert.equal(images.length,6);
 for(const [,src,alt] of images){assert(alt.length>10);const bytes=fs.readFileSync(path.join(root,src));assert.equal(bytes.subarray(1,4).toString(),'PNG');}
 for(const name of ['guide.css','guide.js','publisher-public-key.txt'])assert(fs.existsSync(path.join(root,name)));
});

test('water-wave home remains on webtools and releases live in the dedicated repository',()=>{
 const home='https://kotokowa.github.io/webtools/';
 const project='Kotokowa/FresnelWaterwave',repo='https://github.com/'+project;
 const accelerator=repo+'/releases/latest/download/waterwave-gpu-accelerator.zip';
 const downloads='https://kotokowa.github.io/FresnelWaterwave/offline-download.html';
 for(const name of ['index.html','guide.html','offline-download.html']){
  const html=fs.readFileSync(path.join(root,name),'utf8');
  assert(html.includes(`href="${home}"`));
  assert(html.includes(`href="${repo}"`));
  assert(html.includes(`href="${accelerator}"`));
  if(name==='guide.html')assert(html.includes(`href="${downloads}"`));
 }
 assert(fs.readFileSync(path.join(root,'advanced.js'),'utf8').includes(downloads));
 assert(fs.readFileSync(path.join(root,'offline-download.js'),'utf8').includes(project));
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'offline-releases.json'),'utf8'));
 assert.equal(manifest.release,`${repo}/releases/tag/${manifest.version}`);
 for(const asset of manifest.assets)assert.equal(asset.url,`${repo}/releases/download/${manifest.version}/${asset.name}`);
});
