import { describe, expect, it } from 'vitest';
import { lintGeometry } from '../src/core/lint.js';
import type { Box, GeometryNode } from '../src/types.js';

type NodeInput = Omit<Partial<GeometryNode>, 'computed'> & {
  id: string;
  box: Box;
  computed?: Partial<GeometryNode['computed']>;
};

function node({ computed, ...rest }: NodeInput): GeometryNode {
  return {
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
      ...computed,
    },
    ...rest,
  };
}

function box(x: number, y: number, width: number, height: number): Box {
  return { x, y, width, height };
}

function fixture(): GeometryNode[] {
  return [
    node({ id: 'c1', elType: 'container', box: box(0, 0, 400, 600), computed: { paddingTop: 23, gap: 8 } }),
    node({ id: 'h1', widgetType: 'heading', parentId: 'c1', box: box(0, 0, 200, 72), computed: { lineHeight: 24 } }),
    node({ id: 'over', widgetType: 'image', parentId: 'c1', box: box(10, 100, 420, 50) }),
    node({ id: 's1', widgetType: 'text-editor', parentId: 'c1', box: box(0, 200, 200, 100) }),
    node({ id: 's2', widgetType: 'text-editor', parentId: 'c1', box: box(150, 250, 200, 100) }),
    node({ id: 'empty', elType: 'container', parentId: 'c1', box: box(0, 400, 400, 40) }),
  ];
}

function rulesFor(findings: ReturnType<typeof lintGeometry>, id: string): string[] {
  return findings.filter((f) => f.id === id).map((f) => f.rule);
}

