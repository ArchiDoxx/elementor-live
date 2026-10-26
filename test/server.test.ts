import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { EditorError } from '../src/browser/errors.js';
import { loadConfig } from '../src/config.js';
import { createLazyApi, createServer, type ServerDeps } from '../src/server.js';
import { WpRestClient, WpRestError } from '../src/wp/rest.js';
import type {
  AgentMood,
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
  UserEvent,
  WidgetInfo,
} from '../src/types.js';

function el(id: string, elType: string, widgetType: string | undefined, settings: Record<string, unknown>, children: RawElement[] = [], atomic = false): RawElement {
  return { id, elType, widgetType, settings, atomic, children };
}

function geometry(id: string, parentId: string | undefined, box: GeometryNode['box'], extra: Partial<GeometryNode> = {}): GeometryNode {
  return {
    id,
    parentId,
    box,
    elType: 'widget',
    text: '',
    scrollOverflowX: false,
    computed: {
      display: 'block',
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      marginTop: 0,
      marginBottom: 0,
      gap: 0,
      fontSize: 16,
      lineHeight: 24,
      overflowX: 'visible',
      overflowY: 'visible',
    },
    ...extra,
  };
}

class FakeEditorApi implements EditorApi {
  calls: Array<{ method: string; args: unknown[] }> = [];
  controlsCalls: string[] = [];
  selection = ['h1'];
  events: UserEvent[] = Array.from({ length: 25 }, (_, i) => ({ seq: i + 1, ts: 1000 + i, type: 'select' as const, ids: ['h1'] }));
  prompt: PromptResult | null = { text: 'make this bigger', selection: ['h1'], seq: 26 };
  tree: RawElement = el('doc', 'document', undefined, {}, [
    el('c1', 'container', undefined, { content_width: 'full', flex_direction: 'column' }, [
      el('h1', 'widget', 'heading', { title: 'Hello world', header_size: 'h2', align: '' }),
      el('b1', 'widget', 'button', { text: 'Click me' }),
    ]),
    el('a1', 'e-flexbox', undefined, {}, [], true),
  ]);

  private record(method: string, ...args: unknown[]) {
    this.calls.push({ method, args });
  }

  async status(): Promise<EditorStatus> {
    this.record('status');
    return { connected: true, postId: 5, title: 'Test', elementorVersion: '4.3.5', atomicEnabled: true, selection: this.selection, lastSeq: 25 };
  }
  async openEditor(target: { postId?: number; url?: string }): Promise<EditorStatus> {
    this.record('openEditor', target);
    return { connected: true, postId: target.postId ?? 7, selection: [] };
  }
  async getTree(): Promise<RawElement> {
    return this.tree;
  }
  async getControls(type: string): Promise<ControlDef[]> {
    this.controlsCalls.push(type);
    if (type === 'heading') {
      return [
        { name: 'title', type: 'textarea', default: 'Add Your Heading Text Here' },
        { name: 'header_size', type: 'select', default: 'h2', options: { h1: 'H1', h2: 'H2', h3: 'H3' } },
        { name: 'section_title', type: 'section' },
        { name: 'align', type: 'choose', default: '' },
        { name: 'title_color', type: 'color', default: '' },
        {
          name: 'many',
          type: 'select',
          options: Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`o${i}`, `Option ${i}`])),
          default: { a: { b: { c: 1 } } },
        },
        { name: 'shallow', type: 'slider', default: { unit: 'px', size: 10 } },
      ];
    }
    if (type === 'unknown') throw new EditorError('evaluate_failed', 'no such widget');
    return [{ name: 'text', type: 'text', default: 'Click here' }];
  }
  async listWidgets(): Promise<WidgetInfo[]> {
    return [
      { type: 'heading', title: 'Heading', categories: ['basic'], atomic: false },
      { type: 'button', title: 'Button', categories: ['basic'], atomic: false },
      { type: 'e-heading', title: 'Heading', categories: ['v4'], atomic: true },
    ];
  }
  async getGeometry(ids: string[]): Promise<Record<string, GeometryNode>> {
    const all = await this.getAllGeometry();
    return Object.fromEntries(all.filter((g) => ids.includes(g.id)).map((g) => [g.id, g]));
  }
  async getAllGeometry(): Promise<GeometryNode[]> {
    return [
      geometry('c1', undefined, { x: 0, y: 0, width: 400, height: 200 }, { elType: 'container' }),
      geometry('h1', 'c1', { x: 0, y: 0, width: 500, height: 40 }, { text: 'Hello world', widgetType: 'heading' }),
      geometry('b1', 'c1', { x: 0, y: 50, width: 30, height: 20 }, { text: 'Click me', widgetType: 'button' }),
    ];
  }
  async runOps(ops: Op[], label: string): Promise<MutateResult> {
    this.record('runOps', ops, label);
    return {
      results: ops.map((op, index) => ({ index, op: op.op, ok: true, id: op.op === 'create' ? `new${index}` : undefined })),
      historyGrouped: true,
      historyTitle: `Agent: ${label}`,
    };
  }
  async save(mode: SaveMode) {
    this.record('save', mode);
    return { ok: true, status: mode === 'publish' ? 'publish' : 'draft' };
  }
  async getSelection(): Promise<string[]> {
    return this.selection;
  }
  async screenshot(id?: string, device?: DeviceMode) {
    this.record('screenshot', id, device);
    if (id === 'missing') throw new EditorError('element_not_found', 'missing');
    return { png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), box: { x: 1, y: 2, width: 3, height: 4 } };
  }
  async setDevice(device: DeviceMode) {
    this.record('setDevice', device);
  }
  async say(message: string, id?: string, mood?: AgentMood) {
    this.record('say', message, id, mood);
  }
  async moveCursor(id?: string) {
    this.record('moveCursor', id);
  }
  async setHud(state: HudState) {
    this.record('setHud', state);
  }
  async pullEvents(since: number): Promise<UserEvent[]> {
    return this.events.filter((e) => e.seq > since);
  }
  async waitForPrompt(timeoutMs: number): Promise<PromptResult | null> {
    this.record('waitForPrompt', timeoutMs);
    return this.prompt;
  }
}

