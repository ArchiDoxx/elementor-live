export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export class WpRestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly bodyExcerpt: string,
  ) {
    super(message);
    this.name = 'WpRestError';
  }
}

export interface WpRestOptions {
  baseUrl: string;
  user: string;
  appPassword: string;
  fetch?: typeof fetch;
}

export class WpRestClient {
  readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: WpRestOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    const token = Buffer.from(`${options.user}:${options.appPassword.replace(/\s+/g, '')}`).toString('base64');
    this.authHeader = `Basic ${token}`;
    this.fetchImpl = options.fetch ?? fetch;
  }

  url(path: string): string {
    let p = path.trim();
    if (!p.startsWith('/')) p = `/${p}`;
    if (p.startsWith('/wp-json/')) p = p.slice('/wp-json'.length);
    return `${this.baseUrl}/wp-json${p}`;
  }

  async request(method: HttpMethod, path: string, body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = { Authorization: this.authHeader, Accept: 'application/json' };
    const init: RequestInit = { method, headers };
    if (body !== undefined && method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await this.fetchImpl(this.url(path), init);
    const text = await res.text();
    if (!res.ok) {
      const excerpt = text.slice(0, 500);
      throw new WpRestError(res.status, `WordPress REST ${method} ${path} failed with HTTP ${res.status}: ${excerpt}`, excerpt);
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}
