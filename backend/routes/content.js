const config = require('../config');
const utils = require('../utils');
const { handleError } = require('../wappers/errorHandler');

const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

const express = require('express');
const router = express.Router();


router.get('/raw', handleError(async (req, res) => {
  const { path: requestedPath } = req.query;

  if (!(await utils.isValidPath(requestedPath))) {
    return res.status(400).json({ error: 'Invalid path provided' });
  }

  const fullPath = path.resolve(config.baseDirectory, requestedPath);
  const stats = await fs.promises.stat(fullPath);

  if (stats.isDirectory()) {
    const fileName = path.basename(fullPath);
    const encodedFileName = encodeURIComponent(fileName).replace(/%20/g, ' ');

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFileName}.zip`);
    res.setHeader('Transfer-Encoding', 'chunked');

    const worker = new Worker(path.join(__dirname, '../workers/zipWorker.js'), {
      workerData: {
        pathList: [requestedPath],
        baseDirectory: config.baseDirectory
      }
    });

    worker.on('message', (message) => {
      switch (message.type) {
        case 'data':
          res.write(message.chunk);
          break;

        case 'end':
          res.end();
          break;

        case 'error':
          if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to download files' });
          }
          break;
      }
    });

    worker.on('error', (error) => {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to download files' });
      }
    });

    worker.on('exit', (code) => {
      if (code !== 0 && !res.headersSent) {
        res.status(500).json({ error: 'Failed to download files' });
      }
    });

    req.on('close', () => worker.terminate());
    req.on('aborted', () => worker.terminate());

  } else if (stats.isFile()) {

    const fileName = path.basename(fullPath);
    const encodedFileName = encodeURIComponent(fileName).replace(/%20/g, ' ');
    const mimeType = await utils.getFileType(fullPath);
    const extension = path.extname(fullPath).toLowerCase();

    if (mimeType === 'image/vnd.adobe.photoshop' && config.processPsd) {
      const processedFilePath = await processPsdFile(fullPath);

      if (processedFilePath) {
        // If processing was successful, serve the processed file
        res.setHeader('Content-Type', config.psdFormat === 'png' ? 'image/png' : 'image/jpeg');
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodedFileName}.${config.psdFormat}`);

        const readStream = fs.createReadStream(processedFilePath, {
          highWaterMark: config.highWaterMark
        });

        readStream.on('error', (err) => {
          console.error('File read error:', err);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to read file' });
          } else {
            res.destroy();
          }
        });

        req.on('close', () => readStream.destroy());
        req.on('aborted', () => readStream.destroy());

        readStream.pipe(res);
      }
    }

    if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) {
      // Handle Range requests for video and audio files
      const range = req.headers.range;
      
      if (range) {
        const positions = range.replace(/bytes=/, "").split("-");
        const start = parseInt(positions[0], 10);
        const end = positions[1] ? parseInt(positions[1], 10) : stats.size - 1;
        const chunksize = (end - start) + 1;

        // Validate range
        if (start >= stats.size || end >= stats.size) {
          res.status(416).setHeader('Content-Range', `bytes */${stats.size}`);
          return res.end();
        }

        res.status(206); // Partial Content
        res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Length', chunksize);
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodedFileName}${extension}`);
        res.setHeader('Cache-Control', 'public, max-age=3600');

        const readStream = fs.createReadStream(fullPath, {
          start,
          end,
          highWaterMark: config.highWaterMark
        });

        readStream.on('error', (err) => {
          console.error('Media range read error:', err);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to read media file' });
          } else {
            res.destroy();
          }
        });

        req.on('close', () => readStream.destroy());
        req.on('aborted', () => readStream.destroy());

        return readStream.pipe(res);
      }
      
      // If no range request, set Accept-Ranges header for future requests
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodedFileName}${extension}`);
    res.setHeader('Content-Length', stats.size);

    const readStream = fs.createReadStream(fullPath, {
      highWaterMark: config.highWaterMark
    });

    readStream.on('error', (err) => {
      console.error('File read error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to read file' });
      } else {
        res.destroy();
      }
    });

    req.on('close', () => readStream.destroy());
    req.on('aborted', () => readStream.destroy());

    readStream.pipe(res);
  }
}));

