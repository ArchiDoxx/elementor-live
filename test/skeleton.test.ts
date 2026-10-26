import { describe, expect, it } from 'vitest';
import { compressSkeleton, countNodes, elementLabel, findElement, nonDefaultSettings } from '../src/core/skeleton.js';
import type { ControlDef, RawElement } from '../src/types.js';

function el(partial: Partial<RawElement> & Pick<RawElement, 'id' | 'elType'>): RawElement {
  return { settings: {}, atomic: false, children: [], ...partial };
}

function fixture(): RawElement {
  const heading = el({
    id: 'h1',
    elType: 'widget',
    widgetType: 'heading',
    title: 'Heading',
    settings: { title: 'Welcome home', align: 'left', header_size: 'h2' },
  });
  const button = el({
    id: 'b1',
    elType: 'widget',
    widgetType: 'button',
    title: 'Button',
    settings: { text: 'Click me', size: 'sm' },
  });
  const inner = el({
    id: 'c2',
    elType: 'container',
    title: 'Container',
    children: [el({ id: 'deep', elType: 'widget', widgetType: 'text-editor', settings: { editor: '<p>Deep</p>' } })],
  });
  const container = el({
    id: 'c1',
    elType: 'container',
    title: 'Container',
    settings: { flex_direction: 'column', content_width: 'boxed' },
    children: [heading, button, inner],
  });
  return el({ id: 'document', elType: '', children: [container] });
}

describe('elementLabel', () => {
  it('prefers title over text', () => {
    expect(elementLabel({ elType: 'widget', settings: { title: 'Title', text: 'Text' } })).toBe('Title');
  });

  it('follows the priority chain', () => {
    expect(elementLabel({ elType: 'widget', settings: { button_text: 'Btn', heading: 'Head' } })).toBe('Btn');
    expect(elementLabel({ elType: 'widget', settings: { heading: 'Head', alt: 'Alt' } })).toBe('Head');
    expect(elementLabel({ elType: 'widget', settings: { caption: 'Cap', link: { url: 'https://x.test/a' } } })).toBe('Cap');
    expect(elementLabel({ elType: 'widget', settings: { link: { url: 'https://x.test/a' }, image: { url: 'https://x.test/b.png' } } })).toBe(
      'https://x.test/a',
    );
  });

  it('strips HTML and collapses whitespace from editor content', () => {
    const label = elementLabel({
      elType: 'widget',
      widgetType: 'text-editor',
      settings: { editor: '<p>Hello&nbsp;<strong>world</strong></p>\n\n<p>  again  &amp; again</p>' },
    });
    expect(label).toBe('Hello world again & again');
  });

  it('skips editor content that is empty after stripping', () => {
    expect(elementLabel({ elType: 'widget', settings: { editor: '<p> </p>', caption: 'Fallback' } })).toBe('Fallback');
  });

  it('uses the basename of the image url', () => {
    expect(elementLabel({ elType: 'widget', widgetType: 'image', settings: { image: { url: 'https://x.test/up/2024/hero.jpg?v=2', id: 5 } } })).toBe(
      'hero.jpg',
    );
  });

  it('ignores non-string values', () => {
    expect(elementLabel({ elType: 'widget', settings: { title: 42, text: ['x'], alt: 'Alt text' } })).toBe('Alt text');
  });

  it('falls back to the editor title only when it differs from the widget type', () => {
    expect(elementLabel({ elType: 'widget', widgetType: 'heading', title: 'Heading', settings: {} })).toBeUndefined();
    expect(elementLabel({ elType: 'widget', widgetType: 'text-editor', title: 'Text Editor', settings: {} })).toBeUndefined();
    expect(elementLabel({ elType: 'container', title: 'Hero section', settings: {} })).toBe('Hero section');
    expect(elementLabel({ elType: 'container', settings: {} })).toBeUndefined();
  });

  it('truncates to 60 characters with an ellipsis', () => {
    const label = elementLabel({ elType: 'widget', settings: { title: 'a'.repeat(80) } });
    expect(label).toHaveLength(60);
    expect(label?.endsWith('…')).toBe(true);
    expect(elementLabel({ elType: 'widget', settings: { title: 'b'.repeat(60) } })).toBe('b'.repeat(60));
  });
});

