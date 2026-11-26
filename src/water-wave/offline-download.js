'use strict';
const project='Kotokowa/FresnelWaterwave';
const repository='https://github.com/'+project;
const platforms={'windows-amd64':'Windows · x64','darwin-amd64':'macOS · Intel','darwin-arm64':'macOS · Apple Silicon','linux-amd64':'Linux · x64','linux-arm64':'Linux · ARM64'};
async function json(url){const response=await fetch(url,{signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('无法读取发布信息');return response.json();}
async function showDownloads(){
  const fallback=json('offline-releases.json').catch(()=>null);
  const latest=json('https://api.github.com/repos/'+project+'/releases/latest').catch(()=>null);
  const [local,remote]=await Promise.all([fallback,latest]);
  const release=remote&&/^waterwave-v\d+\.\d+\.\d+$/.test(remote.tag_name)?{version:remote.tag_name,assets:remote.assets}:local;
  if(!release)throw Error('无法读取发布信息');
  const prefix=repository+'/releases/download/'+release.version+'/';
  const label=document.getElementById('release-version'),link=document.createElement('a');link.textContent=release.version;link.href=repository+'/releases/tag/'+release.version;label.replaceChildren('当前发布：',link);
  const gpuAssets=document.getElementById('gpu-packages');
  for(const asset of release.assets){
    const match=asset.name.match(/^waterwave-(windows-amd64|darwin-amd64|darwin-arm64|linux-amd64|linux-arm64)(-gpu)?\.zip$/);
    if(!match||!(asset.size>0))continue;
    const row=document.createElement('li'),a=document.createElement('a');a.textContent=platforms[match[1]]+(match[2]?' · 含 GPU':'')+' · '+(asset.size/1048576).toFixed(1)+' MiB';a.href=prefix+asset.name;row.append(a);
    (match[2]?gpuAssets:document.getElementById('packages')).append(row);
  }
  if(!gpuAssets.children.length)document.getElementById('download-status').textContent='当前发布暂未包含 GPU 套装；可分别下载标准版和加速器。';
}
showDownloads().catch(()=>{document.getElementById('download-status').textContent='未能读取下载列表，请从 GitHub Releases 查看。';});