describe('lintGeometry fixture', () => {
  const findings = lintGeometry(fixture());

  it('finds every expected problem', () => {
    expect(findings.map((f) => [f.id, f.rule])).toEqual([
      ['over', 'child_overflow'],
      ['c1', 'off_grid_spacing'],
      ['s1', 'sibling_overlap'],
      ['h1', 'heading_wraps'],
      ['empty', 'empty_container'],
    ]);
  });

  it('sorts by severity: error, warn, info', () => {
    const ranks = findings.map((f) => ({ error: 0, warn: 1, info: 2 })[f.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

describe('off_grid_spacing', () => {
  it('flags padding that is not a multiple of the grid and suggests the nearest multiple', () => {
    const [finding] = lintGeometry([node({ id: 'a', box: box(0, 0, 10, 10), computed: { paddingTop: 23, marginBottom: 10, gap: 8 } })]);
    expect(finding).toMatchObject({ id: 'a', rule: 'off_grid_spacing', severity: 'warn' });
    expect(finding?.detail).toContain('paddingTop 23px');
    expect(finding?.detail).toContain('marginBottom 10px');
    expect(finding?.detail).not.toContain('gap');
    expect(finding?.suggestion).toContain('paddingTop 24px');
    expect(finding?.suggestion).toContain('marginBottom 12px');
  });

  it('accepts on-grid values, zero, negatives and values within 0.5px tolerance', () => {
    const findings = lintGeometry([
      node({ id: 'a', box: box(0, 0, 10, 10), computed: { paddingTop: 24, paddingLeft: 16.4, marginTop: -3, gap: 0 } }),
    ]);
    expect(findings).toEqual([]);
  });

  it('respects a custom grid', () => {
    const items = [node({ id: 'a', box: box(0, 0, 10, 10), computed: { paddingTop: 12 } })];
    expect(lintGeometry(items, { grid: 4 })).toEqual([]);
    expect(lintGeometry(items, { grid: 8 })[0]?.suggestion).toBe('use paddingTop 16px');
  });
});

describe('child_overflow', () => {
  it('flags a child that exceeds its parent by more than 1px', () => {
    const findings = lintGeometry([
      node({ id: 'p', box: box(0, 0, 100, 100) }),
      node({ id: 'c', parentId: 'p', box: box(-5, 0, 110, 100) }),
    ]);
    expect(findings).toEqual([
      expect.objectContaining({ id: 'c', rule: 'child_overflow', severity: 'error', detail: 'extends beyond parent p: right 5px, left 5px' }),
    ]);
  });

  it('tolerates 1px and ignores children whose parent is not in the list', () => {
    expect(
      lintGeometry([node({ id: 'p', box: box(0, 0, 100, 100) }), node({ id: 'c', parentId: 'p', box: box(-1, 0, 101, 100.5) })]),
    ).toEqual([]);
    expect(lintGeometry([node({ id: 'c', parentId: 'missing', box: box(-50, 0, 500, 10) })])).toEqual([]);
  });
});

describe('sibling_overlap', () => {
  it('reports one finding per overlapping pair', () => {
    const findings = lintGeometry([
      node({ id: 'a', parentId: 'p', box: box(0, 0, 100, 100) }),
      node({ id: 'b', parentId: 'p', box: box(90, 90, 100, 100) }),
    ]);
    expect(findings).toEqual([
      expect.objectContaining({ id: 'a', rule: 'sibling_overlap', severity: 'warn', detail: 'overlaps sibling b by 10px x 10px' }),
    ]);
  });

  it('ignores touching boxes, small overlaps, different parents and zero-size boxes', () => {
    expect(
      lintGeometry([node({ id: 'a', parentId: 'p', box: box(0, 0, 100, 100) }), node({ id: 'b', parentId: 'p', box: box(98, 0, 100, 100) })]),
    ).toEqual([]);
    expect(
      lintGeometry([node({ id: 'a', parentId: 'p', box: box(0, 0, 100, 100) }), node({ id: 'b', parentId: 'q', box: box(50, 50, 100, 100) })]),
    ).toEqual([]);
    expect(
      lintGeometry([node({ id: 'a', parentId: 'p', box: box(0, 0, 100, 100) }), node({ id: 'b', parentId: 'p', box: box(50, 50, 0, 100) })]),
    ).toEqual([]);
  });
});

describe('heading_wraps', () => {
  it('flags headings that wrap to three or more lines', () => {
    const findings = lintGeometry([node({ id: 'h', widgetType: 'e-heading', box: box(0, 0, 100, 70), computed: { lineHeight: 24 } })]);
    expect(findings).toEqual([expect.objectContaining({ id: 'h', rule: 'heading_wraps', severity: 'info', detail: 'wraps to 3 lines' })]);
  });

  it('ignores two-line headings, non-headings and missing line heights', () => {
    expect(lintGeometry([node({ id: 'h', widgetType: 'heading', box: box(0, 0, 100, 48), computed: { lineHeight: 24 } })])).toEqual([]);
    expect(lintGeometry([node({ id: 't', widgetType: 'text-editor', box: box(0, 0, 100, 240), computed: { lineHeight: 24 } })])).toEqual([]);
    expect(lintGeometry([node({ id: 'h', widgetType: 'heading', box: box(0, 0, 100, 240), computed: { lineHeight: 0 } })])).toEqual([]);
  });

  it('does not count vertical padding as lines', () => {
    const items = [node({ id: 'h', widgetType: 'heading', box: box(0, 0, 100, 80), computed: { lineHeight: 24, paddingTop: 16, paddingBottom: 16 } })];
    expect(lintGeometry(items)).toEqual([]);
  });
});

describe('horizontal_scroll', () => {
  it('flags elements with horizontal scroll overflow', () => {
    expect(lintGeometry([node({ id: 'a', box: box(0, 0, 10, 10), scrollOverflowX: true })])).toEqual([
      expect.objectContaining({ id: 'a', rule: 'horizontal_scroll', severity: 'error' }),
    ]);
    expect(lintGeometry([node({ id: 'a', box: box(0, 0, 10, 10) })])).toEqual([]);
  });
});

describe('tap_target_small', () => {
  it('flags buttons shorter than 44px', () => {
    expect(lintGeometry([node({ id: 'b', widgetType: 'button', box: box(0, 0, 120, 32) })])).toEqual([
      expect.objectContaining({ id: 'b', rule: 'tap_target_small', severity: 'info', detail: 'height 32px is below 44px' }),
    ]);
  });

  it('accepts tall enough buttons and ignores other widgets', () => {
    expect(lintGeometry([node({ id: 'b', widgetType: 'e-button', box: box(0, 0, 120, 44) })])).toEqual([]);
    expect(lintGeometry([node({ id: 'i', widgetType: 'icon', box: box(0, 0, 20, 20) })])).toEqual([]);
  });
});

describe('empty_container', () => {
  it('flags container-like elements without children', () => {
    for (const elType of ['container', 'e-flexbox', 'e-div-block', 'e-grid', 'section', 'column']) {
      expect(lintGeometry([node({ id: 'x', elType, box: box(0, 0, 10, 10) })])).toEqual([
        expect.objectContaining({ id: 'x', rule: 'empty_container', severity: 'info' }),
      ]);
    }
  });

  it('ignores containers with children and non-containers', () => {
    expect(
      lintGeometry([
        node({ id: 'x', elType: 'container', box: box(0, 0, 100, 100) }),
        node({ id: 'y', parentId: 'x', box: box(0, 0, 10, 10) }),
      ]),
    ).toEqual([]);
    expect(lintGeometry([node({ id: 'w', elType: 'widget', box: box(0, 0, 10, 10) })])).toEqual([]);
  });
});

describe('onlyId', () => {
  it('restricts findings to the node and its descendants', () => {
    const items = [
      ...fixture(),
      node({ id: 'c3', elType: 'container', parentId: 'empty', box: box(0, 400, 40, 40) }),
      node({ id: 'other', widgetType: 'button', box: box(0, 900, 100, 20) }),
    ];
    expect(lintGeometry(items, { onlyId: 'empty' }).map((f) => [f.id, f.rule])).toEqual([['c3', 'empty_container']]);
    expect(lintGeometry(items, { onlyId: 'h1' }).map((f) => [f.id, f.rule])).toEqual([['h1', 'heading_wraps']]);
    expect(lintGeometry(items, { onlyId: 'other' }).map((f) => f.id)).toEqual(['other']);
  });

  it('includes the whole tree when filtering on the root', () => {
    expect(lintGeometry(fixture(), { onlyId: 'c1' })).toEqual(lintGeometry(fixture()));
  });

  it('reports an overlap from the perspective of the in-scope sibling', () => {
    const findings = lintGeometry(fixture(), { onlyId: 's2' });
    expect(findings).toEqual([expect.objectContaining({ id: 's2', rule: 'sibling_overlap', detail: 'overlaps sibling s1 by 50px x 50px' })]);
  });
});

describe('ordering and deduplication', () => {
  it('keeps input order within a severity', () => {
    const findings = lintGeometry([
      node({ id: 'b2', widgetType: 'button', box: box(0, 0, 100, 30) }),
      node({ id: 'x', box: box(0, 50, 10, 10), scrollOverflowX: true }),
      node({ id: 'b1', widgetType: 'button', box: box(0, 100, 100, 30) }),
    ]);
    expect(findings.map((f) => f.id)).toEqual(['x', 'b2', 'b1']);
  });

  it('does not duplicate findings for repeated nodes', () => {
    const repeated = node({ id: 'x', box: box(0, 0, 10, 10), scrollOverflowX: true });
    expect(lintGeometry([repeated, repeated])).toHaveLength(1);
  });
});
