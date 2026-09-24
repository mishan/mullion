#!/usr/bin/env node
/*
 * Copyright (C) 2026 Misha Nasledov
 *
 * SPDX-License-Identifier: MIT
 */

/*
 * check.mjs -- mullion, in a browser.
 *
 *   npm install && npx playwright install chromium firefox webkit
 *   npm test                  # in Chromium
 *   npm test -- firefox       # or firefox, or webkit
 *
 * Everything here runs against test/fixture/index.html, which is a page
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

import * as playwright from 'playwright';

import { serve } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/* Wide enough for the tiler's own threshold, and narrow enough to be
   under it: mullion asks for 60em and a pointer that is not a finger. */
const WIDE = { width: 1400, height: 900 };
const NARROW = { width: 560, height: 900 };

/* Which browser. Chromium by default, and the others because the one
   thing it does that they do not is `moveBefore': without it every
   render that moves a pane is an ordinary insert, and that is the path
   a page in Firefox or Safari takes. */
const name = process.argv[2] ?? process.env.BROWSER ?? 'chromium';

if (!['chromium', 'firefox', 'webkit'].includes(name))
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

/* A claim this browser has no way to test, said rather than passed. */
function skip (what)
{
    process.stdout.write(`skip  ${what}\n`);
}

const site = await serve(path.join(here, '..'));
const base = `http://127.0.0.1:${site.address().port}/test/fixture/index.html`;
const errors = [];

const browser = await playwright[name].launch();

