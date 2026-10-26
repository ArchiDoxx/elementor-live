# elementor-live

An MCP server that lets coding agents (Claude Code, Kimi Code, Cursor, any MCP client) work on a **live Elementor editor tab** like an IDE. The agent sees what you select, changes the canvas through Elementor's own command API (`$e.run`) inside your Chrome tab — so every change is one undo step, Ctrl+Z works, and nothing fights over the database — moves a ghost cursor so you can follow along, takes pixel-accurate screenshots of what it built, and receives prompts you type directly in the editor with Alt+Space.

The loop:

```
open_editor → get_canvas_skeleton → inspect_element → mutate_canvas → capture_vision → (design_lint) → save_document
                        ↑                                                                  │
                        └──────────── wait_for_user_prompt (Alt+Space in the editor) ──────┘
```

There is no WordPress plugin. The server drives a dedicated Chrome window over the Chrome DevTools Protocol (Playwright) and injects a small overlay (cursor, speech bubble, HUD, prompt box) into the editor page.

## Requirements

- Node.js ≥ 20
- Google Chrome installed (the system Chrome is used; no browser download)
- A WordPress site with Elementor ≥ 3.x and a user who can edit pages. Tested on Elementor 4.3.5 with the Atomic editor enabled.

## Install

```bash
git clone https://github.com/ArchiDoxx/elementor-live.git
cd elementor-live
npm install
npm run build
npx elementor-live doctor
```

`doctor` prints the configuration, checks that Chrome is found and the profile directory is writable, and whether `ELIVE_WP_URL` responds (and authenticates, if REST credentials are set).

## First run

```bash
ELIVE_WP_URL=https://your-site.example npx elementor-live open
```

A Chrome window with its own profile (`~/.elementor-live/profile`) opens. Log in to WordPress once — the login persists in that profile — and open a page with "Edit with Elementor". You can also pass a post ID or an editor URL: `npx elementor-live open 42`.

Close it with Ctrl+C before you start your MCP client: the profile can only be used by one Chrome process at a time. The MCP server launches the same profile on the first tool call. To keep using a Chrome you started yourself, start it with `--remote-debugging-port=9222` and set `ELIVE_CDP_URL=http://localhost:9222`.

## MCP client configuration

Use the absolute path to `dist/cli.js` of your checkout. More snippets: [docs/mcp-clients.md](docs/mcp-clients.md).

**Claude Code**

```bash
claude mcp add elementor-live -e ELIVE_WP_URL=https://your-site.example -- node /abs/path/elementor-live/dist/cli.js
```

**Kimi Code, Cursor and other JSON-configured clients** (`mcpServers`):

```json
{
  "mcpServers": {
    "elementor-live": {
      "command": "node",
      "args": ["/abs/path/elementor-live/dist/cli.js"],
      "env": {
        "ELIVE_WP_URL": "https://your-site.example"
      }
    }
  }
}
```

The server speaks MCP over stdio; it logs only to stderr.

## Tools

| Tool | Input | Output |
|---|---|---|
| `canvas_status` | – | connected, editorUrl, postId, title, documentType, elementorVersion, atomicEnabled, selection, lastSeq |
| `open_editor` | `postId` or `url` | same as `canvas_status` |
| `get_canvas_skeleton` | `maxDepth?`, `includeSettings?`, `since?` | compressed tree `{id, elType, widgetType, label, atomic?, children}`, selection, nodeCount, events, lastSeq |
| `inspect_element` | `id` | non-default settings, controlsHint, box, computed styles, text, scrollOverflowX, parentChain, children |
| `list_widgets` | `filter?` | `[{type, title, categories, atomic}]` |
| `get_widget_controls` | `widgetType` | control definitions (type, default, options capped at 30) |
| `mutate_canvas` | `ops[]`, `label?` | per-op results `{ok, id?, error?, code?}`, historyGrouped, historyTitle |
| `save_document` | `mode: draft \| publish \| update` | ok, status |
| `capture_vision` | `id?`, `device?` | PNG image + `{box, bytes}` |
| `design_lint` | `id?`, `grid?` (default 4) | findings `[{id, rule, severity, detail, suggestion}]`, checked |
| `agent_say` | `message`, `id?`, `mood?` | ok |
| `set_hud` | `score?`, `delta?`, `note?` | ok |
| `get_user_activity` | `since?` | events since seq, lastSeq |
| `wait_for_user_prompt` | `timeoutSec?` (default 120, max 600) | `{text, selection, seq}` or `{timeout: true}` |
| `wp_rest` | `method`, `path`, `body?` | JSON (only when REST credentials are configured) |

