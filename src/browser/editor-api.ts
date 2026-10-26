import type { Page } from 'playwright-core';
import type {
  AgentMood,
  Box,
  ControlDef,
  DeviceMode,
  EditorApi,
  EditorStatus,
  GeometryNode,
  HudState,
  MutateResult,
  Op,
  PromptResult,
  RawElement,
  SaveMode,
  SessionConfig,
  UserEvent,
  WidgetInfo,
} from '../types.js';
import { EditorError, type EditorErrorCode } from './errors.js';
import { overlay } from './overlay.js';
import { BrowserSession, isLoginUrl, loginRequiredError, notConnectedError } from './session.js';

const READY_TIMEOUT_MS = 60_000;
const MAX_CLIP_WIDTH = 1600;
const ERROR_CODES: readonly EditorErrorCode[] = ['not_connected', 'no_editor_tab', 'editor_not_ready', 'element_not_found', 'evaluate_failed', 'timeout'];

type Envelope = { missing: true } | { v: unknown } | { e: string; m: string };

interface ShotInfo {
  found: boolean;
  frame?: Box;
  rect?: Box | null;
  viewport?: { width: number; height: number };
}

function noEditorTab(): EditorError {
  return new EditorError('no_editor_tab', 'No Elementor editor tab is open', 'Call open_editor with a postId or url');
}

