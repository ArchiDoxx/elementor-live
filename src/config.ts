import os from 'node:os';
import path from 'node:path';
import type { SessionConfig } from './types.js';

export interface WpCredentials {
  baseUrl: string;
  user: string;
  appPassword: string;
}

export interface AppConfig {
  session: SessionConfig;
  wp?: WpCredentials;
}

export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function nonEmpty(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

function isTruthy(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const wpUrl = nonEmpty(env.ELIVE_WP_URL)?.replace(/\/+$/, '');
  const session: SessionConfig = {
    profileDir: path.resolve(expandHome(nonEmpty(env.ELIVE_PROFILE_DIR) ?? '~/.elementor-live/profile')),
    cdpUrl: nonEmpty(env.ELIVE_CDP_URL),
    wpUrl,
    headless: isTruthy(env.ELIVE_HEADLESS),
  };
  const user = nonEmpty(env.ELIVE_WP_USER);
  const appPassword = nonEmpty(env.ELIVE_WP_APP_PASSWORD);
  const wp = wpUrl && user && appPassword ? { baseUrl: wpUrl, user, appPassword } : undefined;
  return { session, wp };
}