interface Harness {
  client: Client;
  api: FakeEditorApi;
  close: () => Promise<void>;
}

const open: Harness[] = [];

async function connect(overrides: Partial<ServerDeps> = {}, api = new FakeEditorApi()): Promise<Harness> {
  const server = createServer({ getApi: async () => api, ...overrides });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const harness = { client, api, close: async () => { await client.close(); await server.close(); } };
  open.push(harness);
  return harness;
}

afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

type Content = { type: string; text?: string; data?: string; mimeType?: string };

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as { content: Content[]; isError?: boolean };
  const text = res.content.find((c) => c.type === 'text')?.text ?? 'null';
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { isError: res.isError === true, json, content: res.content };
}

const CORE_TOOLS = [
  'agent_say',
  'canvas_status',
  'capture_vision',
  'design_lint',
  'get_canvas_skeleton',
  'get_user_activity',
  'get_widget_controls',
  'inspect_element',
  'list_widgets',
  'mutate_canvas',
  'open_editor',
  'save_document',
  'set_hud',
  'wait_for_user_prompt',
];

describe('tool registration', () => {
  it('registers the v1 tools with descriptions; wp_rest only with a client', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(CORE_TOOLS);
    for (const t of tools) expect((t.description ?? '').length).toBeGreaterThan(120);

    const withWp = await connect({ wpRest: new WpRestClient({ baseUrl: 'https://wp.test', user: 'u', appPassword: 'p' }) });
    const names = (await withWp.client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('wp_rest');
    expect(names).toHaveLength(CORE_TOOLS.length + 1);
  });

  it('advertises the op union in the mutate_canvas schema', async () => {
    const { client } = await connect();
    const tool = (await client.listTools()).tools.find((t) => t.name === 'mutate_canvas')!;
    const schema = tool.inputSchema as any;
    expect(schema.required).toEqual(['ops']);
    const items = JSON.stringify(schema.properties.ops.items);
    for (const op of ['create', 'update_settings', 'move', 'delete', 'duplicate', 'set_custom_css']) expect(items).toContain(op);
  });

  it('exposes the workflow prompt and the status resource', async () => {
    const { client } = await connect();
    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((p) => p.name)).toContain('elementor_workflow');
    const prompt = await client.getPrompt({ name: 'elementor_workflow' });
    const text = (prompt.messages[0].content as { text: string }).text;
    expect(text).toContain('open_editor');
    expect(text).toContain('save_document');

    const resource = await client.readResource({ uri: 'elementor-live://status' });
    const status = JSON.parse((resource.contents[0] as { text: string }).text);
    expect(status).toMatchObject({ connected: true, postId: 5 });
  });
});

