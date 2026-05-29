export function formatObsidianExportNetworkError(error, endpoint = '') {
  const message = String(error?.message ?? error ?? '').trim();
  const target = String(endpoint ?? '').trim();
  const suffix = target ? `（${target}）` : '';
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return `无法直接导出到 Obsidian 目录：未检测到本地导出服务${suffix}。请在项目目录运行 npm run transcribe-server，然后重新点击导出。`;
  }
  return `无法直接导出到 Obsidian 目录${suffix}：${message || '网络不可用'}。请确认本地导出服务正在运行。`;
}
