import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EditorApi } from './types.js';
import type { WpRestClient } from './wp/rest.js';
import { registerInteractTools } from './tools/interact.js';
import { registerMutateTools } from './tools/mutate.js';
import { registerReadTools } from './tools/read.js';
import { registerStatusTools } from './tools/status.js';
import { registerVisionTools } from './tools/vision.js';
import { registerWpTools } from './tools/wp.js';
import { toErrorBody, type ToolContext } from './tools/register.js';

export interface ServerDeps {
  getApi: () => Promise<EditorApi>;
  resetApi?: () => Promise<void> | void;
  wpRest?: WpRestClient;
}

export const WORKFLOW_GUIDE = `You are working on a live Elementor editor tab that the user is watching. Every change you make appears instantly and is undoable with Ctrl+Z.

1. canvas_status — check the session. If not connected, open_editor({postId}) or open_editor({url}). If WordPress shows a login page, ask the user to log in once in the opened Chrome window.
2. get_canvas_skeleton — learn the structure, the user's current selection and recent activity. Element IDs come only from here or from create results; never invent them. "This"/"here" in user requests means the selection.
3. inspect_element({id}) — current non-default settings, controlsHint, box and computed styles. Call get_widget_controls({widgetType}) before writing setting keys you have not seen.
4. mutate_canvas({ops, label}) — batch related changes into one call (one undo step). Prefer elType "container" with flex settings; widgets go inside containers. Atomic V4 elements ("e-*") may reject classic settings.
5. capture_vision({id}) — look at the result; optionally design_lint({id}) and report findings with agent_say instead of silently "fixing" deliberate choices.
6. save_document({mode}) — only when the user asked for it or confirmed.

Tag-team: agent_say to explain, wait_for_user_prompt to receive the next Alt+Space prompt from inside the editor, get_user_activity({since}) to notice the user's own edits before touching the same elements. wp_rest (if available) is for posts, media and options only — never for _elementor_data.`;

function readVersion(): string {
  try {
    const pkg = createRequire(import.meta.url)('../package.json') as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function errorCode(e: unknown): string | undefined {
  if (e instanceof Error && e.name === 'EditorError') return (e as { code?: string }).code;
  return undefined;
}

export function createLazyApi<T extends EditorApi & { close?: () => Promise<void> }>(factory: () => Promise<T>) {
  let pending: Promise<T> | undefined;
  const getApi = (): Promise<T> => {
    if (!pending) {
      pending = factory().catch((e: unknown) => {
        pending = undefined;
        throw e;
      });
    }
    return pending;
  };
  const resetApi = async (): Promise<void> => {
    const current = pending;
    pending = undefined;
    if (current) await current.then((api) => api.close?.()).catch(() => undefined);
  };
  return { getApi, resetApi, close: resetApi };
}

export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer(
    { name: 'elementor-live', version: readVersion() },
    { instructions: WORKFLOW_GUIDE },
  );

  const withApi: ToolContext['withApi'] = async (fn) => {
    try {
      return await fn(await deps.getApi());
    } catch (e) {
      if (errorCode(e) !== 'not_connected' || !deps.resetApi) throw e;
      console.error('[elementor-live] session lost (not_connected); restarting once');
      await deps.resetApi();
      return fn(await deps.getApi());
    }
  };

  const ctx: ToolContext = { withApi, wpRest: deps.wpRest };

  registerStatusTools(server, ctx);
  registerReadTools(server, ctx);
  registerMutateTools(server, ctx);
  registerVisionTools(server, ctx);
  registerInteractTools(server, ctx);
  if (deps.wpRest) registerWpTools(server, deps.wpRest);

  server.registerPrompt(
    'elementor_workflow',
    {
      title: 'Elementor live workflow',
      description: 'How to work on the live Elementor editor with the elementor-live tools.',
    },
    () => ({
      messages: [{ role: 'user', content: { type: 'text', text: WORKFLOW_GUIDE } }],
    }),
  );

  server.registerResource(
    'status',
    'elementor-live://status',
    {
      title: 'Editor status',
      description: 'Current state of the live Elementor editor session (same as canvas_status).',
      mimeType: 'application/json',
    },
    async (uri) => {
      let body: unknown;
      try {
        body = await withApi((api) => api.status());
      } catch (e) {
        body = { connected: false, selection: [], ...toErrorBody(e) };
      }
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(body) }] };
    },
  );

  return server;
}