router.get('/content', handleError(async (req, res) => {
  const { path: requestedPath, _encoding } = req.query;

  const encoding = _encoding || 'utf8';

  if (!(await utils.isValidFilePath(requestedPath))) {
    return res.status(400).json({ error: 'Invalid path provided' });
  }

  const fullPath = path.resolve(config.baseDirectory, requestedPath);
  const stats = await fs.promises.stat(fullPath);

  if (stats.size > config.contentMaxSize) {
    return res.status(413).json({ error: 'Content size exceeds the maximum limit' });
  }

  const contentType = await utils.getFileType(fullPath);
  if (!contentType.startsWith('text/')) {
    return res.status(415).json({ error: 'Unsupported media type' });
  }

  res.setHeader('Content-Type', `${contentType}; charset=${encoding}`);
  res.setHeader('Content-Length', stats.size);

  const readStream = fs.createReadStream(fullPath, {
    encoding,
    highWaterMark: config.highWaterMark
  });

  readStream.on('error', (err) => {
    console.error('File read error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to read file' });
    } else {
      res.destroy();
    }
  });

  req.on('close', () => readStream.destroy());
  req.on('aborted', () => readStream.destroy());

  readStream.pipe(res);
}));

router.get('/thumbnail', handleError(async (req, res) => {
  const { path: requestedPath, width = 300, height, quality = 80 } = req.query;

  const failMsg = 'Failed to generate thumbnail';

  if (!utils.isValidFilePathSync(requestedPath)) {
    return res.status(400).json({ error: 'Invalid path provided' });
  }

  const fullPath = path.resolve(config.baseDirectory, requestedPath);
  const stats = fs.statSync(fullPath);
  const mimeType = await utils.getFileType(fullPath);

  if (!config.generateThumbnail) {
    if (mimeType.startsWith('image/')) {
      res.setHeader('Content-Type', mimeType);
      return fs.createReadStream(fullPath).pipe(res);
    }
    return res.status(415).json({ error: 'Unsupported media type' });
  }

  if (mimeType === 'image/bmp') {
    // Cause sharp cannot handle bmp files, I return the original file directly
    res.setHeader('Content-Type', 'image/bmp');
    return fs.createReadStream(fullPath).pipe(res);
  }

  if (mimeType === 'image/x-icon') {
    // Cause sharp cannot handle ico files, I return the original file directly
    res.setHeader('Content-Type', 'image/x-icon');
    return fs.createReadStream(fullPath).pipe(res);
  }

  if (mimeType === 'image/gif' && !config.generateThumbnailForGif) {
    res.setHeader('Content-Type', 'image/gif');
    return fs.createReadStream(fullPath).pipe(res);
  }

  const cacheDir = config.thumbnailCacheDir;
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const crypto = require('crypto');

  const hashInput = `${fullPath}-${stats.mtimeMs}-w${width}-h${height || 'auto'}-q${quality}`;
  const cacheKey = crypto.createHash('md5').update(hashInput).digest('hex');
  const cachePath = path.join(cacheDir, `${cacheKey}.jpg`);

  if (fs.existsSync(cachePath)) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for one day
    return fs.createReadStream(cachePath).pipe(res);
  }

  if (mimeType === 'image/vnd.adobe.photoshop') {
    if (config.processPsd) {
      const processedPsdPath = await processPsdFile(fullPath);

      if (!processedPsdPath) {
        console.error('Error processing PSD file');
        return res.status(500).json({ error: failMsg });
      }

      const sharp = require('sharp');

      let transformer = sharp(processedPsdPath)
        .rotate() // Auto-rotate based on EXIF data
        .resize({
          width: parseInt(width),
          height: height ? parseInt(height) : null,
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality: parseInt(quality) });

      transformer
        .clone()
        .toFile(cachePath)
        .catch(err => {
          console.error('Error caching thumbnail:', err);
          if (fs.existsSync(cachePath)) {
            fs.unlinkSync(cachePath);
          }
        });

      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return transformer.pipe(res);
    }

    // If processing is disabled or failed, return the original file
    res.setHeader('Content-Type', 'image/vnd.adobe.photoshop');
    return fs.createReadStream(fullPath).pipe(res);
  }

  if (mimeType.startsWith('image/')) {

    const sharp = require('sharp');

    let transformer = sharp(fullPath)
      .rotate() // Auto-rotate based on EXIF data
      .resize({
        width: parseInt(width),
        height: height ? parseInt(height) : null,
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality: parseInt(quality) })
      .on('error', (err) => {
        console.error('Error generating image thumbnail:', err);
        res.status(500).json({ error: failMsg });
      });

    transformer
      .clone()
      .toFile(cachePath)
      .catch(err => {
        console.error('Error saving image thumbnail:', err);
        if (fs.existsSync(cachePath)) {
          fs.unlinkSync(cachePath);
        }
      });

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return transformer.pipe(res);
  }

  if (mimeType.startsWith('video/')) {

    const ffmpeg = require('fluent-ffmpeg');

    ffmpeg(fullPath)
      .screenshots({
        timestamps: ['10%'],
        filename: path.basename(cachePath),
        folder: path.dirname(cachePath),
        size: `${width}x${height || '?'}`
      })
      .on('end', () => {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        fs.createReadStream(cachePath).pipe(res);
      })
      .on('error', (err) => {
        console.error('Error generating video thumbnail:', err);
        res.status(500).json({ error: failMsg });
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
      });

    return;
  }

  if (mimeType === 'application/epub+zip') {
    // Extract cover image from EPUB file using adm-zip
    const AdmZip = require('adm-zip');

    // Parse EPUB file as ZIP
    const zip = new AdmZip(fullPath);
    const entries = zip.getEntries();

    // Find container.xml to get the path to content.opf
    const containerEntry = entries.find(entry => entry.entryName === 'META-INF/container.xml');
    if (!containerEntry) {
      console.error('Error generating EPUB thumbnail: container.xml not found');
      return res.status(500).json({ error: failMsg })
    }

    const containerXml = containerEntry.getData().toString('utf8');
    // Extract rootfile path from container.xml
    const rootfileMatch = containerXml.match(/<rootfile[^>]*full-path="([^"]*)"[^>]*>/);
    if (!rootfileMatch) {
      console.error('Error generating EPUB thumbnail: rootfile not found in container.xml');
      return res.status(500).json({ error: failMsg });
    }

    const contentOpfPath = rootfileMatch[1];
    const contentOpfEntry = entries.find(entry => entry.entryName === contentOpfPath);
    if (!contentOpfEntry) {
      console.error('Error generating EPUB thumbnail: content.opf not found');
      return res.status(500).json({ error: failMsg });
    }

    const contentOpfXml = contentOpfEntry.getData().toString('utf8');

    // Extract cover image ID from content.opf using multiple methods
    let coverId = null;

    // Method 1: Look for cover in metadata
    const metaMatches = contentOpfXml.match(/<meta[^>]*>/g);
    if (metaMatches) {
      for (const metaMatch of metaMatches) {
        // Split by spaces to get attributes
        const parts = metaMatch.split(/\s+/);
        let metaName = null;
        let metaContent = null;

        for (const part of parts) {
          if (part.startsWith('name=')) {
            // Extract name value
            const nameMatch = part.match(/name="([^"]*)"/);
            if (nameMatch) {
              metaName = nameMatch[1];
            }
          } else if (part.startsWith('content=')) {
            // Extract content value
            const contentMatch = part.match(/content="([^"]*)"/);
            if (contentMatch) {
              metaContent = contentMatch[1];
            }
          }
        }

        if (metaName === 'cover' && metaContent) {
          coverId = metaContent;
          break;
        }
      }
    }

    // Method 2: Look for cover in manifest with properties="cover-image" or id="cover"
    if (!coverId) {
      // Find all item tags and parse them more carefully
      const itemMatches = contentOpfXml.match(/<item[^>]*>/g);
      if (itemMatches) {
        for (const itemMatch of itemMatches) {
          // Split by spaces to get attributes
          const parts = itemMatch.split(/\s+/);

          let itemId = null;
          // Extract and check id value
          for (const part of parts) {
            if (part.startsWith('id=')) {
              const idMatch = part.match(/id="([^"]*)"/);
              if (idMatch) {
                itemId = idMatch[1];
                break;
              }
            }
          }

          if (itemId === 'cover') {
            coverId = itemId;
            break;
          }

          // Extract and check properties value
          let itemProperties = null;
          for (const part of parts) {
            if (part.startsWith('properties=')) {
              const propsMatch = part.match(/properties="([^"]*)"/);
              if (propsMatch) {
                itemProperties = propsMatch[1];
                break;
              }
            }
          }

          if (itemProperties === 'cover-image') {
            coverId = itemId;
            break;
          }
        }
      }
    }

    if (!coverId) {
      console.error('Error generating EPUB thumbnail: cover image not found');
      return res.status(500).json({ error: failMsg });
    }

    // Find the cover image entry in manifest using the same parsing approach
    const coverItemMatches = contentOpfXml.match(/<item[^>]*>/g);
    let coverHref = null;

    if (coverItemMatches) {
      for (const itemMatch of coverItemMatches) {
        const parts = itemMatch.split(/\s+/);
        let itemId = null;
        let href = null;

        for (const part of parts) {
          if (part.startsWith('id=')) {
            const idMatch = part.match(/id="([^"]*)"/);
            if (idMatch) {
              itemId = idMatch[1];
            }
          } else if (part.startsWith('href=')) {
            const hrefMatch = part.match(/href="([^"]*)"/);
            if (hrefMatch) {
              href = hrefMatch[1];
            }
          }
        }

        if (itemId === coverId && href) {
          coverHref = href;
          break;
        }
      }
    }

    if (!coverHref) {
      console.error('Error generating EPUB thumbnail: cover image not found in manifest');
      return res.status(500).json({ error: failMsg });
    }

    // Resolve relative path to absolute path within EPUB
    const contentOpfDir = path.dirname(contentOpfPath);
    const coverPath = path.join(contentOpfDir, coverHref).replace(/\\/g, '/');

    // Find the cover image in ZIP entries
    const coverEntry = entries.find(entry => entry.entryName === coverPath);
    if (!coverEntry) {
      console.error('Error generating EPUB thumbnail: cover image file not found in EPUB');
      return res.status(500).json({ error: failMsg });
    }

    // Extract cover image data
    const coverData = coverEntry.getData();

    const sharp = require('sharp');

    let transformer = sharp(coverData)
      .rotate() // Auto-rotate based on EXIF data
      .resize({
        width: parseInt(width),
        height: height ? parseInt(height) : null,
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality: parseInt(quality) })
      .on('error', err => {
        console.error('Error processing EPUB thumbnail:', err);
        return res.status(500).json({ error: failMsg });
      });

    transformer
      .clone()
      .toFile(cachePath)
      .catch(err => {
        console.error('Error saving EPUB thumbnail:', err);
        if (fs.existsSync(cachePath)) {
          fs.unlinkSync(cachePath);
        }
      });

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    return transformer.pipe(res);
  }

  res.status(415).json({ error: 'Unsupported Media Type' });
}));

