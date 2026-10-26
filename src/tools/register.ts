import { z } from 'zod';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { CallToolResult, ServerNotification, ServerRequest, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { EditorError } from '../browser/errors.js';
import type { EditorApi } from '../types.js';
import { WpRestError, type WpRestClient } from '../wp/rest.js';

export type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

export interface ToolContext {
  withApi<T>(fn: (api: EditorApi) => Promise<T>): Promise<T>;
  wpRest?: WpRestClient;
}

export class ToolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly hint?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

export interface ImagePart {
  data: string;
  mimeType: string;
}

export class RichResult {
  constructor(
    public readonly json: unknown,
    public readonly images: ImagePart[] = [],
  ) {}
}

export interface ErrorBody {
  error: string;
  code: string;
  hint?: string;
  details?: unknown;
}

const DEFAULT_HINTS: Record<string, string> = {
  not_connected: 'No editor session. Call open_editor with a postId or url (the user may need to log in once in the opened Chrome window).',
  no_editor_tab: 'No Elementor editor tab is open. Call open_editor with a postId or url.',
  editor_not_ready: 'The editor is still loading or was reloaded. Wait a moment and call canvas_status again.',
  element_not_found: 'Element IDs change only through mutations. Call get_canvas_skeleton to get current IDs; never guess them.',
  timeout: 'The editor did not respond in time. Call canvas_status to check the session.',
  invalid_input: 'Check the tool input against its schema.',
};

function isEditorError(e: unknown): e is EditorError {
  return e instanceof EditorError || (e instanceof Error && e.name === 'EditorError' && typeof (e as { code?: unknown }).code === 'string');
}

export function toErrorBody(e: unknown): ErrorBody {
  let body: ErrorBody;
  if (e instanceof ToolError) {
    body = { error: e.message, code: e.code, hint: e.hint, details: e.details };
  } else if (isEditorError(e)) {
    body = { error: e.message, code: e.code, hint: e.hint };
  } else if (e instanceof z.ZodError) {
    body = {
      error: e.issues.map((i) => `${i.path.length ? i.path.join('.') : 'input'}: ${i.message}`).join('; '),
      code: 'invalid_input',
    };
  } else if (e instanceof WpRestError) {
    body = { error: e.message, code: 'wp_rest_error', details: { status: e.status } };
  } else if (e instanceof Error) {
    body = { error: e.message, code: 'internal_error' };
  } else {
    body = { error: String(e), code: 'internal_error' };
  }
  if (!body.hint && DEFAULT_HINTS[body.code]) body.hint = DEFAULT_HINTS[body.code];
  if (body.hint === undefined) delete body.hint;
  if (body.details === undefined) delete body.details;
  return body;
}

export function errorResult(e: unknown): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(toErrorBody(e)) }] };
}

export function successResult(value: unknown): CallToolResult {
  if (value instanceof RichResult) {
    return {
      content: [
        ...value.images.map((img) => ({ type: 'image' as const, data: img.data, mimeType: img.mimeType })),
        { type: 'text' as const, text: JSON.stringify(value.json ?? null) },
      ],
    };
  }
  return { content: [{ type: 'text', text: JSON.stringify(value ?? null) }] };
}

export interface ToolSpec<S extends z.ZodRawShape> {
  title?: string;
  description: string;
  input: S;
  annotations?: ToolAnnotations;
}

export function defineTool<S extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  spec: ToolSpec<S>,
  handler: (args: z.infer<z.ZodObject<S>>, extra: ToolExtra) => Promise<unknown>,
): RegisteredTool {
  const schema = z.object(spec.input);
  const callback = async (args: unknown, extra: ToolExtra): Promise<CallToolResult> => {
    try {
      return successResult(await handler(args as z.infer<z.ZodObject<S>>, extra));
    } catch (e) {
      return errorResult(e);
    }
  };
  return server.registerTool(
    name,
    { title: spec.title, description: spec.description, inputSchema: schema, annotations: spec.annotations },
    callback as never,
  );
}
