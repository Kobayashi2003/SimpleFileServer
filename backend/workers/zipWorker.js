const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { parentPort, workerData } = require('worker_threads');

const { pathList, baseDirectory } = workerData;

const archive = archiver('zip', {
  zlib: { level: 9 } // Compression level
});

archive.on('error', (err) => {
  parentPort.postMessage({ type: 'error', error: err.message });
});

archive.on('data', (chunk) => {
  parentPort.postMessage({ type: 'data', chunk });
});

archive.on('end', () => {
  parentPort.postMessage({ type: 'end' });
});

try {
  for (const p of pathList) {
    const fullPath = path.resolve(baseDirectory, p);
    const stats = fs.statSync(fullPath);

    if (stats.isDirectory()) {
      archive.directory(fullPath, path.basename(fullPath));
    } else if (stats.isFile()) {
      archive.file(fullPath, { name: path.basename(fullPath) });
    }
  }

  // Finalize the archive (this will trigger the 'end' event)
  archive.finalize();

} catch (error) {
  parentPort.postMessage({ type: 'error', error: error.message });
}
