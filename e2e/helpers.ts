import path from 'node:path';
import type { Page } from 'playwright-core';
import type { BrowserEditorApi } from '../src/browser/editor-api.js';
import { EditorError } from '../src/browser/errors.js';

export const DEV = {
  url: (process.env.ELIVE_DEV_URL ?? 'http://localhost:8080').replace(/\/+$/, ''),
  user: process.env.ELIVE_DEV_USER ?? 'admin',
  pass: process.env.ELIVE_DEV_PASS ?? 'admin',
  postId: Number(process.env.ELIVE_DEV_POST ?? '5'),
  profileDir: path.resolve(process.env.ELIVE_PROFILE_DIR ?? '.elementor-live/profile'),
  headless: process.env.ELIVE_HEADLESS === '1',
};

export async function loginOnPage(page: Page): Promise<void> {
  if (!page.url().includes('wp-login.php')) await page.goto(`${DEV.url}/wp-login.php`, { waitUntil: 'domcontentloaded' });
  if (!(await page.locator('#user_login').count())) return;
  await page.fill('#user_login', DEV.user);
  await page.fill('#user_pass', DEV.pass);
  if (await page.locator('#rememberme').count()) await page.check('#rememberme');
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('#wp-submit')]);
}

export async function openEditorWithLogin(api: BrowserEditorApi, postId: number) {
  try {
    return await api.openEditor({ postId });
  } catch (err) {
    if (!(err instanceof EditorError) || err.message !== 'WordPress login required') throw err;
    const page = api.session.livePages().find((p) => p.url().includes('wp-login.php'));
    if (!page) throw err;
    await loginOnPage(page);
    return api.openEditor({ postId });
  }
}

export async function editorPage(api: BrowserEditorApi): Promise<Page> {
  const page = await api.session.findEditorPage();
  if (!page) throw new Error('no editor page');
  return page;
}
