#!/usr/bin/env node
/**
 * Render the application icon from the mark redbot already has.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS.
 *
 * `electron-builder` logged one line on every build — "default Electron icon is used  reason=
 * application icon is not set" — and shipped an installer, a Start-menu entry, a desktop shortcut
 * and a taskbar button all wearing Electron's atom. A person looking for redbot on their own
 * machine had nothing of redbot's to look for.
 *
 * THE MARK IS NOT INVENTED HERE. It is the one already in the product: the favicon data URI in
 * tools/product/index.html — boxed head, red eyes, fingers on a keyboard. This script READS that
 * URI and decodes it rather than carrying a second copy, because two copies of a logo drift and
 * the day they disagree neither is authoritative. The header's inline <svg> is deliberately NOT
 * the source: it paints with `var(--ember)` and `currentColor`, which resolve to nothing outside
 * the console's stylesheet and would render a black square.
 *
 * Chromium does the rasterising, through the Playwright that is already a runtime dependency
 * (src/browser.ts). No image library is added for one build asset.
 *
 *   node electron/make-icon.mjs
 *
 * Writes electron/build/icon.png at 1024×1024. `buildResources: electron/build` in
 * electron-builder.yml is what makes that the app icon; electron-builder derives the .ico itself,
 * and requires the source to be at least 256×256.
 *
 * COMMITTED, not generated at build time. A packaging step that needs a browser to produce an
 * icon is a packaging step that fails on a machine without one.
 * ---------------------------------------------------------------------------
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = join(HERE, 'build');
const OUT = join(OUT_DIR, 'icon.png');
const SIZE = 1024;

/** The favicon href, decoded. Throws rather than guessing — a wrong icon is worse than no icon. */
function markFromConsole() {
  const html = readFileSync(join(ROOT, 'tools', 'product', 'index.html'), 'utf8');
  const m = html.match(/href="data:image\/svg\+xml,([^"]+)"/);
  if (!m) {
    throw new Error(
      'no data:image/svg+xml favicon found in tools/product/index.html — the mark moved, and this ' +
      'script must be pointed at wherever it went rather than given a copy of its own.'
    );
  }
  const svg = decodeURIComponent(m[1]);
  if (!svg.startsWith('<svg')) throw new Error('the favicon decoded to something that is not an <svg>');
  return svg;
}

const svg = markFromConsole();
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: SIZE, height: SIZE },
    /* 1 rather than the display's scale: the viewport IS the output size, and a 2x factor would
       silently produce a 2048 png that only looks correct. */
    deviceScaleFactor: 1
  });

  /* The mark is a rounded black tile that already fills its own 32×32 box, so it is scaled to the
     full canvas with no padding — Windows applies its own margins around a taskbar icon, and
     padding baked into the image makes it read smaller than everything beside it. */
  await page.setContent(
    `<!doctype html><meta charset="utf-8">` +
    `<style>html,body{margin:0;padding:0;background:transparent}` +
    `svg{display:block;width:${SIZE}px;height:${SIZE}px}</style>` +
    svg,
    { waitUntil: 'load' }
  );

  await page.screenshot({ path: OUT, omitBackground: true });
} finally {
  await browser.close();
}

process.stdout.write(`  icon  ${OUT}  ${SIZE}x${SIZE}\n`);
