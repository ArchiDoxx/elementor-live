import { BrowserEditorApi } from '../src/browser/editor-api.js';
import { EditorError } from '../src/browser/errors.js';
import type { PromptResult, RawElement } from '../src/types.js';
import { DEV, editorPage, openEditorWithLogin } from './helpers.js';

let failures = 0;

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  const started = Date.now();
  try {
    const value = await fn();
    console.log(`PASS ${name} (${Date.now() - started} ms)`);
    return value;
  } catch (err) {
    failures++;
    const reason = err instanceof EditorError ? `${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err);
    console.log(`FAIL ${name}: ${reason}`);
    return undefined;
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function findNode(node: RawElement, id: string): RawElement | undefined {
  if (node.id === id) return node;
  for (const child of node.children) {
    const hit = findNode(child, id);
    if (hit) return hit;
  }
  return undefined;
}

async function historyTitles(api: BrowserEditorApi): Promise<string[]> {
  const page = await editorPage(api);
  return page.evaluate(() => {
    const items = (window as any).elementor.documents.getCurrent().history.getItems();
    const arr = items.models ?? items;
    return arr.map((i: any) => String(i.get('title')));
  });
}

const api = await BrowserEditorApi.create({ profileDir: DEV.profileDir, wpUrl: DEV.url, headless: DEV.headless });
let containerId = '';
let headingId = '';
let buttonId = '';
try {
  await step('status before open is not connected', async () => {
    const st = await api.status();
    assert(st.connected === false, 'expected connected=false before open_editor');
  });

  await step('open editor (login if needed)', async () => {
    const st = await openEditorWithLogin(api, DEV.postId);
    assert(st.connected, 'status.connected is false after openEditor');
  });

  await step('status shows connected/version/atomic', async () => {
    const st = await api.status();
    assert(st.connected, 'not connected');
    assert(st.postId === DEV.postId, `postId ${st.postId}`);
    assert(typeof st.elementorVersion === 'string' && st.elementorVersion.length > 0, 'no elementorVersion');
    assert(st.atomicEnabled === true, `atomicEnabled=${st.atomicEnabled}`);
    assert(typeof st.lastSeq === 'number', 'lastSeq missing');
    console.log(`  version=${st.elementorVersion} atomic=${st.atomicEnabled} type=${st.documentType} title=${st.title} lastSeq=${st.lastSeq}`);
  });

  await step('getTree root is document', async () => {
    const tree = await api.getTree();
    assert(tree.id === 'document' && tree.elType === 'document' && Array.isArray(tree.children), `root ${tree.id}/${tree.elType}`);
  });

  await step('listWidgets and getControls', async () => {
    const widgets = await api.listWidgets();
    assert(widgets.some((w) => w.type === 'heading' && !w.atomic), 'heading widget missing');
    assert(widgets.some((w) => w.type === 'e-heading' && w.atomic), 'atomic e-heading missing');
    const heading = await api.getControls('heading');
    const title = heading.find((c) => c.name === 'title');
    assert(title?.type === 'textarea' && title.section === 'section_title', 'heading.title control missing');
    assert(!heading.some((c) => ['section', 'tab', 'heading', 'divider', 'raw_html'].includes(c.type)), 'layout controls not filtered');
    const container = await api.getControls('container');
    assert(container.length > 10, 'container controls missing');
    const atomic = await api.getControls('e-heading');
    assert(atomic.some((c) => c.name === 'title'), 'e-heading title control missing');
    console.log(`  widgets=${widgets.length} headingControls=${heading.length} containerControls=${container.length} eHeadingControls=${atomic.length}`);
  });

  const titlesBefore = await historyTitles(api);

  await step('runOps creates container + heading + button and updates heading', async () => {
    const res = await api.runOps(
      [
        { op: 'create', elType: 'container', settings: { content_width: 'full' } },
        { op: 'create', parentId: '$0', elType: 'widget', widgetType: 'heading', settings: { title: 'E2E Heading', header_size: 'h2' } },
        { op: 'create', parentId: '$0', elType: 'widget', widgetType: 'button', settings: { text: 'E2E Button' } },
        { op: 'update_settings', id: '$1', settings: { title_color: '#ff0066' } },
      ],
      'e2e',
    );
    for (const r of res.results) assert(r.ok && r.id, `op ${r.index} (${r.op}) failed: ${r.code} ${r.error}`);
    assert(res.historyGrouped, 'history not grouped');
    assert(res.historyTitle === 'Agent: e2e', `historyTitle ${res.historyTitle}`);
    containerId = res.results[0]!.id!;
    headingId = res.results[1]!.id!;
    buttonId = res.results[2]!.id!;
    assert(res.results[3]!.id === headingId, 'update_settings did not resolve $1');
    console.log(`  container=${containerId} heading=${headingId} button=${buttonId}`);
  });

  await step('history has exactly one new item "Agent: e2e"', async () => {
    await new Promise((r) => setTimeout(r, 1200));
    const after = await historyTitles(api);
    const added = after.filter((t) => t !== 'Editing Started').length - titlesBefore.filter((t) => t !== 'Editing Started').length;
    assert(added === 1, `expected 1 new history item, got ${added}: ${after.slice(0, 4).join(' | ')}`);
    assert(after[0] === 'Agent: e2e', `newest history item is "${after[0]}"`);
  });

  await step('negative: update_settings on unknown id → element_not_found', async () => {
    const res = await api.runOps([{ op: 'update_settings', id: 'nope123', settings: {} }], 'e2e-negative');
    assert(res.results[0]?.ok === false && res.results[0].code === 'element_not_found', JSON.stringify(res.results[0]));
  });

  await step('getGeometry(heading) has height and text', async () => {
    const geo = await api.getGeometry([headingId]);
    const g = geo[headingId];
    assert(g, 'heading geometry missing');
    assert(g.box.height > 0, `height ${g.box.height}`);
    assert(g.text.includes('E2E Heading'), `text "${g.text}"`);
    assert(g.widgetType === 'heading' && g.elType === 'widget', `${g.elType}/${g.widgetType}`);
    assert(g.parentId === containerId, `parentId ${g.parentId}`);
    console.log(`  box=${JSON.stringify(g.box)} fontSize=${g.computed.fontSize} lineHeight=${g.computed.lineHeight}`);
  });

  await step('screenshot(heading) returns PNG > 1000 bytes', async () => {
    const shot = await api.screenshot(headingId);
    assert(shot.png.length > 1000, `png ${shot.png.length} bytes`);
    assert(shot.png.subarray(1, 4).toString() === 'PNG', 'not a PNG');
    const full = await api.screenshot();
    assert(full.png.length > shot.png.length, 'full preview screenshot not larger than element shot');
    console.log(`  element=${shot.png.length}B box=${JSON.stringify(shot.box)} full=${full.png.length}B`);
  });

  await step('getAllGeometry contains heading under container', async () => {
    const all = await api.getAllGeometry();
    const h = all.find((g) => g.id === headingId);
    assert(h, 'heading not in getAllGeometry');
    assert(h.parentId === containerId, `parentId ${h.parentId}`);
    assert(all.some((g) => g.id === buttonId && g.parentId === containerId), 'button missing');
  });

  await step('say + setHud render overlay', async () => {
    await api.say('Hello', headingId, 'happy');
    await api.setHud({ score: 100, delta: +5, note: 'nice' });
    const page = await editorPage(api);
    const dom = await page.evaluate(() => ({
      cursor: !!document.querySelector('.elive-cursor.elive-show'),
      hud: !!document.querySelector('.elive-hud.elive-show'),
      hudText: document.querySelector('.elive-hud')?.textContent ?? '',
      bubble: document.querySelector('.elive-bubble')?.textContent ?? '',
      mood: document.querySelector('.elive-root')?.className ?? '',
    }));
    assert(dom.cursor, '.elive-cursor not visible');
    assert(dom.hud && dom.hudText.includes('100') && dom.hudText.includes('nice'), `hud "${dom.hudText}"`);
    assert(dom.bubble === 'Hello' && dom.mood.includes('elive-mood-happy'), `bubble "${dom.bubble}" mood "${dom.mood}"`);
  });

  await step('pullEvents(0) contains navigate and agent events', async () => {
    const events = await api.pullEvents(0);
    assert(events.some((e) => e.type === 'navigate' && e.text?.includes('action=elementor')), 'no navigate event');
    assert(events.some((e) => e.type === 'agent' && e.text === 'Hello'), 'no agent event');
    for (let i = 1; i < events.length; i++) assert(events[i]!.seq > events[i - 1]!.seq, 'seq not monotonic');
  });

  await step('Alt+Space prompt reaches waitForPrompt and the buffer', async () => {
    const page = await editorPage(api);
    await page.bringToFront();
    const waiting = api.waitForPrompt(10_000);
    await page.keyboard.press('Alt+Space');
    await page.waitForSelector('.elive-prompt.elive-show', { timeout: 3000 });
    await page.keyboard.type('make the heading bigger');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('please');
    await page.keyboard.press('Enter');
    const res: PromptResult | null = await waiting;
    assert(res, 'waitForPrompt returned null');
    assert(res.text === 'make the heading bigger\nplease', `text ${JSON.stringify(res.text)}`);
    assert(Array.isArray(res.selection), 'selection missing');
    const events = await api.pullEvents(res.seq - 1);
    assert(events.some((e) => e.type === 'prompt' && e.seq === res.seq), 'prompt event not in buffer');
    const closed = await page.evaluate(() => !document.querySelector('.elive-prompt.elive-show'));
    assert(closed, 'prompt did not close after Enter');
    const again = await api.waitForPrompt(300);
    assert(again === null, 'waitForPrompt returned an already consumed prompt');
  });

  await step('Alt+Space inside preview iframe opens prompt, Esc closes', async () => {
    const page = await editorPage(api);
    await page.evaluate(() => {
      const pdoc = (document.getElementById('elementor-preview-iframe') as HTMLIFrameElement).contentDocument!;
      pdoc.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', altKey: true, bubbles: true, cancelable: true }));
    });
    await page.waitForSelector('.elive-prompt.elive-show', { timeout: 3000 });
    await page.evaluate(() => (document.querySelector('.elive-prompt textarea') as HTMLTextAreaElement).focus());
    await page.keyboard.press('Escape');
    await page.waitForSelector('.elive-prompt.elive-show', { state: 'detached', timeout: 3000 }).catch(async () => {
      const open = await page.evaluate(() => !!document.querySelector('.elive-prompt.elive-show'));
      assert(!open, 'prompt still open after Escape');
    });
  });

  await step('user selection produces a select event', async () => {
    const page = await editorPage(api);
    const since = (await api.status()).lastSeq ?? 0;
    const initial = await api.getSelection();
    const target = initial.includes(headingId) ? buttonId : headingId;
    await page.evaluate((id) => {
      const w = window as any;
      w.$e.run('document/elements/select', { container: w.elementor.getContainer(id) });
    }, target);
    await new Promise((r) => setTimeout(r, 1200));
    const events = await api.pullEvents(since);
    assert(events.some((e) => e.type === 'select' && e.ids?.length === 1 && e.ids[0] === target), `no select event: ${JSON.stringify(events)}`);
    const sel = await api.getSelection();
    assert(sel.length === 1 && sel[0] === target, `getSelection ${JSON.stringify(sel)}`);
  });

  await step('user edit, undo and save produce change/save events', async () => {
    const page = await editorPage(api);
    const since = (await api.status()).lastSeq ?? 0;
    await page.evaluate((id) => {
      const w = window as any;
      w.$e.run('document/elements/settings', { container: w.elementor.getContainer(id), settings: { title: 'User Edit' } });
    }, headingId);
    await new Promise((r) => setTimeout(r, 1500));
    await page.evaluate(() => (window as any).$e.run('document/history/undo'));
    await new Promise((r) => setTimeout(r, 900));
    await page.evaluate(() => (window as any).$e.run('document/save/draft'));
    await new Promise((r) => setTimeout(r, 900));
    const events = await api.pullEvents(since);
    const change = events.find((e) => e.type === 'change' && !e.title?.startsWith('Undo: '));
    const undo = events.find((e) => e.type === 'change' && e.title?.startsWith('Undo: '));
    const save = events.find((e) => e.type === 'save');
    assert(change && change.ids?.includes(headingId), `no change event for heading: ${JSON.stringify(events)}`);
    assert(undo, `no undo change event: ${JSON.stringify(events)}`);
    assert(save, `no save event: ${JSON.stringify(events)}`);
    const tree = await api.getTree();
    assert(findNode(tree, headingId)?.settings.title === 'E2E Heading', 'undo did not restore heading title');
    console.log(`  events: ${events.map((e) => `${e.type}${e.title ? `(${e.title})` : ''}`).join(', ')}`);
  });

  await step('setDevice mobile/desktop', async () => {
    await api.setDevice('mobile');
    const page = await editorPage(api);
    const mode = await page.evaluate(() => (window as any).elementor.channels.deviceMode.request('currentMode'));
    assert(mode === 'mobile', `mode ${mode}`);
    const shot = await api.screenshot(headingId, 'mobile');
    assert(shot.png.length > 500, 'mobile screenshot empty');
    await api.setDevice('desktop');
  });

  await step('save draft', async () => {
    const res = await api.save('draft');
    assert(res.ok, `save failed: ${res.error}`);
    console.log(`  status=${res.status}`);
  });

  await step('reload via openEditor keeps created container with 2 children', async () => {
    const st = await api.openEditor({ postId: DEV.postId });
    assert(st.connected, 'not connected after reload');
    const tree = await api.getTree();
    const c = findNode(tree, containerId);
    assert(c, 'container missing after reload');
    assert(c.children.length === 2, `container has ${c.children.length} children`);
    const h = findNode(tree, headingId);
    assert(h?.settings.title === 'E2E Heading' && h.settings.title_color === '#ff0066', `heading settings ${JSON.stringify(h?.settings.title)}`);
  });

  await step('runOps delete container + save draft (cleanup)', async () => {
    const res = await api.runOps([{ op: 'delete', id: containerId }], 'e2e-cleanup');
    assert(res.results[0]?.ok, `delete failed: ${res.results[0]?.error}`);
    const tree = await api.getTree();
    assert(!findNode(tree, containerId), 'container still present');
    const saved = await api.save('draft');
    assert(saved.ok, `save failed: ${saved.error}`);
    containerId = '';
  });
} finally {
  if (containerId) {
    await api.runOps([{ op: 'delete', id: containerId }], 'e2e-cleanup').catch(() => undefined);
    await api.save('draft').catch(() => undefined);
  }
  await api.close();
}

await step('status after close is not connected', async () => {
  const st = await api.status();
  assert(st.connected === false, 'still connected after close');
  await api.getTree().then(
    () => assert(false, 'getTree did not throw after close'),
    (err) => assert(err instanceof EditorError && err.code === 'not_connected', `wrong error ${err}`),
  );
});

console.log(failures ? `\n${failures} step(s) failed` : '\nall steps passed');
process.exit(failures ? 1 : 0);
