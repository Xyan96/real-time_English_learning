import fs from 'node:fs';
import path from 'node:path';

const REQUIRED_PERMISSIONS = ['activeTab', 'nativeMessaging', 'scripting', 'storage'];

export function collectExtensionFiles(input) {
  const {
    rootDir = process.cwd(),
    manifest,
    readText = (filePath) => fs.readFileSync(filePath, 'utf8'),
  } = isManifestShape(input) ? { manifest: input } : input;
  const files = new Set(['manifest.json']);

  addIfPresent(files, manifest?.background?.service_worker);
  addIfPresent(files, manifest?.action?.default_popup);
  collectIconFiles(files, manifest?.icons);
  collectIconFiles(files, manifest?.action?.default_icon);

  for (const contentScript of manifest?.content_scripts ?? []) {
    for (const file of contentScript.js ?? []) addIfPresent(files, file);
    for (const file of contentScript.css ?? []) addIfPresent(files, file);
  }

  for (const resourceGroup of manifest?.web_accessible_resources ?? []) {
    for (const file of resourceGroup.resources ?? []) addIfPresent(files, file);
  }

  collectRuntimeDependencies({ rootDir, readText, files });

  return files;
}

export function validateExtensionPackage({
  rootDir = process.cwd(),
  manifest = readJson(path.join(rootDir, 'manifest.json')),
  exists = fs.existsSync,
  readText = (filePath) => fs.readFileSync(filePath, 'utf8'),
} = {}) {
  const errors = [];

  if (manifest.manifest_version !== 3) {
    errors.push('manifest_version must be 3.');
  }

  for (const permission of REQUIRED_PERMISSIONS) {
    if (!manifest.permissions?.includes(permission)) {
      errors.push(`Missing required permission: ${permission}`);
    }
  }

  if (manifest.background?.type !== 'module') {
    errors.push('background.type must be "module" for the MV3 service worker.');
  }

  const files = collectExtensionFiles({ rootDir, manifest, readText });
  for (const file of files) {
    const absolutePath = path.join(rootDir, file);
    if (!exists(absolutePath)) {
      errors.push(`Missing referenced file: ${file}`);
    }
  }

  validatePopupModuleReferences({ rootDir, manifest, exists, readText, errors });
  validateDynamicImportResources({ rootDir, manifest, readText, errors });
  validateAllFrameContentScripts({ manifest, errors });
  validateOriginFallbackContentScripts({ manifest, errors });

  return errors;
}

function validateAllFrameContentScripts({ manifest, errors }) {
  for (const contentScript of manifest.content_scripts ?? []) {
    if (contentScript.all_frames === true) continue;

    const label = Array.from(contentScript.js ?? []).join(', ') || '(no script files)';
    errors.push(`Content script must run in all frames: ${label}`);
  }
}

function validateOriginFallbackContentScripts({ manifest, errors }) {
  for (const contentScript of manifest.content_scripts ?? []) {
    if (contentScript.match_origin_as_fallback === true) continue;

    const label = Array.from(contentScript.js ?? []).join(', ') || '(no script files)';
    errors.push(`Content script must match origin fallback frames: ${label}`);
  }
}

function validatePopupModuleReferences({ rootDir, manifest, exists, readText, errors }) {
  const popup = manifest.action?.default_popup;
  if (!popup) return;

  const popupPath = path.join(rootDir, popup);
  if (!exists(popupPath)) return;

  const html = readText(popupPath);
  const scriptMatches = html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/g);

  for (const match of scriptMatches) {
    const scriptPath = path.normalize(path.join(path.dirname(popup), match[1]));
    if (!exists(path.join(rootDir, scriptPath))) {
      errors.push(`Missing popup script file: ${scriptPath}`);
    }
  }
}

