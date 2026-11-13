// Photograph every state in states.mjs at both sizes, against the snapshot server.
//   NODE_PATH=<dir with playwright> node capture.mjs site http://127.0.0.1:8501 OUT_DIR [--data normal|empty|error|loading] [--only id-substring]
//   node capture.mjs references OUT_DIR
// One browser at a time. Every context sends DNT: 1 / Sec-GPC: 1 and blocks Google
// analytics before navigation. i.ytimg.com thumbnails are served from a frozen cache
// (YB_YTIMG_CACHE; filled once with YB_YTIMG_RECORD=1) so no capture reaches YouTube.
import { createRequire } from 'node:module';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { loadavg } from 'node:os';
import { SIZES, STATES, REFERENCES, NOW } from './states.mjs';

// ESM ignores NODE_PATH, so resolve Playwright from it explicitly.
const require = createRequire((process.env.NODE_PATH || process.cwd()).split(':')[0].replace(/\/?$/, '/'));
const { chromium } = require('playwright');
const [mode, ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
const YTIMG = process.env.YB_YTIMG_CACHE || '/tmp/yb-review/data/ytimg';
let browser = await chromium.launch();
const ANALYTICS = /(google-analytics\.com|googletagmanager\.com|analytics\.google\.com|doubleclick\.net)/;

async function guard(context, { frozenImages }) {
  await context.setExtraHTTPHeaders({ DNT: '1', 'Sec-GPC': '1' });
  await context.addInitScript(() => { Object.defineProperty(navigator, 'doNotTrack', { get: () => '1' }); Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true }); });
  await context.route(ANALYTICS, (route) => route.abort());
  if (!frozenImages) return;
  mkdirSync(YTIMG, { recursive: true });
  await context.route(/^https:\/\/(i\d?\.ytimg\.com|img\.youtube\.com)\//, async (route) => {
    const file = join(YTIMG, createHash('sha256').update(route.request().url()).digest('hex').slice(0, 32));
    if (existsSync(file)) return route.fulfill({ status: 200, contentType: 'image/jpeg', body: readFileSync(file) });
    if (process.env.YB_YTIMG_RECORD !== '1') return route.fulfill({ status: 404, body: '' });
    const response = await route.fetch().catch(() => null);
    if (!response || !response.ok()) return route.fulfill({ status: 404, body: '' });
    const body = await response.body();
    writeFileSync(file, body);
    return route.fulfill({ status: 200, contentType: 'image/jpeg', body });
  });
  // Anything else off-site (fonts, embeds) is refused rather than fetched live.
  await context.route((url) => !['127.0.0.1', 'localhost'].includes(url.hostname) && !/(^|\.)ytimg\.com$|^img\.youtube\.com$/.test(url.hostname), (route) => route.abort());
}

// The host is shared: before every state, wait while the 1-minute load average is above 10.
async function waitForLoad() {
  for (;;) {
    const load = loadavg()[0];
    if (!(load > 10)) return;
    console.warn(`load1 ${load.toFixed(2)} > 10, waiting`);
    await new Promise((done) => setTimeout(done, 30000));
  }
}

async function settle(page, maxHeight) {
  const height = Math.min(await page.evaluate(() => document.documentElement.scrollHeight), maxHeight * 2);
  for (let y = 0; y < height; y += 500) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(100);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => Promise.all([...document.images].filter((img) => !img.complete).map((img) => new Promise((done) => { img.onload = img.onerror = done; setTimeout(done, 4000); }))));
  await page.waitForTimeout(500);
}

async function shoot(page, file, size, { anchor, viewportOnly } = {}) {
  let top = 0;
  if (anchor) top = await page.evaluate((selector) => { const node = document.querySelector(selector); return node ? Math.max(0, Math.round(node.getBoundingClientRect().top + window.scrollY - 96)) : 0; }, anchor);
  if (viewportOnly) return page.screenshot({ path: file });
  const full = await page.evaluate(() => document.documentElement.scrollHeight);
  const height = Math.max(size.height, Math.min(full - top, size.maxHeight));
  await page.setViewportSize({ width: size.width, height: Math.round(Math.min(height, Math.max(full - top, size.height))) });
  await page.waitForTimeout(800);
  await page.evaluate((y) => window.scrollTo(0, y), top);
  await page.waitForTimeout(300);
  return page.screenshot({ path: file });
}

async function scenario(base, body) {
  await fetch(base + '/__review/scenario', { method: 'POST', body: JSON.stringify(body) });
}

