/* Same Python modules as desktop; runtime is isolated from the UI thread. */
let runtime;
importScripts('runtime-config.js');
async function boot() {
  if (runtime) return runtime;
  importScripts(WATERWAVE_RUNTIME.pyodide + 'pyodide.js');
  runtime = await loadPyodide({indexURL: WATERWAVE_RUNTIME.pyodide});
  await runtime.loadPackage(['numpy', 'scipy', 'pillow']);
  runtime.FS.mkdirTree('/home/pyodide/waterwave');
  for (const name of ['__init__.py', 'core.py', 'session.py', 'measurement.py', 'analysis.py', 'fields.py', 'colors.py', 'colormaps.json']) {
    const response = await fetch('python/' + name);
    if (!response.ok) throw Error('Python 算法文件缺失：' + name);
    runtime.FS.writeFile('/home/pyodide/waterwave/' + name, await response.text());
  }
  runtime.runPython('import json\nfrom waterwave.session import dispatch, sessions');
  return runtime;
}
self.onmessage = async ({data: {id, message}}) => {
  try {
    const py = await boot();
    if (message.op === 'boot') return self.postMessage({id, result: {ready: true}});
    if (message.op === 'artifact_bytes') {
      py.globals.set('_artifact', message.artifact);
      const path = py.runPython("str(__import__('waterwave.fields', fromlist=['artifacts']).artifacts[_artifact])");
      py.globals.delete('_artifact');
      const size = Math.min(4*1024*1024, py.FS.stat(path).size-message.offset);
      if (!Number.isSafeInteger(message.offset) || message.offset < 0 || size <= 0) throw Error('读取范围无效');
      const bytes = new Uint8Array(size), stream = py.FS.open(path, 'r');
      try { py.FS.read(stream, bytes, 0, size, message.offset); }
      finally { py.FS.close(stream); }
      return self.postMessage({id, result: {bytes: bytes.buffer, size}}, [bytes.buffer]);
    }
    if (message.op === 'download') {
      py.globals.set('_key', message.session);
      const path = py.runPython('str(sessions[_key].path)');
      const bytes = py.FS.readFile(path);
      return self.postMessage({id, result: {bytes: bytes.buffer}}, [bytes.buffer]);
    }
    py.globals.set('_message', JSON.stringify(message));
    const result = JSON.parse(py.runPython('json.dumps(dispatch(json.loads(_message)), ensure_ascii=False, allow_nan=False)'));
    py.globals.delete('_message');
    self.postMessage({id, result});
  } catch (error) {
    self.postMessage({id, error: String(error.message || error)});
  }
};
