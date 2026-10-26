import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { EditorError } from '../browser/errors.js';
import { lintGeometry } from '../core/lint.js';
import type { GeometryNode } from '../types.js';
import { defineTool, RichResult, type ToolContext } from './register.js';

function subtreeIds(nodes: GeometryNode[], rootId: string): Set<string> {
  const ids = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) {
      if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) {
        ids.add(n.id);
        grew = true;
      }
    }
  }
  return ids;
}

export function registerVisionTools(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    'capture_vision',
    {
      title: 'Capture screenshot',
      description:
        'Take a pixel-accurate PNG screenshot of one element (id) or of the whole preview viewport (no id), as rendered in the live editor; the ghost cursor moves to the element first so the user sees what you look at. device switches the editor\'s responsive mode (desktop, tablet, mobile) before capturing. Use it after every meaningful mutation to verify the visual result instead of assuming it. Returns the image plus {box, bytes}.',
      input: {
        id: z.string().min(1).optional().describe('Element ID; omit for the whole preview viewport.'),
        device: z.enum(['desktop', 'tablet', 'mobile']).optional().describe('Responsive mode to capture.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id, device }) =>
      ctx.withApi(async (api) => {
        const shot = await api.screenshot(id, device);
        return new RichResult({ box: shot.box ?? null, bytes: shot.png.length }, [{ data: shot.png.toString('base64'), mimeType: 'image/png' }]);
      }),
  );

  defineTool(
    server,
    'design_lint',
    {
      title: 'Design lint',
      description:
        'Check rendered geometry for common layout problems: spacing off the grid (grid, default 4 px), children overflowing their parent, overlapping siblings, headings that wrap, horizontal scroll, tap targets smaller than 44 px, empty containers. With id only that element and its descendants are reported. Findings are suggestions: show them to the user (agent_say with id) and only fix what the user wants — do not silently override deliberate design choices.',
      input: {
        id: z.string().min(1).optional().describe('Limit findings to this element and its descendants.'),
        grid: z.number().int().min(1).max(64).optional().describe('Spacing grid in px (default 4).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id, grid }) =>
      ctx.withApi(async (api) => {
        const nodes = await api.getAllGeometry();
        if (id && !nodes.some((n) => n.id === id)) {
          throw new EditorError('element_not_found', `No rendered element with id "${id}".`, 'Call get_canvas_skeleton to get current IDs; hidden elements have no geometry.');
        }
        const findings = lintGeometry(nodes, { grid: grid ?? 4, onlyId: id });
        const checked = id ? subtreeIds(nodes, id).size : nodes.length;
        return { findings, checked };
      }),
  );
}