describe('nonDefaultSettings', () => {
  const controls: ControlDef[] = [
    { name: 'align', type: 'choose', default: 'left' },
    { name: 'header_size', type: 'select', default: 'h2' },
    { name: 'padding', type: 'dimensions', default: { unit: 'px', top: '', right: '', bottom: '', left: '', isLinked: true } },
    { name: 'typography', type: 'group', default: { size: 16, unit: 'px' } },
  ];

  it('removes values equal to the control default, including deep defaults', () => {
    const result = nonDefaultSettings(
      {
        title: 'Hi',
        align: 'left',
        header_size: 'h1',
        typography: { unit: 'px', size: 16 },
      },
      controls,
    );
    expect(result).toEqual({ title: 'Hi', header_size: 'h1' });
  });

  it('removes empty values and private keys but keeps non-empty __globals__', () => {
    const result = nonDefaultSettings({
      a: '',
      b: null,
      c: undefined,
      d: [],
      e: {},
      f: 0,
      g: false,
      __dynamic__: { title: '[elementor-tag]' },
      __globals__: { title_color: 'globals/colors?id=primary', typography_typography: '' },
    });
    expect(result).toEqual({ f: 0, g: false, __globals__: { title_color: 'globals/colors?id=primary' } });
  });

  it('drops __globals__ when it carries no references', () => {
    expect(nonDefaultSettings({ __globals__: { title_color: '' } })).toEqual({});
    expect(nonDefaultSettings({ __globals__: {} })).toEqual({});
  });

  it('keeps responsive variants only when they differ from the base value', () => {
    const result = nonDefaultSettings({
      align: 'center',
      align_tablet: 'center',
      align_mobile: 'right',
      align_tablet_extra: 'center',
      width_widescreen: { unit: '%', size: 50, sizes: [] },
    });
    expect(result).toEqual({ align: 'center', align_mobile: 'right', width_widescreen: { unit: '%', size: 50, sizes: [] } });
  });

  it('compares responsive variants against the raw base value even when the base equals the default', () => {
    const result = nonDefaultSettings({ align: 'left', align_tablet: 'left', align_mobile: 'center' }, controls);
    expect(result).toEqual({ align_mobile: 'center' });
  });

  it('keeps dimensions with at least one side and drops empty ones', () => {
    const filled = { unit: 'px', top: '10', right: '', bottom: '', left: '', isLinked: false };
    const empty = { unit: 'px', top: '', right: '', bottom: '', left: '', isLinked: true };
    expect(nonDefaultSettings({ margin: filled, _padding: empty })).toEqual({ margin: filled });
  });

  it('drops empty slider values', () => {
    expect(nonDefaultSettings({ space: { unit: 'px', size: '', sizes: [] }, gap: { unit: 'px', size: 8, sizes: [] } })).toEqual({
      gap: { unit: 'px', size: 8, sizes: [] },
    });
  });

  it('does not mutate its input', () => {
    const input = {
      title: 'Hi',
      align: 'left',
      __dynamic__: { x: 1 },
      __globals__: { a: 'globals/colors?id=1', b: '' },
      empty: '',
    };
    const snapshot = structuredClone(input);
    const result = nonDefaultSettings(input, controls);
    expect(input).toEqual(snapshot);
    expect(result).not.toBe(input);
  });
});

