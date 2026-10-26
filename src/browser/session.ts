import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Dialog, type Page } from 'playwright-core';
import type { SessionConfig } from '../types.js';
import { EditorError } from './errors.js';
import { OVERLAY_SCRIPT } from './overlay.js';
import { PAGE_API_SCRIPT } from './page-scripts.js';

const EDITOR_URL_MARK = 'action=elementor';
const LOGIN_URL_MARK = 'wp-login.php';

export function loginRequiredError(): EditorError {
  return new EditorError(
    'editor_not_ready',
    'WordPress login required',
    'Log in once in the opened Chrome window (tick "Remember Me" so the login survives restarts; the profile persists), then retry',
  );
}

export function notConnectedError(reason = 'Browser is not connected'): EditorError {
  return new EditorError('not_connected', reason, 'Call open_editor with a postId or url');
}

export function isEditorUrl(url: string): boolean {
  return url.includes(EDITOR_URL_MARK);
}

export function isLoginUrl(url: string): boolean {
  return url.includes(LOGIN_URL_MARK);
}

export class BrowserSession {
  private closed = false;
  private readonly crashed = new WeakSet<Page>();
  private readonly activity = new WeakMap<Page, number>();
  private tick = 0;
  private editorCrashed = false;

  private constructor(
    readonly context: BrowserContext,
    private readonly browser: Browser | undefined,
    readonly mode: 'launch' | 'cdp',
  ) {
    context.on('close', () => {
      this.closed = true;
    });
    browser?.on('disconnected', () => {
      this.closed = true;
    });
    context.on('page', (page) => this.watch(page));
    for (const page of context.pages()) this.watch(page);
  }

  static async launch(config: SessionConfig): Promise<BrowserSession> {
    let session: BrowserSession;
    if (config.cdpUrl) {
      let browser: Browser;
      try {
        browser = await chromium.connectOverCDP(config.cdpUrl);
      } catch (err) {
        throw new EditorError(
          'not_connected',
          `Could not connect to Chrome at ${config.cdpUrl}: ${(err as Error).message}`,
          'Start Chrome with --remote-debugging-port and check the CDP URL',
        );
      }
      const context = browser.contexts()[0];
      if (!context) {
        await browser.close().catch(() => undefined);
        throw notConnectedError('Connected Chrome has no browser context');
      }
      session = new BrowserSession(context, browser, 'cdp');
    } else {
      mkdirSync(config.profileDir, { recursive: true });
      let context: BrowserContext;
      try {
        context = await chromium.launchPersistentContext(config.profileDir, {
          channel: 'chrome',
          headless: config.headless,
          viewport: null,
          args: ['--window-size=1500,950'],
        });
      } catch (err) {
        throw new EditorError(
          'not_connected',
          `Could not launch Chrome: ${(err as Error).message}`,
          'Make sure Google Chrome is installed and no other process uses the profile directory',
        );
      }
      session = new BrowserSession(context, undefined, 'launch');
    }
    await session.context.addInitScript(`if (/[?&]action=elementor(&|$)/.test(location.search)) {\n${PAGE_API_SCRIPT}\n;${OVERLAY_SCRIPT}\n}`);
    for (const page of session.livePages()) {
      if (isEditorUrl(page.url())) await session.inject(page).catch(() => undefined);
    }
    return session;
  }

  get connected(): boolean {
    return !this.closed;
  }

  get crashedEditor(): boolean {
    return this.editorCrashed;
  }

  requireContext(): BrowserContext {
    if (this.closed) throw notConnectedError();
    return this.context;
  }

  livePages(): Page[] {
    if (this.closed) return [];
    return this.context.pages().filter((p) => !p.isClosed() && !this.crashed.has(p));
  }

  markActive(page: Page): void {
    this.activity.set(page, ++this.tick);
  }

  async findEditorPage(): Promise<Page | undefined> {
    const editors = this.livePages().filter((p) => isEditorUrl(p.url()));
    if (editors.length <= 1) return editors[0];
    const scored = await Promise.all(
      editors.map(async (page) => {
        let focus = 0;
        try {
          focus = await page.evaluate(() => (document.hasFocus() ? 2 : 0) + (document.visibilityState === 'visible' ? 1 : 0));
        } catch {
          focus = 0;
        }
        return { page, focus, active: this.activity.get(page) ?? 0 };
      }),
    );
    scored.sort((a, b) => b.focus - a.focus || b.active - a.active);
    return scored[0]?.page;
  }

  async pageForNavigation(): Promise<Page> {
    this.requireContext();
    const editor = await this.findEditorPage();
    if (editor) return editor;
    const blank = this.livePages().find((p) => p.url() === 'about:blank' || p.url() === 'chrome://newtab/');
    if (blank) return blank;
    try {
      const page = await this.context.newPage();
      this.markActive(page);
      return page;
    } catch {
      throw notConnectedError();
    }
  }

  async navigate(page: Page, url: string, opts: { allowUnload: boolean; timeoutMs: number }): Promise<void> {
    let blocked = false;
    const onDialog = (dialog: Dialog) => {
      if (dialog.type() === 'beforeunload') {
        if (opts.allowUnload) {
          dialog.accept().catch(() => undefined);
        } else {
          blocked = true;
          dialog.dismiss().catch(() => undefined);
        }
      } else {
        dialog.dismiss().catch(() => undefined);
      }
    };
    page.on('dialog', onDialog);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs });
    } catch (err) {
      if (blocked) {
        throw new EditorError(
          'editor_not_ready',
          'Navigation was blocked by unsaved changes in the editor',
          'Save with save_document first, or discard the changes in the editor',
        );
      }
      if (page.isClosed() || this.closed) throw notConnectedError();
      const message = (err as Error).message;
      if (/timeout/i.test(message)) throw new EditorError('timeout', `Navigation to ${url} timed out`, 'Check that the WordPress site is reachable');
      throw new EditorError('editor_not_ready', `Navigation to ${url} failed: ${message}`, 'Check the URL and that the WordPress site is reachable');
    } finally {
      page.off('dialog', onDialog);
    }
    this.markActive(page);
    this.editorCrashed = false;
    if (isLoginUrl(page.url())) throw loginRequiredError();
  }

  async inject(page: Page): Promise<void> {
    await page.evaluate(PAGE_API_SCRIPT);
    await page.evaluate(OVERLAY_SCRIPT);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      if (this.mode === 'cdp') await this.browser?.close();
      else await this.context.close();
    } catch {
      return;
    }
  }

  private watch(page: Page): void {
    this.markActive(page);
    page.on('crash', () => {
      this.crashed.add(page);
      if (isEditorUrl(page.url())) this.editorCrashed = true;
    });
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) this.markActive(page);
    });
  }
}
