# Realtime Video Transcriber Chrome Extension

This is a Manifest V3 prototype for extracting subtitles from video sites such as Netflix, YouTube, and other streaming pages.

## How It Works

- The content script first watches for subtitles already rendered by the page, including Netflix-style timed text nodes, YouTube caption nodes, XGPlayer/Video.js/JW Player/Plyr caption containers, generic caption containers, open shadow DOM captions, active `TextTrackCue` text on video elements, accessible WebVTT, SRT, TTML/DFXP, YouTube srv3/timedtext XML, LRC, BCC, or ASS/SSA subtitle files referenced by `<track>` elements, declared by subtitle `<link>` resources such as `<link rel="preload" as="track">`, or embedded in player configuration attributes such as `data-setup`, inline `data:` and page-local `blob:` subtitle tracks, subtitle-like resource URLs visible in Performance Resource Timing, subtitle responses fetched by page JavaScript, live subtitle JSON received over WebSocket or Server-Sent Events, HLS playlists that point at subtitle renditions or WebVTT subtitle segments, and DASH MPD subtitle adaptation sets.
- Subtitle files and manifests are requested through the extension background worker first with browser credentials included, so extension host permissions and the active site session can handle subtitle URLs that page-origin `fetch` would otherwise fail to read.
- The popup shows the active tab transcript count and can start an automatic check for website subtitles.
- The content script renders transcript segments as a floating subtitle panel on the video page.
- The popup can copy the collected transcript as TXT or download it as SRT.
- Parsed subtitle text strips markup and decodes common HTML/XML entities before display or export.
- The overlay renders the latest lines, while exports use the full transcript collected during the page session.
- Transcript export is collected across all injected frames, so iframe player captions are included in popup Copy TXT and Download SRT actions.
- Copy Diagnostics also aggregates all injected frames and copies a verification report with a clear verdict, which helps identify subtitle sources inside embedded players and real streaming pages.
- Clear Current Transcript clears transcript state in every injected frame, preventing stale iframe player captions from leaking into the next export.
- The popup can clear the active tab transcript before switching videos or starting a new capture session.
- The overlay follows the page fullscreen container when a video player enters fullscreen.
- Extension updates preserve existing popup settings such as learning preferences and export paths.
- Content scripts run at `document_start` in all frames, so embedded player iframes and early page subtitle requests can expose their own rendered subtitles and subtitle network activity.

## Subtitle Priority

1. Use subtitles already visible on the website, including captions rendered inside open shadow DOM player components.
2. Use active browser `textTracks` from video elements when available, including videos inside open shadow DOM. Disabled subtitle or caption tracks are switched to `hidden` so cues can be read without forcing native captions visible.
3. Use WebVTT, SRT, TTML/DFXP, YouTube srv3/timedtext XML, LRC, BCC, or ASS/SSA subtitle files referenced by subtitle or caption `<track>` elements when the page exposes the asset but does not render subtitle text into the DOM. Inline `data:` track URLs, including UTF-8 base64 payloads, and page-local `blob:` track URLs are decoded or fetched in the content script without a background network request.
4. Use subtitle-like URLs declared by DOM `<link>` resources, including preloaded track links, embedded in player configuration attributes such as `data-setup`, or discovered from Performance Resource Timing when the player fetched a subtitle asset without exposing a DOM `<track>`.
5. Use subtitle-like WebVTT, SRT, TTML/DFXP, YouTube srv3/timedtext XML, LRC, BCC, ASS/SSA, HLS, or DASH responses captured from page-world `fetch` and `XMLHttpRequest` calls, including requests fired by early page scripts during load.
6. Use live subtitle JSON messages captured from page-world WebSocket or `EventSource` connections when pages push captions instead of fetching subtitle files.
7. Expand HLS `.m3u8` playlists to find subtitle renditions and WebVTT subtitle segments.
8. Expand DASH `.mpd` manifests to find subtitle/text adaptation set `BaseURL` entries.
9. If no website subtitle evidence is available, the extension reports that state in diagnostics. Audio fallback has been removed from the extension path.

## Local Backend

For remote learning analysis and direct Obsidian export, run the included local backend:

```bash
OPENAI_API_KEY=your_api_key node server/transcriptionServer.js
```

For the simplest day-to-day use, install the native helper once:

```bash
npm run install-native-host
```

After that, the extension can start the local backend automatically when the plugin is enabled, when you analyze learning items, or when you export to Obsidian. The helper closes the backend after about 15 minutes without plugin activity.

