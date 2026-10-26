import { z } from 'zod';
import type { Op } from '../types.js';

const id = z.string().min(1);
const at = z.number().int().nonnegative();
const settings = z.record(z.unknown());

const CreateOp = z
  .object({
    op: z.literal('create'),
    parentId: id.optional(),
    at: at.optional(),
    elType: z.string().min(1),
    widgetType: z.string().min(1).optional(),
    settings: settings.optional(),
  })
  .strict();

const UpdateSettingsOp = z.object({ op: z.literal('update_settings'), id, settings }).strict();

const MoveOp = z.object({ op: z.literal('move'), id, parentId: id, at: at.optional() }).strict();

const DeleteOp = z.object({ op: z.literal('delete'), id }).strict();

const DuplicateOp = z.object({ op: z.literal('duplicate'), id }).strict();

const SetCustomCssOp = z.object({ op: z.literal('set_custom_css'), id, css: z.string().max(20000) }).strict();

export const OpSchema: z.ZodType<Op> = z
  .discriminatedUnion('op', [CreateOp, UpdateSettingsOp, MoveOp, DeleteOp, DuplicateOp, SetCustomCssOp])
  .superRefine((value, ctx) => {
    if (value.op === 'create' && value.elType === 'widget' && value.widgetType === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['widgetType'],
        message: "widgetType is required when elType is 'widget'",
      });
    }
  });

export const OpsSchema: z.ZodType<Op[]> = z.array(OpSchema).min(1).max(100);

function formatPath(path: Array<string | number>): string {
  return path.reduce<string>(
    (acc, segment) => (typeof segment === 'number' ? `${acc}[${segment}]` : `${acc}.${segment}`),
    'ops',
  );
}

export function parseOps(input: unknown): { ok: true; ops: Op[] } | { ok: false; errors: string[] } {
  const result = OpsSchema.safeParse(input);
  if (result.success) return { ok: true, ops: result.data };
  return { ok: false, errors: result.error.issues.map((issue) => `${formatPath(issue.path)}: ${issue.message}`) };
}
