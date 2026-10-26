# Changelog

## 0.1.0 — 2026-10-27

First release.

- MCP server (stdio) driving a live Elementor editor tab through Playwright/CDP and Elementor's
  command API (`$e.run`): `open_editor`, `canvas_status`, `get_canvas_skeleton`, `inspect_element`,
  `list_widgets`, `get_widget_controls`, `mutate_canvas` (history-grouped, Ctrl+Z friendly),
  `save_document`, `capture_vision`, `design_lint`, `agent_say`, `set_hud`, `get_user_activity`,
  `wait_for_user_prompt`, optional `wp_rest`.
- In-editor overlay: ghost cursor with speech bubble, HUD badge, Alt+Space prompt, user-activity
  buffer (selection and history changes).
- No WordPress plugin required; persistent Chrome profile keeps the login.
- Dev environment: Docker Compose (WordPress + MariaDB + wp-cli) with Elementor bootstrap; e2e
  and MCP smoke scripts against it. Verified on Elementor 4.3.5 with the Atomic editor enabled.
