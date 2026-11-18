/* Single-thread FFmpeg: no COOP/COEP headers or shared memory required.
 * Loaded only by the separate water-wave page when an AVI is imported.
 * Source files stay in this worker; WORKERFS reads the File without copying
 * the whole movie into the WASM heap. A short lossless BMP block is held at a time.
 */
let core, input, metadata;
const PREFETCH = 4;
const frameCache = new Map();
importScripts('runtime-config.js');
const base = WATERWAVE_RUNTIME.ffmpeg;
let errors = [];
function execute(method, ...args) {
  errors = []; core.reset();
  const code = core[method](...args);
  // This pinned core leaves ret=-1 after a successful ffprobe JSON write.
  // Validate the probe file below; ffmpeg frame extraction must return zero.
  if (code !== 0 && !(method === 'ffprobe' && code === -1)) throw Error(`AVI ${method} 失败（${code}）：` + errors.slice(-5).join(' '));
}
function rate(s) { const [a,b=1] = String(s).split('/').map(Number); return a/b; }
self.onmessage = async ({data: {id, op, file, index}}) => {
  try {
    if (op === 'open') {
      self.postMessage({id,progressText:'正在加载 AVI 解码脚本…'});
      importScripts(base + 'ffmpeg-core.js');
      self.postMessage({id,progressText:'正在下载 AVI 解码器…'});
      const response=await fetch(base+'ffmpeg-core.wasm',{signal:AbortSignal.timeout(120000)});
      if(!response.ok)throw Error('AVI 解码器下载失败：HTTP '+response.status);
      const reader=response.body.getReader(),chunks=[];let received=0,reported=0;
      while(true){const {done,value}=await reader.read();if(done)break;chunks.push(value);received+=value.length;if(received-reported>1048576){reported=received;self.postMessage({id,progressText:`正在下载 AVI 解码器：${(received/1048576).toFixed(1)} MiB…`});}}
      const wasmBinary=new Uint8Array(received);let offset=0;for(const part of chunks){wasmBinary.set(part,offset);offset+=part.length;}chunks.length=0;
      self.postMessage({id,progressText:'正在初始化 AVI 解码器并读取视频信息…'});
      core = await createFFmpegCore({wasmBinary});
      core.setLogger(({message}) => { errors.push(message); if (errors.length>12) errors.shift(); });
      core.FS.mkdir('/input');
      try { core.FS.mkdir('/cache'); } catch {}
      frameCache.clear();
      core.FS.mount(core.FS.filesystems.WORKERFS, {files: [file]}, '/input');
      input = '/input/' + file.name;
      execute('ffprobe', '-v','error','-select_streams','v:0','-show_entries',
        'stream=width,height,avg_frame_rate,r_frame_rate,nb_frames,codec_name,duration',
        '-of','json','-o','probe.json',input);
      const stream = JSON.parse(core.FS.readFile('probe.json',{encoding:'utf8'})).streams?.[0];
      core.FS.unlink('probe.json');
      if (!stream) throw Error('AVI 没有可读取的视频流');
      const fps = rate(stream.avg_frame_rate), nominal = rate(stream.r_frame_rate);
      if (!(fps>0) || !Number.isFinite(fps) || (nominal>0 && Math.abs(fps-nominal)>fps*1e-4)) throw Error('无法确认 AVI 恒定帧率，请使用本地版精确解码');
      const count = Number(stream.nb_frames);
      if (!Number.isSafeInteger(count) || count<1) throw Error('AVI 缺少可靠帧数，请使用本地版解码');
      metadata = {fps,count,width:stream.width,height:stream.height,codec:stream.codec_name};
      self.postMessage({id,result:metadata});
    } else if (op === 'frame') {
      if (!metadata || !Number.isInteger(index) || index<0 || index>=metadata.count) throw Error('AVI 帧索引无效');
      try {
        let bytes = frameCache.get(index);
        if (!bytes) {
          const count = Math.min(PREFETCH, metadata.count-index);
          frameCache.clear();
          for (let n=1;n<=PREFETCH;n++) { try { core.FS.unlink(`/cache/frame-${String(n).padStart(6,'0')}.bmp`); } catch {} }
          // Decode a short sequential block. The caller usually requests frames in
          // order, so one FFmpeg invocation serves several frames and avoids paying
          // the WASM/FFmpeg startup cost once per frame.
          execute('exec','-v','error','-ss',(index/metadata.fps).toFixed(12),'-i',input,
            '-map','0:v:0','-frames:v',String(count),'-an','-sn','-pix_fmt','bgr24',
            '-c:v','bmp','-f','image2','/cache/frame-%06d.bmp');
          for (let n=0;n<count;n++) {
            const path=`/cache/frame-${String(n+1).padStart(6,'0')}.bmp`;
            const part=core.FS.readFile(path); if (!part.length) continue;
            frameCache.set(index+n, new Uint8Array(part));
            try { core.FS.unlink(path); } catch {}
          }
          bytes = frameCache.get(index);
          if (!bytes) throw Error('未读取到指定 AVI 帧');
        }
        // Transfer a copy so the prefetched cache remains available for the next call.
        const out=bytes.slice();
        frameCache.delete(index);
        self.postMessage({id,result:{bytes:out.buffer}},[out.buffer]);
      } finally {}
    } else throw Error('未知视频操作');
  } catch (error) { self.postMessage({id,error:String(error.message || error)}); }
};
