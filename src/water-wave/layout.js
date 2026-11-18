'use strict';
(() => {
  function group(title, nodes, id) {
    const details=document.createElement('details');details.className='option-group';if(id)details.id=id;
    const summary=document.createElement('summary');summary.textContent=title;details.append(summary,...nodes);return details;
  }
  function module(panel,title,id) {
    const heading=panel.querySelector('h2');heading?.remove();
    const details=group(title,[],id);details.className='module';
    const body=document.createElement('div');body.className='module-body';body.append(...panel.childNodes);details.append(body);panel.append(details);return details;
  }
  const source=document.querySelector('aside > section:first-child');
  const physical=document.querySelector('aside > section:nth-child(2)');
  const recovery=$('pipeline').closest('section'),batch=$('batch-directory').closest('section'),focus=$('focal-condition').closest('section');
  const viewer=document.querySelector('.viewer-panel'),workspace=document.querySelector('.workspace');
  const sourceFold=module(source,'影像来源','source-options');
  module(physical,'物理标定','physical-options');
  const recoveryBody=recovery.querySelector('.two');
  for(const [title,keys] of [['遮挡参数',['mask_dark','mask_mod','mask_saturation','mask_window','mask_min_blob','mask_grow','mask_guard','fill_ring']],['经验标定',['height_scale','cal_x_slope','cal_y_slope','cal_x_offset_cm','cal_y_offset_cm','cal_slope_error','cal_offset_error_cm']]]) {
    const grid=document.createElement('div');grid.className='two';for(const key of keys)grid.append($(key).closest('label'));
    recovery.append(group(title,[grid]));
  }
  recoveryBody.append($('lockin').closest('label'));
  module(recovery,'恢复与 RMS','recovery-options');
  const batchFrame=group('帧范围',[$('batch-start').parentElement.parentElement]);
  $('batch-repeats').closest('label').after(batchFrame);
  const batchReference=group('无波带片参考',[$('reference-directory'),$('reference-root-row'),...['reference-format','reference-static-format','reference-rms-format'].map(id=>$(id).closest('label'))],'batch-reference-options');
  batch.querySelector('.mini-actions').before(batchReference);
  const batchFold=module(batch,'本地批处理','batch-options');
  const frameRange=group('帧范围',[$('start').parentElement.parentElement,$('frame-list').closest('label')],'frame-options');
  $('fps').closest('label').before(frameRange);
  const sourceInfo=group('文件信息',[$('source-info'),$('ref-info'),$('video-note')]);sourceFold.querySelector('.module-body').append(sourceInfo);
  const viewerFold=module(viewer,'范围与采样','selection-options');
  document.querySelector('.geometry-editor').open=false;
  const rawReference=group('恢复无波带片参考', ['raw-reference-static','raw-reference-files','raw-reference-folder'].map(id=>$(id).closest('label')).concat($('compute-reference')),'raw-reference-options');
  focus.querySelector('.import-grid').after(rawReference);
  const focusGrid=$('focus-x').parentElement.parentElement;
  const focusExtra=document.createElement('div');focusExtra.className='two';
  for(const id of ['focus-half','focus-line','focus-axis-a','focus-axis-b'])focusExtra.append($(id).closest('label'));
  const focusDetails=group('分析参数',[focusExtra,$('focus-fill').closest('label'),$('focus-auto-angle').closest('label'),$('focus-angle').closest('label')],'focus-options');
  focusGrid.after(focusDetails);
  const metrics=$('focal-metrics'),metricsGroup=group('完整结果',[metrics],'full-metrics');focus.append(metricsGroup);
  const quickMetrics=document.createElement('div');quickMetrics.id='focal-summary';quickMetrics.className='metrics';quickMetrics.hidden=true;metricsGroup.before(quickMetrics);
  const focusFold=module(focus,'RMS 与聚焦','focal-module');
  const exportGrid=document.querySelector('.export-grid');
  const moreGrid=document.createElement('div');moreGrid.className='export-grid';
  const common=new Set(['height_npz','height_png','height_csv','lines','points','video','focal_line','focal_area']);
  for(const label of [...exportGrid.children])if(!common.has(label.querySelector('input').dataset.export))moreGrid.append(label);
  const moreExports=group('更多导出',[moreGrid],'more-exports');exportGrid.after(moreExports);
  const palette=document.createElement('label');palette.innerHTML='色图<select id="colormap"></select>';
  for(const name of Object.keys(WaterWaveColors))palette.querySelector('select').add(new Option(name,name));
  const colorSample=document.createElement('div');colorSample.id='color-sample';colorSample.setAttribute('aria-hidden','true');palette.append(colorSample);
  document.querySelector('.output-options').prepend(palette);
  document.querySelector('.output-options .help').hidden=true;
  const tasks=document.createElement('nav');tasks.className='task-nav';tasks.setAttribute('aria-label','处理方式');
  for(const [key,title] of [['images','图片／序列'],['folder','文件夹'],['video','视频'],['batch','本地批处理'],['focus','聚焦分析']]){
    const button=document.createElement('button');button.type='button';button.dataset.task=key;button.textContent=title;button.setAttribute('aria-pressed','false');button.onclick=()=>selectTask(key);tasks.append(button);
  }
  document.querySelector('.layout').before(tasks);
  let mode=null;
  function selectTask(key){
    mode=key;for(const b of tasks.children)b.setAttribute('aria-pressed',String(b.dataset.task===key));
    source.hidden=key==='batch'||key==='focus';batch.hidden=key!=='batch';
    sourceFold.open=['images','folder','video'].includes(key);batchFold.open=key==='batch';
    for(const [task,id] of [['images','files'],['folder','folder'],['video','video-file']])$(id).closest('label').hidden=key!==task;
    if(key==='focus'){
      workspace.prepend(focus);focusFold.open=true;viewerFold.open=false;
      rawReference.append(batchFrame,$('fps').closest('label'));
    } else {
      workspace.append(focus);focusFold.open=false;
      $('batch-repeats').closest('label').after(batchFrame);
      if(key==='batch')batchFrame.append($('fps').closest('label'));
      else sourceInfo.before($('fps').closest('label'));
    }
  }
  function refreshExports(){
    const count=moreGrid.querySelectorAll('input:checked').length;
    moreExports.querySelector('summary').textContent='更多导出'+(count?'（已选 '+count+'）':'');
  }
  function gradient(){const colors=WaterWaveColors[$('colormap').value];return 'linear-gradient(to top,'+colors.map(c=>'rgb('+c.join(',')+')').join(',')+')';}
  function legend(){const value=gradient();colorSample.style.background=value.replace('to top','to right');const bar=document.querySelector('.color-legend div');bar.style.background=value;}
  let renderVersion=0;
  async function recolor(){
    legend();const version=++renderVersion,colormap=$('colormap').value;
    await globalThis.WaterWaveAdvanced?.recolor(colormap);
    if(state.session&&!$('result-panel').hidden&&!state.busy){
      const result=await rpc({op:'preview',session:state.session,colormap});
      if(version===renderVersion)$('result').src='data:image/png;base64,'+result.preview;
    }
  }
  $('colormap').addEventListener('change',catchAction(recolor));
  document.addEventListener('change',e=>{if(e.target.matches('[data-export]'))refreshExports();});
  const method=document.querySelector('.method'),methodDetails=group('方法与说明',[]);method.before(methodDetails);methodDetails.append(method);
  globalThis.WaterWaveLayout={
    recolor,
    referenceReady(){if(mode==='focus')selectTask('images');viewerFold.open=true;},
    refreshExports(){refreshExports();legend();},
    fieldReady(){focus.hidden=false;},
    showMetrics(metrics){quickMetrics.replaceChildren();for(const [key,title] of [['line_gain','线聚焦效率'],['area_gain','面聚焦效率']])if(key in (metrics.fit_gain||{})){const item=document.createElement('div');item.textContent=title;const value=document.createElement('b');value.textContent=metrics.fit_gain[key]===null?'—':Number(metrics.fit_gain[key]).toPrecision(4);item.append(value);quickMetrics.append(item);}quickMetrics.hidden=false;}
  };
  refreshExports();legend();
})();
