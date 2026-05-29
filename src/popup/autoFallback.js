export function hasUsableSiteSubtitleEvidence(diagnostics = {}) {
  if (Number(diagnostics?.transcriptCount) > 0) return true;
  if (Number(diagnostics?.renderedSubtitles?.count) > 0) return true;
  if (Array.from(diagnostics?.subtitleResources ?? []).length > 0) return true;
  if (Array.from(diagnostics?.domSubtitleResources ?? []).length > 0) return true;

  if (Array.from(diagnostics?.pageSubtitleResources ?? []).some((resource) => (
    Number(resource?.cueCount) > 0 || Number(resource?.length) > 0
  ))) {
    return true;
  }

  return Array.from(diagnostics?.videos ?? []).some((video) => (
    Array.from(video?.textTracks ?? []).some((track) => Number(track?.activeCueCount) > 0)
  ));
}

export function hasCapturedSiteSubtitleLine(diagnostics = {}) {
  return Number(diagnostics?.transcriptCount) > 0;
}

export async function waitForUsableSiteSubtitles({
  readDiagnostics,
  wait = defaultWait,
  intervalMs = 750,
  maxAttempts = 6,
} = {}) {
  let diagnostics = { ok: false, error: '无法读取当前标签页的字幕诊断信息。' };
  const attempts = Math.max(1, Number(maxAttempts) || 1);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    diagnostics = await readDiagnostics();
    if (!diagnostics?.ok || hasUsableSiteSubtitleEvidence(diagnostics)) {
      return {
        ok: diagnostics?.ok !== false,
        found: diagnostics?.ok !== false && hasUsableSiteSubtitleEvidence(diagnostics),
        attempts: attempt,
        diagnostics,
      };
    }

    if (attempt < attempts) {
      await wait(intervalMs);
    }
  }

  return {
    ok: diagnostics?.ok !== false,
    found: false,
    attempts,
    diagnostics,
  };
}

export async function waitForCapturedSiteSubtitles({
  readDiagnostics,
  wait = defaultWait,
  intervalMs = 750,
  maxAttempts = 8,
} = {}) {
  let diagnostics = { ok: false, error: '无法读取当前标签页的字幕诊断信息。' };
  const attempts = Math.max(1, Number(maxAttempts) || 1);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    diagnostics = await readDiagnostics();
    if (!diagnostics?.ok || hasCapturedSiteSubtitleLine(diagnostics)) {
      return {
        ok: diagnostics?.ok !== false,
        found: diagnostics?.ok !== false && hasCapturedSiteSubtitleLine(diagnostics),
        hasEvidence: diagnostics?.ok !== false && hasUsableSiteSubtitleEvidence(diagnostics),
        attempts: attempt,
        diagnostics,
      };
    }

    if (attempt < attempts) {
      await wait(intervalMs);
    }
  }

  return {
    ok: diagnostics?.ok !== false,
    found: false,
    hasEvidence: diagnostics?.ok !== false && hasUsableSiteSubtitleEvidence(diagnostics),
    attempts,
    diagnostics,
  };
}

function defaultWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
