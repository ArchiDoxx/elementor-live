import type { Box, GeometryNode, LintFinding, LintSeverity } from '../types.js';

const SEVERITY_RANK: Record<LintSeverity, number> = { error: 0, warn: 1, info: 2 };

const SPACING_PROPS = [
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'marginTop',
  'marginBottom',
  'gap',
] as const;

const HEADING_TYPES = new Set(['heading', 'e-heading']);
const BUTTON_TYPES = new Set(['button', 'e-button']);
const CONTAINER_TYPES = new Set(['container', 'e-flexbox', 'e-div-block', 'e-grid', 'section', 'column']);

const GRID_TOLERANCE = 0.5;
const OVERFLOW_TOLERANCE = 1;
const OVERLAP_TOLERANCE = 2;
const MIN_TAP_HEIGHT = 44;

function px(value: number): string {
  return `${Math.round(value * 100) / 100}px`;
}

function hasArea(box: Box): boolean {
  return box.width > 0 && box.height > 0;
}

function offGridSpacing(node: GeometryNode, grid: number): LintFinding | undefined {
  const offending = SPACING_PROPS.filter((prop) => {
    const value = node.computed[prop];
    if (!(value > 0)) return false;
    const remainder = value % grid;
    return Math.min(remainder, grid - remainder) > GRID_TOLERANCE;
  });
  if (offending.length === 0) return undefined;
  const detail = offending.map((prop) => `${prop} ${px(node.computed[prop])}`).join(', ');
  const suggestion = offending
    .map((prop) => `${prop} ${px(Math.max(grid, Math.round(node.computed[prop] / grid) * grid))}`)
    .join(', ');
  return {
    id: node.id,
    rule: 'off_grid_spacing',
    severity: 'warn',
    detail: `${detail} not on ${px(grid)} grid`,
    suggestion: `use ${suggestion}`,
  };
}

function childOverflow(node: GeometryNode, parent: GeometryNode | undefined): LintFinding | undefined {
  if (!parent || !hasArea(node.box) || !hasArea(parent.box)) return undefined;
  const c = node.box;
  const p = parent.box;
  const sides: Array<[string, number]> = [
    ['top', p.y - c.y],
    ['right', c.x + c.width - (p.x + p.width)],
    ['bottom', c.y + c.height - (p.y + p.height)],
    ['left', p.x - c.x],
  ];
  const exceeded = sides.filter(([, amount]) => amount > OVERFLOW_TOLERANCE);
  if (exceeded.length === 0) return undefined;
  return {
    id: node.id,
    rule: 'child_overflow',
    severity: 'error',
    detail: `extends beyond parent ${parent.id}: ${exceeded.map(([side, amount]) => `${side} ${px(amount)}`).join(', ')}`,
    suggestion: 'constrain width/height (max-width: 100%), allow wrapping, or remove negative margins and fixed sizes',
  };
}

function intersection(a: Box, b: Box): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  };
}

function headingWraps(node: GeometryNode): LintFinding | undefined {
  if (!node.widgetType || !HEADING_TYPES.has(node.widgetType)) return undefined;
  const { lineHeight, paddingTop, paddingBottom } = node.computed;
  if (!(lineHeight > 0)) return undefined;
  const contentHeight = node.box.height - Math.max(0, paddingTop) - Math.max(0, paddingBottom);
  const lines = Math.round(contentHeight / lineHeight);
  if (lines < 3) return undefined;
  return {
    id: node.id,
    rule: 'heading_wraps',
    severity: 'info',
    detail: `wraps to ${lines} lines`,
    suggestion: 'shorten the text, reduce the font size, or give the heading more width',
  };
}

function horizontalScroll(node: GeometryNode): LintFinding | undefined {
  if (!node.scrollOverflowX) return undefined;
  return {
    id: node.id,
    rule: 'horizontal_scroll',
    severity: 'error',
    detail: 'content is wider than the element and scrolls horizontally',
    suggestion: 'find the oversized child (fixed width, long unbroken text) and constrain it',
  };
}