The same local backend is also required for direct Obsidian export. Chrome extensions cannot write arbitrary local folders by themselves, so keep the backend running and set the popup fields like this:

```text
Obsidian vault path: /Users/you/Documents/ObsidianVault
Obsidian subdir: 英语观看记录
Obsidian export endpoint: http://localhost:8787/obsidian/export
```

When you click "导出学习项到 Obsidian", the extension posts the collected learning items to the local backend, and the backend appends Markdown directly to:

```text
<Obsidian vault path>/<Obsidian subdir>/YYYY-MM-DD.md
```

## Local Development

Run tests:

```bash
node --test
```

Validate the extension package structure:

```bash
node tools/validateExtension.js
```

Create a distributable extension zip:

```bash
node tools/packageExtension.js
```

The zip is written to `dist/realtime-video-transcriber-extension.zip` and includes only runtime extension files, not tests or the local transcription server.

Run a local Chrome smoke test against the fixture page:

```bash
node tools/chromeSmoke.js
```

This launches Chrome with the unpacked extension, opens the local fake Netflix-style subtitle fixture, and checks through the Chrome DevTools Protocol that the overlay appears and collects subtitle text. Fixtures can also require diagnostics evidence, such as `data-setup` expecting the subtitle URL in `domSubtitleResources`. To smoke-test every local subtitle source path, run:

```bash
node tools/chromeSmoke.js --fixture=all
```

Use `--fixture=caption` for rendered subtitle DOM only, `--fixture=iframe-player` for a rendered-caption player embedded in an iframe, `--fixture=xgplayer-caption` for XGPlayer-style rendered caption containers, `--fixture=track` for WebVTT subtitle-file extraction only, `--fixture=data-setup` for captions declared only in a player `data-setup` JSON attribute, `--fixture=network-srv3` for YouTube srv3/timedtext XML fetched by page JavaScript, `--fixture=network-lrc` for timestamped LRC fetched by page JavaScript, `--fixture=network-srt` for SubRip SRT fetched by page JavaScript, `--fixture=network-bcc` for BCC-style `body/from/to/content` subtitle JSON, `--fixture=network-ass` for ASS `Dialogue:` subtitle files, `--fixture=early-network-json` for subtitle JSON fetched by a head script during page load, `--fixture=websocket-live` for live WebSocket subtitle messages, or `--fixture=eventsource-live` for Server-Sent Events subtitle messages.
The smoke tool automatically prefers a Playwright-installed Chrome for Testing from `~/Library/Caches/ms-playwright` when it exists, because recent branded Google Chrome builds can ignore command-line `--load-extension`. If you want to force a browser, set `CHROME_PATH`:

```bash
CHROME_PATH=/path/to/chrome-for-testing node tools/chromeSmoke.js --fixture=all --headed
```

For a manually loaded extension in an already running browser, start Chrome with a DevTools port, open the video page, enable the site's own captions, then attach the verifier:

```bash
node tools/chromeSmoke.js --print-launch-command=9222 --url=https://www.netflix.com/watch/123
```

```bash
node tools/chromeSmoke.js --diagnose-attach=9222 --url-match=netflix.com/watch
```

```bash
node tools/chromeSmoke.js --attach=9222 --url-match=netflix.com/watch --expected-text="line you saw in the overlay" --report=real-site-report.json
```

Run `--diagnose-attach` first to confirm Chrome exposes the target page, this extension's service worker is inspectable, and the expected extension manifest is visible before waiting for subtitles.
Run `--print-launch-command` when nothing is listening on port 9222; it prints a macOS Chrome command with remote debugging, a dedicated profile, this unpacked extension path, and the keychain/sandbox flags needed by Chrome for Testing on macOS.

If you do not want to copy an exact subtitle line first, verify that the extension collected at least a few website subtitle lines:

```bash
node tools/chromeSmoke.js --attach=9222 --url-match=netflix.com/watch --min-lines=3 --report=real-site-report.json
```

Attach verification requires actual website subtitle evidence by default, such as rendered subtitle text, rendered subtitle nodes, intercepted subtitle resources with cues, DOM subtitle resources, browser subtitle resources, text tracks, or active cues. Transcript lines alone are not enough, so audio fallback output will not accidentally pass a website-subtitle verification.

For slow-loading pages, extend the wait window:

