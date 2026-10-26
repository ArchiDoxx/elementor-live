// Acceptance run: spawns the built MCP server (dist/cli.js) over stdio and drives it with a real MCP client
// against the dev instance. Not a CI gate; prints PASS/FAIL per step and exits non-zero on failure.
// Usage: npm run build && npx tsx e2e/mcp-smoke.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const WP = process.env.ELIVE_DEV_URL ?? 'http://localhost:8080';
const POST = Number(process.env.ELIVE_DEV_POST ?? '5');
const results: { step: string; ok: boolean; info?: string }[] = [];
const step = async (name: string, fn: () => Promise<string | void>) => {
  try {
    const info = (await fn()) ?? undefined;
    results.push({ step: name, ok: true, info });
    console.log(`PASS ${name}${info ? ' — ' + info : ''}`);
  } catch (e: any) {
    results.push({ step: name, ok: false, info: e?.message ?? String(e) });
    console.log(`FAIL ${name}: ${e?.message ?? e}`);
  }
};

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.resolve('dist/cli.js')],
  env: {
    ...process.env,
    ELIVE_WP_URL: WP,
    ELIVE_PROFILE_DIR: path.resolve('.elementor-live/profile'),
    ELIVE_HEADLESS: process.env.ELIVE_HEADLESS ?? '1',
  },
  stderr: 'pipe',
});
transport.stderr?.on('data', (d) => process.stderr.write(`[server] ${d}`));
const client = new Client({ name: 'elementor-live-smoke', version: '0.0.0' });

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const res: any = await client.callTool({ name, arguments: args });
  const text = res.content?.find((c: any) => c.type === 'text')?.text;
  const image = res.content?.find((c: any) => c.type === 'image');
  const json = text ? JSON.parse(text) : undefined;
  if (res.isError) throw new Error(`${name} → ${text}`);
  return { json, image };
};