describe('status tools', () => {
  it('canvas_status returns the editor status', async () => {
    const { client } = await connect();
    const res = await call(client, 'canvas_status');
    expect(res.isError).toBe(false);
    expect(res.json).toMatchObject({ connected: true, elementorVersion: '4.3.5', selection: ['h1'] });
  });

  it('open_editor requires postId or url', async () => {
    const { client, api } = await connect();
    const bad = await call(client, 'open_editor');
    expect(bad.isError).toBe(true);
    expect(bad.json).toMatchObject({ code: 'invalid_input' });
    expect(bad.json.hint).toBeTruthy();

    const ok = await call(client, 'open_editor', { postId: 12 });
    expect(ok.json).toMatchObject({ connected: true, postId: 12 });
    expect(api.calls.find((c) => c.method === 'openEditor')?.args[0]).toEqual({ postId: 12, url: undefined });
  });
});

describe('read tools', () => {
  it('get_canvas_skeleton returns tree, selection, nodeCount, last 20 events and lastSeq', async () => {
    const { client } = await connect();
    const res = await call(client, 'get_canvas_skeleton');
    expect(res.isError).toBe(false);
    expect(res.json.tree.elType).toBe('document');
    expect(res.json.tree.children[0].children.map((c: any) => c.id)).toEqual(['h1', 'b1']);
    expect(res.json.tree.children[0].children[0].label).toBe('Hello world');
    expect(res.json.tree.children[1].atomic).toBe(true);
    expect(res.json.tree.children[0].settings).toBeUndefined();
    expect(res.json.selection).toEqual(['h1']);
    expect(res.json.nodeCount).toBe(5);
    expect(res.json.events).toHaveLength(20);
    expect(res.json.events[0].seq).toBe(6);
    expect(res.json.lastSeq).toBe(25);

    const since = await call(client, 'get_canvas_skeleton', { since: 23 });
    expect(since.json.events.map((e: any) => e.seq)).toEqual([24, 25]);
    expect(since.json.lastSeq).toBe(25);
  });

  it('get_canvas_skeleton with settings fetches controls once per type', async () => {
    const { client, api } = await connect();
    const res = await call(client, 'get_canvas_skeleton', { includeSettings: true });
    const heading = res.json.tree.children[0].children[0];
    expect(heading.settings).toEqual({ title: 'Hello world' });
    expect(api.controlsCalls.sort()).toEqual(['button', 'container', 'e-flexbox', 'heading']);
  });

  it('inspect_element returns settings, hints, geometry and relations', async () => {
    const { client } = await connect();
    const res = await call(client, 'inspect_element', { id: 'h1' });
    expect(res.isError).toBe(false);
    expect(res.json).toMatchObject({
      id: 'h1',
      elType: 'widget',
      widgetType: 'heading',
      atomic: false,
      label: 'Hello world',
      settings: { title: 'Hello world' },
      box: { x: 0, y: 0, width: 500, height: 40 },
      text: 'Hello world',
      scrollOverflowX: false,
      parentChain: [{ id: 'doc', elType: 'document' }, { id: 'c1', elType: 'container' }],
      children: [],
    });
    expect(res.json.controlsHint[0]).toBe('title');
    expect(res.json.controlsHint).toContain('title_color');
    expect(res.json.controlsHint).not.toContain('section_title');
    expect(res.json.controlsHint.length).toBeLessThanOrEqual(40);
    expect(res.json.computed.fontSize).toBe(16);
  });

  it('inspect_element reports element_not_found', async () => {
    const { client } = await connect();
    const res = await call(client, 'inspect_element', { id: 'nope' });
    expect(res.isError).toBe(true);
    expect(res.json.code).toBe('element_not_found');
    expect(res.json.hint).toContain('get_canvas_skeleton');
  });

  it('list_widgets filters case-insensitively on type and title', async () => {
    const { client } = await connect();
    expect((await call(client, 'list_widgets')).json).toHaveLength(3);
    const res = await call(client, 'list_widgets', { filter: 'HEAD' });
    expect(res.json.map((w: any) => w.type)).toEqual(['heading', 'e-heading']);
    expect((await call(client, 'list_widgets', { filter: 'butt' })).json.map((w: any) => w.type)).toEqual(['button']);
  });

  it('get_widget_controls caps options and strips deep defaults', async () => {
    const { client } = await connect();
    const res = await call(client, 'get_widget_controls', { widgetType: 'heading' });
    const many = res.json.find((c: any) => c.name === 'many');
    expect(Object.keys(many.options)).toHaveLength(30);
    expect(many.optionsTotal).toBe(45);
    expect(many).not.toHaveProperty('default');
    expect(res.json.find((c: any) => c.name === 'shallow').default).toEqual({ unit: 'px', size: 10 });
    expect(res.json.find((c: any) => c.name === 'header_size').options).toEqual({ h1: 'H1', h2: 'H2', h3: 'H3' });
  });

  it('maps EditorError to a JSON error body', async () => {
    const { client } = await connect();
    const res = await call(client, 'get_widget_controls', { widgetType: 'unknown' });
    expect(res.isError).toBe(true);
    expect(res.json).toEqual({ error: 'no such widget', code: 'evaluate_failed' });
  });
});

