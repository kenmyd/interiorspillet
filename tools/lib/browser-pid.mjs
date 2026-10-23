/**
 * The rule tools/stop-browser.mjs uses to judge the process a browser pidfile points at (pure, no I/O – tested by
 * tools/house-tests/stop-browser.test.mjs):
 *
 *   judgeBrowserPid({ name, cmd, created, written }) → { verdict: 'kill' | 'stale' | 'keep', why }
 *
 *   name     the process image (Win32_Process.Name), e.g. msedge.exe
 *   cmd      its command line
 *   created  its start time (Unix ms)
 *   written  the pidfile's mtime (Unix ms)
 *
 *   kill   our own headless browser: a Chromium image Playwright launches (msedge.exe for the default channel,
 *          chrome.exe for --browser=chrome, the bundled chrome-headless-shell), --headless and
 *          --remote-debugging-pipe on the command line, started just before the pidfile was written
 *   stale  the PID was reused: started outside BEFORE_MS before … AFTER_MS after the pidfile's mtime – delete the
 *          pidfile, kill nothing
 *   keep   alive and started with the pidfile, but not something we may kill (or the start time is unknown) – keep the
 *          pidfile (it is the only safe handle on the process), kill nothing
 *
 * Every browser image is accepted whatever --browser said: the owner's own Edge or Chrome never has
 * --headless + --remote-debugging-pipe, and the start-time check rules out a reused PID.
 */
export const BEFORE_MS = 120 * 1000; // launchServer → pidfile written: a few seconds in practice
export const AFTER_MS = 2000; // file-system / clock granularity
export const BROWSER_IMAGES = ['msedge.exe', 'chrome.exe', 'chrome-headless-shell.exe', 'headless_shell.exe'];

/**
 * @param {{ name?: string, cmd?: string, created?: number, written: number }} p
 * @returns {{ verdict: 'kill' | 'stale' | 'keep', why: string }}
 */
export function judgeBrowserPid({ name = '', cmd = '', created, written }) {
  const label = name || '?';
  if (!Number.isFinite(created)) return { verdict: 'keep', why: `Windows gave no start time for ${label}` };
  if (!(created >= written - BEFORE_MS && created <= written + AFTER_MS)) {
    return { verdict: 'stale', why: `${label} started ${new Date(created).toISOString()}, not just before the pidfile (${new Date(written).toISOString()}) – the PID was reused` };
  }
  if (!BROWSER_IMAGES.includes(String(name).toLowerCase())) {
    return { verdict: 'keep', why: `${label} started with the pidfile and is not a browser (${BROWSER_IMAGES.join(' / ')})` };
  }
  if (!cmd.includes('--headless') || !cmd.includes('--remote-debugging-pipe')) {
    return { verdict: 'keep', why: `${label} started with the pidfile and is not a headless Playwright browser (no --headless / --remote-debugging-pipe)` };
  }
  return { verdict: 'kill', why: `headless ${label}` };
}
