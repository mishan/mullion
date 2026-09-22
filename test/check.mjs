#!/usr/bin/env node
/*
 * Copyright (C) 2026 Misha Nasledov
 *
 * SPDX-License-Identifier: MIT
 */

/*
 * check.mjs -- mullion, in a browser.
 *
 *   npm install && npx playwright install chromium
 *   npm test
 *
 * Everything here runs against demo/index.html, which is the demo page
 * and nothing more: no build step, no bundler, no framework. What it
 * proves about a document it proves about any document.
 *
 * The claims, in the order they are made: that the tiler adopts a
 * document and puts it back with every id intact, that a divider moves
 * what the pointer moved and stops where the markup said to, that a
 * split fills the box it is in, that tabs and the drawer and the chords
 * do what they say -- and, the one worth the most, that a canvas behind
 * a tab asks for no frames at all.
 *
 * Exit status is the number of failures.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { serve } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/* Wide enough for the tiler's own threshold, and narrow enough to be
   under it: mullion asks for 60em and a pointer that is not a finger. */
const WIDE = { width: 1400, height: 900 };
const NARROW = { width: 560, height: 900 };

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
const errors = [];

const browser = await chromium.launch();

/* What the document is, pane by pane: where each one sits among its
   siblings, what is in it, and how it is folded. Taken with the tiler off
   and again after it has been on, because "it puts the document back" is
   a claim about exactly this. */
const photograph = () => page.evaluate(() =>
    window.tiler.panes().map((id) =>
    {
        const el = document.getElementById(id);
        const kids = [...el.parentElement.children];

        return [id, kids.indexOf(el), el.parentElement.tagName,
                [...el.querySelectorAll('[id]')].map((n) => n.id).join(' '),
                el.tagName === 'DETAILS' ? el.open : null];
    }));

let page = null;

/* A press, a move and a release over a target: the layout's own gesture,
   which is pointer events and not the browser's drag -- what is being
   moved is a box in a layout, and where it would land is drawn by the
   page rather than by a drag image. */
