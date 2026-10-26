// Spike: verifiziert die Kernannahmen gegen die Dev-Instanz (Elementor 4.x, Atomic-Default).
// Aufruf: npx tsx e2e/spike.ts
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.ELIVE_DEV_URL ?? 'http://localhost:8080';
const USER = process.env.ELIVE_DEV_USER ?? 'admin';
const PASS = process.env.ELIVE_DEV_PASS ?? 'admin';
const POST = process.env.ELIVE_DEV_POST ?? '5';
const profile = path.resolve('.elementor-live/profile');
mkdirSync(profile, { recursive: true });

const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'chrome',
  headless: false,
  viewport: null,
  args: ['--window-size=1500,950'],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());

await page.goto(`${BASE}/wp-login.php`);
if (await page.locator('#user_login').count()) {
  await page.fill('#user_login', USER);
  await page.fill('#user_pass', PASS);
  await Promise.all([page.waitForNavigation(), page.click('#wp-submit')]);
}
await page.goto(`${BASE}/wp-admin/post.php?post=${POST}&action=elementor`);
await page.waitForFunction(() => (window as any).elementor?.documents?.getCurrent?.() && (window as any).$e, null, { timeout: 60000 });
await page.waitForSelector('#elementor-preview-iframe');
await page.waitForFunction(() => (window as any).elementor?.$preview?.[0]?.contentWindow?.document?.readyState === 'complete', null, { timeout: 60000 });

const facts = await page.evaluate(() => {
  const w = window as any;
  const el = w.elementor;
  const doc = el.documents.getCurrent();
  return {
    version: w.elementor?.config?.version ?? w.ElementorConfig?.version,
    docId: doc.id,
    docType: doc.config?.type,
    atomic: !!w.elementorCommon?.config?.experimentalFeatures?.e_atomic_elements,
    experiments: Object.entries(w.elementorCommon?.config?.experimentalFeatures ?? {}).filter(([, v]) => v).map(([k]) => k),
    hasSelection: typeof el.selection?.getElements === 'function',
    hasChannels: !!el.channels?.editor,
    widgetsCacheCount: Object.keys(el.widgetsCache ?? {}).length,
    atomicWidgets: Object.entries(el.widgetsCache ?? {}).filter(([, v]: any) => v?.atomic || v?.atomic_controls).map(([k]) => k).slice(0, 20),
    rootChildren: doc.container.children.length,
    historyCommands: Object.keys(w.$e.commands.getAll()).filter((c: string) => c.startsWith('document/history')),
    elementsCommands: Object.keys(w.$e.commands.getAll()).filter((c: string) => c.startsWith('document/elements')),
    saveCommands: Object.keys(w.$e.commands.getAll()).filter((c: string) => c.startsWith('document/save')),
  };
});
console.log(JSON.stringify(facts, null, 2));

// 1) History-Gruppe + create container + heading + button + settings
const result = await page.evaluate(() => {
  const w = window as any; const $e = w.$e; const el = w.elementor;
  const doc = el.documents.getCurrent();
  const histBefore = doc.history?.getItems?.().length ?? -1;
  let tid: any = null;
  try { tid = $e.internal('document/history/start-log', { type: 'add', title: 'Agent: Spike' }); } catch (e: any) { tid = 'ERR ' + e.message; }
  const container = $e.run('document/elements/create', {
    container: doc.container,
    model: { elType: 'container', settings: { content_width: 'full', padding: { unit: 'px', top: '24', right: '24', bottom: '24', left: '24', isLinked: true } } },
  });
  const heading = $e.run('document/elements/create', {
    container,
    model: { elType: 'widget', widgetType: 'heading', settings: { title: 'Spike Heading', header_size: 'h2' } },
  });
  const button = $e.run('document/elements/create', {
    container,
    model: { elType: 'widget', widgetType: 'button', settings: { text: 'Klick mich' } },
  });
  $e.run('document/elements/settings', { container: heading, settings: { title: 'Spike Heading (geändert)', title_color: '#ff0066' }, options: { external: true } });
  let endErr: string | null = null;
  try { $e.internal('document/history/end-log', { id: tid }); } catch (e: any) { endErr = e.message; }
  const histAfter = doc.history?.getItems?.().length ?? -1;
  return {
    tid, endErr, histBefore, histAfter,
    containerId: container.id, headingId: heading.id, buttonId: button.id,
    headingTitle: heading.settings.get('title'),
    historyTitles: (doc.history?.getItems?.() ?? []).slice(0, 5).map((i: any) => i.get?.('title') ?? i.title),
  };
});
console.log(JSON.stringify(result, null, 2));

// 2) Geometrie aus dem Preview-Iframe
const geo = await page.evaluate((id) => {
  const w = window as any;
  const pdoc = w.elementor.$preview[0].contentDocument as Document;
  const node = pdoc.querySelector(`[data-id="${id}"]`) as HTMLElement | null;
  if (!node) return { found: false };
  const r = node.getBoundingClientRect();
  const cs = pdoc.defaultView!.getComputedStyle(node);
  return { found: true, box: { x: r.x, y: r.y, w: r.width, h: r.height }, padding: cs.padding, display: cs.display, text: node.innerText.slice(0, 80) };
}, result.headingId);
console.log(JSON.stringify(geo));

// 3) Screenshot-Clip der Heading-Box (Iframe-Offset addieren)
const iframeBox = await page.locator('#elementor-preview-iframe').boundingBox();
if (geo.found && iframeBox) {
  mkdirSync('e2e/artifacts', { recursive: true });
  await page.screenshot({ path: 'e2e/artifacts/spike-heading.png', clip: { x: iframeBox.x + geo.box.x, y: iframeBox.y + geo.box.y, width: Math.max(1, geo.box.w), height: Math.max(1, geo.box.h) } });
  console.log('screenshot ok');
}

// 4) Save (draft) und Reload-Verifikation
const saved = await page.evaluate(async () => {
  const w = window as any;
  try { await w.$e.run('document/save/draft'); return 'ok'; } catch (e: any) { return 'ERR ' + e.message; }
});
console.log('save:', saved);
await page.reload();
await page.waitForFunction(() => (window as any).elementor?.documents?.getCurrent?.()?.container?.children?.length > 0, null, { timeout: 60000 });
const after = await page.evaluate(() => {
  const doc = (window as any).elementor.documents.getCurrent();
  return doc.container.children.map((c: any) => ({ id: c.id, type: c.model.get('elType'), kids: c.children.map((k: any) => k.model.get('widgetType')) }));
});
console.log('after reload:', JSON.stringify(after));

// 5) Atomic-Element anlegen (e-heading) — erwartet: geht oder klarer Fehler
const atomic = await page.evaluate(() => {
  const w = window as any; const $e = w.$e; const doc = w.elementor.documents.getCurrent();
  try {
    const c = $e.run('document/elements/create', { container: doc.container, model: { elType: 'e-flexbox' } });
    const h = $e.run('document/elements/create', { container: c, model: { elType: 'widget', widgetType: 'e-heading', settings: { title: 'Atomic Heading' } } });
    return { ok: true, cId: c?.id, hId: h?.id, settings: Object.keys(h?.settings?.attributes ?? {}) };
  } catch (e: any) { return { ok: false, error: e.message }; }
});
console.log('atomic:', JSON.stringify(atomic));

await ctx.close();