```bash
node tools/chromeSmoke.js --attach=9222 --url-match=netflix.com/watch --min-lines=3 --timeout-ms=60000 --report=real-site-report.json
```

Use `--expected-dom-subtitle-resource=...` when you need to prove a DOM-declared subtitle URL, such as a `data-setup` caption file, appears in diagnostics.
Attach verification prints the diagnostics verdict and evidence list, so a passing run shows whether the page was verified through rendered subtitles, intercepted subtitle resources, DOM subtitle resources, browser subtitle resources, text tracks, or active cues. It also tries to connect to this extension's service worker and collect transcript plus diagnostics from every injected frame with `chrome.scripting.executeScript({ allFrames: true })`, which is the preferred evidence path for embedded players and cross-frame streaming pages. If the verifier says no inspectable extension service worker was found, open the extension popup once, or inspect the service worker from `chrome://extensions`, then retry. When `--report=...` is provided it writes the full JSON evidence report for later review.

The attach output includes `Service worker evidence` and `Service worker injection` lines. Use them to distinguish setup failures from real subtitle misses: `unavailable` means the verifier could not inspect this extension's service worker, `incomplete` means Chrome blocked one of the all-frame injection steps, and `ok` with zero transcript segments means the extension ran but did not detect usable website subtitles yet.

You can also manually load this repository from `chrome://extensions` with Developer mode and Load unpacked, then open `http://localhost:4173/demo/caption-fixture.html`.

The test suite includes a content-script harness that executes the real content script against a simulated Netflix-style subtitle DOM. It verifies subtitle detection, overlay rendering, transcript export, and clearing without requiring a Netflix login.

Load the extension:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this repository folder.
5. Open a video page. Existing on-page subtitles should appear automatically in the floating transcript panel.
6. Use Copy TXT or Download SRT from the popup to export collected lines.
7. Use Copy Diagnostics if you need to verify which subtitle sources the extension detected on a real video site. The popup status shows a short verdict immediately, and the copied report includes `verdict.status`, `verdict.evidence`, frame summaries, rendered subtitle samples, intercepted subtitle resource samples, and the raw diagnostics payload.
8. Use Clear Current Transcript before switching videos if you do not want the next export mixed with previous lines.
9. If you want the extension to check the active tab, press Start Auto Mode. It will use website subtitles when available and report when no usable subtitle evidence is found.

Verify on a local fixture:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173/demo/caption-fixture.html`. The page cycles fake Netflix-style subtitle DOM; the extension should detect it without a transcription endpoint.
The fixture page includes a manual checklist and a DevTools expression that reports whether the content script loaded, whether the overlay is visible, and which transcript lines were collected.

To verify subtitle-file extraction, open `http://localhost:4173/demo/track-fixture.html`. That fixture has a `<video>` with a WebVTT `<track>` but no rendered subtitle DOM, so the overlay should populate from `demo/fixtures/captions.vtt`.

To verify player-configuration extraction, open `http://localhost:4173/demo/data-setup-fixture.html`. That fixture has no rendered subtitle DOM and no `<track>` element; the subtitle URL exists only inside the video element's `data-setup` JSON attribute.

## Current Limits

- Existing site subtitles do not need a transcription backend.
- Audio fallback has been removed; pages without exposed subtitles cannot be transcribed from tab audio by this extension.
- DRM-protected video pixels are not captured or processed.
- Streaming services can change page behavior, fullscreen handling, and extension injection constraints.

## Real Site Verification

On Netflix, YouTube, Xiaohongshu, or a similar video page:

1. Load the extension from `chrome://extensions`.
2. Open the video and enable the site's own subtitles when available.
3. Wait until at least one subtitle line appears in the floating transcript panel.
4. Click Copy Diagnostics in the popup.
5. Read the popup verdict. It should say `Website subtitles detected` when the extension found usable site subtitles.
6. Paste the copied report into a text file or chat for deeper inspection.

For website-subtitle extraction, the important fields are:

```json
{
  "verdict": {
    "status": "site-subtitles-detected",
    "evidence": [
      "collected transcript lines",
      "rendered subtitle nodes",
      "intercepted subtitle resources with cues",
      "browser subtitle resources",
      "DOM subtitle resources",
      "text tracks",
      "active cues"
    ]
  }
}
```

If `verdict.status` is `no-site-subtitles-detected`, the extension did not find usable site subtitles on that page yet. Audio fallback has been removed, so pages without exposed subtitles cannot be transcribed automatically.