describe('compressSkeleton', () => {
  it('emits the root as a document and keeps structure, labels and widget types', () => {
    const tree = compressSkeleton(fixture());
    expect(tree.id).toBe('document');
    expect(tree.elType).toBe('document');
    expect(tree.label).toBeUndefined();
    const container = tree.children[0];
    expect(container).toMatchObject({ id: 'c1', elType: 'container' });
    expect(container).not.toHaveProperty('widgetType');
    expect(container).not.toHaveProperty('label');
    expect(container).not.toHaveProperty('atomic');
    expect(container?.children.map((c) => c.label)).toEqual(['Welcome home', 'Click me', undefined]);
    expect(container?.children[0]).toEqual({ id: 'h1', elType: 'widget', widgetType: 'heading', label: 'Welcome home', children: [] });
    expect(container?.children[2]?.children[0]?.label).toBe('Deep');
  });

  it('marks atomic elements', () => {
    const root = el({ id: 'document', elType: 'document', children: [el({ id: 'a', elType: 'e-flexbox', atomic: true })] });
    expect(compressSkeleton(root).children[0]?.atomic).toBe(true);
  });

  it('omits settings unless requested', () => {
    const tree = compressSkeleton(fixture());
    expect(tree.children[0]).not.toHaveProperty('settings');
  });

  it('includes non-default settings when requested, using controlsFor', () => {
    const controlsFor = (element: RawElement): ControlDef[] | undefined =>
      element.widgetType === 'heading'
        ? [
            { name: 'align', type: 'choose', default: 'left' },
            { name: 'header_size', type: 'select', default: 'h2' },
            { name: 'title', type: 'text', default: 'Welcome home' },
          ]
        : undefined;
    const tree = compressSkeleton(fixture(), { includeSettings: true, controlsFor });
    const container = tree.children[0];
    expect(container?.settings).toEqual({ flex_direction: 'column', content_width: 'boxed' });
    expect(container?.children[0]).not.toHaveProperty('settings');
    expect(container?.children[1]?.settings).toEqual({ text: 'Click me', size: 'sm' });
  });

  it('with maxDepth 1 emits depth-2 nodes as stubs and drops deeper nodes', () => {
    const tree = compressSkeleton(fixture(), { maxDepth: 1, includeSettings: true });
    const container = tree.children[0];
    expect(container?.label).toBeUndefined();
    expect(container?.settings).toEqual({ flex_direction: 'column', content_width: 'boxed' });
    expect(container?.children).toEqual([
      { id: 'h1', elType: 'widget', widgetType: 'heading', children: [] },
      { id: 'b1', elType: 'widget', widgetType: 'button', children: [] },
      { id: 'c2', elType: 'container', children: [] },
    ]);
  });

  it('with maxDepth 0 emits only stubs of the top-level elements', () => {
    const tree = compressSkeleton(fixture(), { maxDepth: 0 });
    expect(tree.children).toEqual([{ id: 'c1', elType: 'container', children: [] }]);
  });

  it('with maxDepth 2 shows details down to depth 2', () => {
    const tree = compressSkeleton(fixture(), { maxDepth: 2 });
    const inner = tree.children[0]?.children[2];
    expect(tree.children[0]?.children[0]?.label).toBe('Welcome home');
    expect(inner?.children).toEqual([{ id: 'deep', elType: 'widget', widgetType: 'text-editor', children: [] }]);
  });
});

describe('findElement and countNodes', () => {
  it('finds a nested element with its parent chain from the root', () => {
    const found = findElement(fixture(), 'deep');
    expect(found?.element.id).toBe('deep');
    expect(found?.parentChain.map((p) => p.id)).toEqual(['document', 'c1', 'c2']);
  });

  it('finds the root with an empty parent chain', () => {
    expect(findElement(fixture(), 'document')?.parentChain).toEqual([]);
  });

  it('returns undefined for unknown ids', () => {
    expect(findElement(fixture(), 'nope')).toBeUndefined();
  });

  it('counts all nodes including the root', () => {
    expect(countNodes(fixture())).toBe(6);
    expect(countNodes(el({ id: 'x', elType: 'document' }))).toBe(1);
  });
});
