#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { convertFigmaJsonToSvg } from '../lib/convert-figma-json-to-svg.mjs';

function usage() {
  console.error('Usage: node scripts/figma-json-to-svg.mjs <input.json> <output.svg> [--manifest /path/to/assets-manifest.json] [--assets-dir /path/to/assets]');
}

function parseArguments(argv) {
  const positional = [];
  const options = {
    manifestPath: undefined,
    assetsDir: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--manifest') {
      options.manifestPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--assets-dir') {
      options.assetsDir = argv[index + 1];
      index += 1;
      continue;
    }
    positional.push(token);
  }

  return {
    inputPath: positional[0],
    outputPath: positional[1],
    manifestPath: options.manifestPath,
    assetsDir: options.assetsDir,
  };
}

function mimeTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') {
    return 'image/png';
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg';
  }
  if (extension === '.webp') {
    return 'image/webp';
  }
  if (extension === '.gif') {
    return 'image/gif';
  }
  if (extension === '.svg') {
    return 'image/svg+xml';
  }
  return undefined;
}

function assetFromFile(filePath, sourceLabel) {
  const mimeType = mimeTypeFor(filePath);
  if (!mimeType) {
    return undefined;
  }
  return {
    mimeType,
    base64: fs.readFileSync(filePath).toString('base64'),
    source: sourceLabel || filePath,
  };
}

function loadAssetsFromDirectory(assetsDir) {
  if (!assetsDir) {
    return {};
  }

  const files = fs.readdirSync(assetsDir);
  return files.reduce((assets, fileName) => {
    const filePath = path.join(assetsDir, fileName);
    if (!fs.statSync(filePath).isFile()) {
      return assets;
    }

    const asset = assetFromFile(filePath, filePath);
    if (!asset) {
      return assets;
    }

    const imageRef = path.basename(fileName, path.extname(fileName));
    assets[imageRef] = asset;
    return assets;
  }, {});
}

function loadAssetsFromManifest(manifestPath) {
  if (!manifestPath) {
    return {};
  }

  const manifestDir = path.dirname(manifestPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const mappings = manifest.imageRefs || manifest;
  return Object.keys(mappings).reduce((assets, imageRef) => {
    const entry = mappings[imageRef];
    if (!entry) {
      return assets;
    }

    if (typeof entry === 'string') {
      const assetPath = path.isAbsolute(entry) ? entry : path.join(manifestDir, entry);
      const asset = assetFromFile(assetPath, assetPath);
      if (asset) {
        assets[imageRef] = asset;
      }
      return assets;
    }

    if (entry.dataUri) {
      assets[imageRef] = {
        dataUri: entry.dataUri,
        source: entry.source || `${manifestPath}:${imageRef}`,
      };
    }

    return assets;
  }, {});
}

const parsed = parseArguments(process.argv.slice(2));
const inputPath = parsed.inputPath;
const outputPath = parsed.outputPath;

if (!inputPath || !outputPath) {
  usage();
  process.exit(1);
}

const source = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const imageAssets = {
  ...loadAssetsFromDirectory(parsed.assetsDir),
  ...loadAssetsFromManifest(parsed.manifestPath),
};
const result = convertFigmaJsonToSvg(source, {
  sourcePath: inputPath,
  outputPath,
  imageAssets,
});

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, result.svg, 'utf8');

const reportPath = outputPath.replace(/\.svg$/i, '.report.txt');
fs.writeFileSync(reportPath, result.report, 'utf8');
console.log(`Wrote ${outputPath}`);
console.log(`Wrote ${reportPath}`);