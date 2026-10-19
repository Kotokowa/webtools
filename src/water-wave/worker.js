/* Same Python modules as desktop; runtime is isolated from the UI thread. */
let runtime;
async function boot() {
  if (runtime) return runtime;
  importScripts('https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js');
  runtime = await loadPyodide({indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/'});
  await runtime.loadPackage(['numpy', 'scipy', 'pillow']);
  runtime.FS.mkdirTree('/home/pyodide/waterwave');
  for (const name of ['__init__.py', 'core.py', 'session.py']) {
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