router.get('/comic', handleError(async (req, res) => {
  const { path: requestedPath } = req.query;

  if (!(await utils.isValidFilePath(requestedPath))) {
    return res.status(400).json({ error: 'Invalid path provided' });
  }

  const fullPath = path.resolve(config.baseDirectory, requestedPath);
  const stats = await fs.promises.stat(fullPath);
  const extension = path.extname(fullPath).toLowerCase();

  if (!['.cbz', '.cbr'].includes(extension)) {
    return res.status(415).json({ error: 'Unsupported media type' });
  }

  const crypto = require('crypto');

  const hashInput = `${fullPath}-${stats.mtimeMs}`;
  const cacheKey = crypto.createHash('md5').update(hashInput).digest('hex');
  const cacheDir = path.join(config.tempDirectory, 'comic', cacheKey);

  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const worker = new Worker(path.join(__dirname, '../workers/comicWorker.js'), {
    workerData: {
      filePath: fullPath,
      cacheDir: cacheDir,
      extension: extension
    }
  });

  worker.on('message', (message) => {
    switch (message.type) {
      case 'success':
        const pages = message.pages.map(page =>
          `/api/comic-page/${cacheKey}/${encodeURIComponent(page)}`
        );
        res.json({ pages });
        break;

      case 'error':
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to process comic file' });
        }
        break;
    }
  });

  worker.on('error', (error) => {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to process comic file' });
    }
  });

  worker.on('exit', (code) => {
    if (code !== 0 && !res.headersSent) {
      res.status(500).json({ error: 'Failed to process comic file' });
    }
  });

  req.on('close', () => worker.terminate());
  req.on('aborted', () => worker.terminate());
}));

