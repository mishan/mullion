#!/usr/bin/env node
/*
 * Copyright (C) 2026 Misha Nasledov
 *
 * SPDX-License-Identifier: MIT
 */

/*
 * demo.mjs -- the playground in demo/, still working.
 *
 *   npm run test:demo              # Chromium
 *   npm run test:demo -- firefox   # or webkit
 *
 * check.mjs holds the module to its promises against test/fixture/. This
 * holds the page people are sent to against its own: that it tiles and
 * untiles with every id in place, that its program runs and logs, that
 * the program and the chart rest when nobody can see them, and that an
 * error is reported against the line of app.js it was on.
 *
 * Exit status is the number of failures.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, firefox, webkit } from 'playwright';

import { serve } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const name = process.argv[2] ?? process.env.BROWSER ?? 'chromium';
const engines = { chromium, firefox, webkit };

if (!(name in engines))
{
    process.stderr.write(`no such browser: ${name}\n`);
    process.exit(1);
}

let failures = 0;

function check (cond, what)
{
    if (cond)
        process.stdout.write(`ok    ${what}\n`);
    else
    {
        failures++;
        process.stdout.write(`FAIL  ${what}\n`);
    }
}

const site = await serve(path.join(here, '..'));
const base = `http://127.0.0.1:${site.address().port}/demo/index.html`;
const browser = await engines[name].launch();
const errors = [];

const open = async (viewport, query = '') =>
{
    const page = await browser.newPage({ viewport });

    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}${query}`);
    await page.waitForFunction(() => window.playground !== undefined);

    return page;
};

/* Until the page says so, or a few seconds: frames and samples arrive
   once a second. */
const until = (page, fn, arg) =>
    page.waitForFunction(fn, arg, { timeout: 8000 }).then(() => true,
                                                           () => false);

try
{
    /* ---- the plain page ---- */

    let page = await open({ width: 600, height: 900 });

    const plain = await page.evaluate(() =>
        window.playground.panes().map((id) =>
            [id, document.getElementById(id).parentElement.tagName]));

    check(!await page.evaluate(() => window.playground.tiled()) &&
          plain.every(([, parent]) => parent === 'BODY'),
          'a narrow window is the plain page, every section in the body');

    /* The preview is below the fold on a phone's page, and a pane nobody
       has scrolled to is a pane whose work can wait. */
    await page.waitForTimeout(1500);

    check(!await page.evaluate(() =>
              window.playground.pane('visible', 'preview') ||
              document.getElementById('log').textContent.includes('lit')),
          'and the program waits while the preview is scrolled out of sight');

    await page.evaluate(() =>
        document.getElementById('preview').scrollIntoView());

    check(await until(page, () =>
              document.getElementById('log').textContent.includes('lit')),
          'and runs once it is scrolled to, and logs');

    /* ---- tiled ---- */

    await page.setViewportSize({ width: 1400, height: 900 });
    await page.waitForFunction(() => window.playground.tiled());

    check(await page.evaluate(() =>
              window.playground.panes().every((id) =>
                  document.getElementById(id)
                          .closest(`#pane-${id}`) !== null)),
          'a wide one tiles it, every section in a pane of its own');

    await page.setViewportSize({ width: 600, height: 900 });
    await page.waitForFunction(() => !window.playground.tiled());

    const back = await page.evaluate(() =>
        window.playground.panes().map((id) =>
            [id, document.getElementById(id).parentElement.tagName]));

    check(JSON.stringify(back) === JSON.stringify(plain),
          'and a narrow one puts it back as it was');

    await page.close();

    /* ---- the program rests ---- */

    page = await open({ width: 1400, height: 900 });
    await page.evaluate(() => { localStorage.clear(); });
    await page.reload();
    await page.waitForFunction(() => window.playground?.tiled());

    check(await until(page, () =>
              window.playground.samples().some((s) => s.fps > 10)),
          'the preview draws while it is on the screen');

    /* Behind another tab: the program's frames held, not merely
       unseen. */
    await page.evaluate(() => window.playground.pane('close', 'preview'));

    check(await until(page, () =>
              window.playground.samples().slice(-2)
                  .every((s) => s.resting && s.fps === 0)),
          'and asks for no frames once it is closed');

    await page.evaluate(() =>
        window.playground.pane('present', 'preview', { focus: false }));

    check(await until(page, () =>
              window.playground.samples().at(-1).fps > 10),
          'and draws again when it comes back');

    /* Back from the drawer, it is a tab in the first leaf -- over the
       Files -- so the layout starts over for what follows. */
    await page.evaluate(() => window.playground.pane('reset'));

    /* The chart draws only while it is in front. */
    check(!await page.evaluate(() => window.playground.drawing()),
          'the Activity chart is behind the Console, and not drawing');

    await page.click('#panetab-activity');

    check(await page.evaluate(() => window.playground.drawing()),
          'and draws once it is raised');

    /* What the Console missed is counted on its tab. */
    await page.click('#run');

    check(await until(page, () =>
              /Console \(\d+\)/.test(
                  document.getElementById('panetab-console').textContent)),
          'the Console\'s tab counts what arrived while it was hidden');

    await page.click('#panetab-console');

    check(await page.evaluate(() =>
              document.getElementById('panetab-console').textContent ===
              'Console'),
          'and forgets the count when it is looked at');

    /* ---- an error, where it was ---- */

    await page.evaluate(() =>
    {
        const area = document.querySelector('#ed-js textarea');

        area.value = 'const a = 1;\n\nnope();\n';
        area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.click('#run');

    const where = await until(page, () =>
        [...document.querySelectorAll('#log .error .where')]
            .some((n) => n.textContent === 'app.js:3'));
    const said = await page.evaluate(() =>
        [...document.querySelectorAll('#log .error')]
            .map((n) => n.textContent).join(' | '));

    check(where,
          `an error in the program is reported at its line of app.js: ${said}`);

    check(await page.evaluate(() =>
              document.querySelector('[data-open="ed-js"]')
                      .classList.contains('edited')),
          'and the file is marked as edited');

    await page.click('#reset');

    check(await page.evaluate(() =>
          {
              const area = document.querySelector('#ed-js textarea');

              return area.value === area.defaultValue;
          }),
          'Reset examples puts the program back');

    /* ---- the files raise their editors ---- */

    await page.evaluate(() => window.playground.pane('close', 'ed-css'));
    await page.click('[data-open="ed-css"]');

    check(await page.evaluate(() =>
              window.playground.onScreen()['ed-css'] &&
              document.activeElement ===
              document.querySelector('#ed-css textarea')),
          'a file in the list raises its editor out of the drawer, focused');

    /* ---- the modes ---- */

    await page.click('[data-mode="debug"]');

    check(await page.evaluate(() =>
              window.playground.onScreen().activity &&
              !window.playground.onScreen().files),
          'Debug is a layout of its own');

    await page.close();
}
catch (e)
{
    check(false, `threw: ${e.message}`);
}
finally
{
    await browser.close();
    site.close();
}

/* The error the program was given on purpose is the frame's, and
   Playwright reports a frame's errors as the page's -- in each engine's
   own words, so it is matched by the name that was not defined. */
errors.splice(0, errors.length,
              ...errors.filter((e) => !/\bnope\b/.test(e)));

check(errors.length === 0,
      errors.length === 0 ? 'and the page raised nothing'
                          : `the page raised: ${errors.join(' | ')}`);

process.exitCode = failures;