function toCode(code: string): EditorErrorCode {
  return (ERROR_CODES as readonly string[]).includes(code) ? (code as EditorErrorCode) : 'evaluate_failed';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BrowserEditorApi implements EditorApi {
  private lastPromptSeq: number | undefined;

  private constructor(
    readonly session: BrowserSession,
    private readonly config: SessionConfig,
  ) {}

  static async create(config: SessionConfig): Promise<BrowserEditorApi> {
    const session = await BrowserSession.launch(config);
    return new BrowserEditorApi(session, config);
  }

  async close(): Promise<void> {
    await this.session.close();
  }

  async status(): Promise<EditorStatus> {
    if (!this.session.connected) return { connected: false, selection: [] };
    let page: Page | undefined;
    try {
      page = await this.session.findEditorPage();
    } catch {
      return { connected: false, selection: [] };
    }
    if (!page) return { connected: false, selection: [] };
    try {
      return await this.call<EditorStatus>('status', [], page);
    } catch {
      return { connected: false, editorUrl: page.isClosed() ? undefined : page.url(), selection: [] };
    }
  }

  async openEditor(target: { postId?: number; url?: string }): Promise<EditorStatus> {
    this.session.requireContext();
    let url = target.url;
    if (!url && target.postId !== undefined) {
      if (!this.config.wpUrl) {
        throw new EditorError('editor_not_ready', 'Cannot open a post by id without a WordPress URL', 'Configure the WordPress base URL (wpUrl) or pass a full editor url');
      }
      url = `${this.config.wpUrl.replace(/\/+$/, '')}/wp-admin/post.php?post=${target.postId}&action=elementor`;
    }
    let page: Page;
    if (url) {
      page = await this.session.pageForNavigation();
      let dirty: boolean | undefined;
      try {
        dirty = await overlay.dirty(page);
      } catch {
        dirty = undefined;
      }
      if (dirty === true) {
        throw new EditorError(
          'editor_not_ready',
          'The open editor has unsaved changes',
          'Save with save_document first, or discard the changes in the editor',
        );
      }
      await this.session.navigate(page, url, { allowUnload: dirty === false, timeoutMs: READY_TIMEOUT_MS });
    } else {
      const existing = await this.session.findEditorPage();
      if (!existing) throw noEditorTab();
      page = existing;
    }
    await this.waitReady(page);
    await this.session.inject(page);
    await page.waitForFunction(() => !!(window as any).__elive, null, { timeout: 5_000 }).catch(() => undefined);
    this.session.markActive(page);
    return this.status();
  }

  async getTree(): Promise<RawElement> {
    return this.call<RawElement>('tree', []);
  }

  async getControls(widgetTypeOrElType: string): Promise<ControlDef[]> {
    return this.call<ControlDef[]>('controls', [widgetTypeOrElType]);
  }

  async listWidgets(): Promise<WidgetInfo[]> {
    return this.call<WidgetInfo[]>('widgets', []);
  }

  async getGeometry(ids: string[]): Promise<Record<string, GeometryNode>> {
    if (ids.length === 0) return {};
    const nodes = await this.call<GeometryNode[]>('geometry', [ids]);
    const out: Record<string, GeometryNode> = {};
    for (const node of nodes) out[node.id] = node;
    return out;
  }

  async getAllGeometry(): Promise<GeometryNode[]> {
    return this.call<GeometryNode[]>('geometry', [null]);
  }

  async runOps(ops: Op[], label: string): Promise<MutateResult> {
    return this.call<MutateResult>('runOps', [ops, label]);
  }

  async save(mode: SaveMode): Promise<{ ok: boolean; status?: string; error?: string }> {
    return this.call<{ ok: boolean; status?: string; error?: string }>('save', [mode]);
  }

  async getSelection(): Promise<string[]> {
    return this.call<string[]>('selection', []);
  }

  async setDevice(device: DeviceMode): Promise<void> {
    await this.call<string>('setDevice', [device]);
  }

  async screenshot(id?: string, device?: DeviceMode): Promise<{ png: Buffer; box?: Box }> {
    if (device) await this.setDevice(device);
    const page = await this.requirePage();
    await this.ensureOverlay(page);
    const info = await this.call<ShotInfo>('prepareShot', [id ?? null], page);
    if (!info.found) throw new EditorError('element_not_found', `Element not found in preview: ${id}`, 'Use an id from get_canvas_skeleton');
    const frame = info.frame!;
    const viewport = info.viewport!;
    const source: Box = info.rect
      ? { x: frame.x + info.rect.x, y: frame.y + info.rect.y, width: info.rect.width, height: info.rect.height }
      : frame;
    const left = Math.max(source.x, frame.x, 0);
    const top = Math.max(source.y, frame.y, 0);
    const right = Math.min(source.x + source.width, frame.x + frame.width, viewport.width);
    const bottom = Math.min(source.y + source.height, frame.y + frame.height, viewport.height);
    const clip = {
      x: Math.max(0, Math.min(left, viewport.width - 1)),
      y: Math.max(0, Math.min(top, viewport.height - 1)),
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
    };
    await overlay.capture(page, true).catch(() => undefined);
    let png: Buffer;
    try {
      png = await page.screenshot({ type: 'png', clip, ...(clip.width > MAX_CLIP_WIDTH ? { scale: 'css' as const } : {}) });
    } catch (err) {
      throw this.mapError(err, page);
    } finally {
      await overlay.capture(page, false).catch(() => undefined);
    }
    return info.rect ? { png, box: info.rect } : { png };
  }

  async say(message: string, id?: string, mood: AgentMood = 'neutral'): Promise<void> {
    await this.overlayCall((page) => overlay.say(page, message, id, mood));
  }

  async moveCursor(id?: string): Promise<void> {
    if (id) await this.overlayCall((page) => overlay.moveToId(page, id));
    else await this.overlayCall((page) => overlay.hideCursor(page));
  }

  async setHud(state: HudState): Promise<void> {
    await this.overlayCall((page) => overlay.setHud(page, state));
  }

  async pullEvents(since: number): Promise<UserEvent[]> {
    return this.overlayCall((page) => overlay.pull(page, since));
  }

  async waitForPrompt(timeoutMs: number): Promise<PromptResult | null> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    const freshSince = Date.now() - 60_000;
    for (;;) {
      if (!this.session.connected) throw notConnectedError();
      let events: UserEvent[] = [];
      try {
        events = await this.pullEvents(0);
      } catch (err) {
        if (err instanceof EditorError && (err.code === 'not_connected' || err.code === 'no_editor_tab')) throw err;
      }
      const latest = events.length ? events[events.length - 1]!.seq : 0;
      if (this.lastPromptSeq !== undefined && latest < this.lastPromptSeq) this.lastPromptSeq = 0;
      const since = this.lastPromptSeq ?? 0;
      const hit = events.find((e) => e.type === 'prompt' && e.seq > since && e.ts >= freshSince);
      if (hit) {
        this.lastPromptSeq = hit.seq;
        return { text: hit.text ?? '', selection: hit.ids ?? [], seq: hit.seq };
      }
      if (Date.now() >= deadline) return null;
      await sleep(Math.min(250, Math.max(0, deadline - Date.now())));
    }
  }

  private async requirePage(): Promise<Page> {
    if (!this.session.connected) throw notConnectedError();
    const page = await this.session.findEditorPage();
    if (!page) throw this.session.crashedEditor ? notConnectedError('The editor tab crashed') : noEditorTab();
    return page;
  }

  private async waitReady(page: Page): Promise<void> {
    try {
      await page.waitForFunction(
        () => {
          const w = window as any;
          try {
            const el = w.elementor;
            const frame = document.getElementById('elementor-preview-iframe') as HTMLIFrameElement | null;
            return !!(
              el?.documents?.getCurrent?.() &&
              w.$e &&
              frame?.contentDocument?.readyState === 'complete' &&
              el.getPreviewView?.() &&
              Object.keys(el.widgetsCache ?? {}).length > 0
            );
          } catch {
            return false;
          }
        },
        null,
        { timeout: READY_TIMEOUT_MS, polling: 250 },
      );
    } catch (err) {
      if (page.isClosed() || !this.session.connected) throw notConnectedError();
      if (isLoginUrl(page.url())) throw loginRequiredError();
      let hasElementor = false;
      try {
        hasElementor = await page.evaluate(() => !!(window as any).elementor);
      } catch {
        hasElementor = false;
      }
      if (!hasElementor) {
        throw new EditorError('editor_not_ready', `The page did not load the Elementor editor: ${page.url()}`, 'Check that the post exists and is editable with Elementor');
      }
      throw new EditorError('timeout', `Elementor editor did not become ready within ${READY_TIMEOUT_MS / 1000}s`, `Reload the editor tab and retry (${(err as Error).message.split('\n')[0]})`);
    }
  }

  private async ensureOverlay(page: Page): Promise<void> {
    try {
      if (await overlay.isActive(page)) return;
      await this.session.inject(page);
    } catch (err) {
      throw this.mapError(err, page);
    }
  }

  private async overlayCall<T>(fn: (page: Page) => Promise<{ missing: true } | { missing: false; value: T }>): Promise<T> {
    const page = await this.requirePage();
    let res: { missing: true } | { missing: false; value: T };
    try {
      res = await fn(page);
      if (res.missing) {
        await this.session.inject(page);
        res = await fn(page);
      }
    } catch (err) {
      throw this.mapError(err, page);
    }
    if (res.missing) throw new EditorError('editor_not_ready', 'Overlay is not active (editor still loading?)', 'Call open_editor and retry');
    return res.value;
  }

  private async call<T>(name: string, args: unknown[], pageArg?: Page): Promise<T> {
    const page = pageArg ?? (await this.requirePage());
    let env = await this.invoke(page, name, args);
    if ('missing' in env) {
      try {
        await this.session.inject(page);
      } catch (err) {
        throw this.mapError(err, page);
      }
      env = await this.invoke(page, name, args);
    }
    if ('missing' in env) throw new EditorError('editor_not_ready', 'Page API could not be injected', 'Call open_editor and retry');
    if ('e' in env) {
      const code = toCode(env.e);
      const hint = code === 'editor_not_ready' ? 'Wait for the editor to finish loading or call open_editor' : undefined;
      throw new EditorError(code, env.m, hint);
    }
    return env.v as T;
  }

  private async invoke(page: Page, name: string, args: unknown[]): Promise<Envelope> {
    try {
      return (await page.evaluate(
        ([n, a]) => {
          const api = (window as any).__eliveApi;
          if (!api) return { missing: true };
          return api.invoke(n, a);
        },
        [name, args] as const,
      )) as Envelope;
    } catch (err) {
      throw this.mapError(err, page);
    }
  }

  private mapError(err: unknown, page?: Page): EditorError {
    if (err instanceof EditorError) return err;
    const message = err instanceof Error ? err.message : String(err);
    if (!this.session.connected || page?.isClosed() || /Target (page, context or browser )?(has been )?closed|Browser has been closed|crash/i.test(message)) {
      return notConnectedError(`Browser or tab is gone: ${message.split('\n')[0]}`);
    }
    if (/Execution context was destroyed|navigat/i.test(message)) {
      return new EditorError('editor_not_ready', 'The editor tab navigated during the call', 'Retry once the editor has reloaded (open_editor waits for it)');
    }
    if (/timeout/i.test(message)) return new EditorError('timeout', message.split('\n')[0] ?? message);
    return new EditorError('evaluate_failed', message.split('\n')[0] ?? message);
  }
}
