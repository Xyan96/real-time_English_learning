export function buildObsidianMarkdown({
  pageTitle = '',
  sourceUrl = '',
  segment = {},
  analysis = {},
  highlights = [],
} = {}) {
  const title = String(pageTitle || 'Video').trim();
  const historyItems = Array.from(highlights ?? []);
  if (historyItems.length > 0) {
    return buildHighlightHistoryMarkdown({ title, sourceUrl, highlights: historyItems });
  }

  const timestamp = formatShortTimestamp(segment.startedAt);
  const text = String(segment.text ?? '').trim();
  const items = Array.from(analysis?.items ?? []);
  const rows = items.length > 0
    ? items.map((item) => `| ${escapeTableCell(item.type)} | ${escapeTableCell(item.text)} | ${escapeTableCell(item.translation)} | ${escapeTableCell(item.difficulty)} |`).join('\n')
    : '| note | No highlights |  |  |';

  return [
    `## ${timestamp} ${title}`,
    '',
    `> ${text}`,
    '',
    '| Type | Expression | 中文 | Level |',
    '| --- | --- | --- | --- |',
    rows,
    '',
    sourceUrl ? `[Source](${sourceUrl})` : '',
    '',
  ].filter((line, index, lines) => line || lines[index - 1] !== '').join('\n').trimEnd() + '\n';
}

function buildHighlightHistoryMarkdown({ title, sourceUrl, highlights }) {
  const rows = highlights.map((item) => [
    formatShortTimestamp(item.startedAt),
    escapeTableCell(item.type),
    escapeTableCell(item.text),
    escapeTableCell(item.translation),
    escapeTableCell(item.difficulty),
    escapeTableCell(item.segmentText),
  ]).map(([time, type, text, translation, difficulty, segmentText]) => (
    `| ${time} | ${type} | ${text} | ${translation} | ${difficulty} | ${segmentText} |`
  )).join('\n');

  return [
    `## Highlight History ${title}`,
    '',
    '| Time | Type | Expression | 中文 | Level | Subtitle |',
    '| --- | --- | --- | --- | --- | --- |',
    rows,
    '',
    sourceUrl ? `[Source](${sourceUrl})` : '',
    '',
  ].filter((line, index, lines) => line || lines[index - 1] !== '').join('\n').trimEnd() + '\n';
}

export function resolveObsidianExportPath({
  vaultPath,
  subdir = '英语观看记录',
  now = new Date(),
} = {}) {
  const root = normalizeFilesystemPath(vaultPath);
  if (!root) {
    throw new Error('obsidianVaultPath is required.');
  }
  const safeSubdir = String(subdir ?? '').trim();
  const date = formatDate(now);
  return joinPath(root, safeSubdir, `${date}.md`);
}

export function normalizeFilesystemPath(filePath) {
  return String(filePath ?? '')
    .trim()
    .replace(/\\([\\\s~()[\]{}'"!#$&*?;<>|])/g, '$1');
}

export async function appendObsidianMarkdown({
  fs,
  vaultPath,
  subdir,
  markdown,
  now = new Date(),
}) {
  const filePath = resolveObsidianExportPath({ vaultPath, subdir, now });
  await fs.mkdir(dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${String(markdown ?? '').trimEnd()}\n\n`, 'utf8');
  const writtenText = `${String(markdown ?? '').trimEnd()}\n\n`;
  return {
    ok: true,
    path: filePath,
    bytesWritten: new TextEncoder().encode(writtenText).byteLength,
  };
}

function joinPath(...parts) {
  const values = parts.map((part) => String(part ?? '').trim()).filter(Boolean);
  if (values.length === 0) return '';
  const [first, ...rest] = values;
  return [first.replace(/\/+$/g, ''), ...rest.map((part) => part.replace(/^\/+|\/+$/g, ''))].join('/');
}

function dirname(filePath) {
  const value = String(filePath ?? '');
  const index = value.lastIndexOf('/');
  return index <= 0 ? '/' : value.slice(0, index);
}

function formatShortTimestamp(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function escapeTableCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}
