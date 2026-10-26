# Elementor Live — Agentic IDE für WordPress/Elementor

Stand: 2026-10-26 · Architekt/Ausführer: Horus (GLM, Kimi Code) · Auftraggeber: Lucas (ArchiDoxx)

## 0. Ziel in einem Satz

Mit einem Coding-Agenten (Claude Code, Kimi Code, Cursor — alles, was MCP spricht) an einer
offenen Elementor-Seite arbeiten wie in einer IDE: der Agent sieht, was ich markiere, baut live
im selben Editor-Tab, ich sehe seinen Cursor, Strg+Z funktioniert, nichts wird gegenseitig
überschrieben — und ich muss WordPress/Elementor nicht mehr anfassen, als ich will.

## 1. Was sich gegenüber dem Ursprungsplan ändert (Review 2026-10-26)

| Ursprungsplan | Entscheid | Grund (Beleg) |
|---|---|---|
| WP-Plugin injiziert Bridge-JS, spricht per WebSocket mit lokalem Daemon | **Kein WP-Plugin, kein WebSocket.** Der MCP-Server hängt per **CDP/Playwright** am Browser-Tab und führt `$e.run` via `page.evaluate` aus; Overlay wird per `addInitScript` injiziert | Playwright wird für pixelgenaue Screenshots ohnehin gebraucht; ein Transport statt zwei; keine Mixed-Content-Frage `https → ws://localhost`; Installation auf Nutzerseite = null |
| Zielt implizit auf Elementor V3 (Backbone) | **Primärziel: V3-Elemente (Container + klassische Widgets) auf Elementor 4.x.** V4-Atomic-Elemente werden erkannt und im Skelett gezeigt; Mutation auf Atomic nur, soweit `$e.run` sie über die Adapter trägt — wird im Spike gemessen und ehrlich dokumentiert | Seit 4.0 starten Neuinstallationen mit Atomic-Features; V3-Elemente bleiben parallel nutzbar ([Elementor Discussion #35165](https://github.com/orgs/elementor/discussions/35165)) |
| Backend-Hook schreibt per WP-CLI/REST auch an Elementor-Daten | **Backend nur für Nicht-Dokument-Operationen** (Posts anlegen, Optionen, Medien). Das offene Dokument wird ausschließlich über den Editor-Tab mutiert | Sonst entsteht genau der Doppel-Schreib-Konflikt, den der Plan verbietet |
| Design-Polizist korrigiert Nutzerwerte automatisch | **Vorschlag statt Auto-Fix.** `design_lint` liefert Befunde, `agent_say` zeigt sie am Element; der Agent ändert nur auf Zuruf | Auto-Fix kämpft mit der Undo-History des Nutzers |
| `modern-screenshot` im Iframe | **CDP-Screenshot mit Clip** auf die Bounding-Box | DOM-zu-Bild rät bei Fonts/Cross-Origin |
| Voice/Whisper-Hook | **Nicht in v1.** Alt+Space-Prompt-Overlay ja (Text) | YAGNI; Text-Kanal reicht für den IDE-Loop |
| „~150 Zeilen JS" | realistisch ~1–2k Zeilen TS gesamt | — |

## 2. Architektur

```
┌───────────────────────┐   MCP (stdio)   ┌──────────────────────────┐   CDP    ┌──────────────────────────────┐
│ Coding-Agent          │◄───────────────►│ elementor-live (Node/TS) │◄────────►│ Chrome (eigenes Profil)      │
│ Claude Code / Kimi /  │  tools+images   │  • BrowserSession        │          │  Tab: /wp-admin/post.php?    │
│ Cursor                │                 │  • Tools (unten)         │          │       action=elementor       │
└───────────────────────┘                 │  • Overlay-Injector      │          │  ├─ window.$e / elementor    │
                                          │  • optional: WP-REST     │          │  ├─ #elementor-preview-iframe│
                                          └──────────────────────────┘          │  └─ Overlay (Cursor, HUD,    │
                                                                                 │     Toasts, Alt+Space)       │
                                                                                 └──────────────────────────────┘
```

Komponenten (je eine Datei, je ein Zweck):

- `src/server.ts` — MCP-Server (stdio), registriert Tools, mappt Fehler in Tool-Antworten.
- `src/browser/session.ts` — startet Chrome mit persistentem Profil (`channel: 'chrome'`,
  `userDataDir` im Projekt-State) **oder** hängt sich an `--remote-debugging-port` an; findet
  den Editor-Tab (URL enthält `action=elementor`); re-injiziert Overlay nach Navigation.
- `src/browser/editor-api.ts` — alle `page.evaluate`-Snippets gegen `window.$e`/`elementor`:
  Skelett, Inspect, Create/Settings/Move/Delete/Duplicate, History-Gruppierung, Save, Widgets-
  Cache, Selection, Geometrie aus dem Preview-Iframe.
- `src/browser/overlay.ts` — Injektions-Skript (String): Ghost-Cursor (SVG), Sprechblase,
  HUD-Badge in der Topbar, Toasts, Alt+Space-Prompt, Event-Ringpuffer (`window.__elive`).
- `src/tools/*.ts` — ein Modul je Tool-Gruppe (status, read, mutate, vision, interact, wp).
- `src/core/skeleton.ts`, `src/core/lint.ts`, `src/core/ops.ts` — **reine Funktionen** ohne
  Browser (Skelett-Kompression, Lint-Mathematik, Operations-Validierung) → Unit-Tests.
- `src/wp/rest.ts` — optionaler WP-REST-Client (Application Password), nur Nicht-Dokument-Ops.
- `dev/` — Docker-Compose (WordPress + MariaDB + wp-cli), Bootstrap-Skript installiert
  Elementor, legt Testseite an, aktiviert Application Passwords.
- `e2e/` — Playwright-Skripte gegen die Dev-Instanz (echte `$e.run`-Flows).

## 3. Datenfluss im IDE-Loop

1. `open_editor({postId})` → Session öffnet Tab, wartet auf `window.elementor` + Preview-Iframe,
   injiziert Overlay.
2. Nutzer klickt Element → Overlay hört `elementor.channels.editor`/Selection-Änderungen und
   schreibt `{seq, type:'select', ids}` in den Ringpuffer. Nutzer-Edits ebenso
   (`{type:'change', id, keys}`).
3. Agent ruft `get_canvas_skeleton()` → Baum + `selection` + letzte Events seit `since`.
4. Agent ruft `inspect_element(id)` → Nicht-Default-Settings (Diff gegen Control-Defaults aus
   `elementor.widgetsCache`), Bounding-Box, Computed-Styles-Auszug, Textinhalt.
5. Agent ruft `mutate_canvas({ops, label})` → eine History-Gruppe („Agent: label"), je Op
   fährt der Ghost-Cursor zur Ziel-Box; Rückgabe: erzeugte IDs, Fehler je Op.
6. Agent ruft `capture_vision({id})` → PNG-Clip → prüft Ergebnis; optional `design_lint({id})`.
7. `save_document({mode})` → `document/save/draft|publish|update`.
8. Tag-Team: Agent ruft `wait_for_user_prompt({timeoutSec})`; Nutzer drückt Alt+Space im
   Editor, tippt; Tool kehrt mit Text + aktueller Selektion zurück.

## 4. MCP-Tools (v1, verbindlich)

| Tool | Eingabe | Ausgabe |
|---|---|---|
| `canvas_status` | – | connected, editorUrl, postId, title, elementorVersion, atomicEnabled, selection |
| `open_editor` | `postId` oder `url` | wie status |
| `get_canvas_skeleton` | `maxDepth?`, `since?` | Baum `{id, elType, widgetType, label, atomic?, children}`, selection, events |
| `inspect_element` | `id` | settings (non-default), controlsHint, box, computed, text, parentChain |
| `list_widgets` | `filter?` | `[{type, title, categories}]` |
| `get_widget_controls` | `widgetType` | Controls mit Typ, Default, Optionen (gekürzt) |
| `mutate_canvas` | `ops[]`, `label?` | `results[]` je Op `{ok, id?, error?}`, historyGrouped |
| `save_document` | `mode: draft\|publish\|update` | ok, status |
| `capture_vision` | `id?`, `device?` | MCP-Image (PNG) + box |
| `design_lint` | `id?`, `grid?=4` | findings `[{id, rule, severity, detail, suggestion}]` |
| `agent_say` | `id?`, `message`, `mood?` | ok |
| `set_hud` | `score?`, `delta?`, `note?` | ok |
| `get_user_activity` | `since?` | events seit seq |
| `wait_for_user_prompt` | `timeoutSec?` | `{text, selection}` oder timeout |
| `wp_rest` (optional, env-gated) | `method`, `path`, `body?` | JSON |

`mutate_canvas`-Operationen: `create {parentId?, at?, elType, widgetType?, settings?}`,
`update_settings {id, settings}`, `move {id, parentId, at?}`, `delete {id}`, `duplicate {id}`,
`set_custom_css {id, css}` (schreibt `custom_css`, Pro-Feature — Fallback-Hinweis wenn frei).
Kein Element-ID-Raten: IDs kommen immer aus Skelett/Create-Resultat.

## 5. Fehlerpfade

- Kein Chrome/Tab: Tools antworten mit klarem `not_connected` und dem Hinweis auf `open_editor`.
- Tab navigiert/Editor neu geladen: Session erkennt `elementor` fehlt → wartet bis 15 s, dann
  Fehler; Overlay wird automatisch neu injiziert.
- Unbekannte ID: Op-Fehler `element_not_found`, die übrigen Ops laufen weiter; History-Gruppe
  wird trotzdem sauber geschlossen.
- Atomic-Element bei Settings-Op: wenn `$e.run` ablehnt → `unsupported_atomic` mit Hinweis.
- Screenshot größer als Limit: automatisch auf max. 1600 px Breite skaliert.

## 6. Tests

- **Unit (vitest):** Skelett-Kompression (Defaults-Diff, Tiefe), Lint-Regeln (Off-Grid,
  Overflow, Overlap, Zeilenumbruch), Ops-Validierung (Schema, ID-Pflicht).
- **E2E (Playwright, gegen Dev-Docker):** Editor öffnen → Container + Heading + Button erzeugen
  → Settings ändern → Undo-Gruppe prüfen (eine History-Zeile) → Speichern → Reload → Elemente
  vorhanden. Screenshot-Clip liefert PNG > 0 Byte. Alt+Space-Prompt landet im Puffer.
- **Suite-Beweis vor Push** (AGENTS.md §2): `npm test` grün am Tag-Commit.

## 7. Entscheide (datiert, Lucas hat alle Entscheide an Horus delegiert, 2026-10-26)

1. Sprache: TypeScript auf Node 24, ESM. MCP: `@modelcontextprotocol/sdk`. Browser: `playwright-core`
   mit Systemchrome (kein Browser-Download).
2. Chrome-Modus: Standard **eigenes Profil** (`~/.elementor-live/profile`), damit das WP-Login
   persistiert; Alternative `ELIVE_CDP_URL` zum Anhängen an einen laufenden Chrome.
3. Keine Installation auf WordPress-Seite. Alles passiert im Browser des Nutzers.
4. Lizenz MIT. Repo `ArchiDoxx/elementor-live`.
5. Dev-Instanz: Docker in WSL (WordPress latest, MariaDB 11, wp-cli), Port 8080.

## 8. Nicht in v1

Voice-Eingabe, Multi-Tab/Multi-Dokument, Kollaboration mehrerer Agenten, Elementor-Pro-
spezifische Widgets jenseits `custom_css`, Theme-Builder-Dokumente, V4-Klassen/Variablen-Editing.
