import { describe, expect, it } from 'vitest';
import { OpSchema, parseOps } from '../src/core/ops.js';

function errorsOf(input: unknown): string[] {
  const result = parseOps(input);
  if (result.ok) throw new Error('expected parseOps to fail');
  return result.errors;
}

describe('parseOps', () => {
  it('accepts every op kind', () => {
    const ops = [
      { op: 'create', elType: 'container' },
      { op: 'create', parentId: 'c1', at: 0, elType: 'widget', widgetType: 'heading', settings: { title: 'Hi' } },
      { op: 'update_settings', id: 'h1', settings: { title: 'New' } },
      { op: 'move', id: 'h1', parentId: 'c2', at: 3 },
      { op: 'move', id: 'h1', parentId: 'c2' },
      { op: 'delete', id: 'b1' },
      { op: 'duplicate', id: 'c1' },
      { op: 'set_custom_css', id: 'c1', css: 'selector { color: red; }' },
    ];
    const result = parseOps(ops);
    expect(result).toEqual({ ok: true, ops });
  });

  it('rejects unknown op kinds', () => {
    const errors = errorsOf([{ op: 'create', elType: 'container' }, { op: 'explode', id: 'x' }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^ops\[1\]\.op: /);
  });

  it('requires widgetType when elType is widget', () => {
    expect(errorsOf([{ op: 'create', elType: 'widget' }])).toEqual([
      "ops[0].widgetType: widgetType is required when elType is 'widget'",
    ]);
  });

  it('rejects unknown keys', () => {
    const errors = errorsOf([{ op: 'delete', id: 'x', force: true }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^ops\[0\]: Unrecognized key\(s\) in object: 'force'/);
  });

  it('rejects an empty array', () => {
    expect(errorsOf([])).toEqual([expect.stringMatching(/^ops: .*at least 1/)]);
  });

  it('rejects more than 100 ops', () => {
    const ops = Array.from({ length: 101 }, (_, i) => ({ op: 'delete', id: `e${i}` }));
    expect(errorsOf(ops)).toEqual([expect.stringMatching(/^ops: .*at most 100/)]);
    expect(parseOps(ops.slice(0, 100)).ok).toBe(true);
  });

  it('rejects a negative or fractional at', () => {
    expect(errorsOf([{ op: 'move', id: 'a', parentId: 'b', at: -1 }])[0]).toMatch(/^ops\[0\]\.at: /);
    expect(errorsOf([{ op: 'create', elType: 'container', at: 1.5 }])[0]).toMatch(/^ops\[0\]\.at: /);
  });

  it('reports the path of a wrongly typed settings field', () => {
    expect(errorsOf([{ op: 'delete', id: 'a' }, { op: 'delete', id: 'b' }, { op: 'update_settings', id: 'c', settings: 'x' }])).toEqual([
      'ops[2].settings: Expected object, received string',
    ]);
  });

  it('rejects empty ids and missing required fields', () => {
    expect(errorsOf([{ op: 'delete', id: '' }])[0]).toMatch(/^ops\[0\]\.id: /);
    expect(errorsOf([{ op: 'move', id: 'a' }])[0]).toMatch(/^ops\[0\]\.parentId: /);
    expect(errorsOf([{ op: 'create', elType: '' }])[0]).toMatch(/^ops\[0\]\.elType: /);
  });

  it('rejects css longer than 20000 characters', () => {
    expect(errorsOf([{ op: 'set_custom_css', id: 'a', css: 'x'.repeat(20001) }])[0]).toMatch(/^ops\[0\]\.css: /);
    expect(parseOps([{ op: 'set_custom_css', id: 'a', css: 'x'.repeat(20000) }]).ok).toBe(true);
  });

  it('rejects non-array input', () => {
    expect(errorsOf({ op: 'delete', id: 'a' })).toEqual(['ops: Expected array, received object']);
  });

  it('reports errors from several ops at once', () => {
    const errors = errorsOf([{ op: 'delete' }, { op: 'duplicate', id: 'ok' }, { op: 'create', elType: 'widget' }]);
    expect(errors.some((e) => e.startsWith('ops[0].id: '))).toBe(true);
    expect(errors.some((e) => e.startsWith('ops[2].widgetType: '))).toBe(true);
  });
});

describe('OpSchema', () => {
  it('parses a single op', () => {
    expect(OpSchema.safeParse({ op: 'duplicate', id: 'x' }).success).toBe(true);
    expect(OpSchema.safeParse({ op: 'duplicate' }).success).toBe(false);
  });
});
