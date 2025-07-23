const fs = require('fs');
const path = require('path');
const { parentPort, workerData } = require('worker_threads');

const { filePath, cacheDir, extension } = workerData;

async function processComic() {
  try {
    const pages = [];

    if (extension === '.cbz') {
      // Handle CBZ files (ZIP format)
      const AdmZip = require('adm-zip');
      
      const zip = new AdmZip(filePath);
      const entries = zip.getEntries();

      const imageEntries = entries.filter(entry => {
        const ext = path.extname(entry.entryName).toLowerCase();
        const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
        if (isImage) {
          pages.push(entry.entryName);
        }
        return isImage;
      });

      for (const entry of imageEntries) {
        const entryPath = path.join(cacheDir, entry.entryName);
        
        const entryDir = path.dirname(entryPath);
        if (!fs.existsSync(entryDir)) {
          fs.mkdirSync(entryDir, { recursive: true });
        }
        
        zip.extractEntryTo(entry, cacheDir, false, true);
      }
    }

    if (extension === '.cbr') {
      // Handle CBR files (RAR format)
      const unrar = require('node-unrar-js');

      const rarData = fs.readFileSync(filePath);
      const extractor = await unrar.createExtractorFromData({
        data: rarData.buffer,
        password: undefined
      });

      const extracted = extractor.extract();
      const extractedFiles = [...extracted.files];

      for (const file of extractedFiles) {
        const ext = path.extname(file.fileHeader.name).toLowerCase();
        if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext) && file.extraction) {
          pages.push(file.fileHeader.name);

          const entryPath = path.join(cacheDir, file.fileHeader.name);
          
          const entryDir = path.dirname(entryPath);
          if (!fs.existsSync(entryDir)) {
            fs.mkdirSync(entryDir, { recursive: true });
          }
          
          fs.writeFileSync(entryPath, file.extraction);
        }
      }
    }

    // Sort pages naturally by number
    pages.sort((a, b) => {
      const aMatch = a.match(/(\d+)/g);
      const bMatch = b.match(/(\d+)/g);

      if (aMatch && bMatch) {
        const aNum = parseInt(aMatch[aMatch.length - 1]);
        const bNum = parseInt(bMatch[bMatch.length - 1]);
        return aNum - bNum;
      }

      return a.localeCompare(b);
    });

    parentPort.postMessage({ 
      type: 'success', 
      pages: pages 
    });

  } catch (error) {
    parentPort.postMessage({ 
      type: 'error', 
      error: error.message 
    });
  }
}

processComic();