function tapTargetSmall(node: GeometryNode): LintFinding | undefined {
  if (!node.widgetType || !BUTTON_TYPES.has(node.widgetType)) return undefined;
  if (!(node.box.height > 0) || node.box.height >= MIN_TAP_HEIGHT) return undefined;
  return {
    id: node.id,
    rule: 'tap_target_small',
    severity: 'info',
    detail: `height ${px(node.box.height)} is below ${px(MIN_TAP_HEIGHT)}`,
    suggestion: `increase vertical padding so the button is at least ${px(MIN_TAP_HEIGHT)} tall`,
  };
}

function emptyContainer(node: GeometryNode, childCount: number): LintFinding | undefined {
  if (!CONTAINER_TYPES.has(node.elType) || childCount > 0) return undefined;
  return {
    id: node.id,
    rule: 'empty_container',
    severity: 'info',
    detail: `${node.elType} has no children`,
    suggestion: 'add content or delete the container',
  };
}

function scopeOf(onlyId: string, childrenOf: Map<string, GeometryNode[]>): Set<string> {
  const scope = new Set<string>([onlyId]);
  const queue = [onlyId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const child of childrenOf.get(current) ?? []) {
      if (!scope.has(child.id)) {
        scope.add(child.id);
        queue.push(child.id);
      }
    }
  }
  return scope;
}

export function lintGeometry(nodes: GeometryNode[], opts: { grid?: number; onlyId?: string } = {}): LintFinding[] {
  const grid = opts.grid !== undefined && opts.grid > 0 ? opts.grid : 4;
  const byId = new Map<string, GeometryNode>();
  const childrenOf = new Map<string, GeometryNode[]>();
  for (const node of nodes) {
    if (!byId.has(node.id)) byId.set(node.id, node);
    if (node.parentId !== undefined) {
      const siblings = childrenOf.get(node.parentId) ?? [];
      siblings.push(node);
      childrenOf.set(node.parentId, siblings);
    }
  }
  const scope = opts.onlyId !== undefined ? scopeOf(opts.onlyId, childrenOf) : undefined;
  const inScope = (nodeId: string): boolean => scope === undefined || scope.has(nodeId);

  const findings: LintFinding[] = [];
  const seen = new Set<string>();
  const push = (finding: LintFinding | undefined): void => {
    if (!finding || !inScope(finding.id)) return;
    const key = `${finding.id}\u0000${finding.rule}\u0000${finding.detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(finding);
  };

  nodes.forEach((node, index) => {
    push(offGridSpacing(node, grid));
    push(childOverflow(node, node.parentId !== undefined ? byId.get(node.parentId) : undefined));

    if (hasArea(node.box)) {
      for (const other of nodes.slice(index + 1)) {
        if (other.parentId !== node.parentId || other.id === node.id || !hasArea(other.box)) continue;
        const overlap = intersection(node.box, other.box);
        if (overlap.width <= OVERLAP_TOLERANCE || overlap.height <= OVERLAP_TOLERANCE) continue;
        const [subject, peer] = inScope(node.id) || !inScope(other.id) ? [node, other] : [other, node];
        push({
          id: subject.id,
          rule: 'sibling_overlap',
          severity: 'warn',
          detail: `overlaps sibling ${peer.id} by ${px(overlap.width)} x ${px(overlap.height)}`,
          suggestion: 'check absolute positioning, negative margins, and fixed heights',
        });
      }
    }

    push(headingWraps(node));
    push(horizontalScroll(node));
    push(tapTargetSmall(node));
    push(emptyContainer(node, childrenOf.get(node.id)?.length ?? 0));
  });

  return findings
    .map((finding, order) => ({ finding, order }))
    .sort((a, b) => SEVERITY_RANK[a.finding.severity] - SEVERITY_RANK[b.finding.severity] || a.order - b.order)
    .map(({ finding }) => finding);
}
