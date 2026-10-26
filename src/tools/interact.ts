import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { recentEvents } from './read.js';
import { defineTool, type ToolContext, type ToolExtra } from './register.js';

const PROGRESS_INTERVAL_MS = 15000;

function startProgress(extra: ToolExtra, totalSec: number): () => void {
  const token = extra._meta?.progressToken;
  if (token === undefined) return () => {};
  const started = Date.now();
  const timer = setInterval(() => {
    const elapsed = Math.round((Date.now() - started) / 1000);
    extra
      .sendNotification({
        method: 'notifications/progress',
        params: { progressToken: token, progress: elapsed, total: totalSec, message: 'Waiting for the user to press Alt+Space in the editor' },
      })
      .catch(() => {});
  }, PROGRESS_INTERVAL_MS);
  return () => clearInterval(timer);
}

export function registerInteractTools(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    'agent_say',
    {
      title: 'Speak in the editor',
      description:
        'Show a short speech bubble from the agent inside the user\'s editor, anchored at an element (id, the ghost cursor moves there) or at the top of the canvas. Use it to explain what you are about to change, to point at lint findings, or to ask the user something while they watch the canvas. Keep messages under ~200 characters. mood tints the bubble: neutral, happy, thinking, warning, sassy.',
      input: {
        message: z.string().min(1).max(1000).describe('Text to show.'),
        id: z.string().min(1).optional().describe('Element ID to anchor the bubble at.'),
        mood: z.enum(['neutral', 'happy', 'thinking', 'warning', 'sassy']).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ message, id, mood }) =>
      ctx.withApi(async (api) => {
        await api.say(message, id, mood);
        return { ok: true };
      }),
  );

  defineTool(
    server,
    'set_hud',
    {
      title: 'Update HUD',
      description:
        'Update the small heads-up badge in the editor top bar: score (e.g. a 0–100 design quality estimate), delta (change since the last update, shown as +/-) and a short note. Purely informational for the user; it does not change the document.',
      input: {
        score: z.number().optional(),
        delta: z.number().optional(),
        note: z.string().max(200).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ score, delta, note }) =>
      ctx.withApi(async (api) => {
        await api.setHud({ score, delta, note });
        return { ok: true };
      }),
  );

  defineTool(
    server,
    'get_user_activity',
    {
      title: 'User activity',
      description:
        'Return what the user did in the editor since a sequence number: selections (ids), edits (change events with the history title and ids), Alt+Space prompts (text), saves and navigations, plus lastSeq. Pass since=<lastSeq of your previous call> to get only new events; re-read get_canvas_skeleton or inspect_element for elements the user changed before mutating them, so you do not overwrite their edits.',
      input: {
        since: z.number().int().min(0).optional().describe('Only events with seq greater than this value (default 0 = whole buffer).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ since }) =>
      ctx.withApi(async (api) => {
        const events = await api.pullEvents(since ?? 0);
        const lastSeq = events.length ? Math.max(...events.map((e) => e.seq)) : (since ?? 0);
        return { events, lastSeq };
      }),
  );

  defineTool(
    server,
    'wait_for_user_prompt',
    {
      title: 'Wait for user prompt',
      description:
        'Block until the user presses Alt+Space in the Elementor editor and submits a prompt, then return {text, selection, seq} — selection holds the element IDs the user had selected, which is what "this" refers to in the prompt. Returns {timeout: true} after timeoutSec (default 120, max 600). Use it for tag-team work: finish a task, call agent_say to report, then wait for the next prompt in a loop. If your MCP client enforces a short request timeout, pass a smaller timeoutSec and call again.',
      input: {
        timeoutSec: z.number().int().min(1).max(600).optional().describe('Seconds to wait (default 120, max 600).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ timeoutSec }, extra) => {
      const seconds = timeoutSec ?? 120;
      const stop = startProgress(extra, seconds);
      try {
        const result = await ctx.withApi((api) => api.waitForPrompt(seconds * 1000));
        return result ?? { timeout: true };
      } finally {
        stop();
      }
    },
  );
}
