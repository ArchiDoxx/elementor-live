import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WpRestClient } from '../wp/rest.js';
import { defineTool, ToolError } from './register.js';

export function registerWpTools(server: McpServer, client: WpRestClient): void {
  defineTool(
    server,
    'wp_rest',
    {
      title: 'WordPress REST',
      description:
        'Call the WordPress REST API of the configured site (authenticated with an Application Password) for operations outside the open document: list or create posts and pages (then open them with open_editor), upload or query media, read or change options, menus, users. path is relative to /wp-json, e.g. "/wp/v2/pages?per_page=20" or "/wp/v2/media". Never use it to write _elementor_data or other Elementor meta of a document — the open document must only be changed through mutate_canvas, otherwise the editor and the database overwrite each other. Write requests containing _elementor_data are rejected.',
      input: {
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
        path: z.string().min(1).describe('Path below /wp-json, e.g. /wp/v2/posts.'),
        body: z.unknown().optional().describe('JSON body for POST/PUT/PATCH.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ method, path, body }) => {
      if (method !== 'GET' && body !== undefined && JSON.stringify(body).includes('_elementor_data')) {
        throw new ToolError(
          'forbidden',
          'wp_rest must not write _elementor_data.',
          'Change the open document with mutate_canvas; for another document, open it with open_editor first.',
        );
      }
      return client.request(method, path, body);
    },
  );
}