describe('mutate tools', () => {
  it('runs valid ops with the default label', async () => {
    const { client, api } = await connect();
    const ops = [
      { op: 'create', elType: 'container', settings: { flex_direction: 'row' } },
      { op: 'update_settings', id: 'h1', settings: { title: 'New' } },
    ];
    const res = await call(client, 'mutate_canvas', { ops });
    expect(res.isError).toBe(false);
    expect(res.json.results[0]).toMatchObject({ index: 0, op: 'create', ok: true, id: 'new0' });
    expect(res.json.historyGrouped).toBe(true);
    const run = api.calls.find((c) => c.method === 'runOps')!;
    expect(run.args).toEqual([ops, 'Edit']);
  });

  it('passes a custom label', async () => {
    const { client, api } = await connect();
    await call(client, 'mutate_canvas', { ops: [{ op: 'delete', id: 'b1' }], label: 'Remove button' });
    expect(api.calls.find((c) => c.method === 'runOps')!.args[1]).toBe('Remove button');
  });

  it('returns parseOps messages for invalid ops and applies nothing', async () => {
    const { client, api } = await connect();
    const res = await call(client, 'mutate_canvas', {
      ops: [{ op: 'create', elType: 'widget' }, { op: 'update_settings', settings: {} }, { op: 'explode', id: 'x' }],
    });
    expect(res.isError).toBe(true);
    expect(res.json.code).toBe('invalid_ops');
    expect(res.json.error).toContain('widgetType');
    expect(res.json.error).toContain('ops[1]');
    expect(res.json.details.errors.length).toBeGreaterThanOrEqual(3);
    expect(res.json.hint).toBeTruthy();
    expect(api.calls.some((c) => c.method === 'runOps')).toBe(false);

    const empty = await call(client, 'mutate_canvas', { ops: [] });
    expect(empty.isError).toBe(true);
    expect(empty.json.code).toBe('invalid_ops');
  });

  it('save_document forwards the mode', async () => {
    const { client, api } = await connect();
    const res = await call(client, 'save_document', { mode: 'publish' });
    expect(res.json).toEqual({ ok: true, status: 'publish' });
    expect(api.calls.find((c) => c.method === 'save')!.args).toEqual(['publish']);
    const bad = await call(client, 'save_document', { mode: 'trash' });
    expect(bad.isError).toBe(true);
  });
});

