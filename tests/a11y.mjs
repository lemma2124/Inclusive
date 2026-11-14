import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.env.BASE || 'http://localhost:8787';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const PAGES = ['/demo', '/agent', '/sms-demo'];

const VIEWS = [
  { name: 'desktop-light', viewport: { width: 1280, height: 800 }, scheme: 'light' },
  { name: 'desktop-dark', viewport: { width: 1280, height: 800 }, scheme: 'dark' },
  { name: 'reflow-320px', viewport: { width: 320, height: 256 }, scheme: 'light' }
];

let failures = 0;

async function scan(page, label) {
  const res = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  if (!res.violations.length) {
    console.log(`PASS  ${label}`);
    return;
  }
  failures += res.violations.length;
  console.log(`FAIL  ${label}`);
  for (const v of res.violations) {
    console.log(`  - [${v.impact}] ${v.id}: ${v.help}`);
    for (const n of v.nodes.slice(0, 3)) console.log(`      ${n.target.join(' ')}`);
  }
}

async function horizontalScroll(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  if (overflow) { failures++; console.log(`FAIL  ${label}: page scrolls sideways (1.4.10 Reflow)`); }
}

const browser = await chromium.launch({ channel: 'msedge' });
for (const view of VIEWS) {
  const ctx = await browser.newContext({ viewport: view.viewport, colorScheme: view.scheme });
  const page = await ctx.newPage();
  for (const p of PAGES) {
    await page.goto(BASE + p, { waitUntil: 'networkidle' });
    await scan(page, `${view.name} ${p}`);
    if (view.name === 'reflow-320px') await horizontalScroll(page, `${view.name} ${p}`);
  }

  // Widget states on /demo
  await page.goto(BASE + '/demo', { waitUntil: 'networkidle' });
  const acc = page.locator('#accBtn');
  if (await acc.count()) {
    await acc.click();
    await scan(page, `${view.name} /demo after accommodation prompt`);
  }
  const am = page.locator('[data-l="am"]');
  if (await am.count()) {
    await am.click();
    await scan(page, `${view.name} /demo Amharic`);
  }
  await ctx.close();
}
await browser.close();

console.log(failures ? `\n${failures} violation(s) found.` : '\nNo automated violations.');
process.exit(failures ? 1 : 0);