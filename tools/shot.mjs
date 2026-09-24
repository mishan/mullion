#!/usr/bin/env node
/*
 * Copyright (C) 2026 Misha Nasledov
 *
 * SPDX-License-Identifier: MIT
 */

/*
 * shot.mjs -- the picture in the README, made rather than taken.
 *
 *   npm install && npx playwright install chromium
 *   node tools/shot.mjs            # needs ffmpeg on the PATH for the gif
 *
 * A tiling layout is a thing somebody does, not a thing that looks a
 * certain way, so the README wants a recording of somebody doing it and
 * not a still of the result. This drives test/fixture/index.html the
 * way a person would -- split, stack, close, reopen, zoom -- and writes:
 *
 *   demo/mullion.gif   the loop the README shows
 *   demo/mullion.png   a still of the layout, for anywhere a gif is wrong
 *
 * The pointer is drawn by this file and not by the browser: a recording
 * of a drag with no cursor in it is a layout rearranging itself for no
 * reason. It is the only thing here the page does not already do.
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
const FPS = 10;

/* A pointer, since the browser does not record its own. */
const CURSOR = () =>
{
    const dot = document.createElement('div');

    dot.dataset.shotCursor = '';
    dot.style.cssText = [
        'position: fixed', 'z-index: 2147483647', 'pointer-events: none',
        'width: 14px', 'height: 14px', 'margin: -7px 0 0 -7px',
        'border-radius: 50%', 'background: rgba(32,32,32,0.75)',
        'border: 2px solid #ffffff',
        'box-shadow: 0 1px 4px rgba(0,0,0,0.4)',
        'transition: transform 80ms ease-out',
        'transform: scale(1)',
    ].join(';');

    document.body.append(dot);

    addEventListener('mousemove', (e) =>
    {
        dot.style.left = `${e.clientX}px`;
        dot.style.top = `${e.clientY}px`;
    }, true);

    addEventListener('mousedown',
                     () => { dot.style.transform = 'scale(0.6)'; }, true);
    addEventListener('mouseup',
                     () => { dot.style.transform = 'scale(1)'; }, true);
};

const site = await serve(path.join(here, '..'));
const base = `http://127.0.0.1:${site.address().port}/test/fixture/index.html`;
const films = await fs.mkdtemp(path.join(os.tmpdir(), 'mullion-'));
const browser = await chromium.launch();

const context = await browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: 1,
    recordVideo: { dir: films, size: SIZE },
});

const page = await context.newPage();

await page.goto(base);
await page.waitForFunction(() => window.tiler !== undefined);

/* The layout this opens on, whatever the last run left behind. */
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(
    () => window.tiler !== undefined && document.body.classList.contains('tiled'));

/* After the load and not before it: a node appended to <html> while the
   parser is still on its way to <body> does not survive the trip. */
await page.evaluate(CURSOR);
await page.waitForTimeout(500);

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

const drag = async (from, target, where) =>
{
    await to(from);
    await wait(250);
    await page.mouse.down();
    await wait(200);
    await to(target, where);
    await wait(350);
    await page.mouse.up();
    await wait(600);
};

const press = async (chord) =>
{
    await page.keyboard.press(chord);
    await wait(900);
};

/* A divider, moved. */
await to('#root > .panebox > .panesplit');
await wait(400);
await page.mouse.down();
await page.mouse.move(SIZE.width * 0.52, SIZE.height / 2, { steps: 20 });
await wait(250);
await page.mouse.move(SIZE.width * 0.44, SIZE.height / 2, { steps: 20 });
await page.mouse.up();
await wait(700);

/* A tab onto a pane: two canvases stacked, and one of them stops. */
await drag('#panetab-fx-plot', '#pane-fx-paint .panebody');
await wait(900);
await to('#panetab-fx-paint');
await page.mouse.click(...Object.values(await at('#panetab-fx-paint')));
await wait(900);

/* A tab onto an edge: a split. */
await drag('#panetab-fx-plot', '#pane-fx-doc', { x: 0.5, y: 0.9 });
await wait(700);

/* A tab onto the drawer: closed, and one click from coming back. */
await drag('#panetab-fx-list', '.panedrawer');
await wait(900);
await to('#panereopen-fx-list');
await page.mouse.click(...Object.values(await at('#panereopen-fx-list')));
await wait(900);

/* And one pane filling the layout -- the one with something moving in
   it, since a still of an empty box says nothing about zoom. */
await page.mouse.click(...Object.values(await at('#panetab-fx-paint')));
await wait(400);
await press('Alt+Enter');
await wait(600);
await press('Alt+Enter');

/* Back where it started, so the loop closes. */
await press('Alt+Digit0');
await wait(900);

/* The still is of the layout and not of the recording, so the pointer
   this file drew comes back out of it first. */
await page.evaluate(
    () => document.querySelector('[data-shot-cursor]')?.remove());
await page.screenshot({ path: path.join(out, 'mullion.png') });

const film = await page.video().path();

await context.close();
await browser.close();
site.close();

/* webm to gif, through a palette of its own: the default 216 colors turn
   a page of flat grays into bands. */
const palette = path.join(films, 'palette.png');
const filters = `fps=${FPS},scale=${WIDE}:-1:flags=lanczos`;

await run('ffmpeg', ['-y', '-i', film, '-vf', `${filters},palettegen=stats_mode=diff`,
                     palette]);
await run('ffmpeg', ['-y', '-i', film, '-i', palette, '-lavfi',
                     `${filters} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`,
                     path.join(out, 'mullion.gif')]);

await fs.rm(films, { recursive: true, force: true });

for (const name of ['mullion.gif', 'mullion.png'])
{
    const { size } = await fs.stat(path.join(out, name));

    process.stdout.write(
        `demo/${name}  ${(size / 1024 / 1024).toFixed(2)} MB\n`);
}