describe('vision tools', () => {
  it('capture_vision returns image content and box', async () => {
    const { client, api } = await connect();
    const res = await call(client, 'capture_vision', { id: 'h1', device: 'mobile' });
    expect(res.isError).toBe(false);
    const image = res.content.find((c) => c.type === 'image')!;
    expect(image.mimeType).toBe('image/png');
    expect(Buffer.from(image.data!, 'base64').subarray(0, 4).toString('hex')).toBe('89504e47');
    expect(res.json).toEqual({ box: { x: 1, y: 2, width: 3, height: 4 }, bytes: 7 });
    expect(api.calls.find((c) => c.method === 'screenshot')!.args).toEqual(['h1', 'mobile']);

    const missing = await call(client, 'capture_vision', { id: 'missing' });
    expect(missing.isError).toBe(true);
    expect(missing.json.code).toBe('element_not_found');
  });

  it('design_lint returns findings and the checked count', async () => {
    const { client } = await connect();
    const all = await call(client, 'design_lint');
    expect(all.isError).toBe(false);
    expect(all.json.checked).toBe(3);
    const rules = all.json.findings.map((f: any) => f.rule);
    expect(rules).toContain('child_overflow');
    expect(rules).toContain('tap_target_small');

    const scoped = await call(client, 'design_lint', { id: 'b1', grid: 8 });
    expect(scoped.json.checked).toBe(1);
    expect(scoped.json.findings.every((f: any) => f.id === 'b1')).toBe(true);

    const missing = await call(client, 'design_lint', { id: 'zzz' });
    expect(missing.isError).toBe(true);
    expect(missing.json.code).toBe('element_not_found');
  });
});

describe('interact tools', () => {
  it('agent_say and set_hud forward to the overlay', async () => {
    const { client, api } = await connect();
    expect((await call(client, 'agent_say', { message: 'Hi', id: 'h1', mood: 'happy' })).json).toEqual({ ok: true });
    expect((await call(client, 'set_hud', { score: 80, delta: 5, note: 'better' })).json).toEqual({ ok: true });
    expect(api.calls.find((c) => c.method === 'say')!.args).toEqual(['Hi', 'h1', 'happy']);
    expect(api.calls.find((c) => c.method === 'setHud')!.args).toEqual([{ score: 80, delta: 5, note: 'better' }]);
    expect((await call(client, 'agent_say', { message: 'x', mood: 'angry' })).isError).toBe(true);
  });

  it('get_user_activity returns events since a seq', async () => {
    const { client } = await connect();
    const res = await call(client, 'get_user_activity', { since: 20 });
    expect(res.json.events.map((e: any) => e.seq)).toEqual([21, 22, 23, 24, 25]);
    expect(res.json.lastSeq).toBe(25);
    const none = await call(client, 'get_user_activity', { since: 99 });
    expect(none.json).toEqual({ events: [], lastSeq: 99 });
    expect((await call(client, 'get_user_activity')).json.events).toHaveLength(25);
  });

  it('wait_for_user_prompt returns the prompt or a timeout marker', async () => {
    const api = new FakeEditorApi();
    const { client } = await connect({}, api);
    const res = await call(client, 'wait_for_user_prompt', { timeoutSec: 5 });
    expect(res.json).toEqual({ text: 'make this bigger', selection: ['h1'], seq: 26 });
    expect(api.calls.find((c) => c.method === 'waitForPrompt')!.args).toEqual([5000]);

    api.prompt = null;
    expect((await call(client, 'wait_for_user_prompt')).json).toEqual({ timeout: true });
    expect(api.calls.filter((c) => c.method === 'waitForPrompt')[1].args).toEqual([120000]);
    expect((await call(client, 'wait_for_user_prompt', { timeoutSec: 601 })).isError).toBe(true);
  });
});

describe('session handling', () => {
  it('retries once after not_connected when the api can be reset', async () => {
    const broken = new FakeEditorApi();
    broken.status = async () => {
      throw new EditorError('not_connected', 'browser closed');
    };
    const healthy = new FakeEditorApi();
    let created = 0;
    const lazy = createLazyApi(async () => (created++ === 0 ? broken : healthy) as FakeEditorApi & { close?: () => Promise<void> });
    const { client } = await connect({ getApi: lazy.getApi, resetApi: lazy.resetApi });
    const res = await call(client, 'canvas_status');
    expect(res.isError).toBe(false);
    expect(res.json.connected).toBe(true);
    expect(created).toBe(2);
  });

  it('reports not_connected with a hint when no reset is possible', async () => {
    const api = new FakeEditorApi();
    api.status = async () => {
      throw new EditorError('not_connected', 'no browser');
    };
    const { client } = await connect({}, api);
    const res = await call(client, 'canvas_status');
    expect(res.isError).toBe(true);
    expect(res.json.code).toBe('not_connected');
    expect(res.json.hint).toContain('open_editor');

    const resource = await client.readResource({ uri: 'elementor-live://status' });
    expect(JSON.parse((resource.contents[0] as { text: string }).text)).toMatchObject({ connected: false, code: 'not_connected' });
  });

  it('createLazyApi caches the session and retries after a failed start', async () => {
    let attempts = 0;
    const lazy = createLazyApi(async () => {
      attempts++;
      if (attempts === 1) throw new Error('chrome failed');
      return new FakeEditorApi();
    });
    await expect(lazy.getApi()).rejects.toThrow('chrome failed');
    const a = await lazy.getApi();
    expect(await lazy.getApi()).toBe(a);
    expect(attempts).toBe(2);
  });
});