process.stdout.write(`in ${name} ${browser.version()}\n`);

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

    /* The fixture maps no colors, so the selected tab is drawn in the
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
       displayed. Where it was scrolled to is kept in every browser; the
       <iframe> only where there is `moveBefore' to keep it. */
    await page.keyboard.press('Alt+Digit0');
    await page.waitForTimeout(200);

    const collapsed = await page.evaluate(async () =>
    {
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
                 now: { ...loads, up, scroll },
                 moves: Element.prototype.moveBefore !== undefined };
    });

    if (!collapsed.moves)
        skip('a pane moved by a collapse keeps its <iframe>: no ' +
             'moveBefore here');
    else
    {
        check(collapsed.now.up && collapsed.now.list === collapsed.was.list,
              'and a pane a collapsing split moves up a level does not load ' +
              `its <iframe> again: ${collapsed.was.list} then ` +
              `${collapsed.now.list}`);

        check(collapsed.now.wide === collapsed.was.wide,
              'and nor does the pane closed on the way, or reopened: ' +
              `${collapsed.was.wide} then ${collapsed.now.wide}`);
    }

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
    await page.evaluate(() => localStorage.setItem('mullion-fixture:one',
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

    await page.evaluate(() => localStorage.setItem('mullion-fixture:one',
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

    /* ---- back where it was ----
     *
     * A pane that was the last in its leaf takes the leaf with it when
     * it closes, and the split around it collapses. Brought back -- by
     * the drawer or by name -- it is put where it was: beside the same
     * neighbor, on the same side, with the same share. Anywhere else,
     * and closing a pane to look at something is a layout lost.
     */
    {
    /* Two layouts the same tree, shares to within rounding. */
    const same = (a, b) =>
        typeof a === 'number' && typeof b === 'number'
            ? Math.abs(a - b) < 1e-6
            : Array.isArray(a) && Array.isArray(b)
                ? a.length === b.length && a.every((v, i) => same(v, b[i]))
                : a !== null && b !== null && typeof a === 'object' &&
                  typeof b === 'object'
                    ? Object.keys(a).length === Object.keys(b).length &&
                      Object.keys(a).every((k) => same(a[k], b[k]))
                    : a === b;

    const layout = () => page.evaluate(() => window.tiler.layout());
    const shut = (id) =>
        page.evaluate((one) => window.tiler.pane('close', one), id);
    const was = await layout();

    await shut('fx-list');
    await page.click('#panereopen-fx-list');
    await page.waitForTimeout(150);

    check(same(await layout(), was),
          'a lone pane closed and reopened from the drawer is where it was, ' +
          'the same share of the same split');

    await shut('fx-paint');
    await page.evaluate(() =>
        window.tiler.pane('present', 'fx-paint', { focus: false }));
    await page.waitForTimeout(150);

    check(same(await layout(), was),
          'and presented by name, the first of its split, it is first again');

    /* Two out of a split of three: the split collapses into the one
       left, the last closed comes back as a split of two again, and the
       first closed goes back beside it. */
    await shut('fx-plot');
    await shut('fx-wide');
    await page.click('#panereopen-fx-wide');
    await page.click('#panereopen-fx-plot');
    await page.waitForTimeout(150);

    check(same(await layout(), was),
          'and two closed out of a split that collapsed come back, last ' +
          'closed first, as the split it was');

    /* Stacked: the leaf it was in, which is still there. */
    await page.evaluate(() => window.tiler.pane('setLayout', {
        dir: 'row', size: [0.5, 0.5], kids: [
            { tabs: ['fx-doc', 'fx-notes'], active: 0 },
            { tabs: ['fx-paint', 'fx-plot'] }] }));
    await shut('fx-notes');
    await page.click('#panereopen-fx-notes');
    await page.waitForTimeout(150);

    const stacked = await layout();

    check(stacked.kids[0].tabs.join() === 'fx-doc,fx-notes',
          'a pane closed out of a stack goes back into the same stack: ' +
          stacked.kids[0].tabs.join());

    /* But raised at somebody, not over what they are typing in. */
    await shut('fx-notes');
    await page.focus('#fx-text');
    await page.evaluate(() =>
        window.tiler.pane('present', 'fx-notes', { focus: false }));
    await page.waitForTimeout(150);

    const beside = await layout();

    check(!beside.kids[0].tabs.includes('fx-notes') &&
          await page.evaluate(() =>
              document.activeElement.id === 'fx-text'),
          'unless it would be raised over the text somebody is typing in');

    /* And a neighbor gone as well is no place to go back to: somewhere
       in the layout still, and nothing thrown. */
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('Alt+Digit0');
    await page.waitForTimeout(150);
    await shut('fx-list');
    await shut('fx-wide');
    await shut('fx-plot');
    await page.click('#panereopen-fx-list');
    await page.waitForTimeout(150);

    check(await page.evaluate(() =>
              document.getElementById('fx-list').checkVisibility()),
          'and where its neighbors went too, it still comes back');

    await page.keyboard.press('Alt+Digit0');
    await page.waitForTimeout(200);
    }

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
        const { createPanes } = await import('../../src/panes.js');
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
        const { createPanes } = await import('../../src/panes.js');
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

    /* ---- a screen with only a finger ----
     *
     * Wide enough, and with nothing to aim with but a finger: the
     * default `media' asks for a pointer that aims anywhere on the
     * device, and this has none, so the page stays the document.
     */
    {
    const fingers = await browser.newContext({ viewport: WIDE,
                                               hasTouch: true });
    const tablet = await fingers.newPage();

    tablet.on('pageerror', (e) => errors.push(e.message));
    await tablet.goto(`${base}?panes=1`);
    await tablet.waitForFunction(() => window.tiler !== undefined);

    check(!await tablet.evaluate(() => window.tiler.tiled()),
          'a wide screen with only a finger to point with is not tiled');

    await fingers.close();
    }

    /* ---- a phone ----
     *
     * The options for a screen the defaults were not drawn for, a second
     * set of layouts swapped in without taking the tiler down, and a
     * divider dragged by a finger rather than a mouse -- which is a
     * different gesture to the browser, and one it will take for a scroll
     * if the element does not say otherwise.
     */
    {
    /* A phone, where the browser can be one: Firefox has no mobile
       mode, and a touch screen at a phone's width is what it has. */
    const touch = await browser.newContext({ viewport: { width: 400, height: 800 },
                                             hasTouch: true,
                                             isMobile: name !== 'firefox' });
    const phone = await touch.newPage();

    phone.on('pageerror', (e) => errors.push(e.message));
    await phone.goto(`${base}?panes=0`);
    await phone.waitForFunction(() => window.tiler !== undefined);

    const narrow = await phone.evaluate(async () =>
    {
        const { createPanes } = await import('../../src/panes.js');
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

        /* Over the fixture, where a finger can reach it: the page's own
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

    /* By a finger: pressed on the divider and moved 150 pixels up.
       Only Chromium can be told to move one -- Playwright's touch
       screen taps and does nothing else -- so elsewhere it is said and
       not tested. */
    if (name !== 'chromium')
        skip('and a finger moves it as far as it moved: no touch drag ' +
             `in ${name}`);
    else
    {
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
              'and a finger moves it as far as it moved: ' +
              `${upper} to ${lower}`);
    }

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

    check(swapped.saved === 'panes:m' && swapped.back,
          'and each set is kept under its own store, the first coming ' +
          'back as it was left, and one nobody changed not written at ' +
          `all: ${swapped.saved}`);

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
        const { createPanes } = await import('../../src/panes.js');
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

    /* ---- a layout the page changed its mind about, and one it puts up
     *
     * A kept layout outlives the default it was made from: `version' is
     * how a page says so. And `setLayout', which is a preset or a link or
     * an undo -- data from somewhere, read the way a kept layout is.
     */
    {
    const own = await browser.newPage({ viewport: WIDE });

    own.on('pageerror', (e) => errors.push(e.message));
    await own.goto(`${base}?panes=0`);
    await own.waitForFunction(() => window.tiler !== undefined);

    const versioned = await own.evaluate(async () =>
    {
        const { createPanes } = await import('../../src/panes.js');
        const root = document.createElement('div');
        const kept = new Map();
        const heard = [];

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
        document.body.append(root, box('vs-a'), box('vs-b'), box('vs-c'));

        const layout = { dir: 'row', size: [0.5, 0.5], kids: [
            { tabs: ['vs-a', 'vs-b'] }, { tabs: ['vs-c'] }] };
        const old = { tabs: ['vs-c', 'vs-b'], active: 0 };

        const make = (version) => createPanes({
            root, catalog: ['vs-a', 'vs-b', 'vs-c'],
            mode: 'm', layouts: { m: layout }, version,
            on: true, media: 'all', param: 'versioned',
            storage: { getItem: (k) => kept.get(k) ?? null,
                       setItem: (k, v) => kept.set(k, v),
                       removeItem: (k) => kept.delete(k) },
            onLayout: (tree) => heard.push(tree),
        });

        const tabsOf = (tree) => JSON.stringify(
            tree.tabs ?? tree.kids.map((k) => k.tabs));

        /* Kept before the page had a version at all. */
        kept.set('panes:m', JSON.stringify(old));

        let panes = make(undefined);

        const unversioned = tabsOf(panes.layout());

        panes.destroy();
        panes = make(2);

        const fresh = tabsOf(panes.layout());

        panes.close('vs-b');

        const closed = tabsOf(panes.layout());
        const written = JSON.parse(kept.get('panes:m'));

        panes.destroy();
        panes = make(2);

        const same = tabsOf(panes.layout());

        panes.destroy();
        panes = make(3);

        const newer = tabsOf(panes.layout());

        /* And a layout put up by the page: a pane it does not have is
           dropped, and a tree that is no layout is refused. */
        const told = heard.length;
        const put = panes.setLayout({ dir: 'col', size: [1, 2], kids: [
            { tabs: ['vs-c', 'vs-nowhere'] },
            { tabs: ['vs-b', 'vs-a'], active: 1 }] });
        const after = panes.layout();
        const front = document.querySelector(
            '#panetab-vs-a[aria-selected="true"]') !== null;
        const heardPut = heard.length - told;
        const stored = tabsOf(JSON.parse(kept.get('panes:m')).layout);
        const refused = [
            panes.setLayout({ dir: 'row', size: [1], kids: [] }),
            panes.setLayout(null),
            panes.setLayout({ tabs: ['vs-nowhere'] }),
        ];
        const untouched = tabsOf(panes.layout()) === tabsOf(after);

        panes.destroy();
        root.remove();

        return { unversioned, fresh, written, closed, same, newer,
                 put, after: tabsOf(after), front, heardPut, stored,
                 refused, untouched, heardAfter: heard.length - told,
                 want: { layout: tabsOf(layout), old: tabsOf(old) } };
    });

    check(versioned.unversioned === versioned.want.old,
          'with no version, a kept layout comes back as before');

    check(versioned.fresh === versioned.want.layout,
          'and once the page has one, a layout kept without it is not ' +
          `read back: ${versioned.fresh}`);

    check(versioned.written.version === 2 &&
          versioned.written.layout !== undefined,
          'what is kept is kept with the version on it');

    check(versioned.same !== versioned.want.layout &&
          versioned.same === versioned.closed,
          `and read back under the same one: ${versioned.same}`);

    check(versioned.newer === versioned.want.layout,
          `and not under the next: ${versioned.newer}`);

    check(versioned.put &&
          versioned.after === '[["vs-c"],["vs-b","vs-a"]]' &&
          versioned.front,
          'setLayout puts a layout up, dropping a pane the page does not ' +
          `have: ${versioned.after}`);

    check(versioned.heardPut === 1 && versioned.stored === versioned.after,
          'and it is kept and told of like any other change');

    check(versioned.refused.every((r) => r === false) &&
          versioned.untouched && versioned.heardAfter === 1,
          'and a tree that is no layout is refused, leaving the one ' +
          `there: ${versioned.refused}`);

    /* ---- a strip is a row of places ----
     *
     * By the mouse, since this is about where a pointer is: a tab let go
     * over a strip goes between the two tabs either side of it, from its
     * own leaf or another. Let go over its own leaf it stays where it
     * is. And Escape takes a drag back.
     */
    const heard = await own.evaluate(async () =>
    {
        const { createPanes } = await import('../../src/panes.js');
        const root = document.createElement('div');
        const box = (id) =>
        {
            const el = document.createElement('section');

            el.id = id;
            el.dataset.pane = '';
            el.dataset.paneMin = '40';
            el.dataset.paneTitle = id.slice(3).toUpperCase().repeat(6);

            return el;
        };

        Object.assign(root.style, { position: 'fixed', inset: '0',
                                    zIndex: '10', background: 'white',
                                    display: 'flex',
                                    flexDirection: 'column' });
        document.body.append(root, box('st-a'), box('st-b'), box('st-c'),
                             box('st-d'));

        window.stripHeard = [];
        window.stripPanes = createPanes({
            root, catalog: ['st-a', 'st-b', 'st-c', 'st-d'],
            mode: 'm', on: true, media: 'all', param: 'strip',
            layouts: { m: { dir: 'row', size: [0.5, 0.5], kids: [
                { tabs: ['st-a', 'st-b', 'st-c'] }, { tabs: ['st-d'] }] } },
            storage: { getItem: () => null, setItem: () => {},
                       removeItem: () => {} },
            onLayout: (tree) => window.stripHeard.push(tree),
        });

        return true;
    });

    const strips = () => own.evaluate(() =>
    {
        const tree = window.stripPanes.layout();

        return JSON.stringify(tree.tabs ? [tree.tabs]
                                        : tree.kids.map((k) => k.tabs));
    });
    const centerOf = async (sel, fx = 0.5, fy = 0.5) =>
    {
        const b = await own.locator(sel).boundingBox();

        return { x: b.x + b.width * fx, y: b.y + b.height * fy };
    };
    let start = null;

    const hold = async (sel) =>
    {
        start = await centerOf(sel);

        await own.mouse.move(start.x, start.y);
        await own.mouse.down();
    };

    /* Measured once the drag has begun, and not before: a drag shows
       the drawer, which is a row above the layout that was not there. */
    const toward = async (sel, fx, fy) =>
    {
        await own.mouse.move(start.x + 8, start.y, { steps: 2 });

        const p = await centerOf(sel, fx, fy);

        await own.mouse.move(p.x, p.y, { steps: 10 });
    };
    const drop = async () =>
    {
        await own.mouse.up();
        await own.waitForTimeout(100);
    };

    /* Past the middle of the last tab: after it. */
    await hold('#panetab-st-a');
    await toward('#panetab-st-c', 0.8);

    const slot = await own.evaluate(() =>
    {
        const hint = document.querySelector('.panedrop');
        const c = document.getElementById('panetab-st-c')
                          .getBoundingClientRect();
        const h = hint.getBoundingClientRect();

        return { shown: !hint.hidden && hint.classList.contains('paneslot'),
                 at: Math.round(h.left + h.width / 2 - c.right) };
    });

    await drop();

    const reordered = await strips();

    /* Before the first, from the other leaf. */
    await hold('#panetab-st-d');
    await toward('#panetab-st-b', 0.2);
    await drop();

    const moved = await strips();

    /* And over its own leaf's middle, where it already is: nowhere new,
       and in front. */
    const told = await own.evaluate(() => window.stripHeard.length);

    await hold('#panetab-st-c');
    await toward('.paneleaf:has(#panetab-st-c)', 0.5, 0.6);
    await drop();

    const stayed = await strips();
    const raised = await own.evaluate(() =>
        document.getElementById('panetab-st-c')
                .getAttribute('aria-selected'));

    /* And again, now that it is in front: nothing at all has changed. */
    await hold('#panetab-st-c');
    await toward('.paneleaf:has(#panetab-st-c)', 0.5, 0.6);
    await drop();

    /* And Escape, half way through: the hint goes, nothing moves, and
       letting go back over the tab is not a click on it. */
    const quiet = await own.evaluate(() => window.stripHeard.length);

    await hold('#panetab-st-a');
    await toward('.paneleaf:has(#panetab-st-c)', 0.05, 0.5);
    await own.keyboard.press('Escape');

    const hidden = await own.evaluate(() =>
        document.querySelector('.panedrop').hidden &&
        !document.querySelector('.panedragging'));

    const back = await centerOf('#panetab-st-a');

    await own.mouse.move(back.x, back.y, { steps: 5 });
    await drop();

    const escaped = {
        hidden,
        layout: await strips(),
        front: await own.evaluate(() =>
            document.getElementById('panetab-st-a')
                    .getAttribute('aria-selected')),
        heard: await own.evaluate(() => window.stripHeard.length) - quiet,
    };

    check(heard && slot.shown && Math.abs(slot.at) <= 2,
          'a tab over a strip is marked with a line between two tabs: ' +
          `${slot.shown} ${slot.at}`);

    check(reordered === '[["st-b","st-c","st-a"],["st-d"]]',
          `and let go there it goes there: ${reordered}`);

    check(moved === '[["st-d","st-b","st-c","st-a"]]',
          `from another leaf too, before the first: ${moved}`);

    check(stayed === moved && raised === 'true',
          'let go over its own leaf, a tab stays where it was, in front: ' +
          `${stayed}`);

    check(await own.evaluate(() => window.stripHeard.length) - told === 1,
          'and it is told of once, for being put in front, and not again ' +
          'for a drop that changed nothing');

    check(escaped.hidden && escaped.layout === moved &&
          escaped.front === 'false' && escaped.heard === 0,
          'Escape takes a drag back: nothing moves, nothing is raised, ' +
          `and nobody is told: ${JSON.stringify(escaped)}`);

    await own.evaluate(() => window.stripPanes.destroy());
    await own.close();
    }

    /* ---- right to left ----
     *
     * A split's first child is on the right in a page that reads that
     * way, so everything that turns a direction on the screen into a
     * place in the tree has to know which way the page reads: the arrows
     * along a strip, a divider dragged or moved by the keys, and a tab
     * dropped on an edge.
     */
    {
    const own = await browser.newPage({ viewport: WIDE });

    own.on('pageerror', (e) => errors.push(e.message));
    await own.goto(`${base}?panes=0`);
    await own.waitForFunction(() => window.tiler !== undefined);

    await own.evaluate(async () =>
    {
        const { createPanes } = await import('../../src/panes.js');
        const root = document.createElement('div');
        const box = (id) =>
        {
            const el = document.createElement('section');

            el.id = id;
            el.dataset.pane = '';
            el.dataset.paneMin = '40';

            return el;
        };

        root.dir = 'rtl';
        Object.assign(root.style, { position: 'fixed', inset: '0',
                                    zIndex: '10', background: 'white',
                                    display: 'flex',
                                    flexDirection: 'column' });
        document.body.append(root, box('rl-a'), box('rl-b'), box('rl-e'),
                             box('rl-c'), box('rl-d'));

        window.rtlPanes = createPanes({
            root, catalog: ['rl-a', 'rl-b', 'rl-e', 'rl-c', 'rl-d'],
            mode: 'm', on: true, media: 'all', param: 'rtl',
            layouts: { m: { dir: 'row', size: [0.5, 0.5], kids: [
                { tabs: ['rl-a', 'rl-b', 'rl-e'] },
                { tabs: ['rl-c', 'rl-d'] }] } },
            storage: { getItem: () => null, setItem: () => {},
                       removeItem: () => {} },
        });
    });

    const rect = (sel) => own.locator(sel).boundingBox();
    const leafOf = (id) => `.paneleaf:has(#panetab-${id})`;

    /* The first leaf is on the right. The arrow pointing left, along
       its strip, is the next tab. */
    const first = await rect(leafOf('rl-a'));
    const second = await rect(leafOf('rl-c'));

    await own.focus('#panetab-rl-a');
    await own.keyboard.press('ArrowLeft');

    const along = await own.evaluate(() => document.activeElement.id);

    await own.keyboard.press('ArrowRight');

    /* A divider dragged 100px to the right makes the right-hand leaf,
       which is the first, 100px narrower. */
    const bar = await rect('.panesplit');

    await own.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
    await own.mouse.down();
    await own.mouse.move(bar.x + bar.width / 2 + 100, bar.y + bar.height / 2,
                         { steps: 10 });
    await own.mouse.up();

    const dragged = (await rect(leafOf('rl-a'))).width;

    /* And the arrow keys on it the same way round. */
    await own.focus('.panesplit');
    await own.keyboard.press('ArrowLeft');

    const keyed = (await rect(leafOf('rl-a'))).width;

    /* A tab dropped on the left edge of the right-hand leaf lands on the
       left of it, and is shown landing there. */
    const tab = await rect('#panetab-rl-d');

    await own.mouse.move(tab.x + tab.width / 2, tab.y + tab.height / 2);
    await own.mouse.down();
    await own.mouse.move(tab.x + tab.width / 2 + 10, tab.y + tab.height / 2,
                         { steps: 2 });

    const target = await rect(leafOf('rl-a'));

    await own.mouse.move(target.x + 5, target.y + target.height / 2,
                         { steps: 10 });

    const hinted = await own.evaluate(() =>
    {
        const h = document.querySelector('.panedrop').getBoundingClientRect();
        const leaf = document.getElementById('panetab-rl-a')
                             .closest('.paneleaf').getBoundingClientRect();

        return { ok: Math.abs(h.left - leaf.left) <= 2 &&
                     Math.abs(h.width - leaf.width / 2) <= 6,
                 h: [h.left, h.width], leaf: [leaf.left, leaf.width] };
    });

    await own.mouse.up();
    await own.waitForTimeout(100);

    const d = await rect(leafOf('rl-d'));
    const a = await rect(leafOf('rl-a'));

    /* And a pane moved off the right edge by the keys, with nothing to
       its right: it goes right. */
    await own.click('#panetab-rl-a');
    await own.keyboard.press('Alt+Shift+ArrowRight');
    await own.waitForTimeout(100);

    const keyedOff = { a: await rect(leafOf('rl-a')),
                       b: await rect(leafOf('rl-b')) };

    check(first.x > second.x && along === 'panetab-rl-b',
          'right to left, the arrow pointing left along a strip is the ' +
          `next tab: ${along}`);

    check(Math.abs(first.width - 100 - dragged) <= 2,
          'and a divider dragged right narrows the leaf on its right: ' +
          `${Math.round(first.width)} to ${Math.round(dragged)}`);

    check(Math.abs(keyed - dragged - 16) <= 2,
          'and the arrow pointing left widens it: ' +
          `${Math.round(dragged)} to ${Math.round(keyed)}`);

    check(hinted.ok && d.x + d.width <= a.x + 1,
          'and a tab dropped on a left edge is shown and put on the left: ' +
          `${JSON.stringify(hinted)} ${Math.round(d.x)} ${Math.round(a.x)}`);

    check(keyedOff.a.x > keyedOff.b.x,
          'and Alt Shift and the arrow pointing right splits a pane off ' +
          `to the right: ${Math.round(keyedOff.a.x)} ` +
          `${Math.round(keyedOff.b.x)}`);

    await own.evaluate(() => window.rtlPanes.destroy());
    await own.close();
    }

    /* ---- panes the page adds, and takes away ----
     *
     * An element the page puts into the document once it is up, taken on
     * as a catalog entry would have been; a place kept for it across a
     * visit when `later' says it will come; and a pane that is no longer
     * one, its element handed back where it was.
     */
    {
    const own = await browser.newPage({ viewport: WIDE });

    own.on('pageerror', (e) => errors.push(e.message));
    await own.goto(`${base}?panes=0`);
    await own.waitForFunction(() => window.tiler !== undefined);

    const grown = await own.evaluate(async () =>
    {
        const { createPanes } = await import('../../src/panes.js');
        const wait = (ms) => new Promise((go) => setTimeout(go, ms));
        const root = document.createElement('div');
        const kept = new Map();
        const shows = [];
        const heard = [];
        const box = (id, mark = true) =>
        {
            const el = document.createElement('section');

            el.id = id;

            if (mark)
                el.dataset.pane = '';

            el.dataset.paneMin = '40';

            return el;
        };

        Object.assign(root.style, { position: 'fixed', inset: '0',
                                    zIndex: '10', background: 'white',
                                    display: 'flex',
                                    flexDirection: 'column' });

        const home = document.createElement('div');

        document.body.append(root, home);
        home.append(box('ad-a'), box('ad-b'));

        const make = (storage) => createPanes({
            root, catalog: ['ad-a', 'ad-b'], mode: 'm',
            layouts: { m: { dir: 'row', size: [0.5, 0.5], kids: [
                { tabs: ['ad-a'] }, { tabs: ['ad-b'] }] } },
            on: true, media: 'all', param: 'grown',
            later: (id) => id.startsWith('ad-f'),
            storage: storage ?? {
                getItem: (k) => kept.get(k) ?? null,
                setItem: (k, v) => kept.set(k, v),
                removeItem: (k) => kept.delete(k) },
            onShow: (id, on) => shows.push(`${id} ${on}`),
            onLayout: (tree) => heard.push(tree),
        });
        const tabsOf = (tree) => JSON.stringify(
            tree.tabs ?? tree.kids.map((k) => k.tabs));
        const leaves = () => [...root.querySelectorAll('.paneleaf')]
            .filter((l) => l.checkVisibility())
            .sort((x, y) => x.getBoundingClientRect().left -
                            y.getBoundingClientRect().left)
            .map((l) => [...l.querySelectorAll('.panetab')]
                .map((t) => t.id.replace(/^panetab-/, '')));

        let panes = make();

        /* Refused: nothing there, not marked, already a pane. */
        const stray = box('ad-f9');
        const plain = box('ad-f8', false);

        home.append(plain);

        const refused = [panes.add('ad-f9'), panes.add('ad-f8'),
                         panes.add('ad-a')];

        plain.remove();

        /* Beside a pane, in front, with the focus, and heard. */
        home.append(box('ad-f1'));

        const told = heard.length;
        const added = panes.add('ad-f1', { near: 'ad-b' });
        const beside = leaves();
        const focused = document.activeElement.id;
        const shownNow = shows.includes('ad-f1 true');
        const heardAdd = heard.length - told;

        /* Its own leaf in the middle, and a visit later, before the page
           has added it again: its place is kept and not drawn, and
           adding it puts it back there -- without the focus, asked. */
        panes.setLayout({ dir: 'row', size: [1, 1, 1], kids: [
            { tabs: ['ad-a'] }, { tabs: ['ad-f1'] }, { tabs: ['ad-b'] }] });
        panes.destroy();
        panes = make();

        const waiting = leaves();

        document.body.focus();
        panes.add('ad-f1', { focus: false });

        const back = leaves();
        const kept3 = document.activeElement.id !== 'panetab-ad-f1';

        /* And a server slower than the page: the files come back before
           the layout does, and the layout is still the one put up. */
        panes.destroy();

        const saved = kept.get('panes:m');

        panes = make({
            getItem: () => wait(150).then(() => saved),
            setItem: () => {}, removeItem: () => {} });
        panes.add('ad-f1', { focus: false, keep: true });

        const early = leaves();

        await wait(300);

        const late = leaves();

        /* Kept, and put away by somebody, it stays put away through a
           reset. */
        document.getElementById('paneshut-ad-f1').click();
        panes.reset();

        const afterReset = leaves();
        const inDrawer = root.querySelector('#panereopen-ad-f1') !== null;

        /* And taken away: the element back where it was, told it has left
           the screen, the layout without it. */
        panes.present('ad-f1');
        shows.length = 0;

        const before = heard.length;
        const el = panes.remove('ad-f1');
        const handed = {
            same: el === document.getElementById('ad-f1'),
            home: el?.parentElement === home,
            told: shows.includes('ad-f1 false'),
            gone: !JSON.stringify(panes.layout()).includes('ad-f1'),
            drawer: root.querySelector('#panereopen-ad-f1') === null,
            heard: heard.length - before,
            again: panes.remove('ad-f1'),
            visible: panes.visible('ad-f1'),
        };

        /* And the same id taken on again. */
        const readded = panes.add('ad-f1') && leaves().flat().includes('ad-f1');

        panes.destroy();

        const whole = el.parentElement === home &&
                      document.getElementById('ad-a').parentElement === home;

        root.remove();
        home.remove();
        void stray;

        return { refused, added, beside, focused, shownNow, heardAdd,
                 waiting, back, kept3, early, late, afterReset, inDrawer,
                 handed, readded, whole };
    });

    check(grown.refused.every((r) => r === false),
          'add refuses an element not in the document, one not marked, ' +
          'and a pane it already has');

    check(grown.added && JSON.stringify(grown.beside) ===
              '[["ad-a"],["ad-b","ad-f1"]]' &&
          grown.focused === 'panetab-ad-f1' && grown.shownNow &&
          grown.heardAdd === 1,
          'add puts a pane beside the one named, in front, with the focus, ' +
          `and says so: ${JSON.stringify(grown.beside)}`);

    check(JSON.stringify(grown.waiting) === '[["ad-a"],["ad-b"]]' &&
          JSON.stringify(grown.back) === '[["ad-a"],["ad-f1"],["ad-b"]]' &&
          grown.kept3,
          'a place `later\' kept is not drawn until the pane is added, and ' +
          `then it is where it was: ${JSON.stringify(grown.back)}`);

    check(grown.early.length === 2 && grown.early.flat().includes('ad-f1') &&
          JSON.stringify(grown.late) === '[["ad-a"],["ad-f1"],["ad-b"]]',
          'and a pane added before a kept layout arrives does not stop it ' +
          `being put up: ${JSON.stringify(grown.late)}`);

    check(!grown.afterReset.flat().includes('ad-f1') && grown.inDrawer,
          'a pane added to be kept, put away by somebody, stays in the ' +
          'drawer through a reset');

    check(grown.handed.same && grown.handed.home && grown.handed.told &&
          grown.handed.gone && grown.handed.drawer &&
          grown.handed.heard === 1 && grown.handed.again === null &&
          !grown.handed.visible,
          'remove hands the element back where it was, off the screen, ' +
          `out of the layout and the drawer: ${JSON.stringify(grown.handed)}`);

    check(grown.readded && grown.whole,
          'and the same id can be added again, and destroy() hands back ' +
          'the rest');

    await own.close();
    }

    /* ---- how an added pane ends ----
     *
     * What the page adds is ephemeral unless it asks to be kept: a
     * person's close does not put it in the drawer, it asks the page,
     * which ends it with `remove' or does not. A page that has not said
     * how offers no way to close one at all.
     */
    {
    const own = await browser.newPage({ viewport: WIDE });

    own.on('pageerror', (e) => errors.push(e.message));
    await own.goto(`${base}?panes=0`);
    await own.waitForFunction(() => window.tiler !== undefined);

    await own.evaluate(async () =>
    {
        const { createPanes } = await import('../../src/panes.js');
        const root = document.createElement('div');
        const home = document.createElement('div');
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
        document.body.append(root, home);
        home.append(box('ep-a'), box('ep-x'), box('ep-y'), box('ep-z'));

        window.epAsked = [];
        window.epKept = new Map();
        window.epLater = new Set(['ep-gone']);
        window.epRoot = root;
        window.epMake = (discard) => createPanes({
            root, catalog: ['ep-a'], mode: 'm', on: true, media: 'all',
            param: 'ephemeral',
            later: (id) => window.epLater.has(id),
            storage: { getItem: (k) => window.epKept.get(k) ?? null,
                       setItem: (k, v) => window.epKept.set(k, v),
                       removeItem: (k) => window.epKept.delete(k) },
            ...(discard ? { onDiscard: (id) =>
            {
                window.epAsked.push(id);

                if (id !== 'ep-y')
                    window.epPanes.remove(id)?.remove();
            } } : {}),
        });
    });

    /* No onDiscard: nothing a person does closes it. */
    const none = await own.evaluate(() =>
    {
        const panes = window.epMake(false);

        panes.add('ep-x');

        const cross = document.getElementById('paneshut-ep-x') !== null;

        document.getElementById('panetab-ep-x').focus();
        document.getElementById('panetab-ep-x').dispatchEvent(
            new KeyboardEvent('keydown', { code: 'KeyW', altKey: true,
                                           bubbles: true }));
        panes.close('ep-x');

        const still = JSON.stringify(panes.layout()).includes('ep-x');
        const listed = panes.panes();

        panes.destroy();

        return { cross, still, listed };
    });

    check(!none.cross && none.still,
          'an added pane on a page with no onDiscard has no cross, and ' +
          'neither Alt W nor close() ends it');

    check(JSON.stringify(none.listed.map((p) => [p.id, p.kind, p.where])) ===
              '[["ep-a","lasting","behind"],["ep-x","ephemeral","front"]]',
          'panes() lists every pane with its kind and where it is: ' +
          JSON.stringify(none.listed));

    /* With onDiscard: the page is asked, and ends it or does not. */
    const asked = await own.evaluate(() =>
    {
        window.epPanes = window.epMake(true);

        const panes = window.epPanes;

        panes.add('ep-x', { near: 'ep-a' });
        panes.add('ep-y', { near: 'ep-a' });
        panes.add('ep-z', { near: 'ep-a' });

        const el = document.getElementById('ep-x');

        panes.present('ep-x');
        document.getElementById('paneshut-ep-x').click();

        const ended = {
            asked: [...window.epAsked],
            gone: !JSON.stringify(panes.layout()).includes('ep-x') &&
                  !el.isConnected,
            focus: document.activeElement.classList.contains('panetab'),
            drawer: window.epRoot.querySelector('.paneclosed') === null,
        };

        /* A page that says no: nothing moves. */
        panes.present('ep-y');
        document.getElementById('panetab-ep-y').dispatchEvent(
            new KeyboardEvent('keydown', { code: 'KeyW', altKey: true,
                                           bubbles: true }));

        const vetoed = JSON.stringify(panes.layout()).includes('ep-y') &&
                       window.epAsked.at(-1) === 'ep-y';

        /* And close() from the page asks the same way. */
        panes.close('ep-z');

        const closedByPage = window.epAsked.at(-1) === 'ep-z' &&
            !JSON.stringify(panes.layout()).includes('ep-z');

        return { ended, vetoed, closedByPage };
    });

    check(JSON.stringify(asked.ended.asked) === '["ep-x"]' &&
          asked.ended.gone && asked.ended.focus && asked.ended.drawer,
          'its cross asks the page, which ends it; the keyboard stays on ' +
          `a tab and nothing goes to the drawer: ${JSON.stringify(asked.ended)}`);

    check(asked.vetoed,
          'Alt W asks too, and a page that does not end it keeps it');

    check(asked.closedByPage,
          'and close() on one asks the page rather than using the drawer');

    /* A place kept for a pane still to come is let go of once `later'
       no longer says it will come. */
    const trimmed = await own.evaluate(() =>
    {
        const panes = window.epPanes;

        panes.setLayout({ dir: 'row', size: [1, 1], kids: [
            { tabs: ['ep-a'] }, { tabs: ['ep-gone'] }] });

        const before = window.epKept.get('panes:m').includes('ep-gone');

        window.epLater.delete('ep-gone');

        /* A change, so that something is kept: ep-y went in front of
           ep-a when the layout came up without it. */
        panes.present('ep-a');

        const after = window.epKept.get('panes:m').includes('ep-gone');

        panes.destroy();

        return { before, after };
    });

    check(trimmed.before && !trimmed.after,
          'a place kept for a pane still to come is let go of when later() ' +
          'stops saying it will come');

    await own.close();
    }

        /* ---- nobody looking ----
     *
     * The untiled page is a scroll, and a pane scrolled out of it is as
     * out of sight as one behind a tab; a window in the background is
     * out of sight whatever is in it. onShow says so in both, and says
     * it from the start rather than yes and then no.
     */
    {
    const own = await browser.newPage({ viewport: NARROW });

    own.on('pageerror', (e) => errors.push(e.message));
    await own.goto(`${base}?panes=0`);
    await own.waitForFunction(() => window.tiler !== undefined);

    const looked = await own.evaluate(async () =>
    {
        const { createPanes } = await import('../../src/panes.js');
        const wait = (ms) => new Promise((go) => setTimeout(go, ms));
        const told = [];
        const root = document.createElement('div');

        document.body.replaceChildren(root);
        window.scrollTo(0, 0);

        for (const id of ['ns-top', 'ns-low'])
        {
            const el = document.createElement('section');

            el.id = id;
            el.dataset.pane = '';
            el.style.height = '1500px';
            document.body.append(el);
        }

        const panes = createPanes({
            root, catalog: ['ns-top', 'ns-low'], mode: 'm',
            on: false, param: 'unseen',
            storage: { getItem: () => null, setItem: () => {},
                       removeItem: () => {} },
            onShow: (id, on) => told.push(`${id} ${on}`),
        });

        const first = [...told];

        await wait(200);

        const settled = told.length === first.length;

        window.scrollTo(0, 1800);
        await wait(300);

        const scrolled = told.slice(first.length);
        const asked = [panes.visible('ns-top'), panes.visible('ns-low')];

        /* The window put behind another. */
        const was = told.length;

        Object.defineProperty(document, 'hidden',
                              { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));

        const away = told.slice(was);

        delete document.hidden;
        document.dispatchEvent(new Event('visibilitychange'));

        const back = told.slice(was + away.length);

        panes.destroy();

        return { first, settled, scrolled, asked, away, back };
    });

    check(JSON.stringify(looked.first) ===
              '["ns-top true","ns-low false"]' && looked.settled,
          'untiled, a pane below the fold is told it is out of sight from ' +
          `the start, and not told otherwise first: ${looked.first}`);

    check(JSON.stringify(looked.scrolled) ===
              '["ns-top false","ns-low true"]' &&
          !looked.asked[0] && looked.asked[1],
          'and scrolled to, the two change places: ' +
          `${looked.scrolled}`);

    check(JSON.stringify(looked.away) === '["ns-low false"]' &&
          JSON.stringify(looked.back) === '["ns-low true"]',
          'and a window in the background has nothing on the screen: ' +
          `${looked.away} then ${looked.back}`);

    await own.close();
    }

    /* ---- a renderer that falls over ----
     *
     * Chromium's renderer has crashed outright -- the whole tab gone --
     * on a `moveBefore' into a leaf one of whose panes was hidden, or
     * shown, a moment before or after. Until the browser is fixed, and
     * the fix is what people have, mullion has to not do that. Each
     * case on a page of its own, since a crash takes the page with it.
     */
    {
    const survives = async (steps) =>
    {
        const own = await browser.newPage({ viewport: WIDE });
        let crashed = false;

        own.on('crash', () => { crashed = true; });
        own.on('pageerror', (e) => errors.push(e.message));
        await own.goto(base);
        await own.waitForFunction(() => window.tiler !== undefined);

        try
        {
            await steps(own);
            await own.waitForTimeout(150);
            await own.evaluate(() => document.body.offsetWidth);
        }
        catch
        {
            crashed = true;
        }

        await own.close().catch(() => {});

        return !crashed;
    };

    /* A tab let go before the tab in front of another leaf's strip. */
    const before = (from, onto) => async (own) =>
    {
        const a = await own.locator(from).boundingBox();

        await own.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
        await own.mouse.down();
        await own.mouse.move(a.x + a.width / 2 + 20, a.y + a.height / 2,
                             { steps: 3 });

        const t = await own.locator(onto).boundingBox();

        await own.mouse.move(t.x + 3, t.y + t.height / 2, { steps: 8 });
        await own.mouse.up();
    };

    check(await survives(before('#panetab-fx-doc', '#panetab-fx-paint')),
          'a tab dropped before the front tab of another strip does not ' +
          'take the renderer down');

    check(await survives(before('#panetab-fx-list', '#panetab-fx-wide')),
          'nor another pair of them');

    /* A pane whose mode goes down and comes back up, in a leaf it
       shares. */
    check(await survives(async (own) =>
    {
        await own.evaluate(async () =>
        {
            const wait = (ms) => new Promise((go) => setTimeout(go, ms));
            const t = window.tiler;

            t.pane('setLayout', { tabs: ['fx-only-one', 'fx-paint'],
                                  active: 0 });
            t.pane('available', 'fx-only-one', false);
            await wait(50);
            t.pane('available', 'fx-only-one', true);
            await wait(50);
        });
    }), 'nor a pane in a shared leaf made unavailable and available again');
    }

    /* ---- what a review of 0.3.0 found ----
     *
     * Each on a page of its own, over a root and panes made for it:
     * `rv.make(ids, options)' puts up a tiler over sections with those
     * ids, and `rv.async()' is a storage whose answers wait to be let go.
     */
    {
    const sandbox = async () =>
    {
        const own = await browser.newPage({ viewport: WIDE });

        own.on('pageerror', (e) => errors.push(e.message));
        await own.goto(`${base}?panes=0`);
        await own.waitForFunction(() => window.tiler !== undefined);
        await own.evaluate(async () =>
        {
            const { createPanes } = await import('../../src/panes.js');
            const root = document.createElement('div');
            const home = document.createElement('div');

            Object.assign(root.style, { position: 'fixed', inset: '0',
                                        zIndex: '10', background: 'white',
                                        display: 'flex',
                                        flexDirection: 'column' });
            document.body.append(root, home);

            window.rv = {
                root, home,
                heard: [],
                box: (id) =>
                {
                    const el = document.createElement('section');

                    el.id = id;
                    el.dataset.pane = '';
                    el.dataset.paneMin = '40';
                    el.dataset.paneTitle = id.toUpperCase();
                    home.append(el);

                    return el;
                },
                make: (ids, opts) =>
                {
                    ids.forEach((id) => window.rv.box(id));
                    window.rv.panes = createPanes({
                        root, catalog: ids, mode: 'm', on: true,
                        media: 'all', param: 'review',
                        onLayout: (t) => window.rv.heard.push(t),
                        ...opts,
                    });

                    return window.rv.panes;
                },
                /* A storage that answers when told to. */
                async: (kept = new Map()) =>
                {
                    const held = [];
                    const writes = [];

                    return {
                        kept, held, writes,
                        release: () => held.splice(0).forEach((go) => go()),
                        getItem: (k) => new Promise((go) =>
                            held.push(() => go(kept.get(k) ?? null))),
                        setItem: (k, v) =>
                        {
                            writes.push(k);
                            kept.set(k, v);
                        },
                        removeItem: (k) => { kept.delete(k); },
                    };
                },
                tabs: () => JSON.stringify(((t) => t.tabs ? [t.tabs]
                    : t.kids.map((k) => k.tabs ?? k.kids.map((j) => j.tabs)))(
                        window.rv.panes.layout())),
                wait: (ms) => new Promise((go) => setTimeout(go, ms)),
            };
        });

        return own;
    };

    /* A key on a tab that is not an arrow is not the strip's. */
    let own = await sandbox();

    await own.evaluate(() => window.rv.make(['k-a', 'k-b'], {
        layouts: { m: { tabs: ['k-a', 'k-b'], active: 1 } } }));

    for (const key of ['Enter', ' ', 'x', 'Tab'])
    {
        await own.focus('#panetab-k-b');
        await own.keyboard.press(key);
    }

    const keyed = await own.evaluate(() => ({
        active: window.rv.panes.layout().active,
        shown: document.getElementById('k-b').checkVisibility(),
        left: document.activeElement.id !== 'panetab-k-b',
    }));

    check(keyed.active === 1 && keyed.shown && keyed.left,
          'Enter, Space, a letter and Tab on a tab leave its leaf as it ' +
          `was, and Tab leaves the strip: ${JSON.stringify(keyed)}`);

    await own.close();

    /* A tab alone in its leaf, let go over its own strip. */
    own = await sandbox();
    await own.evaluate(() => window.rv.make(['s-a', 's-b'], {
        layouts: { m: { dir: 'row', size: [0.5, 0.5], kids: [
            { tabs: ['s-a'] }, { tabs: ['s-b'] }] } } }));

    const lone = await own.locator('#panetab-s-a').boundingBox();

    await own.mouse.move(lone.x + 10, lone.y + lone.height / 2);
    await own.mouse.down();
    await own.mouse.move(lone.x + 30, lone.y + lone.height / 2,
                         { steps: 4 });

    /* Measured once the drag has begun: it shows the drawer, a row above
       the layout that was not there. */
    const strip = await own.evaluate(() =>
    {
        const r = document.getElementById('panetab-s-a')
                          .closest('.panetabs').getBoundingClientRect();

        return { x: r.right - 30, y: r.top + r.height / 2 };
    });

    await own.mouse.move(strip.x, strip.y, { steps: 3 });
    await own.mouse.up();
    await own.waitForTimeout(100);

    check(await own.evaluate(() => window.rv.tabs()) ===
              '[["s-a"],["s-b"]]',
          'a tab alone in its leaf, let go over its own strip, stays ' +
          'where it is');

    /* A render in the middle of a drag: the drag still ends, and Escape
       is the page's again. */
    await own.evaluate(() =>
    {
        window.escapes = 0;
        addEventListener('keydown', (e) =>
        {
            if (e.key === 'Escape')
                window.escapes++;
        });
    });

    const t = await own.locator('#panetab-s-a').boundingBox();

    await own.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
    await own.mouse.down();
    await own.mouse.move(t.x + t.width / 2 + 40, t.y + 120, { steps: 5 });
    await own.evaluate(() => window.rv.panes.setTitle('s-b', 'Renamed'));
    await own.mouse.move(t.x + t.width / 2 + 60, t.y + 140, { steps: 3 });
    await own.mouse.up();
    await own.waitForTimeout(100);

    for (let i = 0; i < 3; i++)
        await own.keyboard.press('Escape');

    const after = await own.evaluate(() => ({
        escapes: window.escapes,
        drag: window.rv.root.classList.contains('panedrag'),
    }));

    check(after.escapes === 3 && !after.drag,
          'a render in the middle of a drag leaves no drag behind, and ' +
          `Escape reaching the page: ${JSON.stringify(after)}`);

    await own.close();

    /* A slow storage, and a page busy while it answers. */
    own = await sandbox();

    const slow = await own.evaluate(async () =>
    {
        const { rv } = window;
        const L = { dir: 'row', size: [0.5, 0.5], kids: [
            { tabs: ['w-b'] }, { tabs: ['w-a', 'w-c'] }] };
        const store = rv.async(new Map([['panes:m', JSON.stringify(L)]]));

        /* 1. A pane added before the kept layout arrives, where it keeps
              a place: what is kept is what is on the screen. */
        rv.box('w-c');

        const panes = rv.make(['w-a', 'w-b'], {
            storage: store, later: (id) => id === 'w-c',
            layouts: { m: { tabs: ['w-a', 'w-b'] } } });

        panes.add('w-c', { focus: false });

        const early = store.writes.length;

        store.release();
        await rv.wait(20);

        const shown = rv.tabs();
        const stored = JSON.stringify(JSON.parse(
            store.kept.get('panes:m')).kids.map((k) => k.tabs));
        const told = rv.heard.at(-1);
        const toldTabs = JSON.stringify(told.kids.map((k) => k.tabs));

        panes.destroy();

        /* 2. setLayouts while a kept layout is on its way writes nothing
              over it. */
        rv.root.replaceChildren();

        const store2 = rv.async(new Map([['panes:m', JSON.stringify(L)]]));
        const panes2 = rv.make([], {
            catalog: ['w-a', 'w-b', 'w-c'], storage: store2 });

        panes2.setLayouts({ m: { tabs: ['w-a', 'w-b', 'w-c'] } },
                          { store: 'side' });

        const kept2 = store2.kept.get('panes:m') === JSON.stringify(L);

        panes2.destroy();

        /* 3. The page raising a pane already in front, while it answers:
              nothing is told, and the kept layout still comes. */
        rv.root.replaceChildren();
        rv.heard.length = 0;

        const store3 = rv.async(new Map([['panes:m', JSON.stringify(L)]]));
        const panes3 = rv.make([], {
            catalog: ['w-a', 'w-b', 'w-c'], storage: store3,
            layouts: { m: { tabs: ['w-a', 'w-b', 'w-c'] } } });

        panes3.present('w-a', { focus: false });

        const heardEarly = rv.heard.length;

        store3.release();
        await rv.wait(20);

        const came = rv.tabs();

        panes3.destroy();

        return { early, shown, stored, toldTabs, kept2, heardEarly, came };
    });

    check(slow.early === 0 && slow.shown === '[["w-b"],["w-a","w-c"]]' &&
          slow.stored === slow.shown && slow.toldTabs === slow.shown,
          'a pane added before a kept layout arrives writes nothing over ' +
          'it, and once it comes what is kept and told is what is shown: ' +
          `${slow.shown} ${slow.stored} ${slow.toldTabs}`);

    check(slow.kept2,
          'setLayouts while a kept layout is on its way writes nothing ' +
          'over it');

    check(slow.heardEarly === 0 && slow.came === '[["w-b"],["w-a","w-c"]]',
          'a pane raised that was in front already is no change, and the ' +
          `kept layout still comes: ${slow.came}`);

    /* Writes to a storage that answers later land in the order made. */
    const ordered = await own.evaluate(async () =>
    {
        const { rv } = window;
        const kept = new Map();
        let n = 0;
        const panes = rv.make([], {
            catalog: ['w-a', 'w-b', 'w-c'],
            layouts: { m: { tabs: ['w-a', 'w-b', 'w-c'] } },
            storage: {
                getItem: (k) => kept.get(k) ?? null,
                /* The first write is the slowest. */
                setItem: (k, v) => rv.wait(n++ === 0 ? 120 : 10)
                    .then(() => kept.set(k, v)),
                removeItem: (k) => { kept.delete(k); },
            },
        });

        rv.root.replaceChildren();
        panes.present('w-b');
        panes.present('w-c');
        await rv.wait(300);

        const last = JSON.parse(kept.get('panes:m')).active;

        panes.destroy();

        return last;
    });

    check(ordered === 2,
          'writes to a storage that answers later land in the order they ' +
          `were made: active ${ordered}`);

    await own.close();

    /* A pane added while its mode is down, and a front tab kept by name
       when another in its leaf comes and goes. */
    own = await sandbox();

    const modes = await own.evaluate(() =>
    {
        const { rv } = window;
        const panes = rv.make(['m-a', 'm-b', 'm-c'], {
            layouts: { m: { tabs: ['m-a', 'm-b', 'm-c'], active: 1 } },
            onDiscard: (id) => panes.remove(id)?.remove(),
        });

        panes.available('m-a', false);

        const frontOff = panes.panes().find((p) => p.where === 'front').id;

        panes.available('m-a', true);

        const frontOn = panes.panes().find((p) => p.where === 'front').id;

        rv.box('m-x').setAttribute('data-pane-off', '');
        panes.add('m-x');
        panes.available('m-x', true);

        const placed = panes.panes().find((p) => p.id === 'm-x').where;

        panes.destroy();

        return { frontOff, frontOn, placed };
    });

    check(modes.frontOff === 'm-b' && modes.frontOn === 'm-b',
          'the tab in front stays in front while another in its leaf goes ' +
          `off and comes back: ${modes.frontOff} ${modes.frontOn}`);

    check(modes.placed !== 'drawer' && modes.placed !== 'off',
          'and a pane added while its mode was down is put in the layout ' +
          `when it comes up: ${modes.placed}`);

    await own.close();

    /* Out of the drawer by a split is out of it, and a pane closed beside
       a split that collapses comes back beside it. */
    own = await sandbox();

    const back = await own.evaluate(() =>
    {
        const { rv } = window;
        const panes = rv.make(['d-a', 'd-b', 'd-c', 'd-d'], {
            layouts: { m: { dir: 'row', size: [0.5, 0.5], kids: [
                { tabs: ['d-a'] },
                { dir: 'col', size: [0.5, 0.5], kids: [
                    { tabs: ['d-b'] }, { tabs: ['d-c'] }] }] } } });

        panes.close('d-a');
        panes.close('d-c');
        panes.present('d-c');
        panes.present('d-a');

        const reverse = rv.tabs();

        panes.destroy();

        return { reverse };
    });

    check(back.reverse === '[["d-a"],[["d-b"],["d-c"]]]',
          'panes closed one after another and brought back the other way ' +
          `round go back where they were: ${back.reverse}`);

    await own.evaluate(() => window.rv.root.replaceChildren());

    const split = await own.evaluate(async () =>
    {
        const { rv } = window;
        const panes = rv.make([], {
            catalog: ['d-a', 'd-b'],
            layouts: { m: { tabs: ['d-a'] } } });

        rv.box('d-z');
        panes.add('d-z', { keep: true });
        panes.close('d-z');

        return true;
    });

    const tray = await own.locator('#panereopen-d-z').boundingBox();
    const leaf = await own.locator('.paneleaf').first().boundingBox();

    await own.mouse.move(tray.x + tray.width / 2, tray.y + tray.height / 2);
    await own.mouse.down();
    await own.mouse.move(tray.x + 40, tray.y + 60, { steps: 4 });
    await own.mouse.move(leaf.x + leaf.width - 8, leaf.y + leaf.height / 2,
                         { steps: 8 });
    await own.mouse.up();
    await own.waitForTimeout(100);

    const splitOut = await own.evaluate(() =>
    {
        const { panes } = window.rv;
        const now = panes.panes().find((p) => p.id === 'd-z').where;

        panes.reset();

        const afterReset = panes.panes().find((p) => p.id === 'd-z').where;

        panes.destroy();

        return { now, afterReset };
    });

    check(split && splitOut.now === 'front' &&
          splitOut.afterReset !== 'drawer',
          'a pane split out of the drawer is not put back in it by a reset: ' +
          JSON.stringify(splitOut));

    await own.close();

    /* Right to left, a tab over a strip goes where the pointer is. */
    own = await sandbox();
    await own.evaluate(() =>
    {
        window.rv.root.dir = 'rtl';
        window.rv.make(['r-a', 'r-b', 'r-c', 'r-d'], {
            layouts: { m: { dir: 'row', size: [0.5, 0.5], kids: [
                { tabs: ['r-a', 'r-b', 'r-c'] }, { tabs: ['r-d'] }] } } });
    });

    const dragged = await own.locator('#panetab-r-d').boundingBox();

    await own.mouse.move(dragged.x + dragged.width / 2,
                         dragged.y + dragged.height / 2);
    await own.mouse.down();
    await own.mouse.move(dragged.x + 30, dragged.y + 40, { steps: 4 });

    const endTab = await own.locator('#panetab-r-c').boundingBox();

    /* Past the last tab, which reading leftward is past its left edge. */
    const target = { x: endTab.x - 6, y: endTab.y + endTab.height / 2 };

    await own.mouse.move(target.x, target.y, { steps: 8 });

    const line = await own.evaluate(() =>
    {
        const r = document.querySelector('.panedrop.paneslot')
                          ?.getBoundingClientRect();

        return r === undefined ? null : r.left + r.width / 2;
    });

    await own.mouse.up();
    await own.waitForTimeout(100);

    check(await own.evaluate(() => window.rv.tabs()) ===
              '[["r-a","r-b","r-c","r-d"]]' &&
          line !== null && Math.abs(line - endTab.x) <= 3,
          'right to left, a tab over the end of a strip goes at the end, ' +
          `and the line is drawn there: ${line} ${endTab.x}`);

    await own.close();

    /* One drop onto the drawer is one change, and a reset button named
       in words is named by them. */
    own = await sandbox();

    const once = await own.evaluate(() =>
    {
        const { rv } = window;
        const panes = rv.make(['o-a'], {
            reset: 'Start over',
            later: (id) => id === 'o-later',
            onDiscard: (id) => panes.remove(id)?.remove() });

        rv.box('o-x');
        panes.add('o-x');

        return document.querySelector('.panereset button')
                       .getAttribute('aria-label');
    });

    await own.evaluate(() => { window.rv.heard.length = 0; });

    const x = await own.locator('#panetab-o-x').boundingBox();

    await own.mouse.move(x.x + x.width / 2, x.y + x.height / 2);
    await own.mouse.down();
    await own.mouse.move(x.x + 30, x.y + 60, { steps: 4 });

    const drawer = await own.locator('.panedrawer').boundingBox();

    await own.mouse.move(drawer.x + 40, drawer.y + drawer.height / 2,
                         { steps: 6 });
    await own.mouse.up();
    await own.waitForTimeout(100);

    const heardOnce = await own.evaluate(() => window.rv.heard.length);

    check(heardOnce === 1,
          `an ephemeral pane dropped on the drawer is one change: ${heardOnce}`);

    check(once === null,
          'a reset button labeled in words is named by them');

    /* And a layout of nothing but places for panes to come is refused. */
    check(await own.evaluate(() =>
              window.rv.panes.setLayout({ tabs: ['o-later'] }) === false),
          'setLayout refuses a layout of nothing but places kept for panes ' +
          'still to come');

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

