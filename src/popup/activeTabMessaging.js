export async function sendActiveTabMessage(chromeApi, message) {
  const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { ok: false, error: '没有找到当前活动标签页。' };
  }

  if (message?.type === 'GET_TRANSCRIPT') {
    try {
      return await chromeApi.runtime?.sendMessage?.({
        target: 'background',
        type: 'COLLECT_TRANSCRIPT',
        tabId: tab.id,
      });
    } catch {
      // Fall back to the direct content-script path below for restricted pages.
    }
  }

  if (message?.type === 'GET_DIAGNOSTICS') {
    try {
      return await chromeApi.runtime?.sendMessage?.({
        target: 'background',
        type: 'COLLECT_DIAGNOSTICS',
        tabId: tab.id,
      });
    } catch {
      // Fall back to direct messaging below if the background worker is unavailable.
    }
  }

  if (message?.type === 'GET_LEARNING_HISTORY') {
    try {
      return await chromeApi.runtime?.sendMessage?.({
        target: 'background',
        type: 'COLLECT_LEARNING_HISTORY',
        tabId: tab.id,
      });
    } catch {
      // Fall back to direct messaging below if the background worker is unavailable.
    }
  }

  if (message?.type === 'CLEAR_TRANSCRIPT') {
    try {
      return await chromeApi.runtime?.sendMessage?.({
        target: 'background',
        type: 'CLEAR_TRANSCRIPTS',
        tabId: tab.id,
      });
    } catch {
      // Fall back to direct messaging below if the background worker is unavailable.
    }
  }

  try {
    return await chromeApi.tabs.sendMessage(tab.id, message);
  } catch {
    await ensureContentScript(chromeApi, tab.id);
  }

  try {
    return await chromeApi.tabs.sendMessage(tab.id, message);
  } catch {
    return {
      ok: false,
      error: '当前标签页没有字幕浮窗。请打开视频页面并等待字幕出现。',
    };
  }
}

async function ensureContentScript(chromeApi, tabId) {
  try {
    await chromeApi.runtime?.sendMessage?.({
      target: 'background',
      type: 'ENSURE_CONTENT_SCRIPT',
      tabId,
    });
  } catch {
    // The retry below will return the user-facing overlay error if injection is unavailable.
  }
}
