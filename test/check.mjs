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

    await page.setViewportSize(WIDE);
    await page.waitForFunction(
        () => document.body.classList.contains('tiled'));
    await page.waitForTimeout(200);

    /* ---- the accent ---- */

    /* The demo maps no colors, so the selected tab is drawn in the
       fallback: the page's own accent, as a slider on it would be. */
    const accent = await page.evaluate(() =>
    {
        const probe = document.createElement('i');

        probe.style.color = 'AccentColor';
        document.body.append(probe);

        const want = getComputedStyle(probe).color;
        const tab = document.querySelector(
            '.panetabwrap:has(> .panetab[aria-selected="true"])');

        probe.remove();

        return { want, got: getComputedStyle(tab).borderBottomColor };
    });

    check(accent.got === accent.want,
          `a selected tab is underlined in AccentColor: ${accent.got}`);

    /* ---- a pane nobody is looking at ---- */

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
              !document.getElementById('fx-paint').checkVisibility() &&
              document.getElementById('fx-plot').checkVisibility()),
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

    /* And the pane the tab strip acted on, which is the one somebody
       notices. Above is a bystander: a pane that was on the screen before
       the render and after it. This is the other half -- a pane raised
       over, and then raised back. Hidden is not detached here, so what it
       was scrolled to is still what it is scrolled to; a layout that
       rebuilt itself would have lost it twice over. */
    /* Onto the leaf those two are stacked in, aimed at whichever of them
       the block above left in front: a pane behind a tab has no box to
       drop on. */
    await drag('#panetab-fx-wide', '#pane-fx-plot .panebody');

    const behind = await page.evaluate(async () =>
    {
        const scroller = document.getElementById('fx-scroll');
        const wait = () => new Promise((go) => setTimeout(go, 150));

        scroller.scrollLeft = 300;

        const was = scroller.scrollLeft;

        document.getElementById('panetab-fx-paint').click();
        await wait();

        /* That it really went behind one, so that a tab strip which
           quietly stopped switching could not pass this. */
        const gone = !document.getElementById('fx-wide').checkVisibility();

        document.getElementById('panetab-fx-wide').click();
        await wait();

        return { was, gone, now: scroller.scrollLeft };
    });

    check(behind.was > 0 && behind.gone && behind.now === behind.was,
          'and a pane raised back from behind a tab is scrolled where it ' +
          `was: ${behind.was} then ${behind.now}`);

    /* And a pane that did move, because the split it was in went away
       around it: closing the last pane but one of a column puts the
       other up a level, into the row. That is a move and not a render
       being careless, and where the browser has `moveBefore' it keeps
       what it is doing -- as does the pane just closed, which goes to
       the drawer by way of a box that is going. Its <iframe>, and where
       it was scrolled to: a box moved into or out of one that is not
       displayed is scrolled to the start in Chromium however it is
       moved, which is why a pane put away is not drawn rather than not
       displayed. */
    await page.keyboard.press('Alt+Digit0');
    await page.waitForTimeout(200);

    const collapsed = await page.evaluate(async () =>
    {
        if (Element.prototype.moveBefore === undefined)
            return null;

        const wait = (ms) => new Promise((go) => setTimeout(go, ms));
        const loads = { list: 0, wide: 0 };
        const frames = Object.keys(loads).map((id) =>
        {
            const frame = document.createElement('iframe');

            frame.src = 'about:blank';
            frame.addEventListener('load', () => { loads[id]++; });
            document.getElementById(`fx-${id}`).append(frame);

            return frame;
        });

        await wait(200);

        const scroller = document.getElementById('fx-scroll');

        scroller.scrollLeft = 250;

        const was = { ...loads, scroll: scroller.scrollLeft,
                      box: document.getElementById('pane-fx-list')
                                   .closest('.paneleaf').parentElement };

        window.tiler.pane('close', 'fx-plot');
        window.tiler.pane('close', 'fx-wide');
        await wait(300);

        const up = document.getElementById('pane-fx-list')
                           .closest('.paneleaf').parentElement !== was.box;

        document.getElementById('panereopen-fx-wide').click();
        await wait(150);

        const scroll = scroller.scrollLeft;

        frames.forEach((frame) => frame.remove());

        return { was: { list: was.list, wide: was.wide, scroll: was.scroll },
                 now: { ...loads, up, scroll } };
    });

    if (collapsed === null)
        process.stdout.write('skip  a pane moved by a collapse keeps its ' +
                             '<iframe>: no moveBefore here\n');
    else
    {
        check(collapsed.now.up && collapsed.now.list === collapsed.was.list,
              'and a pane a collapsing split moves up a level does not load ' +
              `its <iframe> again: ${collapsed.was.list} then ` +
              `${collapsed.now.list}`);

        check(collapsed.now.wide === collapsed.was.wide,
              'and nor does the pane closed on the way, or reopened: ' +
              `${collapsed.was.wide} then ${collapsed.now.wide}`);

        check(collapsed.was.scroll > 0 &&
              collapsed.now.scroll === collapsed.was.scroll,
              'and that pane is scrolled where it was when it comes back: ' +
              `${collapsed.was.scroll} then ${collapsed.now.scroll}`);

        /* And a pane behind a tab in the leaf that goes up a level,
           which is moved with it and is not displayed either. */
        await page.keyboard.press('Alt+Digit0');
        await page.waitForTimeout(200);
        await drag('#panetab-fx-wide', '#pane-fx-list .panebody');

        const tucked = await page.evaluate(async () =>
        {
            const wait = (ms) => new Promise((go) => setTimeout(go, ms));
            const scroller = document.getElementById('fx-scroll');

            scroller.scrollLeft = 350;

            const was = scroller.scrollLeft;

            document.getElementById('panetab-fx-list').click();
            await wait(100);

            const behind = !scroller.checkVisibility();

            window.tiler.pane('close', 'fx-plot');
            await wait(150);
            document.getElementById('panetab-fx-wide').click();
            await wait(150);

            return { was, behind, now: scroller.scrollLeft };
        });

        check(tucked.was > 0 && tucked.behind && tucked.now === tucked.was,
              'and a pane behind a tab in it is scrolled where it was: ' +
              `${tucked.was} then ${tucked.now}`);
    }

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
              document.getElementById('fx-list').checkVisibility() &&
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

    /* And from a tab in a leaf of two, which is where the focus is after
       every chord. The tab answers plain arrows itself, and a tab that
       answered the chord as well would raise its neighbor before the
       chord asked which pane is in front. */
    await page.keyboard.press('Alt+Digit0');
    await page.waitForTimeout(200);
    await drag('#panetab-fx-doc', '#pane-fx-paint .panebody');
    await page.click('#panetab-fx-doc');

    const leftOf = (id) => page.evaluate((which) =>
        document.getElementById(`pane-${which}`).closest('.paneleaf')
                .getBoundingClientRect().left, id);

    await page.keyboard.press('Alt+ArrowRight');
    await page.waitForTimeout(150);

    check(await page.evaluate(() =>
              document.getElementById('panetab-fx-doc')
                      .getAttribute('aria-selected') === 'true'),
          'and Alt and an arrow from a tab leaves the tab in front of its ' +
          'leaf where it was');

    await page.click('#panetab-fx-doc');
    await page.keyboard.press('Alt+Shift+ArrowRight');
    await page.waitForTimeout(150);

    check(await leftOf('fx-doc') > await leftOf('fx-paint'),
          'and Alt Shift and an arrow from a tab moves that tab\'s pane, ' +
          'not its neighbor');

    await page.keyboard.press('Alt+Digit0');
    await page.waitForTimeout(200);
    await page.click('#panetab-fx-paint');
    await page.keyboard.press('Alt+Enter');
    await page.waitForTimeout(200);

    check(await leafCount() === 1 &&
          await page.evaluate(() =>
              document.getElementById('fx-paint').checkVisibility()),
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

    /* A pane asked for by name is a pane in front of somebody, which a
       zoom on some other leaf would leave drawn and not shown. */
    await page.click('#panetab-fx-paint');
    await page.keyboard.press('Alt+Enter');
    await page.waitForTimeout(200);
    await page.evaluate(() => window.tiler.pane('present', 'fx-list'));
    await page.waitForTimeout(100);

    check(await page.evaluate(() => window.tiler.pane('visible', 'fx-list')) &&
          await leafCount() > 1,
          'and a pane presented while another is zoomed is on the screen');

    await page.click('#panetab-fx-list');
    await page.keyboard.press('Alt+KeyW');
    await page.waitForTimeout(200);

    check(await page.evaluate(() =>
              [...document.querySelectorAll('.paneclosed')]
                  .some((b) => b.textContent === 'List')),
          'Alt W closes a pane to the drawer');

    check(await page.evaluate(() =>
              document.activeElement.classList.contains('panetab')),
          'and leaves the focus on a tab rather than on the page: ' +
          await page.evaluate(() => document.activeElement.id ||
                                    document.activeElement.tagName));

    /* A closed pane's button dragged and let go over nothing is a drag
       that went nowhere, and not a click that reopens it. */
    await drag('#panereopen-fx-list', '.chrome h1');

    check(await page.evaluate(() =>
              document.getElementById('panereopen-fx-list') !== null),
          'and a closed pane dragged out and dropped on nothing stays closed');

    await page.keyboard.press('Alt+Digit0');
    await page.waitForTimeout(200);

    check(await page.evaluate(() =>
              document.getElementById('fx-list').checkVisibility()),
          'and Alt 0 is the layout the page opens on');

    /* A chord typed into a text box is text. */
    await page.click('#fx-text');
    await page.keyboard.press('Alt+KeyW');
    await page.waitForTimeout(200);

    check(await page.evaluate(() =>
              document.getElementById('fx-doc').checkVisibility()),
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

    /* What somebody left can be nothing at all, and nothing is not a
       reason to open on every pane stacked in one leaf. */
    const reload = async () =>
    {
        await page.reload();
        await page.waitForFunction(
            () => window.tiler !== undefined &&
                  document.body.classList.contains('tiled'));
    };

    await page.keyboard.press('Alt+Digit0');
    await page.waitForTimeout(200);

    const opening = JSON.stringify(
        await page.evaluate(() => window.tiler.layout()));

    await page.evaluate(() =>
    {
        for (const id of window.tiler.panes())
            window.tiler.pane('close', id);
    });
    await reload();

    check(JSON.stringify(await page.evaluate(() => window.tiler.layout())) ===
              opening,
          'and a layout with every pane closed opens on the page\'s default');

    /* And a saved layout is somebody else's writing: a pane named in two
       leaves is in the first, and a front tab that is not an index is
       not a layout. */
    await page.evaluate(() => localStorage.setItem('mullion-demo:one',
        JSON.stringify({ dir: 'row', size: [0.5, 0.5], kids: [
            { tabs: ['fx-doc', 'fx-paint'], active: 1 },
            { tabs: ['fx-doc', 'fx-list'] }] })));
    await reload();

    check(await page.evaluate(() =>
              document.querySelectorAll('.panetab').length ===
                  new Set([...document.querySelectorAll('.panetab')]
                              .map((t) => t.id)).size &&
              JSON.stringify(window.tiler.layout().kids[1].tabs) ===
                  '["fx-list"]'),
          'and a pane a saved layout names twice is in one leaf');

    await page.evaluate(() => localStorage.setItem('mullion-demo:one',
        JSON.stringify({ tabs: ['fx-doc', 'fx-paint'], active: 'x' })));
    await reload();

    check(JSON.stringify(await page.evaluate(() => window.tiler.layout())) ===
              opening,
          'and one whose front tab is not an index is the default');

    /* ---- the mode is availability, not the layout ---- */

    const onScreen = () => page.evaluate(() =>
        window.tiler.panes().filter(
            (id) => document.getElementById(id)?.checkVisibility()));

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
        (w) => document.getElementById(w).checkVisibility(), id);

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

    /* A sentence, not a word: a popover has to be given the room to be
       as wide as what is in it. */
    await page.evaluate(() =>
    {
        document.getElementById('fx-menu').textContent =
            'A popover with a sentence in it, long enough to need a line.';
    });
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

    const menuWide = await page.evaluate(
        () => document.getElementById('fx-menu').offsetWidth);

    check(menuWide > 200,
          `and is as wide as what is in it, not one word to a line: ${menuWide}px`);

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

    /* An id is the page's to choose, and a `.' or a `:' in one is part of
       a name and not of a selector. */
    const odd = await page.evaluate(async () =>
    {
        const { createPanes } = await import('../src/panes.js');
        const root = document.createElement('div');

        const box = (id, min) =>
        {
            const el = document.createElement('section');

            el.id = id;
            el.dataset.pane = '';
            el.dataset.paneTitle = id;
            el.dataset.paneMin = min;

            return el;
        };

        document.body.append(root, box('odd:one.x', '0'),
                             box('odd-two', '80'));

        const three = createPanes({
            root,
            catalog: ['odd:one.x', 'odd-two'],
            mode: 'only',
            layouts: { only: { dir: 'row', size: [0.5, 0.5],
                               kids: [{ tabs: ['odd:one.x'] },
                                      { tabs: ['odd-two'] }] } },
            on: true,
            storage: { getItem: () => null, setItem: () => {},
                       removeItem: () => {} },
        });

        const floor = document.getElementById('pane-odd:one.x')
                              .closest('.paneleaf').style.minWidth;

        document.getElementById('odd-two').querySelector('*')?.focus();
        three.present('odd:one.x');

        const presented = document.activeElement.id;

        document.getElementById('paneshut-odd:one.x').click();

        const shut = document.activeElement.id;
        const mine = document.createElement('div');

        three.overlay().append(mine);
        three.destroy();

        return { floor, presented, shut,
                 handed: mine.parentElement === document.body };
    });

    check(odd.presented === 'panetab-odd:one.x' &&
          odd.shut === 'panereopen-odd:one.x',
          'and a pane whose id is not a selector still takes the focus: ' +
          `${odd.presented}, ${odd.shut}`);

    check(odd.floor === '0px',
          `and a floor of nothing is a floor: ${odd.floor}`);

    check(odd.handed,
          'and destroy() hands back what the page put in the overlay');

    /* ---- a phone ----
     *
     * The options for a screen the defaults were not drawn for, a second
     * set of layouts swapped in without taking the tiler down, and a
     * divider dragged by a finger rather than a mouse -- which is a
     * different gesture to the browser, and one it will take for a scroll
     * if the element does not say otherwise.
     */
    {
    const touch = await browser.newContext({ viewport: { width: 400, height: 800 },
                                             hasTouch: true, isMobile: true });
    const phone = await touch.newPage();

    phone.on('pageerror', (e) => errors.push(e.message));
    await phone.goto(`${base}?panes=0`);
    await phone.waitForFunction(() => window.tiler !== undefined);

    const narrow = await phone.evaluate(async () =>
    {
        const { createPanes } = await import('../src/panes.js');
        const root = document.createElement('div');
        const kept = new Map();

        window.createPanesAgain = createPanes;

        const box = (id) =>
        {
            const el = document.createElement('section');

            el.id = id;
            el.dataset.pane = '';
            el.dataset.paneTitle = `a long title for ${id}`;
            el.dataset.paneMin = '40';
            el.style.height = '100%';

            return el;
        };

        /* Over the demo, where a finger can reach it: the page's own
           tiled body would otherwise squeeze it under the viewport. */
        Object.assign(root.style, { position: 'fixed', inset: '0 0 auto 0',
                                    height: '600px', zIndex: '10',
                                    background: 'white' });
        root.style.display = 'flex';
        root.style.flexDirection = 'column';
        document.body.append(root, box('ph-a'), box('ph-b'), box('ph-c'),
                             box('ph-d'), box('ph-e'));

        window.phonePanes = createPanes({
            root,
            catalog: ['ph-a', 'ph-b', 'ph-c', 'ph-d', 'ph-e'],
            mode: 'm',
            layouts: { m: { dir: 'col', size: [0.5, 0.5],
                            kids: [{ tabs: ['ph-a', 'ph-b', 'ph-c', 'ph-d'] },
                                   { tabs: ['ph-e'] }] } },
            on: true, media: 'all', split: 18, param: 'phone',
            strip: 'scroll', lone: false, closed: 'More:',
            storage: { getItem: (k) => kept.get(k) ?? null,
                       setItem: (k, v) => kept.set(k, v),
                       removeItem: (k) => kept.delete(k) },
        });

        window.phoneKept = kept;

        const strips = [...root.querySelectorAll('.paneleaf > .panetabs')];
        const tabs = [...strips[0].querySelectorAll('.panetab')];

        window.phonePanes.close('ph-d');

        return {
            scrolls: strips[0].scrollWidth > strips[0].clientWidth &&
                     getComputedStyle(strips[0]).overflowX === 'auto',
            whole: tabs.every((t) => t.scrollWidth <= t.clientWidth + 1),
            alone: getComputedStyle(strips[1]).display === 'none',
            label: root.querySelector('.panedrawerlabel')?.textContent,
            action: getComputedStyle(root.querySelector('.panesplit'))
                        .touchAction,
        };
    });

    check(narrow.scrolls && narrow.whole,
          'strip: "scroll" keeps every tab its own width, in a row that ' +
          'scrolls');

    check(narrow.alone,
          'lone: false draws no strip over a leaf with one tab');

    check(narrow.label === 'More:',
          `closed labels the drawer: ${narrow.label}`);

    check(narrow.action === 'none',
          `a divider is a drag and not a scroll: touch-action ` +
          `${narrow.action}`);

    /* By a finger: pressed on the divider and moved 150 pixels up. */
    const heightOf = () => phone.evaluate(() => Math.round(
        document.getElementById('pane-ph-a').closest('.paneleaf')
                .getBoundingClientRect().height));
    const upper = await heightOf();
    const bar = await phone.locator('.panesplit').last().boundingBox();
    const cdp = await touch.newCDPSession(phone);
    const x = bar.x + bar.width / 2;
    const y = bar.y + bar.height / 2;

    await cdp.send('Input.dispatchTouchEvent',
                   { type: 'touchStart', touchPoints: [{ x, y }] });

    for (let i = 1; i <= 15; i++)
        await cdp.send('Input.dispatchTouchEvent',
                       { type: 'touchMove',
                         touchPoints: [{ x, y: y - i * 10 }] });

    await cdp.send('Input.dispatchTouchEvent',
                   { type: 'touchEnd', touchPoints: [] });
    await phone.waitForTimeout(100);

    const lower = await heightOf();

    check(Math.abs(upper - lower - 150) <= 2,
          `and a finger moves it as far as it moved: ${upper} to ${lower}`);

    /* And the other shape's layouts, in place: the one that was up is
       saved under its store, the new store's default comes up, and the
       elements are the same ones -- nothing went back to the document on
       the way. */
    const swapped = await phone.evaluate(() =>
    {
        const a = document.getElementById('ph-a');
        let moved = 0;
        const watch = new MutationObserver((list) =>
        {
            for (const m of list)
                for (const n of m.removedNodes)
                    if (n === a)
                        moved++;
        });

        watch.observe(document.body, { childList: true, subtree: true });

        window.phonePanes.setLayouts(
            { m: { tabs: ['ph-e', 'ph-a', 'ph-b', 'ph-c'] } },
            { store: 'side', split: 30 });

        const leaves = document.querySelectorAll('.paneleaf').length;
        const front = document.querySelector(
            '.panetab[aria-selected="true"]')?.id;

        watch.disconnect();

        window.phonePanes.setLayouts(
            { m: { tabs: ['ph-a'] } }, { store: 'panes' });

        const back = window.phonePanes.layout();

        return { leaves, front, moved,
                 saved: [...window.phoneKept.keys()].sort().join(' '),
                 split: getComputedStyle(document.querySelector('.panesroot'))
                            .getPropertyValue('--pane-split'),
                 back: back.dir === 'col' && back.kids.length === 2 };
    });

    check(swapped.leaves === 1 && swapped.front === 'panetab-ph-e',
          `setLayouts puts the new set's layout up: ${swapped.leaves} ` +
          `leaf, ${swapped.front} in front`);

    check(swapped.saved === 'panes:m side:m' && swapped.back,
          'and each set is kept under its own store, the first coming ' +
          `back as it was left: ${swapped.saved}`);

    check(swapped.moved === 0,
          'and no pane went back to the document on the way');

    /* `lone' as a list, and the reset button. The list takes the strip
       off the pane it names and no other: a pane somebody has moved into
       a leaf of its own keeps the tab it is dragged and closed by. And
       the button, which is how a phone starts over with no Alt 0 to
       press, is in the drawer's row whether or not anything is closed. */
    const listed = await phone.evaluate(() =>
    {
        const root = document.querySelector('.panesroot');

        window.phonePanes.destroy();
        window.phoneKept.clear();

        const layout = { dir: 'col', size: [0.3, 0.4, 0.3], kids: [
            { tabs: ['ph-a'] },
            { tabs: ['ph-b', 'ph-c', 'ph-d'] },
            { tabs: ['ph-e'] }] };

        window.phonePanes = createPanesAgain({
            root,
            catalog: ['ph-a', 'ph-b', 'ph-c', 'ph-d', 'ph-e'],
            mode: 'm', layouts: { m: layout },
            on: true, media: 'all', split: 18, param: 'phone',
            strip: 'scroll', lone: ['ph-e'], closed: 'More:',
            reset: '\u21ba',
            storage: { getItem: (k) => window.phoneKept.get(k) ?? null,
                       setItem: (k, v) => window.phoneKept.set(k, v),
                       removeItem: (k) => window.phoneKept.delete(k) },
        });

        const shown = (id) => getComputedStyle(
            document.getElementById(`panetab-${id}`)
                    .closest('.panetabs')).display !== 'none';
        const drawer = root.querySelector('.panedrawer');
        const button = root.querySelector('.panereset > button');
        const before = { a: shown('ph-a'), e: shown('ph-e'),
                         row: !drawer.checkVisibility(),
                         seat: button?.closest('.panetabs') ===
                               document.getElementById('panetab-ph-a')
                                       .closest('.panetabs'),
                         label: button?.getAttribute('aria-label') };

        window.phonePanes.close('ph-b');

        const closed = !JSON.stringify(window.phonePanes.layout())
                            .includes('ph-b');

        button.click();

        const back = window.phonePanes.layout();
        const more = drawer.querySelector('.panedrawerlabel') === null;

        /* And with every leaf bare there is no strip to sit in, so it
           goes in the drawer's row, and the row shows. */
        window.phonePanes.setLayouts({ m: { tabs: ['ph-e'] } },
                                     { store: 'bare' });

        const alone = root.querySelector('.panereset')
                          ?.closest('.panedrawer') === drawer &&
                      drawer.checkVisibility();

        return { ...before, closed, alone,
                 reset: JSON.stringify(back.kids.map((k) => k.tabs)) ===
                        JSON.stringify(layout.kids.map((k) => k.tabs)),
                 more };
    });

    check(listed.a && !listed.e,
          'lone as a list takes the strip off the pane it names, and ' +
          `leaves it on one moved into a leaf alone: ${listed.a} ` +
          `${listed.e}`);

    check(listed.row && listed.seat && listed.label === 'Reset layout',
          'reset puts a button at the end of the first strip, and no ' +
          'drawer row with nothing closed');

    check(listed.alone,
          'and in the drawer\'s row when every leaf is bare');

    check(listed.closed && listed.reset && listed.more,
          'and the button puts the mode\'s layout back, closed panes and ' +
          'all');

    await touch.close();
    }

    /* ---- somewhere else to keep it ----
     *
     * What a page with accounts does: keeps the layout on a server, which
     * answers later, and is told of every change a person makes. The
     * page opens on its default rather than waiting, and what was kept
     * comes up when it arrives -- unless somebody has moved something
     * first, which is newer.
     */
    {
    const own = await browser.newPage({ viewport: WIDE });

    own.on('pageerror', (e) => errors.push(e.message));
    await own.goto(`${base}?panes=0`);
    await own.waitForFunction(() => window.tiler !== undefined);

    const told = await own.evaluate(async () =>
    {
        const { createPanes } = await import('../src/panes.js');
        const wait = (ms) => new Promise((go) => setTimeout(go, ms));
        const root = document.createElement('div');
        const heard = [];
        let loose = 0;

        window.addEventListener('unhandledrejection', () => { loose++; });

        const box = (id) =>
        {
            const el = document.createElement('section');

            el.id = id;
            el.dataset.pane = '';
            el.dataset.paneMin = '40';

            return el;
        };

        Object.assign(root.style, { position: 'fixed', inset: '0',
                                    zIndex: '10', background: 'white',
                                    display: 'flex',
                                    flexDirection: 'column' });
        document.body.append(root, box('kp-a'), box('kp-b'), box('kp-c'));

        const layout = { dir: 'row', size: [0.5, 0.5], kids: [
            { tabs: ['kp-a', 'kp-b'] }, { tabs: ['kp-c'] }] };
        const kept = { dir: 'col', size: [0.4, 0.6], kids: [
            { tabs: ['kp-c'] }, { tabs: ['kp-a', 'kp-b'] }] };

        /* A server: every answer late, and every write refused. */
        const make = (answer) => createPanes({
            root, catalog: ['kp-a', 'kp-b', 'kp-c'],
            mode: 'm', layouts: { m: layout, n: layout },
            on: true, media: 'all', param: 'kept',
            storage: {
                getItem: () => wait(150).then(() => answer),
                setItem: () => Promise.reject(new Error('refused')),
                removeItem: () => Promise.reject(new Error('refused')),
            },
            onLayout: (tree, mode) => heard.push({ tree, mode }),
        });

        const tabsOf = (tree) => JSON.stringify(
            tree.tabs ?? tree.kids.map((k) => k.tabs));

        let panes = make(JSON.stringify(kept));

        const first = tabsOf(panes.layout());

        await wait(300);

        const late = tabsOf(panes.layout());
        const quiet = heard.length;

        panes.close('kp-b');

        const closed = heard.at(-1);

        closed.tree.kids = [];

        const copied = panes.layout().kids !== undefined;

        /* A press on a divider that goes nowhere, and one that does. */
        const bar = root.querySelector('.panesplit');
        const r = bar.getBoundingClientRect();
        const at = { clientX: r.left + r.width / 2,
                     clientY: r.top + r.height / 2,
                     pointerId: 1, bubbles: true, isPrimary: true };

        bar.setPointerCapture = () => {};
        bar.dispatchEvent(new PointerEvent('pointerdown', at));
        bar.dispatchEvent(new PointerEvent('pointerup', at));

        const pressed = heard.length;

        bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight',
                                                         bubbles: true }));

        const keyed = heard.length;

        panes.mode('n');
        panes.setLayouts({ m: layout, n: kept });

        const swapped = heard.length;

        panes.reset();

        const reset = heard.at(-1);

        panes.destroy();

        /* And a person faster than the server: what they did stands. */
        panes = make(JSON.stringify(kept));
        panes.close('kp-c');
        await wait(300);

        const faster = tabsOf(panes.layout());

        panes.destroy();

        /* And a server with nothing kept, or nonsense: the default. */
        panes = make('not a layout');
        await wait(300);

        const nonsense = tabsOf(panes.layout());

        panes.destroy();
        root.remove();
        await wait(50);

        return { first, late, quiet, closed: closed.mode, copied,
                 pressed: pressed - heard.indexOf(closed) - 1,
                 keyed: keyed - pressed, swapped: swapped - keyed,
                 reset: reset.mode === 'n' && tabsOf(reset.tree),
                 faster, nonsense, loose,
                 want: { layout: tabsOf(layout), kept: tabsOf(kept) } };
    });

    check(told.first === told.want.layout && told.late === told.want.kept,
          'a layout kept somewhere that answers later: the default first, ' +
          `then what was kept: ${told.first} then ${told.late}`);

    check(told.quiet === 0,
          'and loading it is not a change anybody made');

    check(told.closed === 'm' && told.copied,
          'onLayout hears a pane closed, with the mode and a copy');

    check(told.pressed === 0 && told.keyed === 1,
          'and a divider moved, but not a divider pressed and let go: ' +
          `${told.pressed} ${told.keyed}`);

    check(told.swapped === 0,
          `and not a mode or a set of layouts swapped in: ${told.swapped}`);

    check(told.reset === told.want.kept,
          `and a reset, with the layout it went back to: ${told.reset}`);

    check(told.faster === '["kp-a","kp-b"]',
          'a person who moves something before the kept layout arrives ' +
          `keeps what they did: ${told.faster}`);

    check(told.nonsense === told.want.layout,
          `and a kept layout that is nonsense is the default: ${told.nonsense}`);

    check(told.loose === 0,
          `and a write the server refuses is not left unhandled: ${told.loose}`);

    await own.close();
    }
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
