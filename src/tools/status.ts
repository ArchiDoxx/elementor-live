import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool, ToolError, type ToolContext } from './register.js';

export function registerStatusTools(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    'canvas_status',
    {
      title: 'Editor status',
      description:
        'Report the state of the live Elementor editor tab: whether a session is connected, the editor URL, postId, document title and type, Elementor version, whether V4 atomic elements are enabled, the current user selection (element IDs) and lastSeq of the activity buffer. Call this first in every session; if connected is false or the call fails with not_connected/no_editor_tab, call open_editor. The first call may start the dedicated Chrome window.',
      input: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => ctx.withApi((api) => api.status()),
  );

  defineTool(
    server,
    'open_editor',
    {
      title: 'Open Elementor editor',
      description:
        'Navigate the dedicated Chrome tab to the Elementor editor of a page and wait until the editor ($e) is ready. Pass either postId (requires ELIVE_WP_URL; opens /wp-admin/post.php?post=<id>&action=elementor) or a full editor url. Returns the same status object as canvas_status. If WordPress shows a login page, ask the user to log in once in that Chrome window and call open_editor again. After opening, call get_canvas_skeleton to learn element IDs.',
      input: {
        postId: z.number().int().positive().optional().describe('WordPress post/page ID to open in Elementor.'),
        url: z.string().url().optional().describe('Full URL of the Elementor editor (…/post.php?post=…&action=elementor).'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ postId, url }) => {
      if (postId === undefined && url === undefined) {
        throw new ToolError('invalid_input', 'open_editor needs either postId or url.', 'Pass postId (with ELIVE_WP_URL configured) or a full editor url.');
      }
      return ctx.withApi((api) => api.openEditor({ postId, url }));
    },
  );
}
