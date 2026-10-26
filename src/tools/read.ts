import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { EditorError } from '../browser/errors.js';
import { compressSkeleton, countNodes, elementLabel, findElement, nonDefaultSettings } from '../core/skeleton.js';
import type { ControlDef, EditorApi, RawElement, UserEvent } from '../types.js';
import { defineTool, type ToolContext } from './register.js';

const RECENT_EVENTS = 20;
const MAX_CONTROLS_HINT = 40;
const MAX_OPTIONS = 30;
const MAX_DEFAULT_DEPTH = 2;

const COMMON_CONTROLS = [
  'title',
  'editor',
  'text',
  'link',
  'header_size',
  'align',
  'title_color',
  'text_color',
  'typography_typography',
  'typography_font_family',
  'typography_font_size',
  'typography_font_weight',
  'image',
  'image_size',
  'selected_icon',
  'size',
  'button_type',
  'background_color',
  'content_width',
  'width',
  'min_height',
  'flex_direction',
  'flex_gap',
  'flex_justify_content',
  'flex_align_items',
  'flex_wrap',
  'padding',
  'margin',
  'background_background',
  'border_border',
  'border_radius',
  '_padding',
  '_margin',
  '_element_id',
  '_css_classes',
  'custom_css',
];

const LAYOUT_ONLY_TYPES = new Set(['section', 'tab', 'tabs', 'heading', 'divider', 'raw_html', 'alert', 'notice', 'deprecated_notice']);

export function controlKey(el: Pick<RawElement, 'elType' | 'widgetType'>): string {
  return el.widgetType ?? el.elType;
}

export async function safeControls(api: EditorApi, type: string, cache: Map<string, ControlDef[] | undefined>): Promise<ControlDef[] | undefined> {
  if (cache.has(type)) return cache.get(type);
  let controls: ControlDef[] | undefined;
  try {
    controls = await api.getControls(type);
  } catch {
    controls = undefined;
  }
  cache.set(type, controls);
  return controls;
}

function collectTypes(parent: RawElement, out: Set<string> = new Set()): Set<string> {
  for (const child of parent.children) {
    out.add(controlKey(child));
    collectTypes(child, out);
  }
  return out;
}

export async function recentEvents(api: EditorApi, since?: number): Promise<{ events: UserEvent[]; lastSeq: number }> {
  const all = await api.pullEvents(since ?? 0);
  const events = since === undefined ? all.slice(-RECENT_EVENTS) : all;
  const lastSeq = all.length ? Math.max(...all.map((e) => e.seq)) : (since ?? 0);
  return { events, lastSeq };
}

function controlsHint(settings: Record<string, unknown>, controls: ControlDef[] | undefined): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const push = (n: string) => {
    if (names.length < MAX_CONTROLS_HINT && !seen.has(n)) {
      seen.add(n);
      names.push(n);
    }
  };
  for (const key of Object.keys(settings)) push(key);
  const available = (controls ?? []).filter((c) => !LAYOUT_ONLY_TYPES.has(c.type));
  const availableNames = new Set(available.map((c) => c.name));
  for (const n of COMMON_CONTROLS) if (availableNames.has(n)) push(n);
  for (const c of available) push(c.name);
  return names;
}

function depthOf(value: unknown): number {
  if (value === null || typeof value !== 'object') return 0;
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  let max = 0;
  for (const child of children) max = Math.max(max, depthOf(child));
  return 1 + max;
}

export function trimControl(c: ControlDef): ControlDef & { optionsTotal?: number } {
  const out: ControlDef & { optionsTotal?: number } = { ...c };
  if (out.options) {
    const entries = Object.entries(out.options);
    if (entries.length > MAX_OPTIONS) {
      out.options = Object.fromEntries(entries.slice(0, MAX_OPTIONS));
      out.optionsTotal = entries.length;
    }
  }
  if ('default' in out && depthOf(out.default) > MAX_DEFAULT_DEPTH) delete out.default;
  return out;
}