router.get('/comic-page/:cacheKey/:page', handleError(async (req, res) => {
  const { cacheKey, page } = req.params;

  if (!cacheKey || !page) {
    return res.status(400).json({ error: 'Invalid request parameters' });
  }

  if (!/^[a-f0-9]{32}$/.test(cacheKey)) {
    return res.status(400).json({ error: 'Invalid cache key format' });
  }

  const entryPath = path.resolve(config.tempDirectory, 'comic', cacheKey, decodeURIComponent(page));

  if (!entryPath.startsWith(path.resolve(config.tempDirectory, 'comic'))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  let stats;

  try {
    stats = await fs.promises.stat(entryPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Page not found' });
    }
    throw error;
  }

  if (!stats.isFile()) {
    return res.status(415).json({ error: 'Unsupported media type' });
  }

  const contentType = await utils.getFileType(entryPath);

  if (!contentType.startsWith('image/')) {
    return res.status(415).json({ error: 'Unsupported media type' });
  }

  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Content-Length', stats.size);

  const readStream = fs.createReadStream(entryPath, {
    highWaterMark: config.highWaterMark
  });

  readStream.on('error', (err) => {
    console.error('Comic page read error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to read comic page' });
    } else {
      res.destroy();
    }
  });

  req.on('close', () => readStream.destroy());
  req.on('aborted', () => readStream.destroy());

  readStream.pipe(res);
}));

