export type EditorErrorCode =
  | 'not_connected'
  | 'no_editor_tab'
  | 'editor_not_ready'
  | 'element_not_found'
  | 'evaluate_failed'
  | 'timeout';

export class EditorError extends Error {
  constructor(
    public readonly code: EditorErrorCode,
    message: string,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = 'EditorError';
  }
}
