#!/usr/bin/env node
/*
 * Copyright (C) 2026 Misha Nasledov
 *
 * SPDX-License-Identifier: MIT
 */

/*
 * shot.mjs -- the pictures of the playground, made rather than taken.
 *
 *   npm install && npx playwright install chromium
 *   node tools/shot.mjs            # needs ffmpeg on the PATH for the gif
 *
 * The server, the page errors, the pointer and captions, the cut and the
 * gif are shotbox's: the pieces several projects had copied. The browser
 * runs in shotbox's seal, so a font or an alias in your home does not
 * make these pictures differ from anybody else's.
 *
 * A tiling layout is a thing somebody does, not a thing that looks a
 * certain way, so the README wants a recording of somebody doing it and
 * not a still of the result. This drives demo/index.html the way a
 * person would -- stack, split, close, zoom, switch -- and writes:
 *
 *   demo/mullion.gif   the loop the README shows
 *   demo/mullion.png   a still of the layout, for anywhere a gif is wrong
 *   demo/og.png        the picture a link to the demo is shown with
 *
 * The loop has one thing to show that a still cannot: a Preview stacked
 * behind another tab stops drawing, and the Activity chart beside it
 * says so.
 *
 * The pointer is drawn into the page and not by the browser: a recording
 * of a drag with no cursor in it is a layout rearranging itself for no
 * reason. So is a chord nobody can see pressed, so those are captioned.
 * Both are the only things here the page does not already do.
 */

import { rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { dress, film, gif, pageErrors, sealed, serve } from 'shotbox';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'demo');

const SIZE = { width: 1280, height: 720 };
const WIDE = 840;               /* what the gif is scaled to */
const FPS = 8;
const OG = { width: 1200, height: 630 };

const site = await serve(path.join(here, '..'));
const base = `http://127.0.0.1:${site.address().port}/demo/index.html`;
const films = await fs.mkdtemp(path.join(os.tmpdir(), 'mullion-'));
const seal = await sealed();

/* However this ends -- done, the page raising, or a step that throws --
   the recording and the seal's scratch home do not stay behind in /tmp.
   Synchronously, since that is all an exit handler gets to do. */
process.on('exit', () =>
{
    for (const dir of [films, seal.dir])
        rmSync(dir, { recursive: true, force: true });
});
const browser = await chromium.launch({ env: seal.env });

/* The page as a first visit finds it: no edits, no layouts, no mode. */
const fresh = async (page) =>
{
    await page.goto(base);
    await page.waitForFunction(() => window.playground !== undefined);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => window.playground?.tiled());
};

/* ---- the picture a link is shown with ---- */

{
    const context = await browser.newContext({ viewport: OG,
                                               deviceScaleFactor: 1 });
    const page = await context.newPage();

    await fresh(page);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(out, 'og.png') });
    await context.close();
}

/* ---- the loop ---- */

const context = await browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: 1,
    recordVideo: { dir: films, size: SIZE },
});

const page = await context.newPage();
const reel = film(page);
const errors = pageErrors(page);

await fresh(page);

const dressing = await dress(page);

/* The recording starts with the page, and the loop with the layout: what
   came before it -- a blank page, the plain one, a reload -- is cut. */
await page.waitForTimeout(600);

reel.start();

await page.waitForTimeout(600);

const wait = (ms) => page.waitForTimeout(ms);

const at = async (target, where = { x: 0.5, y: 0.5 }) =>
{
    const r = await page.locator(target).first().boundingBox();

    return { x: r.x + r.width * where.x, y: r.y + r.height * where.y };
};

const to = async (target, where) =>
{
    const p = await at(target, where);

    await page.mouse.move(p.x, p.y, { steps: 24 });
};

const click = async (target, where) =>
{
    await to(target, where);
    await wait(200);
    await page.mouse.down();
    await wait(80);
    await page.mouse.up();
};

const drag = async (from, target, where) =>
{
    await to(from);
    await wait(250);
    await page.mouse.down();
    await wait(200);
    await to(target, where);
    await wait(400);
    await page.mouse.up();
    await wait(600);
};

const press = async (chord, caption) =>
{
    await dressing.caption(caption);
    await wait(350);
    await page.keyboard.press(chord);
    await wait(900);
};

/* The Console stacked over the Preview. The Preview is behind a tab now,
   its program is held, and the Activity chart -- in front where the
   Console was -- drops to nothing. */
await drag('#panetab-console', '#pane-preview .panebody');
await wait(2800);

/* And raised again, and it draws again. */
await click('#panetab-preview');
await wait(1900);

/* The Files closed into the drawer, and the Keys out of it onto the
   bottom edge of the editor: a split. */
await drag('#panetab-files', '.panedrawer');
await wait(500);
await drag('#panereopen-keys', '#pane-ed-js .panebody', { x: 0.5, y: 0.92 });
await wait(900);

/* A divider, moved. */
await to('#root > .panebox > .panesplit');
await wait(300);
await page.mouse.down();
await page.mouse.move(SIZE.width * 0.62, SIZE.height / 2, { steps: 20 });
await wait(250);
await page.mouse.move(SIZE.width * 0.5, SIZE.height / 2, { steps: 20 });
await page.mouse.up();
await wait(700);

/* One pane filling the layout. */
await click('#panetab-preview');
await wait(300);
await press('Alt+Enter', 'Alt  Enter — zoom');
await wait(400);
await press('Alt+Enter', 'Alt  Enter');

/* Another mode's layout, and back. */
await click('[data-mode="debug"]');
await wait(1300);
await click('[data-mode="write"]');
await wait(900);

/* Back where it started, so the loop closes. */
await page.mouse.move(SIZE.width * 0.5, SIZE.height * 0.45, { steps: 20 });
await press('Alt+Digit0', 'Alt  0 — start over');
await wait(1400);

/* A recording of a page that threw is not one to put in the README, and
   nothing in the picture would say so. */
if (errors.length > 0)
{
    process.stderr.write(`the page raised: ${errors.join(' | ')}\n`);
    process.exit(1);
}

/* The still is of the layout and not of the recording, so what this file
   drew comes back out of it first. */
await dressing.remove();
await page.screenshot({ path: path.join(out, 'mullion.png') });

const video = await reel.end();

await browser.close();
site.close();

/* Sixty-four colors of its own are plenty for a page of flat grays, and
   undithered: the preview animates every frame, and a dither pattern
   over it is noise the gif pays for each time. */
await gif(video, path.join(out, 'mullion.gif'),
          { width: WIDE, fps: FPS, from: reel.from, colors: 64,
            dither: 'none' });

for (const name of ['mullion.gif', 'mullion.png', 'og.png'])
{
    const { size } = await fs.stat(path.join(out, name));

    process.stdout.write(
        `demo/${name}  ${(size / 1024 / 1024).toFixed(2)} MB\n`);
}
