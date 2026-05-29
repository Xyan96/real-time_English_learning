export async function ensureContentScript(chromeApi, tabId) {
  if (!tabId) throw new Error('没有可用于注入内容脚本的标签页。');

  await chromeApi.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ['src/content/pageSubtitleInterceptor.js'],
    world: 'MAIN',
  });

  try {
    await chromeApi.tabs.sendMessage(tabId, { type: 'PING_TRANSCRIBER_OVERLAY' });
    return;
  } catch {
    await chromeApi.scripting.insertCSS({
      target: { tabId, allFrames: true },
      files: ['src/content/overlay.css'],
    });
    await chromeApi.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['src/content/contentScript.js'],
    });
  }
}
