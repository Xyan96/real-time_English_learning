export async function fetchSubtitleTrack(url, fetchImpl = fetch) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { ok: false, error: '字幕 URL 无效。' };
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return { ok: false, error: `不支持的字幕 URL 协议：${parsedUrl.protocol}` };
  }

  try {
    const response = await fetchImpl(parsedUrl.href, { credentials: 'include' });
    if (!response?.ok) {
      return {
        ok: false,
        error: `字幕轨道请求失败：${response?.status ?? 'unknown'} ${response?.statusText ?? ''}`.trim(),
        finalUrl: response?.url ?? parsedUrl.href,
        status: Number(response?.status) || 0,
        contentType: readHeader(response?.headers, 'content-type'),
      };
    }

    const text = await response.text();
    return {
      ok: true,
      text,
      finalUrl: response?.url ?? parsedUrl.href,
      status: Number(response?.status) || 200,
      contentType: readHeader(response?.headers, 'content-type'),
      length: text.length,
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function readHeader(headers, name) {
  if (typeof headers?.get === 'function') return String(headers.get(name) ?? '');
  if (typeof headers?.get !== 'function' && typeof headers?.has === 'function') return String(headers.get(name) ?? '');
  if (headers && typeof headers === 'object') {
    return String(headers[name] ?? headers[String(name).toLowerCase()] ?? '');
  }
  return '';
}