describe('wp_rest', () => {
  function fakeFetch(status: number, body: unknown) {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const impl = (async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { impl, requests };
  }

  it('calls the REST API with basic auth and returns JSON', async () => {
    const { impl, requests } = fakeFetch(200, [{ id: 1 }]);
    const wpRest = new WpRestClient({ baseUrl: 'https://wp.test/', user: 'admin', appPassword: 'abcd efgh', fetch: impl });
    const { client } = await connect({ wpRest });
    const res = await call(client, 'wp_rest', { method: 'POST', path: '/wp/v2/pages', body: { title: 'New' } });
    expect(res.isError).toBe(false);
    expect(res.json).toEqual([{ id: 1 }]);
    expect(requests[0].url).toBe('https://wp.test/wp-json/wp/v2/pages');
    const headers = requests[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('admin:abcdefgh').toString('base64')}`);
    expect(requests[0].init.body).toBe('{"title":"New"}');
  });

  it('refuses writes to _elementor_data', async () => {
    const { impl, requests } = fakeFetch(200, {});
    const wpRest = new WpRestClient({ baseUrl: 'https://wp.test', user: 'a', appPassword: 'b', fetch: impl });
    const { client } = await connect({ wpRest });
    const res = await call(client, 'wp_rest', { method: 'POST', path: '/wp/v2/pages/5', body: { meta: { _elementor_data: '[]' } } });
    expect(res.isError).toBe(true);
    expect(res.json.code).toBe('forbidden');
    expect(requests).toHaveLength(0);
  });

  it('turns non-2xx responses into errors with status and excerpt', async () => {
    const { impl } = fakeFetch(401, { code: 'rest_not_logged_in' });
    const rest = new WpRestClient({ baseUrl: 'https://wp.test', user: 'a', appPassword: 'b', fetch: impl });
    await expect(rest.request('GET', 'wp/v2/users/me')).rejects.toBeInstanceOf(WpRestError);
    const { client } = await connect({ wpRest: rest });
    const res = await call(client, 'wp_rest', { method: 'GET', path: '/wp-json/wp/v2/users/me' });
    expect(res.isError).toBe(true);
    expect(res.json.code).toBe('wp_rest_error');
    expect(res.json.details.status).toBe(401);
    expect(res.json.error).toContain('rest_not_logged_in');
  });
});

describe('config', () => {
  it('reads env with defaults and expands ~', () => {
    const cfg = loadConfig({ ELIVE_HEADLESS: 'true', ELIVE_WP_URL: 'https://site.test/' });
    expect(cfg.session.headless).toBe(true);
    expect(cfg.session.wpUrl).toBe('https://site.test');
    expect(cfg.session.profileDir).toMatch(/\.elementor-live[\\/]profile$/);
    expect(cfg.session.profileDir.startsWith('~')).toBe(false);
    expect(cfg.wp).toBeUndefined();

    const full = loadConfig({ ELIVE_WP_URL: 'https://s', ELIVE_WP_USER: 'u', ELIVE_WP_APP_PASSWORD: 'p', ELIVE_CDP_URL: 'http://localhost:9222', ELIVE_HEADLESS: '0' });
    expect(full.wp).toEqual({ baseUrl: 'https://s', user: 'u', appPassword: 'p' });
    expect(full.session.cdpUrl).toBe('http://localhost:9222');
    expect(full.session.headless).toBe(false);
  });
});