`mutate_canvas` operations:

```jsonc
{ "op": "create", "parentId": "c1a2b3", "at": 0, "elType": "widget", "widgetType": "heading", "settings": { "title": "Hello" } }
{ "op": "update_settings", "id": "h4d5e6", "settings": { "title_color": "#1a1a1a" } }
{ "op": "move", "id": "h4d5e6", "parentId": "c7f8g9", "at": 1 }
{ "op": "delete", "id": "b1c2d3" }
{ "op": "duplicate", "id": "c1a2b3" }
{ "op": "set_custom_css", "id": "c1a2b3", "css": "selector { scroll-margin-top: 80px; }" }
```

All ops of one call form a single undo step. Element IDs come only from `get_canvas_skeleton` or from `create`/`duplicate` results. A failing op does not stop the others.

Errors are returned as tool results with `isError: true` and a JSON body `{ "error", "code", "hint" }`, e.g. `not_connected`, `no_editor_tab`, `element_not_found`, `invalid_ops`.

The server also provides the prompt `elementor_workflow` (a short guide for the agent) and the resource `elementor-live://status`.

## Tag-team with Alt+Space

1. Ask your agent to "work with me in the editor" — it calls `wait_for_user_prompt`.
2. In the Elementor editor, select an element and press **Alt+Space**. Type what you want ("make this a two-column layout with an image on the right") and press Enter.
3. The agent receives your text plus the current selection, makes the change (one undo step), shows a speech bubble at the element, and waits for the next prompt.

Edits you make yourself show up in `get_user_activity`, so the agent can re-read an element before touching it again.

## Example prompts

- "Open page 42 in Elementor and describe its structure."
- "Build a hero section at the top: full-width container, heading, short text, two buttons side by side. Then show me a screenshot."
- "The selected section looks cramped on mobile — check it with design_lint and capture_vision on mobile, then propose fixes."
- "Rename every 'Learn more' button on this page to 'Read the case study'."
- "Create a draft page 'Pricing' via wp_rest and open it in the editor."

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `ELIVE_WP_URL` | – | Base URL of the WordPress site; needed for `open_editor({postId})` and `open` without arguments |
| `ELIVE_PROFILE_DIR` | `~/.elementor-live/profile` | Chrome profile directory (keeps the WordPress login) |
| `ELIVE_CDP_URL` | – | Attach to a running Chrome (e.g. `http://localhost:9222`) instead of launching one |
| `ELIVE_HEADLESS` | `false` | `1`/`true` runs Chrome headless (CI only; you will not see the editor) |
| `ELIVE_WP_USER` | – | WordPress user for `wp_rest` |
| `ELIVE_WP_APP_PASSWORD` | – | Application Password for `wp_rest` (Users → Profile → Application Passwords) |

`wp_rest` is registered only when `ELIVE_WP_URL`, `ELIVE_WP_USER` and `ELIVE_WP_APP_PASSWORD` are all set. It is meant for posts, media and options; it refuses writes containing `_elementor_data`, because the open document must only be changed through the editor.

## Development

```bash
bash dev/bootstrap.sh   # WSL/Linux with Docker: WordPress + MariaDB + wp-cli on http://localhost:8080, Elementor and a test page
npm test                # unit tests (vitest)
npm run typecheck
npm run e2e             # Playwright flows against the dev instance (real $e.run, undo, save, screenshot)
npm run dev             # run the CLI from source via tsx
```

The dev instance's admin login defaults to `admin` / `admin` (`ELIVE_DEV_USER`, `ELIVE_DEV_PASS`, `ELIVE_DEV_URL` override it).

## Limitations

- Elementor V4 atomic elements (`e-flexbox`, `e-heading`, …) are shown in the skeleton and can be created, but their style props cannot be edited via settings yet (`unsupported_atomic`). Prefer classic widgets inside `container` elements.
- `set_custom_css` writes `custom_css`, which needs Elementor Pro.
- One editor tab and one document at a time; theme-builder documents are not targeted.
- No voice input.
- Long `wait_for_user_prompt` calls depend on your client's request timeout; use a smaller `timeoutSec` if your client aborts early.

## Architecture

See the design spec: [docs/superpowers/specs/2026-10-26-elementor-live-design.md](docs/superpowers/specs/2026-10-26-elementor-live-design.md) (German). In short: `src/server.ts` and `src/tools/*` (MCP layer), `src/browser/*` (Playwright session, `$e.run` snippets, overlay), `src/core/*` (pure skeleton/ops/lint logic), `src/wp/rest.ts` (optional REST client).

## License

MIT — see [LICENSE](LICENSE).