export function registerReadTools(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    'get_canvas_skeleton',
    {
      title: 'Canvas skeleton',
      description:
        'Return the compressed element tree of the open document: {id, elType, widgetType, label, atomic?, children} per node, plus the current user selection, nodeCount, recent user events (selections, edits, Alt+Space prompts, saves) and lastSeq. This is the only source of element IDs besides create results — never invent IDs. Pass since=<lastSeq from a previous call> to receive only newer events; without it the last 20 events are returned. includeSettings=true adds non-default settings per node (more tokens); use inspect_element for a single element instead. maxDepth limits nesting for very large pages.',
      input: {
        maxDepth: z.number().int().min(0).max(50).optional().describe('Maximum nesting depth to return.'),
        includeSettings: z.boolean().optional().describe('Include non-default settings for every node.'),
        since: z.number().int().min(0).optional().describe('Only return events with seq greater than this value.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ maxDepth, includeSettings, since }) =>
      ctx.withApi(async (api) => {
        const tree = await api.getTree();
        const cache = new Map<string, ControlDef[] | undefined>();
        if (includeSettings) {
          for (const type of collectTypes(tree)) await safeControls(api, type, cache);
        }
        const skeleton = compressSkeleton(tree, {
          maxDepth,
          includeSettings: includeSettings ?? false,
          controlsFor: includeSettings ? (el) => cache.get(controlKey(el)) : undefined,
        });
        const selection = await api.getSelection();
        const { events, lastSeq } = await recentEvents(api, since);
        return { tree: skeleton, selection, nodeCount: countNodes(tree), events, lastSeq };
      }),
  );

  defineTool(
    server,
    'inspect_element',
    {
      title: 'Inspect element',
      description:
        'Inspect one element by ID (from get_canvas_skeleton or a create result): non-default settings, controlsHint (the most relevant setting keys for this widget type), rendered bounding box in the preview iframe, an excerpt of computed styles (display, padding, margins, gap, font size, line height, overflow), visible text, whether it overflows horizontally, its parent chain and direct children. Use it before update_settings to see the current values and their exact shapes; call get_widget_controls when you need a key that is not in controlsHint. Fails with element_not_found for unknown IDs.',
      input: {
        id: z.string().min(1).describe('Element ID.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id }) =>
      ctx.withApi(async (api) => {
        const tree = await api.getTree();
        const found = findElement(tree, id);
        if (!found) {
          throw new EditorError('element_not_found', `No element with id "${id}" in the open document.`, 'Call get_canvas_skeleton to get current IDs; never guess them.');
        }
        const { element, parentChain } = found;
        const controls = await safeControls(api, controlKey(element), new Map());
        const settings = nonDefaultSettings(element.settings, controls);
        const geometry = (await api.getGeometry([id]))[id];
        return {
          id: element.id,
          elType: element.elType,
          widgetType: element.widgetType,
          atomic: element.atomic,
          label: elementLabel(element),
          settings,
          controlsHint: controlsHint(settings, controls),
          box: geometry?.box ?? null,
          computed: geometry?.computed ?? null,
          text: geometry?.text ?? null,
          scrollOverflowX: geometry?.scrollOverflowX ?? null,
          parentChain: parentChain.map((p) => ({ id: p.id, elType: p.elType, widgetType: p.widgetType })),
          children: element.children.map((c) => ({ id: c.id, elType: c.elType, widgetType: c.widgetType, label: elementLabel(c) })),
        };
      }),
  );

  defineTool(
    server,
    'list_widgets',
    {
      title: 'List widgets',
      description:
        'List the widget types registered in this Elementor installation as [{type, title, categories, atomic}]. Use filter (case-insensitive substring of type or title) to search, e.g. "button" or "image". Use the type as widgetType in a create op with elType "widget". Prefer classic widgets (heading, text-editor, button, image, icon-list …) inside "container" elements; atomic types (prefixed "e-") are Elementor V4 elements and may reject classic settings.',
      input: {
        filter: z.string().optional().describe('Case-insensitive substring of widget type or title.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ filter }) =>
      ctx.withApi(async (api) => {
        const widgets = await api.listWidgets();
        const f = filter?.trim().toLowerCase();
        if (!f) return widgets;
        return widgets.filter((w) => w.type.toLowerCase().includes(f) || w.title.toLowerCase().includes(f));
      }),
  );

  defineTool(
    server,
    'get_widget_controls',
    {
      title: 'Widget controls',
      description:
        'Return the control definitions (setting keys) of a widget type or elType, e.g. "heading", "button" or "container": name, type, label, default, options (capped at 30), section, tab, responsive. Call this before writing settings you have not seen in inspect_element — never guess setting keys. Responsive controls accept suffixed keys (name_tablet, name_mobile). Value shapes follow the control type: dimensions {unit, top, right, bottom, left, isLinked}, sliders {unit, size}, colors as hex strings, selects as one of the option keys.',
      input: {
        widgetType: z.string().min(1).describe('Widget type (e.g. "heading") or elType (e.g. "container").'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ widgetType }) => ctx.withApi(async (api) => (await api.getControls(widgetType)).map(trimControl)),
  );
}