router.get('/archive', handleError((req, res) => {
  // TODO: Implement archive endpoint
}));


async function processPsdFile(psdPath) {
  if (!config.processPsd) {
    return null;
  }

  try {
    // Generate a hash of the file path and last modified time to create a unique cache key
    const stats = fs.statSync(psdPath);

    const crypto = require('crypto');

    const hashInput = `${psdPath}-${stats.mtimeMs}`;
    const cacheKey = crypto.createHash('md5').update(hashInput).digest('hex');

    const outputPath = path.join(config.psdCacheDir, `${cacheKey}.png`);

    if (fs.existsSync(outputPath)) {
      return outputPath;
    }

    if (config.psdProcessor === 'imagemagick') {
      return await processWithImageMagick(psdPath, outputPath);
    } else {
      return await processWithPsdLibrary(psdPath, outputPath);
    }
  } catch (error) {
    console.error(`Error processing PSD file ${psdPath}: ${error.message}`);
    return null;
  }
}

// Process PSD file using ImageMagick
async function processWithImageMagick(psdPath, outputPath) {
  try {
    const { execSync } = require('child_process');

    // Process the PSD file using ImageMagick (convert command) to PNG
    // Note: This requires ImageMagick to be installed on the system
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const pngOutputPath = outputPath.replace(/\.[^.]+$/, '.png');
    // execSync(`magick "${psdPath}" "${pngOutputPath}"`);
    execSync(`magick "${psdPath}"[0] "${pngOutputPath}"`);

    if (fs.existsSync(pngOutputPath)) {
      return pngOutputPath;
    } else {
      console.error(`Failed to process PSD file with ImageMagick: ${psdPath} - Output file not created`);
      return null;
    }
  } catch (error) {
    console.error(`Error executing ImageMagick for PSD processing: ${error.message}`);
    return null;
  }
}

// Process PSD file using the psd library
async function processWithPsdLibrary(psdPath, outputPath) {
  try {
    const PSD = require('psd');

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const pngOutputPath = outputPath.replace(/\.[^.]+$/, '.png');

    await PSD.open(psdPath).then(psd => {
      return psd.image.saveAsPng(pngOutputPath);
    });

    if (fs.existsSync(pngOutputPath)) {
      return pngOutputPath;
    } else {
      console.error(`Failed to process PSD file with psd library: ${psdPath} - Output file not created`);
      return null;
    }
  } catch (error) {
    console.error(`Error processing PSD with psd library: ${error.message}`);
    return null;
  }
}


module.exports = router;