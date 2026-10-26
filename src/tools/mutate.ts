import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OpSchema, parseOps } from '../core/ops.js';
import type { Op } from '../types.js';
import { defineTool, ToolError, type ToolContext } from './register.js';

const LenientOp = OpSchema.catch((ctx) => ctx.input as Op);

export function registerMutateTools(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    'mutate_canvas',
    {
      title: 'Mutate canvas',
      description:
        'Apply a batch of operations to the open document through Elementor\'s own command API, in the user\'s editor tab, as ONE undo step titled after label (the user can press Ctrl+Z). Ops: create {parentId?, at?, elType, widgetType?, settings?} (omit parentId to append at document root; elType "widget" needs widgetType), update_settings {id, settings} (merges keys), move {id, parentId, at?}, delete {id}, duplicate {id}, set_custom_css {id, css} (Elementor Pro custom_css; "selector" refers to the element). IDs must come from get_canvas_skeleton or from earlier create/duplicate results (returned per op as id) — never invent them. Within one batch, "$N" (e.g. "$0") as id/parentId refers to the element created by op N of the same batch, so a container and its children can be built in one undo step. Prefer elType "container" with flex settings (flex_direction, flex_gap, flex_justify_content, flex_align_items) over legacy section/column. Check keys with get_widget_controls first. Atomic V4 elements (elType/widgetType "e-*") can be created, but may reject classic settings (code unsupported_atomic). A failing op does not stop the others; inspect results[] and verify visually with capture_vision.',
      input: {
        ops: z.array(LenientOp).describe('Operations, applied in order.'),
        label: z.string().max(80).optional().describe('Short undo-history label, e.g. "Hero section". Default "Edit".'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ ops, label }) => {
      const parsed = parseOps(ops);
      if (!parsed.ok) {
        throw new ToolError(
          'invalid_ops',
          parsed.errors.join('\n'),
          'Fix the listed ops and resend the whole batch. Nothing was applied.',
          { errors: parsed.errors },
        );
      }
      const title = label?.trim() || 'Edit';
      return ctx.withApi((api) => api.runOps(parsed.ops, title));
    },
  );

  defineTool(
    server,
    'save_document',
    {
      title: 'Save document',
      description:
        'Save the open document via Elementor\'s save commands. mode "draft" saves a draft/revision without publishing, "update" saves an already published page, "publish" publishes it. Only save when the user asked for it or confirmed the result; mutations are visible in the editor before saving.',
      input: {
        mode: z.enum(['draft', 'publish', 'update']).describe('draft | publish | update'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ mode }) => ctx.withApi((api) => api.save(mode)),
  );
}