let containerId = '';
let headingId = '';
try {
  await client.connect(transport);
  await step('tools/list contains the contract', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    const required = ['canvas_status', 'open_editor', 'get_canvas_skeleton', 'inspect_element', 'list_widgets', 'get_widget_controls', 'mutate_canvas', 'save_document', 'capture_vision', 'design_lint', 'agent_say', 'set_hud', 'get_user_activity', 'wait_for_user_prompt'];
    const missing = required.filter((r) => !names.includes(r));
    if (missing.length) throw new Error('missing tools: ' + missing.join(', '));
    return names.join(', ');
  });
  await step('canvas_status before connect reports connected=false, no throw', async () => {
    const { json } = await call('canvas_status');
    if (json.connected !== false) throw new Error(JSON.stringify(json));
  });
  await step('open_editor(postId)', async () => {
    const { json } = await call('open_editor', { postId: POST });
    if (!json.connected || !json.elementorVersion) throw new Error(JSON.stringify(json));
    return `Elementor ${json.elementorVersion}, atomic=${json.atomicEnabled}`;
  });
  await step('get_widget_controls(heading) lists title control', async () => {
    const { json } = await call('get_widget_controls', { widgetType: 'heading' });
    if (!Array.isArray(json) || !json.some((c: any) => c.name === 'title')) throw new Error('no title control');
    return `${json.length} controls`;
  });
  await step('mutate_canvas create container+heading+button', async () => {
    const { json } = await call('mutate_canvas', {
      label: 'smoke',
      ops: [
        { op: 'create', elType: 'container', settings: { content_width: 'full', padding: { unit: 'px', top: '23', right: '24', bottom: '24', left: '24', isLinked: false } } },
      ],
    });
    containerId = json.results[0].id;
    if (!json.results[0].ok || !containerId) throw new Error(JSON.stringify(json));
    const r2 = await call('mutate_canvas', {
      label: 'smoke children',
      ops: [
        { op: 'create', parentId: containerId, elType: 'widget', widgetType: 'heading', settings: { title: 'Smoke Heading', header_size: 'h3' } },
        { op: 'create', parentId: containerId, elType: 'widget', widgetType: 'button', settings: { text: 'Go' } },
      ],
    });
    headingId = r2.json.results[0].id;
    if (!r2.json.results.every((r: any) => r.ok)) throw new Error(JSON.stringify(r2.json));
    return `container ${containerId}, heading ${headingId}, grouped=${r2.json.historyGrouped}`;
  });
  await step('get_canvas_skeleton shows the new subtree with labels', async () => {
    const { json } = await call('get_canvas_skeleton', { includeSettings: true });
    const c = json.tree.children.find((n: any) => n.id === containerId);
    if (!c) throw new Error('container missing in skeleton');
    const h = c.children.find((n: any) => n.id === headingId);
    if (!h || !/Smoke Heading/.test(h.label ?? '')) throw new Error('heading label missing: ' + JSON.stringify(h));
    if (h.settings?.header_size !== 'h3') throw new Error('non-default settings missing: ' + JSON.stringify(h.settings));
    return `${json.nodeCount} nodes`;
  });
  await step('inspect_element(heading) has box + computed + parentChain', async () => {
    const { json } = await call('inspect_element', { id: headingId });
    if (!json.box || json.box.height <= 0) throw new Error('box missing/zero: ' + JSON.stringify(json.box));
    if (!json.parentChain?.some((p: any) => p.id === containerId)) throw new Error('parentChain wrong');
    return `box ${Math.round(json.box.width)}x${Math.round(json.box.height)}`;
  });
  await step('design_lint flags the 23px off-grid padding', async () => {
    const { json } = await call('design_lint', { id: containerId, grid: 4 });
    const f = json.findings.find((x: any) => x.rule === 'off_grid_spacing' && x.id === containerId);
    if (!f) throw new Error('no off_grid finding: ' + JSON.stringify(json.findings));
    return f.detail;
  });
  await step('capture_vision(heading) returns a PNG', async () => {
    const { image, json } = await call('capture_vision', { id: headingId });
    if (!image?.data || image.mimeType !== 'image/png') throw new Error('no image');
    mkdirSync('e2e/artifacts', { recursive: true });
    writeFileSync('e2e/artifacts/smoke-heading.png', Buffer.from(image.data, 'base64'));
    return `${json?.bytes ?? Buffer.from(image.data, 'base64').length} bytes`;
  });
  await step('agent_say + set_hud', async () => {
    await call('agent_say', { id: headingId, message: 'Looks good.', mood: 'happy' });
    await call('set_hud', { score: 97, delta: 3, note: 'clean flex' });
  });
  await step('get_user_activity returns events with lastSeq', async () => {
    const { json } = await call('get_user_activity', { since: 0 });
    if (!Array.isArray(json.events) || typeof json.lastSeq !== 'number') throw new Error(JSON.stringify(json));
    return `${json.events.length} events, types=${[...new Set(json.events.map((e: any) => e.type))].join('/')}`;
  });
  await step('wait_for_user_prompt times out cleanly', async () => {
    const { json } = await call('wait_for_user_prompt', { timeoutSec: 1 });
    if (!json.timeout) throw new Error(JSON.stringify(json));
  });
  await step('mutate_canvas unknown id → element_not_found (other ops continue)', async () => {
    const { json } = await call('mutate_canvas', { ops: [{ op: 'update_settings', id: 'nope1234', settings: { title: 'x' } }, { op: 'update_settings', id: headingId, settings: { title: 'Smoke Heading 2' } }] });
    if (json.results[0].ok || json.results[0].code !== 'element_not_found') throw new Error(JSON.stringify(json.results[0]));
    if (!json.results[1].ok) throw new Error(JSON.stringify(json.results[1]));
  });
  await step('mutate_canvas invalid op → isError', async () => {
    try {
      await call('mutate_canvas', { ops: [{ op: 'create', elType: 'widget' }] });
    } catch (e: any) {
      if (!/widgetType/.test(e.message)) throw e;
      return 'rejected: ' + e.message.slice(0, 80);
    }
    throw new Error('was accepted');
  });
  await step('save_document(draft) + reload keeps elements', async () => {
    const s = await call('save_document', { mode: 'draft' });
    if (!s.json.ok) throw new Error(JSON.stringify(s.json));
    await call('open_editor', { postId: POST });
    const { json } = await call('get_canvas_skeleton');
    const c = json.tree.children.find((n: any) => n.id === containerId);
    if (!c || c.children.length !== 2) throw new Error('subtree lost after reload');
  });
  await step('cleanup: delete container + save', async () => {
    const { json } = await call('mutate_canvas', { label: 'smoke cleanup', ops: [{ op: 'delete', id: containerId }] });
    if (!json.results[0].ok) throw new Error(JSON.stringify(json));
    await call('save_document', { mode: 'draft' });
  });
} finally {
  await client.close().catch(() => {});
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
