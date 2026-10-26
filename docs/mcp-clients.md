# MCP client configuration

elementor-live is a stdio MCP server started with `node /abs/path/elementor-live/dist/cli.js` (run `npm run build` first). Replace `/abs/path/elementor-live` with the absolute path of your checkout. On Windows use forward slashes (`C:/Users/me/elementor-live/dist/cli.js`) or escaped backslashes in JSON.

Only `ELIVE_WP_URL` is needed for a typical setup. Add `ELIVE_WP_USER` and `ELIVE_WP_APP_PASSWORD` to enable the `wp_rest` tool, and `ELIVE_CDP_URL` to attach to a Chrome you started with `--remote-debugging-port`.

Before the first session, run `ELIVE_WP_URL=… npx elementor-live open`, log in to WordPress in the Chrome window, then close it with Ctrl+C (one Chrome process per profile).

## Claude Code

```bash
claude mcp add elementor-live \
  -e ELIVE_WP_URL=https://your-site.example \
  -- node /abs/path/elementor-live/dist/cli.js
```

With REST access:

```bash
claude mcp add elementor-live \
  -e ELIVE_WP_URL=https://your-site.example \
  -e ELIVE_WP_USER=editor \
  -e "ELIVE_WP_APP_PASSWORD=abcd efgh ijkl mnop qrst uvwx" \
  -- node /abs/path/elementor-live/dist/cli.js
```

Check with `claude mcp list`.

## Kimi Code

`~/.kimi-code/mcp.json`:

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

## Cursor

`~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per project):

```json
{
  "mcpServers": {
    "elementor-live": {
      "command": "node",
      "args": ["/abs/path/elementor-live/dist/cli.js"],
      "env": {
        "ELIVE_WP_URL": "https://your-site.example",
        "ELIVE_WP_USER": "editor",
        "ELIVE_WP_APP_PASSWORD": "abcd efgh ijkl mnop qrst uvwx"
      }
    }
  }
}
```

## Claude Desktop

`claude_desktop_config.json` uses the same `mcpServers` shape as above. Use a full `https://` URL for `ELIVE_WP_URL`.

## OpenAI Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.elementor-live]
command = "node"
args = ["/abs/path/elementor-live/dist/cli.js"]
env = { ELIVE_WP_URL = "https://your-site.example" }
```

## Attaching to your own Chrome

```bash
chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.elementor-live/chrome-cdp"
```

Then add `"ELIVE_CDP_URL": "http://localhost:9222"` to `env`. The server uses the open tab whose URL contains `action=elementor`.

## Timeouts

`wait_for_user_prompt` blocks for up to `timeoutSec` (default 120 s). The server sends progress notifications every 15 s when the client supplies a progress token; if your client still aborts long tool calls, ask the agent to pass a smaller `timeoutSec` and call it in a loop.