function validateDynamicImportResources({ rootDir, manifest, readText, errors }) {
  const webAccessible = new Set(
    (manifest.web_accessible_resources ?? []).flatMap((group) => group.resources ?? []),
  );
  const directResources = new Set();

  for (const contentScript of manifest.content_scripts ?? []) {
    for (const file of contentScript.js ?? []) {
      const text = readText(path.join(rootDir, file));
      const matches = text.matchAll(/chrome\.runtime\.getURL\(["']([^"']+)["']\)/g);
      for (const match of matches) {
        const resource = match[1];
        if (!webAccessible.has(resource)) {
          errors.push(`Dynamic import resource is not web-accessible: ${resource}`);
        }
        directResources.add(resource);
      }
    }
  }

  const dependencies = collectTransitiveJavaScriptDependencies({
    rootDir,
    readText,
    entries: Array.from(directResources),
  });
  for (const dependency of dependencies) {
    if (!webAccessible.has(dependency)) {
      errors.push(`Dynamic import dependency is not web-accessible: ${dependency}`);
    }
  }
}

function collectTransitiveJavaScriptDependencies({ rootDir, readText, entries }) {
  const dependencies = new Set();
  const scanned = new Set();
  const queue = Array.from(entries ?? []);

  while (queue.length > 0) {
    const file = queue.shift();
    if (!file || scanned.has(file) || !file.endsWith('.js')) continue;
    scanned.add(file);

    let text = '';
    try {
      text = readText(path.join(rootDir, file));
    } catch {
      continue;
    }

    for (const dependency of collectJavaScriptDependencies(file, text)) {
      if (dependencies.has(dependency)) continue;
      dependencies.add(dependency);
      queue.push(dependency);
    }
  }

  return dependencies;
}

function collectRuntimeDependencies({ rootDir, readText, files }) {
  const scanned = new Set();
  let changed = true;

  while (changed) {
    changed = false;

    for (const file of Array.from(files)) {
      if (scanned.has(file)) continue;
      scanned.add(file);

      let text = '';
      try {
        text = readText(path.join(rootDir, file));
      } catch {
        continue;
      }

      const dependencies = file.endsWith('.html')
        ? collectHtmlDependencies(file, text)
        : file.endsWith('.js')
          ? collectJavaScriptDependencies(file, text)
          : [];

      for (const dependency of dependencies) {
        if (!files.has(dependency)) {
          files.add(dependency);
          changed = true;
        }
      }
    }
  }
}

function collectHtmlDependencies(file, html) {
  const dependencies = [];
  const assetPatterns = [
    /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/g,
    /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/g,
  ];

  for (const pattern of assetPatterns) {
    for (const match of html.matchAll(pattern)) {
      if (isExternalUrl(match[1])) continue;
      dependencies.push(path.normalize(path.join(path.dirname(file), match[1])));
    }
  }

  return dependencies;
}

function collectJavaScriptDependencies(file, source) {
  const dependencies = [];
  const importMatches = source.matchAll(/\bimport\s+(?:[^'"]+\s+from\s+)?["']([^"']+)["']/g);
  for (const match of importMatches) {
    if (isExternalUrl(match[1]) || !match[1].startsWith('.')) continue;
    dependencies.push(path.normalize(path.join(path.dirname(file), match[1])));
  }

  const offscreenMatches = source.matchAll(/\b[A-Z_]*OFFSCREEN[A-Z_]*\s*=\s*["']([^"']+\.html)["']/g);
  for (const match of offscreenMatches) {
    dependencies.push(path.normalize(match[1]));
  }

  return dependencies;
}

function addIfPresent(files, file) {
  if (file) files.add(file);
}

function collectIconFiles(files, icons) {
  if (!icons) return;
  if (typeof icons === 'string') {
    addIfPresent(files, icons);
    return;
  }

  for (const file of Object.values(icons)) {
    addIfPresent(files, file);
  }
}

function isManifestShape(input) {
  return input && typeof input === 'object' && !('manifest' in input);
}

function isExternalUrl(value) {
  return /^(?:[a-z]+:)?\/\//i.test(value);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const errors = validateExtensionPackage();
  if (errors.length > 0) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('Extension package validation passed.');
  }
}
