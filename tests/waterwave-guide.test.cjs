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
