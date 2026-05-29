import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  collectExtensionFiles,
  validateExtensionPackage,
} from './validateExtension.js';

const DEFAULT_OUTPUT = 'dist/realtime-video-transcriber-extension.zip';

export function getPackageFileList({
  rootDir = process.cwd(),
  manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8')),
  readText = (filePath) => fs.readFileSync(filePath, 'utf8'),
} = {}) {
  return Array.from(
    collectExtensionFiles({
      rootDir,
      manifest,
      readText,
    }),
  ).toSorted();
}

export function packageExtension({
  rootDir = process.cwd(),
  output = DEFAULT_OUTPUT,
  zipBin = '/usr/bin/zip',
} = {}) {
  const errors = validateExtensionPackage({ rootDir });
  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  const outputPath = path.resolve(rootDir, output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (fs.existsSync(outputPath)) {
    fs.unlinkSync(outputPath);
  }

  const files = getPackageFileList({ rootDir });
  const result = spawnSync(zipBin, ['-q', '-X', outputPath, ...files], {
    cwd: rootDir,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `zip exited with ${result.status}`);
  }

  return {
    outputPath,
    files,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outputArgIndex = process.argv.indexOf('--output');
  const output = outputArgIndex === -1 ? DEFAULT_OUTPUT : process.argv[outputArgIndex + 1];
  const result = packageExtension({ output });
  console.log(`Packaged ${result.files.length} files into ${path.relative(process.cwd(), result.outputPath)}`);
}
