'use strict';
(function(root) {
  const allowed = new Set(['run', 'frame', 'depth', 'freq', 'amp', 'ext']);
  function compile(template, extensions='avi,mp4,mov,mkv,webm,tif,tiff,png,jpg,jpeg,bmp') {
    if (!template || template.startsWith('/') || template.includes('\\') || template.split('/').some(p=>p==='..')) throw Error('文件格式须为目录内的相对路径');
    let source='^', last=0; const seen=new Set();
    const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    for (const match of template.matchAll(/\{([a-z]+)(?::0?(\d+)d)?\}/g)) {
      const [full,key,width]=match;
      if(!allowed.has(key)||seen.has(key)||(width&&!['run','frame'].includes(key)))throw Error('文件格式变量无效：'+key);
      seen.add(key); source+=escape(template.slice(last,match.index));
      const pattern=key==='ext'?extensions.split(',').map(s=>escape(s.trim().replace(/^\./,''))).filter(Boolean).join('|'):
        ['run','frame'].includes(key)?(width?'\\d{'+Number(width)+',}':'\\d+'):'(?:\\d+(?:\\.\\d+)?)';
      source+='(?<'+key+'>'+pattern+')';last=match.index+full.length;
    }
    const literal=template.slice(last);
    if(/[{}]/.test(template.replace(/\{([a-z]+)(?::0?(\d+)d)?\}/g,'')))throw Error('文件格式括号无效');
    source+=escape(literal)+'$';const regex=new RegExp(source,'i');
    return {keys:[...seen],match(path){const m=regex.exec(path);if(!m)return null;const out={...m.groups};for(const key of seen)if(key!=='ext'){out[key+'_text']=out[key];out[key]=Number(out[key]);if(!Number.isFinite(out[key])||(['run','frame'].includes(key)&&!Number.isSafeInteger(out[key])))throw Error('编号或工况数值无效');}return out;}};
  }
  function group(entries, pattern, staticPattern, options={}) {
    const dynamic=compile(pattern,options.extensions), reference=compile(staticPattern,options.extensions);
    if(!dynamic.keys.includes('run'))throw Error('实验格式缺少 {run}');
    const defaults={depth:30,freq:6,amp:0,...options.defaults}; const groups=new Map(), statics=[];
    for(const entry of entries){const v=reference.match(entry.path);if(v)statics.push({...entry,values:v});}
    for(const entry of entries){
      const v=dynamic.match(entry.path);if(!v)continue;
      const c={...defaults,...v};const condition=JSON.stringify([c.depth,c.freq,c.amp,options.amplitudeUnit||'mm']);
      const key=condition+':'+v.run;
      if(!groups.has(key))groups.set(key,{key,condition,values:c,run:v.run,runText:v.run_text,entries:[],errors:[]});
      groups.get(key).entries.push({...entry,values:v});
    }
    for(const g of groups.values()){
      g.entries.sort((a,b)=>(a.values.frame??0)-(b.values.frame??0));
      const matches=statics.filter(s=>reference.keys.every(k=>k==='ext'||k==='frame'||s.values[k]===g.values[k]));
      g.referenceChoices=matches;
      g.reference=matches.find(item=>item.path===options.staticOverrides?.get(g.key))??(matches.length===1?matches[0]:null);
      if(!g.reference)g.errors.push(matches.length?'静水参考匹配不唯一':'缺少静水参考');
      if(!dynamic.keys.includes('frame')&&g.entries.length!==1)g.errors.push('实验编号重复');
      if(dynamic.keys.includes('frame')&&g.entries.some((e,i)=>i&&e.values.frame===g.entries[i-1].values.frame))g.errors.push('帧号重复');
      g.sequence=dynamic.keys.includes('frame');
    }
    return [...groups.values()].sort((a,b)=>a.condition.localeCompare(b.condition)||a.run-b.run);
  }
  function selectRepeats(groups, limit) {
    if(!Number.isSafeInteger(limit)||limit<0)throw Error('重复次数须为非负整数');
    const conditions=new Map();for(const group of groups){if(!conditions.has(group.condition))conditions.set(group.condition,[]);conditions.get(group.condition).push(group);}
    let minimum=Infinity;const selected=[];
    for(const list of conditions.values()){list.sort((a,b)=>a.run-b.run);if(limit&&list.length<limit)minimum=Math.min(minimum,list.length);selected.push(...(limit?list.slice(0,limit):list));}
    return {selected,notice:minimum<Infinity?`部分数据实际实验次数${minimum}次，小于设置次数${limit}次`:''};
  }
  const api={compile,group,selectRepeats};if(typeof module!=='undefined')module.exports=api;else root.WaterWaveBatch=api;
})(globalThis);
