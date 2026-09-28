#!/usr/bin/env node
/*
 * Copyright (C) 2026 Misha Nasledov
 *
 * SPDX-License-Identifier: MIT
 */

/*
 * layouts.mjs -- the layout cases every implementation is held to.
 *
 *   node tools/layouts.mjs            # writes test/layouts.json
 *   node tools/layouts.mjs --check    # fails if it is out of date
 *
 * Each case is a page with some panes and a layout kept for it, and what
 * reading that layout back has to give (docs/layout.md). mullion runs
 * them in test/check.mjs; another implementation of the same model reads
 * test/layouts.json and runs them too, which is what keeps two of them
 * the same model rather than two that agree today.
 *
 * A case:
 *
 *   name     what it holds an implementation to
 *   panes    the page's panes, in order
 *   later    panes the page will add, whose places a layout keeps
 *   version  the version the page gives, if it gives one
 *   stored   the text that was kept, exactly
 *   layout   what reading it gives; absent where it is refused, and then
 *            the page's default comes up instead: every pane in one leaf
 *
 * Written from here into the JSON: `expect', the layout that comes up
 * either way, and `written', the text an implementation keeps for it --
 * JSON.stringify of the layout, in the version's envelope where there is
 * one. Byte for byte, so that a layout kept by one implementation is
 * read by the other.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'test', 'layouts.json');

const J = JSON.stringify;
const ABC = ['a', 'b', 'c'];

const cases = [
    /* ---- leaves ---- */
    { name: 'a leaf comes back with its front tab defaulted to the first',
      panes: ABC, stored: J({ tabs: ['a', 'b'] }),
      layout: { tabs: ['a', 'b'], active: 0 } },
    { name: 'a leaf keeps the tab that was in front',
      panes: ABC, stored: J({ tabs: ['a', 'b'], active: 1 }),
      layout: { tabs: ['a', 'b'], active: 1 } },
    { name: 'a front tab past the end is the last one',
      panes: ABC, stored: J({ tabs: ['a', 'b'], active: 5 }),
      layout: { tabs: ['a', 'b'], active: 1 } },
    { name: 'a front tab that is not a whole number refuses the layout',
      panes: ABC, stored: J({ tabs: ['a', 'b'], active: 1.5 }) },
    { name: 'a negative front tab refuses the layout',
      panes: ABC, stored: J({ tabs: ['a', 'b'], active: -1 }) },
    { name: 'a front tab that is a string refuses the layout',
      panes: ABC, stored: J({ tabs: ['a', 'b'], active: '1' }) },
    { name: 'a tab that is not a string refuses the layout',
      panes: ABC, stored: J({ tabs: ['a', 2] }) },
    { name: 'a leaf with no tabs is no layout',
      panes: ABC, stored: J({ tabs: [] }) },
    { name: 'fields a leaf does not have are ignored',
      panes: ABC, stored: J({ tabs: ['b'], front: 'b', slot: 'end' }),
      layout: { tabs: ['b'], active: 0 } },
    { name: 'a whole number written as a decimal is a whole number',
      panes: ABC, stored: '{"tabs":["a","b"],"active":1.0}',
      layout: { tabs: ['a', 'b'], active: 1 } },

    /* ---- panes the page does not have ---- */
    { name: 'a pane the page does not have is dropped, not refused',
      panes: ABC, stored: J({ tabs: ['a', 'zz', 'b'], active: 2 }),
      layout: { tabs: ['a', 'b'], active: 1 } },
    { name: 'a layout of nothing but panes the page does not have is none',
      panes: ABC, stored: J({ tabs: ['zz', 'yy'] }) },
    { name: 'a leaf emptied by dropping them goes, and its split with it',
      panes: ABC,
      stored: J({ dir: 'row', size: [1, 2],
                  kids: [{ tabs: ['zz'] }, { tabs: ['a'] }] }),
      layout: { tabs: ['a'], active: 0 } },
    { name: 'the rest of a split keep their shares as they were written',
      panes: ABC,
      stored: J({ dir: 'row', size: [1, 2, 3],
                  kids: [{ tabs: ['a'] }, { tabs: ['zz'] },
                         { tabs: ['b'] }] }),
      layout: { dir: 'row', size: [1, 3],
                kids: [{ tabs: ['a'], active: 0 },
                       { tabs: ['b'], active: 0 }] } },
    { name: 'a pane named twice is kept where it is named first',
      panes: ABC,
      stored: J({ dir: 'row', size: [0.5, 0.5],
                  kids: [{ tabs: ['a', 'b'] }, { tabs: ['b', 'c'] }] }),
      layout: { dir: 'row', size: [0.5, 0.5],
                kids: [{ tabs: ['a', 'b'], active: 0 },
                       { tabs: ['c'], active: 0 }] } },
    { name: 'twice in one leaf is once',
      panes: ABC, stored: J({ tabs: ['a', 'a', 'b'], active: 2 }),
      layout: { tabs: ['a', 'b'], active: 1 } },

    /* ---- splits ---- */
    { name: 'a split comes back as it was written',
      panes: ABC,
      stored: J({ dir: 'row', size: [0.62, 0.38], kids: [
          { dir: 'col', size: [0.7, 0.3],
            kids: [{ tabs: ['a'] }, { tabs: ['b'] }] },
          { tabs: ['c'] }] }),
      layout: { dir: 'row', size: [0.62, 0.38], kids: [
          { dir: 'col', size: [0.7, 0.3],
            kids: [{ tabs: ['a'], active: 0 },
                   { tabs: ['b'], active: 0 }] },
          { tabs: ['c'], active: 0 }] } },
    { name: 'shares are shares, not fractions that add up to one',
      panes: ABC,
      stored: J({ dir: 'col', size: [1, 1, 2],
                  kids: [{ tabs: ['a'] }, { tabs: ['b'] }, { tabs: ['c'] }] }),
      layout: { dir: 'col', size: [1, 1, 2],
                kids: [{ tabs: ['a'], active: 0 }, { tabs: ['b'], active: 0 },
                       { tabs: ['c'], active: 0 }] } },
    { name: 'fields a split does not have are ignored',
      panes: ABC,
      stored: J({ dir: 'row', size: [1, 1], active: 3, fixed: 250,
                  kids: [{ tabs: ['a'] }, { tabs: ['b'] }] }),
      layout: { dir: 'row', size: [1, 1],
                kids: [{ tabs: ['a'], active: 0 },
                       { tabs: ['b'], active: 0 }] } },
    { name: 'a split of one refuses the layout',
      panes: ABC,
      stored: J({ dir: 'row', size: [1], kids: [{ tabs: ['a'] }] }) },
    { name: 'a split whose sizes do not match its children refuses it',
      panes: ABC,
      stored: J({ dir: 'row', size: [1, 1, 1],
                  kids: [{ tabs: ['a'] }, { tabs: ['b'] }] }) },
    { name: 'a share of nothing refuses the layout',
      panes: ABC,
      stored: J({ dir: 'row', size: [0, 1],
                  kids: [{ tabs: ['a'] }, { tabs: ['b'] }] }) },
    { name: 'a negative share refuses the layout',
      panes: ABC,
      stored: J({ dir: 'row', size: [-1, 1],
                  kids: [{ tabs: ['a'] }, { tabs: ['b'] }] }) },
    { name: 'a share that is a string refuses the layout',
      panes: ABC,
      stored: J({ dir: 'row', size: ['1', 1],
                  kids: [{ tabs: ['a'] }, { tabs: ['b'] }] }) },
    { name: 'a direction other than row or col refuses the layout',
      panes: ABC,
      stored: J({ dir: 'h', size: [1, 1],
                  kids: [{ tabs: ['a'] }, { tabs: ['b'] }] }) },
    { name: 'one bad child refuses the whole layout',
      panes: ABC,
      stored: J({ dir: 'row', size: [1, 1],
                  kids: [{ tabs: ['a'] }, { tabs: 'b' }] }) },
    { name: 'small and large shares survive the round trip',
      panes: ABC,
      stored: J({ dir: 'row', size: [0.001, 12345.678],
                  kids: [{ tabs: ['a'] }, { tabs: ['b'] }] }),
      layout: { dir: 'row', size: [0.001, 12345.678],
                kids: [{ tabs: ['a'], active: 0 },
                       { tabs: ['b'], active: 0 }] } },
    { name: 'a share with no short decimal is written in full',
      panes: ABC,
      stored: J({ dir: 'row', size: [1 / 3, 2 / 3],
                  kids: [{ tabs: ['a'] }, { tabs: ['b'] }] }),
      layout: { dir: 'row', size: [1 / 3, 2 / 3],
                kids: [{ tabs: ['a'], active: 0 },
                       { tabs: ['b'], active: 0 }] } },

    /* ---- what is not a layout at all ---- */
    { name: 'text that is not JSON is no layout',
      panes: ABC, stored: '{"tabs": ["a"' },
    { name: 'null is no layout', panes: ABC, stored: 'null' },
    { name: 'an array is no layout', panes: ABC, stored: J([{ tabs: ['a'] }]) },
    { name: 'a string is no layout', panes: ABC, stored: J('a') },
    { name: 'an empty object is no layout', panes: ABC, stored: '{}' },
    { name: 'nothing kept is no layout', panes: ABC, stored: null },
    { name: 'white space around it is still a layout',
      panes: ABC, stored: '\n  { "tabs" : [ "c" , "a" ] }\n',
      layout: { tabs: ['c', 'a'], active: 0 } },
    { name: 'escapes in a pane name are read',
      panes: ['aé', 'q"t', 'b'],
      stored: '{"tabs":["a\\u00e9","q\\"t"]}',
      layout: { tabs: ['aé', 'q"t'], active: 0 } },

    /* ---- panes still to come ---- */
    { name: 'a place is kept for a pane the page will add',
      panes: ABC, later: ['x'], stored: J({ tabs: ['x', 'a'] }),
      layout: { tabs: ['x', 'a'], active: 0 } },
    { name: 'the front tab counts only the panes there are, and is ' +
            'clamped to them once drawn',
      panes: ABC, later: ['x'], stored: J({ tabs: ['a', 'x'], active: 1 }),
      layout: { tabs: ['a', 'x'], active: 0 } },
    { name: 'a layout of nothing but places for panes to come is none',
      panes: ABC, later: ['x'], stored: J({ tabs: ['x'] }) },

    /* ---- versions ---- */
    { name: 'with no version, a bare tree is read',
      panes: ABC, stored: J({ tabs: ['b', 'c'] }),
      layout: { tabs: ['b', 'c'], active: 0 } },
    { name: 'with no version, a tree in a version envelope is none',
      panes: ABC, stored: J({ version: 2, layout: { tabs: ['b'] } }) },
    { name: 'with a version, a bare tree is none',
      panes: ABC, version: 2, stored: J({ tabs: ['b', 'c'] }) },
    { name: 'with a version, the tree kept under it is read',
      panes: ABC, version: 2,
      stored: J({ version: 2, layout: { tabs: ['b', 'c'], active: 1 } }),
      layout: { tabs: ['b', 'c'], active: 1 } },
    { name: 'a tree kept under another version is none',
      panes: ABC, version: 2,
      stored: J({ version: 1, layout: { tabs: ['b', 'c'] } }) },
    { name: 'versions compare as JSON values: 2 is not "2"',
      panes: ABC, version: 2,
      stored: J({ version: '2', layout: { tabs: ['b', 'c'] } }) },
    { name: 'a version can be a string',
      panes: ABC, version: 'desk-3',
      stored: J({ version: 'desk-3', layout: { tabs: ['c'] } }),
      layout: { tabs: ['c'], active: 0 } },
    { name: 'fields an envelope does not have are ignored',
      panes: ABC, version: 2,
      stored: J({ version: 2, layout: { tabs: ['a'] },
                  floating: [{ layout: { tabs: ['b'] } }] }),
      layout: { tabs: ['a'], active: 0 } },
    { name: 'an envelope with no layout is none',
      panes: ABC, version: 2, stored: J({ version: 2 }) },
];

const fallback = (c) => ({ tabs: [...c.panes], active: 0 });

const written = (c, layout) => J(c.version === undefined
    ? layout : { version: c.version, layout });

const corpus = {
    about: 'Layout cases for mullion and every implementation of its model. ' +
           'Generated by tools/layouts.mjs; see docs/layout.md.',
    cases: cases.map((c) =>
    {
        const expect = c.layout ?? fallback(c);

        return {
            name: c.name,
            panes: c.panes,
            ...(c.later ? { later: c.later } : {}),
            ...(c.version !== undefined ? { version: c.version } : {}),
            stored: c.stored,
            refused: c.layout === undefined,
            expect,
            written: written(c, expect),
        };
    }),
};

const text = `${JSON.stringify(corpus, null, 2)}\n`;

if (process.argv.includes('--check'))
{
    const now = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';

    if (now !== text)
    {
        process.stderr.write('test/layouts.json is out of date: ' +
                             'run node tools/layouts.mjs\n');
        process.exit(1);
    }
}
else
    fs.writeFileSync(out, text);
