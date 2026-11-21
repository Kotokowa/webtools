const test=require('node:test'),assert=require('node:assert/strict');
const {compile,group,selectRepeats}=require('../src/water-wave/batch-utils.js');
test('strict templates support nesting, decimals, arbitrary widths and explicit extensions',()=>{
 const p=compile('{depth}mm/{run:04d}_{freq}hz/{frame:05d}.{ext}','tif,tiff');
 const m=p.match('30.5mm/0007_6.2hz/00042.tiff');assert.equal(m.run,7);assert.equal(m.run_text,'0007');assert.equal(m.frame,42);assert.equal(m.depth,30.5);
 assert.equal(p.match('30mm/007_6hz/00042.tiff'),null);assert.equal(p.match('30mm/0007_6hz/00042.png'),null);
 assert.throws(()=>compile('../{run}.avi'));assert.throws(()=>compile('{run}_{run}.avi'));
});
test('strict grouping pairs each reference and preserves numerical experiment IDs',()=>{
 const paths=['006_20mm.avi','007_20mm.avi','008_20mm.avi','009_20mm.avi','006_jt.tiff','007_jt.tiff','008_jt.tiff','009_jt.tiff'];
 const groups=group(paths.map(path=>({path})),'{run}_{depth}mm.avi','{run}_jt.tiff');assert(groups.every(g=>!g.errors.length));
 assert.deepEqual(selectRepeats(groups,3).selected.map(g=>g.runText),['006','007','008']);assert.equal(selectRepeats(groups,0).selected.length,4);
});
test('one deficiency notice uses minimum actual count; ambiguous references are rejected',()=>{
 const groups=[...Array.from({length:2},(_,run)=>({condition:'a',run})),...Array.from({length:4},(_,run)=>({condition:'b',run})),{condition:'c',run:9}];
 const r=selectRepeats(groups,3);assert.equal(r.selected.length,6);assert.equal(r.notice,'部分数据实际实验次数1次，小于设置次数3次');
 const ambiguous=group(['1_20mm.avi','1_jt.tif','1_jt.tiff'].map(path=>({path})),'{run}_{depth}mm.avi','{run}_jt.{ext}');assert.equal(ambiguous[0].errors[0],'静水参考匹配不唯一');
});
test('batch preflight can resolve ambiguous static references without crossing experiment IDs',()=>{
 const paths=['001_30mm_short.avi','001_jt.tif','001_jt.tiff','002_jt.tiff'].map(path=>({path}));
 const parse=staticOverrides=>group(paths,'{run}_{depth}mm_short.avi','{run}_jt.{ext}',{staticOverrides})[0];
 const unresolved=parse();assert.equal(unresolved.referenceChoices.length,2);assert.equal(unresolved.reference,null);
 const picked=parse(new Map([[unresolved.key,'001_jt.tiff']]));assert.equal(picked.reference.path,'001_jt.tiff');assert.deepEqual(picked.errors,[]);
 const otherRun=parse(new Map([[unresolved.key,'002_jt.tiff']]));assert.equal(otherRun.reference,null);assert.equal(otherRun.errors[0],'静水参考匹配不唯一');
});
