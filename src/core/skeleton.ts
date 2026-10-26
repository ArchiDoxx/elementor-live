import type { ControlDef, RawElement, SkeletonNode } from '../types.js';

const LABEL_MAX = 60;

const LABEL_KEYS = ['title', 'text', 'editor', 'html', 'button_text', 'heading', 'description_text', 'alt', 'caption'] as const;

const RESPONSIVE_SUFFIXES = ['_tablet_extra', '_mobile_extra', '_widescreen', '_laptop', '_tablet', '_mobile'];

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#039;': "'",
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return aKeys.length === bKeys.length && aKeys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]));
  }
  return false;
}

function asText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (isPlainObject(value) && typeof value.$$type === 'string' && typeof value.value === 'string') return value.value;
  return undefined;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(nbsp|amp|lt|gt|quot|#0?39);/g, (entity) => ENTITIES[entity] ?? entity);
}

function basename(url: string): string {
  const path = url.split(/[?#]/)[0] ?? '';
  const segments = path.split('/').filter((segment) => segment !== '');
  return segments[segments.length - 1] ?? '';
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function truncate(text: string): string {
  return text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1)}…` : text;
}

export function elementLabel(el: Pick<RawElement, 'settings' | 'widgetType' | 'elType' | 'title'>): string | undefined {
  const settings = el.settings ?? {};
  const candidates: Array<() => string | undefined> = [
    ...LABEL_KEYS.map((key) => () => {
      const raw = asText(settings[key]);
      if (raw === undefined) return undefined;
      return collapse(key === 'editor' ? stripHtml(raw) : raw);
    }),
    () => {
      const link = settings.link;
      return isPlainObject(link) ? asText(link.url)?.trim() : undefined;
    },
    () => {
      const image = settings.image;
      const url = isPlainObject(image) ? asText(image.url) : undefined;
      return url === undefined ? undefined : basename(url.trim());
    },
    () => {
      if (typeof el.title !== 'string') return undefined;
      const title = collapse(el.title);
      const typeName = el.widgetType ?? el.elType;
      return typeName && normalizeName(title) === normalizeName(typeName) ? undefined : title;
    },
  ];
  for (const candidate of candidates) {
    const text = candidate();
    if (text) return truncate(text);
  }
  return undefined;
}

function isEmptyValue(value: unknown): boolean {
  if (value === '' || value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}

function isDimensions(value: Record<string, unknown>): boolean {
  return ['top', 'right', 'bottom', 'left'].every((side) => Object.hasOwn(value, side));
}

function hasSide(value: Record<string, unknown>): boolean {
  return ['top', 'right', 'bottom', 'left'].some((side) => !isEmptyValue(value[side]));
}

function isEmptySlider(value: Record<string, unknown>): boolean {
  if (!Object.hasOwn(value, 'size') || !Object.hasOwn(value, 'unit')) return false;
  const sizes = value.sizes;
  return isEmptyValue(value.size) && (sizes === undefined || isEmptyValue(sizes));
}

function responsiveBase(key: string): string | undefined {
  const suffix = RESPONSIVE_SUFFIXES.find((s) => key.endsWith(s) && key.length > s.length);
  return suffix === undefined ? undefined : key.slice(0, -suffix.length);
}

function cleanGlobals(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) return undefined;
  const cleaned: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isEmptyValue(entry)) cleaned[key] = entry;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

export function nonDefaultSettings(settings: Record<string, unknown>, controls?: ControlDef[]): Record<string, unknown> {
  const defaults = new Map<string, unknown>();
  for (const control of controls ?? []) {
    if (Object.hasOwn(control, 'default')) defaults.set(control.name, control.default);
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (key.startsWith('__')) {
      const globals = key === '__globals__' ? cleanGlobals(value) : undefined;
      if (globals) result[key] = globals;
      continue;
    }
    if (isEmptyValue(value)) continue;
    if (defaults.has(key) && deepEqual(value, defaults.get(key))) continue;
    const base = responsiveBase(key);
    if (base !== undefined && Object.hasOwn(settings, base) && deepEqual(value, settings[base])) continue;
    if (isPlainObject(value)) {
      if (isDimensions(value) && !hasSide(value)) continue;
      if (isEmptySlider(value)) continue;
    }
    result[key] = value;
  }
  return result;
}

/**
 * Builds the compressed agent-facing tree. The root is always emitted as `elType: 'document'`
 * at depth 0. With `maxDepth`, nodes at depth <= maxDepth are emitted in full; their children
 * (depth maxDepth + 1) are emitted as structural stubs with only id/elType/widgetType and
 * `children: []`, so the agent can see that deeper content exists; anything deeper is dropped.
 */
export function compressSkeleton(
  root: RawElement,
  opts: { maxDepth?: number; includeSettings?: boolean; controlsFor?: (el: RawElement) => ControlDef[] | undefined } = {},
): SkeletonNode {
  const maxDepth = opts.maxDepth ?? Number.POSITIVE_INFINITY;

  const stub = (el: RawElement): SkeletonNode => ({
    id: el.id,
    elType: el.elType,
    ...(el.widgetType !== undefined ? { widgetType: el.widgetType } : {}),
    children: [],
  });

  const walkChildren = (children: RawElement[], depth: number): SkeletonNode[] =>
    children.map((child) => (depth > maxDepth ? stub(child) : full(child, depth)));

  const full = (el: RawElement, depth: number): SkeletonNode => {
    const node: SkeletonNode = { id: el.id, elType: el.elType, children: [] };
    if (el.widgetType !== undefined) node.widgetType = el.widgetType;
    const label = elementLabel(el);
    if (label !== undefined) node.label = label;
    if (el.atomic === true) node.atomic = true;
    if (opts.includeSettings) {
      const settings = nonDefaultSettings(el.settings ?? {}, opts.controlsFor?.(el));
      if (Object.keys(settings).length > 0) node.settings = settings;
    }
    node.children = walkChildren(el.children ?? [], depth + 1);
    return node;
  };

  return { id: root.id, elType: 'document', children: walkChildren(root.children ?? [], 1) };
}

export function findElement(root: RawElement, id: string): { element: RawElement; parentChain: RawElement[] } | undefined {
  const visit = (el: RawElement, chain: RawElement[]): { element: RawElement; parentChain: RawElement[] } | undefined => {
    if (el.id === id) return { element: el, parentChain: chain };
    const nextChain = [...chain, el];
    for (const child of el.children ?? []) {
      const found = visit(child, nextChain);
      if (found) return found;
    }
    return undefined;
  };
  return visit(root, []);
}

export function countNodes(root: RawElement): number {
  return 1 + (root.children ?? []).reduce((sum, child) => sum + countNodes(child), 0);
}
