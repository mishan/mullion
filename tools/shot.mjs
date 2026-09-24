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
 * A tiling layout is a thing somebody does, not a thing that looks a
 * certain way, so the README wants a recording of somebody doing it and
 * not a still of the result. This drives demo/index.html the way a
 * person would -- edit, stack, split, close, zoom, switch -- and writes:
 *
 *   demo/mullion.gif   the loop the README shows
 *   demo/mullion.png   a still of the layout, for anywhere a gif is wrong
 *   demo/og.png        the picture a link to the demo is shown with
 *
 * The loop has one thing to show that a still cannot: a Preview stacked
 * behind another tab stops drawing, and the Activity chart beside it
 * says so.
 *
 * The pointer is drawn by this file and not by the browser: a recording
 * of a drag with no cursor in it is a layout rearranging itself for no
 * reason. So is a chord nobody can see pressed, so those are captioned.
 * Both are the only things here the page does not already do.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { chromium } from 'playwright';

import { serve } from '../test/serve.mjs';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'demo');

const SIZE = { width: 1280, height: 720 };
const WIDE = 840;               /* what the gif is scaled to */
const FPS = 8;
const OG = { width: 1200, height: 630 };

/* A pointer, since the browser does not record its own, and a caption
   for a key pressed. */
const DRESS = () =>
{
    const dot = document.createElement('div');
    const cap = document.createElement('div');

    dot.dataset.shot = '';
    dot.style.cssText = [
        'position: fixed', 'z-index: 2147483647', 'pointer-events: none',
        'width: 14px', 'height: 14px', 'margin: -7px 0 0 -7px',
        'border-radius: 50%', 'background: rgba(32,32,32,0.75)',
        'border: 2px solid #ffffff',
        'box-shadow: 0 1px 4px rgba(0,0,0,0.4)',
        'transition: transform 80ms ease-out',
        'transform: scale(1)', 'left: -20px', 'top: -20px',
    ].join(';');

    cap.dataset.shot = '';
    cap.style.cssText = [
        'position: fixed', 'z-index: 2147483647', 'pointer-events: none',
        'left: 50%', 'bottom: 48px', 'transform: translateX(-50%)',
        'padding: 8px 16px', 'border-radius: 10px',
        'font: 600 18px/1.2 system-ui, sans-serif', 'color: #ffffff',
        'background: rgba(24,24,32,0.85)',
        'box-shadow: 0 4px 16px rgba(0,0,0,0.3)',
        'opacity: 0', 'transition: opacity 200ms',
    ].join(';');

    document.body.append(dot, cap);

    addEventListener('mousemove', (e) =>
    {
        dot.style.left = `${e.clientX}px`;
        dot.style.top = `${e.clientY}px`;
    }, true);

    addEventListener('mousedown',
                     () => { dot.style.transform = 'scale(0.6)'; }, true);
    addEventListener('mouseup',
                     () => { dot.style.transform = 'scale(1)'; }, true);

    let fading = 0;

    window.shotCaption = (text) =>
    {
        cap.textContent = text;
        cap.style.opacity = '1';
        clearTimeout(fading);
        fading = setTimeout(() => { cap.style.opacity = '0'; }, 1300);
    };
};

const site = await serve(path.join(here, '..'));
const base = `http://127.0.0.1:${site.address().port}/demo/index.html`;
const films = await fs.mkdtemp(path.join(os.tmpdir(), 'mullion-'));
const browser = await chromium.launch();

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
const began = Date.now();

await fresh(page);

/* After the load and not before it: a node appended to <html> while the
   parser is still on its way to <body> does not survive the trip. */
await page.evaluate(DRESS);

/* The recording starts with the page, and the loop with the layout: what
   came before it -- a blank page, the plain one, a reload -- is cut. */
await page.waitForTimeout(600);

const cut = (Date.now() - began) / 1000;

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
    await page.evaluate((c) => window.shotCaption(c), caption);
    await wait(350);
    await page.keyboard.press(chord);
    await wait(900);
};

/* An edit, typed: the lights another color, and the preview runs it.
   A color and not more of them, since every lit window is redrawn every
   frame and the gif pays for each one. */
await click('#ed-js textarea', { x: 0.3, y: 0.3 });
await page.evaluate(() =>
{
    const area = document.querySelector('#ed-js textarea');
    const was = '255, 196, 92';
    const at = area.value.indexOf(was);

    area.setSelectionRange(at, at + was.length);
});
await wait(400);
await page.keyboard.type('120, 210, 255', { delay: 110 });
await wait(500);
await page.keyboard.press('Home');
await wait(1100);

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

/* The still is of the layout and not of the recording, so what this file
   drew comes back out of it first. */
await page.evaluate(() =>
    document.querySelectorAll('[data-shot]').forEach((n) => n.remove()));
await page.screenshot({ path: path.join(out, 'mullion.png') });

const film = await page.video().path();

await context.close();

await browser.close();
site.close();

/* webm to gif, through a palette of its own: the default 216 colors turn
   a page of flat grays into bands. Sixty-four of its own are plenty for
   a page of flat grays, and undithered: the preview animates every
   frame, and a dither pattern over it is noise the gif pays for each
   time. */
const palette = path.join(films, 'palette.png');
const filters = `fps=${FPS},scale=${WIDE}:-1:flags=lanczos`;
const from = ['-ss', String(cut), '-i', film];

await run('ffmpeg', ['-y', ...from, '-vf',
                     `${filters},palettegen=stats_mode=diff:max_colors=64`,
                     palette]);
await run('ffmpeg', ['-y', ...from, '-i', palette, '-lavfi',
                     `${filters} [x]; [x][1:v] paletteuse=dither=none:diff_mode=rectangle`,
                     path.join(out, 'mullion.gif')]);

await fs.rm(films, { recursive: true, force: true });

for (const name of ['mullion.gif', 'mullion.png', 'og.png'])
{
    const { size } = await fs.stat(path.join(out, name));

    process.stdout.write(
        `demo/${name}  ${(size / 1024 / 1024).toFixed(2)} MB\n`);
}