const drag = async (from, to, at = { x: 0.5, y: 0.5 }) =>
{
    const a = await page.locator(from).boundingBox();
    const b = await page.locator(to).boundingBox();

    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * at.x, b.y + b.height * at.y,
                          { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(100);
};

const leafCount = () => page.evaluate(
    () => [...document.querySelectorAll('#root .paneleaf')]
        .filter((n) => n.checkVisibility()).length);

try
{
    page = await browser.newPage({ viewport: NARROW });

    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) =>
    {
        if (m.type() === 'error')
            errors.push(m.text());
    });

    /* ---- the threshold ---- */

    await page.setViewportSize(WIDE);
    await page.goto(`${base}?panes=0`);
    await page.waitForFunction(() => window.tiler !== undefined);

    check(await page.evaluate(
              () => !document.body.classList.contains('tiled') &&
                    document.getElementById('root').children.length === 0),
          'a wide window with ?panes=0 is the document');

    await page.setViewportSize(NARROW);
    await page.goto(`${base}?panes=1`);
    await page.waitForFunction(() => window.tiler !== undefined);

    check(await page.evaluate(
              () => !document.body.classList.contains('tiled')),
          'and a narrow one is the document whatever the query string says');

    /* The verbs, asked of a page that has never tiled: quiet rather than
       an error, since whatever calls them does not know which side of the
       threshold it is on. */
    check(await page.evaluate(() =>
          {
              try
              {
                  window.tiler.pane('present', 'fx-list');
                  window.tiler.pane('close', 'fx-list');

                  return window.tiler.layout() === null &&
                         document.getElementById('fx-list').isConnected;
              }
              catch
              {
                  return false;
              }
          }),
          'and raising or closing a pane there is quiet, not an error');

    const before = await photograph();

    check(before.length === 8, `${before.length} panes in the catalog`);

    /* ---- and across it ---- */

    await page.setViewportSize(WIDE);
    await page.waitForFunction(
        () => document.body.classList.contains('tiled'));

    const adopted = await page.evaluate(() =>
        window.tiler.panes().map((id) =>
        {
            const el = document.getElementById(id);

            return [id, el.closest('#root .pane')?.id ?? null,
                    [...el.querySelectorAll('[id]')].map((n) => n.id)
                        .join(' '),
                    el.tagName === 'DETAILS'
                        ? [el.open,
                           el.querySelector(':scope > summary').hidden]
                        : null];
        }));

    check(adopted.every(([id, host]) => host === `pane-${id}`),
          'every pane is in the layout, in a pane of its own');
    check(adopted.every(([, , ids], i) => ids === before[i][3]),
          'and every id inside them is where it was');

    const folds = adopted.filter(([, , , d]) => d !== null);

    check(folds.length === 2 && folds.every(([, , , d]) => d[0] && d[1]),
          'the boxes that fold are open with their summary hidden -- the ' +
          'pane\'s header is the disclosure now');

    /* ---- and back ---- */

    await page.setViewportSize(NARROW);
    await page.waitForFunction(
        () => !document.body.classList.contains('tiled'));

    const after = await photograph();

    check(JSON.stringify(after) === JSON.stringify(before),
          'a narrow window is the document again, in the same order, ' +
          'folded the way it was');

    check(await page.evaluate(
              () => document.getElementById('root').children.length === 0),
          'and the tiler has nothing left in it');

    /* ---- a pane nobody is looking at ---- */

    await page.setViewportSize(WIDE);
    await page.waitForFunction(
        () => document.body.classList.contains('tiled'));
    await page.waitForTimeout(200);

    check(await page.evaluate(() => window.tiler.drawing().paint) &&
          await page.evaluate(() => window.tiler.drawing().plot),
          'two canvases in two panes both draw');

    /* Stacked, and one of them stops. This is the whole performance
       argument for tabs and the only claim `onShow' exists to make. */
    await drag('#panetab-fx-plot', '#pane-fx-paint .panebody');
    await page.waitForTimeout(250);

    const stacked = await page.evaluate(() => window.tiler.drawing());

    check(!stacked.paint && stacked.plot,
          'one raised over the other leaves one of them drawing, not two');

    check(await page.evaluate(() =>
              document.getElementById('pane-fx-paint').closest('.paneleaf') ===
              document.getElementById('pane-fx-plot').closest('.paneleaf')),
          'and they are two tabs of one leaf');

    /* Shown, and not merely told. A pane behind a tab is hidden with the
       attribute, and `hidden' is a user agent's rule -- which every rule
       in panes.css outranks by being an author's. A `.pane { display:
       flex }' with nothing said about `hidden' leaves the pane behind the
       tab on the screen, drawing nothing, under the one in front. */
    check(await page.evaluate(() =>
              !document.getElementById('pane-fx-paint').checkVisibility() &&
              document.getElementById('pane-fx-plot').checkVisibility()),
          'and the one behind is not on the screen, not merely not drawing');

    /* And the one behind really stops: a loop that was told and carried
       on looks identical to one that was told and stopped, from the
       outside, unless somebody counts. */
    const was = await page.evaluate(() => window.tiler.frames().paint);

    await page.waitForTimeout(400);

    const now = await page.evaluate(() => window.tiler.frames().paint);

    check(now === was,
          `the one behind asks for no frames at all: ${was} then ${now}`);

    await page.click('#panetab-fx-paint');
    await page.waitForTimeout(250);

    const swapped = await page.evaluate(() => window.tiler.drawing());

    check(swapped.paint && !swapped.plot,
          'and raising the other one turns the first one off');

    /* ---- and what a render costs the document ----
     *
     * The tiler adopts elements the page already had, so a render that
     * rebuilt the layout out of new boxes would take every one of them
     * out of the document and put it back -- and the document does not
     * treat that as a move. A box scrolled half way down is at the top
     * again and an <iframe> loads a second time, neither of which anybody
     * asked for. So: a pane that did not move is not moved.
     */
    const untouched = await page.evaluate(async () =>
    {
        const scroller = document.getElementById('fx-scroll');
        const frame = document.createElement('iframe');
        let loads = 0;

        frame.src = 'about:blank';
        frame.addEventListener('load', () => { loads++; });
        document.getElementById('fx-list').append(frame);

        await new Promise((go) => setTimeout(go, 200));

        scroller.scrollLeft = 200;

        const was = { scroll: scroller.scrollLeft, loads };

        /* Three renders over three different reasons, none of which is
           "this pane moved". */
        window.tiler.pane('setTitle', 'fx-doc', 'Doc');
        document.getElementById('panetab-fx-paint').click();
        document.getElementById('panetab-fx-plot').click();

        await new Promise((go) => setTimeout(go, 300));

        frame.remove();

        return { was, now: { scroll: scroller.scrollLeft, loads } };
    });

    check(untouched.now.scroll === untouched.was.scroll,
          'a render leaves a pane nobody moved where it was scrolled to: ' +
          `${untouched.was.scroll} then ${untouched.now.scroll}`);

    check(untouched.now.loads === untouched.was.loads,
          `and does not load its <iframe> again: ${untouched.was.loads} ` +
          `then ${untouched.now.loads}`);

    /* ---- the dividers ---- */

    await page.keyboard.press('Alt+Digit0');
    await page.waitForTimeout(200);

    const bar = page.locator('#root > .panebox > .panesplit').first();
    const widths = () => page.evaluate(() =>
        [...document.querySelectorAll('#root > .panebox > :not(.panesplit)')]
            .map((k) => Math.round(k.getBoundingClientRect().width)));

    const had = await widths();
    const grip = await bar.boundingBox();

    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2 - 120,
                          grip.y + grip.height / 2, { steps: 8 });
    await page.mouse.up();

    const moved = await widths();

    check(Math.abs((had[0] - moved[0]) - 120) <= 2 &&
          Math.abs((moved[1] - had[1]) - 120) <= 2,
          `a divider dragged 120 pixels moved 120 pixels: ` +
          `${had.join('/')} -> ${moved.join('/')}`);

    /* And it will not take a pane below what the markup said it needs.
       The left column's widest is the canvas, which asks for 240. */
    await page.mouse.move(grip.x + grip.width / 2 - 120,
                          grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x - 1200, grip.y + grip.height / 2,
                          { steps: 12 });
    await page.mouse.up();

    const floor = (await widths())[0];

    check(floor >= 240 && floor < 300,
          `and stops at the minimum the markup asked for: ${floor} of 240`);

    /* ---- and a split fills the box it is in ---- */

    /* A fraction is a share of a split, written out as `flex-grow'. A
       split that lost a child has fractions summing to less than one, and
       `flex-grow' under one leaves the rest of the box as a gap with no
       pane in it and no divider to drag. */
    const spare = (id) => page.evaluate((which) =>
    {
        const col = document.getElementById(`pane-${which}`)
                            .closest('.paneleaf').parentElement;
        const kids = [...col.children].reduce(
            (a, k) => a + k.getBoundingClientRect().height, 0);

        return Math.round(col.getBoundingClientRect().height - kids);
    }, id);

    await page.keyboard.press('Alt+Digit0');
    await page.waitForTimeout(200);

    check(await spare('fx-wide') <= 1,
          'a column of three panes fills the column it is in');

    await page.click('#paneshut-fx-list');
    await page.waitForTimeout(200);

    check(await spare('fx-wide') <= 1,
          'and the two left fill the column the third left');

    /* ---- closed, and brought back ---- */

    check(await page.evaluate(() =>
              document.getElementById('panetab-fx-list') === null &&
              document.getElementById('panereopen-fx-list') !== null &&
              document.getElementById('fx-list').isConnected),
          'the cross on a tab closes its pane to the drawer, element and all');

    check(await page.evaluate(
              () => document.activeElement.id === 'panereopen-fx-list'),
          'and leaves the focus on the button that brings it back');

    await page.click('#panereopen-fx-list');
    await page.waitForTimeout(200);

    check(await page.evaluate(() =>
              document.getElementById('pane-fx-list').checkVisibility() &&
              document.activeElement.id === 'panetab-fx-list'),
          'and the drawer button puts it back, in front and focused');

    /* ---- dragged to the drawer, and onto an edge ---- */

    await drag('#panetab-fx-list', '.panedrawer');

    check(await page.evaluate(() =>
              [...document.querySelectorAll('.paneclosed')]
                  .some((b) => b.textContent === 'List')),
          'a tab dragged onto the drawer closes to it');

    /* And onto a drawer with nothing in it yet, which is the one drop
       that has nowhere to aim otherwise: an empty drawer is not on the
       screen, so it comes back for as long as a tab is in the air. */
    await page.keyboard.press('Alt+Digit0');
    await page.waitForTimeout(200);
    await page.evaluate(() => window.tiler.pane('present', 'fx-notes'));
    await page.waitForTimeout(200);

    check(await page.evaluate(
              () => !document.querySelector('.panedrawer').checkVisibility()),
          'a drawer with nothing in it is not a row of the window');

    const from = await page.locator('#panetab-fx-notes').boundingBox();
    const root = await page.locator('#root').boundingBox();

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(root.x + 60, root.y + 9, { steps: 12 });
    await page.waitForTimeout(100);

    const offered = await page.evaluate(
        () => document.querySelector('.panedrawer').checkVisibility());

    await page.mouse.up();
    await page.waitForTimeout(200);

    check(offered && await page.evaluate(() =>
              [...document.querySelectorAll('.paneclosed')]
                  .some((b) => b.textContent === 'Notes')),
          'and it is there to be dropped on while one is');

    await page.keyboard.press('Alt+Digit0');
    await page.waitForTimeout(200);
    await drag('#panetab-fx-list', '.panedrawer');

    const splits = () => page.evaluate(() =>
    {
        const count = (n) => n.tabs !== undefined
            ? 0 : 1 + n.kids.reduce((a, k) => a + count(k), 0);

        return count(window.tiler.layout());
    });

    const splitsWere = await splits();

    await drag('.panedrawer button:text-is("List")', '#pane-fx-doc',
               { x: 0.92, y: 0.5 });

    check(await splits() === splitsWere + 1 &&
          await page.evaluate(() =>
              document.getElementById('pane-fx-list').closest('.paneleaf')
                      .parentElement.dataset.dir === 'row'),
          'and one dropped on a leaf\'s edge splits it that way');

    /* And the other way, which is not the same code path reflected: the
       two halves of a column are measured against a leaf's own floor
       rather than against what the panes in it asked for. A drop that
       only ever lands on a side edge never reads that number. */
    await drag('#panetab-fx-plot', '#pane-fx-doc', { x: 0.5, y: 0.92 });

    check(await page.evaluate(() =>
          {
              const leaf = document.getElementById('pane-fx-plot')
                                   .closest('.paneleaf');
              const box = leaf.parentElement;

              return box.dataset.dir === 'col' &&
                     box.contains(document.getElementById('pane-fx-doc')) &&
                     leaf.previousElementSibling !== null;
          }),
          'and one dropped on a bottom edge splits it downward');

    check(await page.evaluate(() =>
              [...document.querySelectorAll('.paneleaf')]
                  .every((n) => /^\d+px$/.test(n.style.minHeight))),
          'every leaf carries the height floor it was given');

    /* ---- driven from the keys ---- */

    await page.keyboard.press('Alt+Digit0');
    await page.waitForTimeout(200);
    await page.click('#panetab-fx-doc');

    const leafOf = (id) => page.evaluate((which) =>
    {
        const leaf = document.getElementById(`pane-${which}`)
                             .closest('.paneleaf');

        return [...document.querySelectorAll('.paneleaf')].indexOf(leaf);
    }, id);

    const docLeaf = await leafOf('fx-doc');

    await page.keyboard.press('Alt+ArrowRight');

    const went = await page.evaluate(() => document.activeElement.id);

    check(went !== 'panetab-fx-doc' && went.startsWith('panetab-'),
          `Alt and an arrow moves the focus to the pane that way: ${went}`);

    await page.click('#panetab-fx-doc');
    await page.keyboard.press('Alt+Shift+ArrowRight');
    await page.waitForTimeout(150);

    check(await leafOf('fx-doc') !== docLeaf,
          'Alt Shift and an arrow moves the pane rather than the focus');

    await page.keyboard.press('Alt+Digit0');
    await page.waitForTimeout(200);
    await page.click('#panetab-fx-paint');
    await page.keyboard.press('Alt+Enter');
    await page.waitForTimeout(200);

    check(await leafCount() === 1 &&
          await page.evaluate(() =>
              document.getElementById('pane-fx-paint').checkVisibility()),
          'Alt Enter fills the layout with one pane and draws no others');

    /* And everything that left the screen was told so, which is the same
       contract as a background tab and the reason zoom costs nothing. */
    check(await page.evaluate(() => !window.tiler.drawing().plot),
          'and the canvas it covered stopped drawing');

    /* One pane filling the layout is not one pane filling the window: a
       zoom that covered the drawer would put every closed pane a chord
       out of reach, which is the opposite of what the drawer is for. */
    check(await page.evaluate(() =>
          {
              const drawer = document.querySelector('.panedrawer');
              const leaf = document.getElementById('pane-fx-paint')
                                   .closest('.paneleaf');

              return drawer.checkVisibility() &&
                     leaf.getBoundingClientRect().top >=
                         drawer.getBoundingClientRect().bottom;
          }),
          'and the drawer is still above it, not under it');

    await page.keyboard.press('Alt+Enter');
    await page.waitForTimeout(200);

    check(await leafCount() > 1, 'and again puts the rest back');

    await page.click('#panetab-fx-list');
    await page.keyboard.press('Alt+KeyW');
    await page.waitForTimeout(200);

    check(await page.evaluate(() =>
              [...document.querySelectorAll('.paneclosed')]
                  .some((b) => b.textContent === 'List')),
          'Alt W closes a pane to the drawer');

    await page.keyboard.press('Alt+Digit0');
    await page.waitForTimeout(200);

    check(await page.evaluate(() =>
              document.getElementById('pane-fx-list').checkVisibility()),
          'and Alt 0 is the layout the page opens on');

    /* A chord typed into a text box is text. */
    await page.click('#fx-text');
    await page.keyboard.press('Alt+KeyW');
    await page.waitForTimeout(200);

    check(await page.evaluate(() =>
              document.getElementById('pane-fx-doc').checkVisibility()),
          'and none of them fires while the focus is in a text box');

    /* ---- and it is remembered ---- */

    await page.evaluate(() => document.activeElement.blur());
    await drag('#panetab-fx-list', '#pane-fx-doc .panebody');

    const kept = await page.evaluate(() => window.tiler.layout());

    await page.reload();
    await page.waitForFunction(
        () => window.tiler !== undefined &&
              document.body.classList.contains('tiled'));

    check(JSON.stringify(await page.evaluate(() => window.tiler.layout())) ===
              JSON.stringify(kept),
          'a reload opens on the layout somebody left');

    /* ---- the mode is availability, not the layout ---- */

    const onScreen = () => page.evaluate(() =>
        window.tiler.panes().filter(
            (id) => document.getElementById(`pane-${id}`)?.checkVisibility()));

    await page.keyboard.press('Alt+Digit0');
    await page.waitForTimeout(200);

    const modeOne = await onScreen();

    await page.selectOption('#mode', 'two');
    await page.waitForTimeout(250);

    const modeTwo = await onScreen();

    check(modeOne.includes('fx-only-one') &&
          !modeOne.includes('fx-only-two') &&
          modeTwo.includes('fx-only-two') &&
          !modeTwo.includes('fx-only-one'),
          'a mode switch takes its panes out of the layout and puts the ' +
          'other mode\'s in');

    check(await page.evaluate(() =>
              document.getElementById('fx-only-one')
                      .hasAttribute('data-pane-off') &&
              !document.getElementById('fx-only-one').hidden),
          'and an unavailable pane carries the module\'s own attribute, ' +
          'not `hidden\'');

    await page.selectOption('#mode', 'one');
    await page.waitForTimeout(250);

    check(JSON.stringify(await onScreen()) === JSON.stringify(modeOne),
          'and switching back puts the first mode\'s panes where they were');

    /* ---- a pane, asked for by name ---- */

    await page.evaluate(() => window.tiler.pane('close', 'fx-notes'));
    await page.waitForTimeout(150);

    const seen = (id) => page.evaluate(
        (w) => document.getElementById(`pane-${w}`).checkVisibility(), id);

    check(!await seen('fx-notes'),
          'a pane closed by name is put away');

    await page.evaluate(() => window.tiler.pane('present', 'fx-notes'));
    await page.waitForTimeout(150);

    check(await seen('fx-notes'),
          'and presented by name is in front again');

    await page.evaluate(
        () => window.tiler.pane('setTitle', 'fx-notes', 'Renamed'));
    await page.waitForTimeout(150);

    check(await page.textContent('#panetab-fx-notes') === 'Renamed',
          'and its tab says what it was told to say');

    /* ---- and a split left holding the layout ----
     *
     * A fraction is a share of a split, so a box that was somebody's
     * child and is now the top of the tree is in no split at all.
     * Carrying the share it had there would leave the layout at 45% of
     * the window with the rest blank -- the same mistake `grow' is
     * written to avoid one level down, made one level up.
     */
    await page.keyboard.press('Alt+Digit0');
    await page.waitForTimeout(200);

    for (const id of ['fx-paint', 'fx-doc', 'fx-only-one'])
        await page.evaluate((one) => window.tiler.pane('close', one), id);

    await page.waitForTimeout(250);

    const promoted = await page.evaluate(() =>
    {
        const root = document.getElementById('root');
        const layout = [...root.children].find(
            (c) => c.matches('.panebox, .paneleaf'));

        return Math.round(root.getBoundingClientRect().bottom -
                          layout.getBoundingClientRect().bottom);
    });

    check(promoted <= 1,
          `a split left holding the layout fills it: ${promoted}px spare`);

    await page.keyboard.press('Alt+Digit0');
    await page.waitForTimeout(200);

    /* ---- a popover over the layout ---- */

    await page.keyboard.press('Alt+Digit0');
    await page.waitForTimeout(200);

    check(await page.evaluate(
              () => document.getElementById('fx-menu').parentElement
                            .className === 'paneoverlay'),
          'a popover lives over the layout, not in the pane it points at');

    /* The box it is anchored in is wider than any pane and scrolls, so
       the button can be put against the right of the window and pressed
       there. Beside the pointer would put the menu off the window. */
    await page.evaluate(() =>
    {
        const s = document.getElementById('fx-scroll');

        s.scrollLeft = s.scrollWidth;
    });
    await page.waitForTimeout(100);
    await page.click('#fx-pop');
    await page.waitForFunction(
        () => !document.getElementById('fx-menu').hidden);

    const where = await page.evaluate(() =>
    {
        const r = document.getElementById('fx-menu').getBoundingClientRect();

        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom,
                 w: innerWidth, h: innerHeight };
    });

    check(where.left >= 0 && where.top >= 0 &&
          where.right <= where.w && where.bottom <= where.h,
          'and is held inside the window, edge to edge: ' +
          `${Math.round(where.left)}-${Math.round(where.right)} ` +
          `of ${where.w}`);

    /* ---- and what it was told rather than decided ---- */

    /*
     * Everything above takes the module's defaults. What that cannot show
     * is that they are defaults: a number decided and a number given read
     * exactly alike from out here. So a second instance, on two boxes of
     * its own, told something else for each.
     */
    const told = await page.evaluate(async () =>
    {
        const { createPanes } = await import('../src/panes.js');
        const root = document.createElement('div');
        const saved = [];

        const box = (id) =>
        {
            const el = document.createElement('section');

            el.id = id;
            el.dataset.pane = '';
            el.dataset.paneTitle = id;
            el.dataset.paneMin = '80';

            return el;
        };

        document.body.append(root, box('two-a'), box('two-b'));

        const two = createPanes({
            root,
            catalog: ['two-a', 'two-b'],
            mode: 'only',
            layouts: { only: { dir: 'row', size: [0.5, 0.5],
                               kids: [{ tabs: ['two-a'] },
                                      { tabs: ['two-b'] }] } },
            on: true,
            split: 20,
            keys: { close: ['KeyQ'] },
            storage: { getItem: () => null,
                       setItem: (k) => saved.push(k),
                       removeItem: () => {} },
        });

        const wide = Math.round(root.querySelector('.panesplit')
                                    .getBoundingClientRect().width);

        const fire = (code) => window.dispatchEvent(
            new KeyboardEvent('keydown', { code, altKey: true,
                                           bubbles: true, cancelable: true }));

        fire('KeyW');
        const afterW = root.querySelectorAll('.panetab').length;

        fire('KeyQ');
        const afterQ = root.querySelectorAll('.panetab').length;

        two.available('two-b', false);

        const b = document.getElementById('two-b');
        const marked = b.hasAttribute('data-pane-off') && !b.hidden;

        two.available('two-b', true);

        /* And handed back. What a page that unmounts this needs is every
           pane under its own parent again and nothing of the tiler's
           still listening -- a chord answered after destroy() is the
           second instance nobody can get rid of. */
        two.destroy();

        const back = {
            emptied: root.children.length === 0,
            rooted: !root.classList.contains('panesroot'),
            home: document.getElementById('two-a').parentElement === document.body,
            tiled: two.tiled(),
        };

        fire('KeyQ');

        return { wide, afterW, afterQ, saved, marked, back,
                 afterDead: root.children.length };
    });

    check(told.wide === 20,
          `a divider is as thick as the tiler was told: ${told.wide} of 20`);

    check(told.afterW === 2 && told.afterQ === 1,
          'and the chord it was given closes a pane where the default does ' +
          `nothing: ${told.afterW} tabs after Alt W, ${told.afterQ} after ` +
          'Alt Q');

    check(told.marked,
          'and an unavailable pane is marked with the attribute rather ' +
          'than with `hidden\'');

    check(told.saved.length > 0 &&
          told.saved.every((k) => k.startsWith('panes:')),
          `and what it saves goes where it was told: ${told.saved.join(' ')}`);

    check(told.back.emptied && told.back.rooted && told.back.home &&
          !told.back.tiled && told.afterDead === 0,
          'and destroy() puts the document back and stops answering: ' +
          JSON.stringify(told.back));
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

check(errors.length === 0,
      errors.length === 0 ? 'and the page raised nothing'
                          : `the page raised: ${errors.join(' | ')}`);

process.stdout.write(`\n${failures === 0
    ? 'mullion adopts a document, puts it back, and stops the work ' +
      'behind a tab\n'
    : `${failures} failed\n`}`);
process.exitCode = failures;
