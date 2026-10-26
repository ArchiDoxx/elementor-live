// Verbindliche Verträge zwischen den Modulen. Änderungen hier nur durch den Architekten.

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Rohes Element, 1:1 aus dem Editor gelesen (elementor.documents.getCurrent().container). */
export interface RawElement {
  id: string;
  elType: string;
  widgetType?: string;
  /** Alle gesetzten Settings (model.settings.toJSON()), inkl. Defaults, die Elementor materialisiert hat. */
  settings: Record<string, unknown>;
  /** true für Elementor-V4-Atomic-Elemente (e-flexbox, e-heading, …). */
  atomic: boolean;
  /** Anzeigename aus dem Editor (model.getTitle()), falls vorhanden. */
  title?: string;
  children: RawElement[];
}

/** Komprimierter Knoten für den Agenten. */
export interface SkeletonNode {
  id: string;
  elType: string;
  widgetType?: string;
  /** Kurzer Textauszug (Heading-Text, Button-Text, …), max. 60 Zeichen. */
  label?: string;
  atomic?: true;
  /** Nur Nicht-Default-Settings, nur wenn beim Aufruf angefordert. */
  settings?: Record<string, unknown>;
  children: SkeletonNode[];
}

export interface ControlDef {
  name: string;
  type: string;
  label?: string;
  default?: unknown;
  /** Für select/choose: Wert → Beschriftung. */
  options?: Record<string, string>;
  section?: string;
  tab?: string;
  responsive?: boolean;
}

export interface WidgetInfo {
  type: string;
  title: string;
  categories: string[];
  atomic: boolean;
}

export interface GeometryNode {
  id: string;
  /** Koordinaten relativ zum Preview-Iframe-Dokument (CSS-px, inkl. Scroll-Offset = Viewport-Koordinaten des Iframes). */
  box: Box;
  computed: {
    display: string;
    paddingTop: number;
    paddingRight: number;
    paddingBottom: number;
    paddingLeft: number;
    marginTop: number;
    marginBottom: number;
    gap: number;
    fontSize: number;
    lineHeight: number;
    overflowX: string;
    overflowY: string;
  };
  /** Sichtbarer Text, max. 200 Zeichen. */
  text: string;
  /** Scrollbreite > Clientbreite → horizontaler Overflow im Element selbst. */
  scrollOverflowX: boolean;
  parentId?: string;
  elType: string;
  widgetType?: string;
}

export type Op =
  | { op: 'create'; parentId?: string; at?: number; elType: string; widgetType?: string; settings?: Record<string, unknown> }
  | { op: 'update_settings'; id: string; settings: Record<string, unknown> }
  | { op: 'move'; id: string; parentId: string; at?: number }
  | { op: 'delete'; id: string }
  | { op: 'duplicate'; id: string }
  | { op: 'set_custom_css'; id: string; css: string };

export type OpErrorCode =
  | 'element_not_found'
  | 'parent_not_found'
  | 'invalid_op'
  | 'unsupported_atomic'
  | 'editor_error';

export interface OpResult {
  index: number;
  op: Op['op'];
  ok: boolean;
  /** Bei create/duplicate: ID des neuen Elements. */
  id?: string;
  error?: string;
  code?: OpErrorCode;
}

export interface MutateResult {
  results: OpResult[];
  historyGrouped: boolean;
  historyTitle: string;
}

export type LintSeverity = 'info' | 'warn' | 'error';

export interface LintFinding {
  id: string;
  rule:
    | 'off_grid_spacing'
    | 'child_overflow'
    | 'sibling_overlap'
    | 'heading_wraps'
    | 'horizontal_scroll'
    | 'tap_target_small'
    | 'empty_container';
  severity: LintSeverity;
  detail: string;
  suggestion?: string;
}

export type UserEventType = 'select' | 'change' | 'prompt' | 'save' | 'navigate' | 'agent';

export interface UserEvent {
  seq: number;
  ts: number;
  type: UserEventType;
  /** Betroffene Element-IDs (select: aktuelle Selektion; change: geänderte Elemente). */
  ids?: string[];
  /** change: History-Titel aus Elementor (z. B. "Heading Edited"). */
  title?: string;
  /** prompt: vom Nutzer im Alt+Space-Overlay eingegebener Text. */
  text?: string;
}

export interface EditorStatus {
  connected: boolean;
  editorUrl?: string;
  postId?: number;
  title?: string;
  documentType?: string;
  elementorVersion?: string;
  atomicEnabled?: boolean;
  selection: string[];
  /** Letzte Event-Sequenznummer im Overlay-Puffer. */
  lastSeq?: number;
}

export type SaveMode = 'draft' | 'publish' | 'update';

export type AgentMood = 'neutral' | 'happy' | 'thinking' | 'warning' | 'sassy';

export type DeviceMode = 'desktop' | 'tablet' | 'mobile';

export interface HudState {
  score?: number;
  delta?: number;
  note?: string;
}

export interface PromptResult {
  text: string;
  selection: string[];
  seq: number;
}

/**
 * Alles, was der MCP-Server vom Browser braucht. Implementiert in src/browser/editor-api.ts.
 * Jede Methode wirft `EditorError` (src/browser/errors.ts) mit `code`, wenn kein Editor verbunden ist.
 */
export interface EditorApi {
  status(): Promise<EditorStatus>;
  /** Navigiert den Tab zum Editor (postId → /wp-admin/post.php?post=…&action=elementor) und wartet, bis $e bereit ist. */
  openEditor(target: { postId?: number; url?: string }): Promise<EditorStatus>;
  getTree(): Promise<RawElement>;
  getControls(widgetTypeOrElType: string): Promise<ControlDef[]>;
  listWidgets(): Promise<WidgetInfo[]>;
  /** Geometrie für die angegebenen IDs; fehlende IDs fehlen im Ergebnis. Wartet vorher auf ein ruhiges Preview-Render (≤ 1500 ms). */
  getGeometry(ids: string[]): Promise<Record<string, GeometryNode>>;
  /** Alle Elemente des Dokuments mit Geometrie (für design_lint ohne id). */
  getAllGeometry(): Promise<GeometryNode[]>;
  runOps(ops: Op[], label: string): Promise<MutateResult>;
  save(mode: SaveMode): Promise<{ ok: boolean; status?: string; error?: string }>;
  getSelection(): Promise<string[]>;
  /** PNG-Clip des Elements (oder des ganzen Preview-Viewports ohne id). Bewegt vorher den Ghost-Cursor hin. */
  screenshot(id?: string, device?: DeviceMode): Promise<{ png: Buffer; box?: Box }>;
  setDevice(device: DeviceMode): Promise<void>;
  // Overlay
  say(message: string, id?: string, mood?: AgentMood): Promise<void>;
  moveCursor(id?: string): Promise<void>;
  setHud(state: HudState): Promise<void>;
  pullEvents(since: number): Promise<UserEvent[]>;
  /** Wartet bis der Nutzer im Alt+Space-Overlay absendet oder timeout (ms). null bei Timeout. */
  waitForPrompt(timeoutMs: number): Promise<PromptResult | null>;
}

export interface SessionConfig {
  /** Verzeichnis für das persistente Chrome-Profil. Default: ~/.elementor-live/profile */
  profileDir: string;
  /** Wenn gesetzt: an laufenden Chrome anhängen (z. B. http://localhost:9222) statt zu starten. */
  cdpUrl?: string;
  /** Basis-URL der WordPress-Site (z. B. http://localhost:8080); nötig für openEditor({postId}). */
  wpUrl?: string;
  headless: boolean;
}