if (mode === 'site') {
  const [base, out] = rest;
  const data = flag('data') || 'normal';
  const only = flag('only');
  mkdirSync(out, { recursive: true });
  const states = STATES.filter((s) => (s.loading ? data === 'loading' : (s.data || 'normal') === data) && (!only || s.id.includes(only)));
  for (const [sizeName, size] of Object.entries(SIZES).filter(([name]) => !process.env.ONLY_SIZE || name === process.env.ONLY_SIZE)) {
    for (const state of states) for (let attempt = 1; ; attempt++) try {
      // SKIP_EXISTING=1 resumes an interrupted set without re-shooting what is already there.
      if (process.env.SKIP_EXISTING === '1' && existsSync(`${out}/${state.id}_${sizeName}.png`)) break;
      await waitForLoad();
      // A shared host can kill the browser under memory pressure: start a new one and retry the state once.
      if (!browser.isConnected()) browser = await chromium.launch();
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.deviceScaleFactor,
        isMobile: !!size.isMobile, hasTouch: !!size.hasTouch, colorScheme: state.theme === 'dark' ? 'dark' : 'light',
        locale: 'zh-TW', timezoneId: 'Asia/Taipei', reducedMotion: 'reduce',
      });
      await guard(context, { frozenImages: true });
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date(NOW));
      const file = `${out}/${state.id}_${sizeName}.png`;
      if (state.loading) {
        // Hang the target's reads before the start page loads, so a link prefetch cannot
        // complete the target ahead of the click; the start page uses other reads.
        await scenario(base, { mode: 'hang', match: state.loading.match });
        await page.goto(base + state.loading.from, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(2500);
        // The header renders each nav link twice (desktop row, mobile menu): click the visible one,
        // opening the mobile menu first when none is visible.
        const link = page.locator(`${state.loading.click} >> visible=true`).first();
        if (!(await link.count())) {
          await page.locator('header button[aria-label="開啟導覽選單"] >> visible=true').first().click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(400);
        }
        await link.click({ timeout: 5000, noWaitAfter: true }).catch((error) => console.warn(state.id, 'click failed', error.message.split('\n')[0]));
        await page.waitForTimeout(1500);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(1000);
        await page.screenshot({ path: file });
        await scenario(base, { mode: 'normal' });
      } else {
        await page.goto(base + state.path, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(500);
        // Error pages auto re-read twice before they say the data cannot be read; shoot that final state.
        if (data === 'error') await page.getByText(/暫時無法讀取|Internal Server Error/).first().waitFor({ timeout: 40000 }).catch(() => console.warn(state.id, 'final error text not seen'));
        for (const selector of state.click || []) {
          await page.locator(selector).first().click({ timeout: 5000 }).catch((error) => console.warn(state.id, 'click failed', selector, error.message.split('\n')[0]));
          await page.waitForTimeout(600);
        }
        await settle(page, size.maxHeight);
        // A page with no text at all is a capture failure (a crashed or starved renderer), never a state.
        if (!(await page.evaluate(() => document.body?.innerText.trim().length ?? 0))) throw new Error('blank page');
        await shoot(page, file, size, state);
      }
      console.log(file);
      await context.close();
      break;
    } catch (error) {
      console.warn(state.id, sizeName, `attempt ${attempt} failed:`, String(error).split('\n')[0]);
      await browser.close().catch(() => {});
      if (attempt >= 2) throw error;
    }
  }
} else if (mode === 'references') {
  const [out] = rest;
  const only = flag('only');
  mkdirSync(out, { recursive: true });
  for (const [sizeName, size] of Object.entries(SIZES)) {
    for (const ref of REFERENCES.filter((r) => !only || r.id.includes(only))) {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.deviceScaleFactor,
        isMobile: !!size.isMobile, hasTouch: !!size.hasTouch, locale: ref.locale || 'en-US', timezoneId: 'Asia/Taipei',
        userAgent: size.isMobile
          ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
          : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      });
      await guard(context, { frozenImages: false });
      const page = await context.newPage();
      await page.goto(ref.url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(7000);
      for (const name of ['我知道了', 'Reject all', 'Reject All', '全部拒絕', 'Accept all', 'Accept All', 'Accept', 'Got it', 'I agree', 'AGREE']) {
        const button = page.getByRole('button', { name, exact: true });
        if (await button.count().catch(() => 0)) { await button.first().click({ timeout: 2000 }).catch(() => {}); break; }
      }
      await settle(page, size.maxHeight);
      const file = `${out}/${ref.id}_${sizeName}.png`;
      await shoot(page, file, size, {});
      console.log(file);
      await context.close();
    }
  }
}
await browser.close();
