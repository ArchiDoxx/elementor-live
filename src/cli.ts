#!/usr/bin/env node
import { accessSync, constants, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, type AppConfig } from './config.js';
import { createLazyApi, createServer } from './server.js';
import { WpRestClient } from './wp/rest.js';

const USAGE = `elementor-live — MCP server for the live Elementor editor

Usage:
  elementor-live [serve]      Start the MCP server on stdio (used by MCP clients)
  elementor-live open [url]   Open the dedicated Chrome window (log in once); url may be a post ID or an editor URL
  elementor-live doctor       Check configuration, Chrome, profile directory and WordPress reachability

Environment:
  ELIVE_WP_URL, ELIVE_PROFILE_DIR, ELIVE_CDP_URL, ELIVE_HEADLESS, ELIVE_WP_USER, ELIVE_WP_APP_PASSWORD`;

function log(message: string): void {
  console.error(`[elementor-live] ${message}`);
}

async function loadBrowserApi() {
  const mod = await import('./browser/editor-api.js');
  return mod.BrowserEditorApi;
}

function waitForShutdown(): Promise<string> {
  return new Promise((resolve) => {
    process.once('SIGINT', () => resolve('SIGINT'));
    process.once('SIGTERM', () => resolve('SIGTERM'));
  });
}

async function serve(config: AppConfig): Promise<void> {
  const BrowserEditorApi = await loadBrowserApi();
  const lazy = createLazyApi(() => BrowserEditorApi.create(config.session));
  const wpRest = config.wp ? new WpRestClient(config.wp) : undefined;
  const server = createServer({ getApi: lazy.getApi, resetApi: lazy.resetApi, wpRest });
  const transport = new StdioServerTransport();

  let closing = false;
  const shutdown = async (reason: string) => {
    if (closing) return;
    closing = true;
    log(`shutting down (${reason})`);
    await lazy.close();
    await server.close().catch(() => undefined);
    process.exit(0);
  };
  process.stdin.on('end', () => void shutdown('stdin closed'));
  process.stdin.on('close', () => void shutdown('stdin closed'));
  void waitForShutdown().then(shutdown);

  await server.connect(transport);
  log(`MCP server ready on stdio${wpRest ? ' (wp_rest enabled)' : ''}`);
}

async function open(config: AppConfig, target: string | undefined): Promise<void> {
  const BrowserEditorApi = await loadBrowserApi();
  log(`starting Chrome with profile ${config.session.cdpUrl ? `via CDP ${config.session.cdpUrl}` : config.session.profileDir}`);
  const api = await BrowserEditorApi.create(config.session);
  let request: { postId?: number; url?: string } | undefined;
  if (target && /^\d+$/.test(target)) request = { postId: Number(target) };
  else if (target) request = { url: target };

  if (request) {
    try {
      const status = await api.openEditor(request);
      log(`editor ready: ${status.title ?? ''} ${status.editorUrl ?? ''}`.trim());
    } catch (e) {
      log(`no editor yet (${e instanceof Error ? e.message : String(e)}). Log in in the Chrome window and open a page with "Edit with Elementor".`);
    }
  } else if (config.session.wpUrl) {
    const adminUrl = `${config.session.wpUrl.replace(/\/+$/, '')}/wp-admin/`;
    try {
      const page = await api.session.pageForNavigation();
      await api.session.navigate(page, adminUrl, { allowUnload: true, timeoutMs: 30000 });
      log(`opened ${adminUrl}; open a page with "Edit with Elementor" or pass a post ID next time.`);
    } catch (e) {
      log(`${e instanceof Error ? e.message : String(e)} — log in in the Chrome window; the profile keeps the login.`);
    }
  } else {
    log('no URL given and ELIVE_WP_URL not set; navigate to your site in the Chrome window.');
  }
  log('browser is open; press Ctrl+C to close it (close it before starting an MCP client that uses the same profile).');
  await waitForShutdown();
  await api.close().catch(() => undefined);
  process.exit(0);
}

function chromeCandidates(): string[] {
  if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean) as string[];
    return roots.map((r) => path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }
  if (process.platform === 'darwin') return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  return ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
}

function checkProfileDir(dir: string): string | undefined {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    const probe = path.join(dir, `.elive-write-test-${process.pid}`);
    writeFileSync(probe, 'ok');
    rmSync(probe);
    return undefined;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

async function doctor(config: AppConfig): Promise<number> {
  let failures = 0;
  const line = (ok: boolean | 'info', label: string, detail = '') => {
    const mark = ok === 'info' ? '  ' : ok ? 'ok' : '!!';
    if (ok === false) failures++;
    console.log(`[${mark}] ${label}${detail ? `: ${detail}` : ''}`);
  };

  line('info', 'node', process.version);
  line('info', 'ELIVE_PROFILE_DIR', config.session.profileDir);
  line('info', 'ELIVE_CDP_URL', config.session.cdpUrl ?? '(not set, Chrome is launched with its own profile)');
  line('info', 'ELIVE_WP_URL', config.session.wpUrl ?? '(not set, open_editor needs a full url)');
  line('info', 'ELIVE_HEADLESS', String(config.session.headless));
  line('info', 'wp_rest', config.wp ? `enabled for user ${config.wp.user}` : 'disabled (needs ELIVE_WP_URL, ELIVE_WP_USER, ELIVE_WP_APP_PASSWORD)');

  if (config.session.cdpUrl) {
    try {
      const res = await fetch(`${config.session.cdpUrl.replace(/\/+$/, '')}/json/version`, { signal: AbortSignal.timeout(5000) });
      const info = (await res.json()) as { Browser?: string };
      line(res.ok, 'CDP endpoint', info.Browser ?? `HTTP ${res.status}`);
    } catch (e) {
      line(false, 'CDP endpoint', e instanceof Error ? e.message : String(e));
    }
  } else {
    const found = chromeCandidates().find((p) => existsSync(p));
    line(Boolean(found), 'Google Chrome', found ?? 'not found in the standard locations (install Chrome or set ELIVE_CDP_URL)');
    const profileError = checkProfileDir(config.session.profileDir);
    line(!profileError, 'profile directory writable', profileError ?? config.session.profileDir);
  }

  if (config.session.wpUrl) {
    try {
      const res = await fetch(config.session.wpUrl, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(8000) });
      line(res.status < 500, 'WordPress reachable', `HTTP ${res.status}`);
    } catch (e) {
      line(false, 'WordPress reachable', e instanceof Error ? e.message : String(e));
    }
  }

  if (config.wp) {
    try {
      const me = (await new WpRestClient(config.wp).request('GET', '/wp/v2/users/me')) as { name?: string };
      line(true, 'WordPress REST auth', `authenticated as ${me?.name ?? config.wp.user}`);
    } catch (e) {
      line(false, 'WordPress REST auth', e instanceof Error ? e.message : String(e));
    }
  }

  console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
  return failures ? 1 : 0;
}

async function main(argv: string[]): Promise<void> {
  const [command = 'serve', ...rest] = argv;
  const config = loadConfig();
  switch (command) {
    case 'serve':
      await serve(config);
      break;
    case 'open':
      await open(config, rest[0]);
      break;
    case 'doctor':
      process.exit(await doctor(config));
      break;
    case 'help':
    case '--help':
    case '-h':
      console.log(USAGE);
      break;
    default:
      console.error(`Unknown command "${command}".\n\n${USAGE}`);
      process.exit(2);
  }
}

main(process.argv.slice(2)).catch((e: unknown) => {
  log(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
