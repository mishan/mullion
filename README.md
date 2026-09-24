# mullion

[![ci](https://github.com/mishan/mullion/actions/workflows/ci.yml/badge.svg)](https://github.com/mishan/mullion/actions/workflows/ci.yml)

A tiling layout for a page you already have.

A mullion is the bar that divides a window into panes. This is that, for
the web: splits, dividers, tabs, a drawer and key bindings, over a document
somebody else wrote.

![A tab dragged onto a pane to stack it, onto an edge to split, and onto the drawer to close it](https://raw.githubusercontent.com/mishan/mullion/main/demo/mullion.gif)

**[Try it](https://mishan.github.io/mullion/)** — a small code playground,
tiled, on a window wider than 60em; on anything narrower, the same page
untiled.

```sh
npm install mullion
```

No dependencies, no framework, no build step. One function and a
stylesheet.

## What makes it different

Every other tiling layout for the web — golden-layout, dockview, lumino,
FlexLayout, rc-dock — asks you to render *into* its containers, from a
configuration object, usually inside a framework. mullion does the
opposite three times over.

**It adopts the document.** Mark elements `data-pane` and they are moved
into a layout. Every id survives and every component keeps the element it
was handed, so nothing that found a box by name stops finding it.

```html
<section id="editor" data-pane data-pane-title="Editor" data-pane-min="320">
  …whatever was already here…
</section>
```

**Turn it off and you have your page back.** Below the threshold — a
narrow window, or a screen with only a finger to point with — every
element goes back under its own parent, folded the way it was. The
untiled page is the fallback, not a second mobile layout, so there is one
markup, one stylesheet and one set of tests.

**A pane nobody is looking at is told so.** `onShow` is the contract, and
it is the reason tiling can pay for itself rather than cost: two canvases
stacked as tabs draw one picture, not two.

```js
import { createPanes } from 'mullion';
import 'mullion/panes.css';

const panes = createPanes({
  root: document.getElementById('layout'),
  catalog: ['editor', 'console', 'inspector'],
  mode: 'default',
  layouts: {
    default: {
      dir: 'row', size: [0.6, 0.4], kids: [
        { dir: 'col', size: [0.7, 0.3], kids: [
          { tabs: ['editor'] },
          { tabs: ['console'] }] },
        { tabs: ['inspector'] }],
    },
  },
  onShow: (id, on) => { if (id === 'console') tail.running = on; },
});
```

## The layout

A tree of splits and leaves, and it is plain data — yours to store, diff
or write by hand:

```js
{ dir: 'row', size: [0.62, 0.38], kids: [
    { dir: 'col', size: [0.7, 0.3], kids: [
        { tabs: ['editor'] },
        { tabs: ['console'] }] },
    { tabs: ['inspector'] }] }
```

A leaf holding more than one pane is tabs. The panes no leaf holds are the
**drawer**: listed above the layout, one click from coming back. Nothing
is ever destroyed — closing a pane puts it away, which is why there is
nowhere in here that makes one.

## What a person can do

| | what it does |
|---|---|
| drag a tab | onto a tab strip to put it there, onto a pane to stack, onto an edge to split, onto the drawer to close; `Esc` to take it back |
| the cross on a tab | close it to the drawer |
| a divider | drag, or focus it and use the arrows; double-click to even up |
| `Alt` + arrow | move the focus to the pane that way |
| `Alt Shift` + arrow | move the *pane* that way |
| `Alt \` / `Alt -` | split right / split down |
| `Alt Enter` | zoom one pane to fill the layout |
| `Alt W` | close the pane in front |
| `Alt 0` | forget the saved layout and start over (or the `reset` button, or `reset()`) |

In a page that reads right to left, every direction is the one on the
screen: the arrow pointing left along a strip is the next tab, a divider
goes the way it is dragged, and a pane dropped on or moved off a left
edge goes on the left.

Every command is a chord with `Alt` in it, because wherever the bare
letters already mean something — a text editor, a chat composer, a
keyboard instrument — a tiler that took `W` for itself would have taken
it. All of them are inert while the focus is in a text box, and all of
them are an argument (`keys`) for a page where that is still wrong.

## Markup

| attribute | what it says |
|---|---|
| `data-pane` | this element is a pane |
| `data-pane-title` | what its tab says (a `<details>`'s `<summary>` otherwise) |
| `data-pane-min` | how narrow a divider may make it, in pixels (240) |
| `data-pane-off` | this pane's mode is not up — set it, or call `available()` |

`data-pane-off` and not `hidden`, deliberately: `hidden` is a word most
pages are already using for something else, and a layout that read it
would lose panes to an unrelated `el.hidden = true` and never put them
back.

## Options

Everything below is a default rather than a rule.

| option | what it is | default |
|---|---|---|
| `root` | where the layout is drawn | — |
| `catalog` | the ids of the panes, in document order | — |
| `mode` | which named layout to open on | — |
| `layouts` | one default tree per mode | every pane in one leaf |
| `onShow` | `(id, on)` — a pane came into view, or left it | — |
| `onLayout` | `(layout, mode)` — somebody changed the layout | — |
| `on` | tile when the screen allows it | `false` |
| `store` | localStorage key prefix; the mode is appended | `'panes'` |
| `editing` | extra selector for "a key here is text" | — |
| `media` | the screen worth tiling on | `(min-width: 60em) and (any-pointer: fine)` |
| `split` | a divider's thickness in pixels | `6` |
| `leaf` | a leaf's own floor in pixels | `64` |
| `edge` | how much of a leaf's edge is an edge | `0.2` |
| `param` | query parameter that forces it on or off | `'panes'` |
| `storage` | where a layout is kept; its methods may return promises | `localStorage` |
| `keys` | the commands, merged over the defaults | `Alt` chords |
| `strip` | `'scroll'` keeps tabs and the drawer at their own widths in a row that scrolls | `'shrink'` |
| `lone` | whether a leaf with one tab has a tab strip: `false` for none, or the ids of the panes that go without one | `true` |
| `closed` | the drawer's label | `'Closed:'` |
| `reset` | label for a button that starts the layout over, at the end of the first tab strip (the drawer's row when every leaf is bare) | `null` |
| `version` | which version of your layouts this is; a layout kept under another is not read back | — |

And the handle it returns: `available(id, on)`, `mode(name)`,
`visible(id)`, `present(id, { focus })`, `close(id)`, `setTitle(id, text)`,
`layout()`, `setLayout(layout)`, `reset()`, `overlay()`, `tiled()`,
`setLayouts(layouts, { store, split, version })`, `destroy()`.

`setLayouts` swaps in another set of layouts without taking the tiler
down: the layout that is up is saved under its store, and the mode's
layout from the new set replaces it. It is for a page with more than one
shape, such as a phone that has one layout upright and another on its
side:

```js
const side = matchMedia('(orientation: landscape)');
side.addEventListener('change', () =>
  panes.setLayouts(side.matches ? SIDEWAYS : UPRIGHT,
                   { store: side.matches ? 'app:side' : 'app:up' }));
```

On a touch screen, `strip: 'scroll'`, a thicker `split` and a `lone` list
naming the pane that should not spend a row on its name (a keyboard, a
toolbar) are the usual changes, with a `reset` button, since there is no
`Alt 0` to press; with a `media` that admits a coarse pointer, the tiler
runs there too. `lone: false` goes further and takes the strip off *any*
pane moved into a leaf of its own, which leaves it no tab to drag or
close by.

A layout is kept in `localStorage` under the store and the mode. A page
with accounts keeps it on a server instead: `storage` takes the same three
methods, and any of them may return a promise. The page opens on its
default and the kept layout replaces it when it arrives, unless somebody
has moved something first. `onLayout` is told of every change a person
makes, with a copy of the tree, which is also what an undo button needs:

```js
createPanes({
  // …
  storage: {
    getItem: (k) => fetch(`/prefs/${k}`).then((r) => (r.ok ? r.text() : null)),
    setItem: (k, v) => fetch(`/prefs/${k}`, { method: 'PUT', body: v }),
    removeItem: (k) => fetch(`/prefs/${k}`, { method: 'DELETE' }),
  },
  onLayout: (layout, mode) => history.push({ layout, mode }),
});
```

`setLayout(layout)` goes the other way: it puts a layout up for the mode
that is up — a preset, one read out of a link, a step back through that
undo — and keeps it and tells `onLayout` like any other change. It is read
the way a kept layout is read: a pane the page does not have is dropped,
and a tree that is not the shape of a layout is refused and `false` is
returned.

A kept layout outlives the default it was made from, so when you move a
pane in your defaults, or add one, somebody who has been here before goes
on seeing what they left, with the new pane in the drawer. `version` is
how you tell them: a layout kept under another version, or kept before
there was one, is not read back, and your new default comes up.

```js
createPanes({ /* … */ version: 3 });
```

`destroy()` is the way back out: every pane under its own parent again,
every listener off the window, and the page as it was found. A page that
mounts this into something it later unmounts needs it, and so does anyone
calling `createPanes` a second time over the same document — two tilers
answer the same chord twice.

## Styling

`panes.css` draws the layout and nothing that is in it. Which of *your*
boxes takes the room a pane has is yours to say — no stylesheet shipped
with a tiler can know that:

```css
body.tiled .panebody > .editor { flex: 1 1 auto; min-height: 0; }
body.tiled .panebody > .toolbar { flex: 0 0 auto; }
```

The colors are read under this module's own names, each with a fallback,
so it stands alone and you can map your theme onto it:

```css
:root {
  --pane-fg: var(--text);       --pane-bg: var(--surface);
  --pane-dim: var(--muted);     --pane-panel: var(--surface-2);
  --pane-line: var(--border);   --pane-held: var(--accent);
}
```

`--pane-held` — the selected tab, a divider under the pointer, a drop
target — defaults to `AccentColor`, the color the page's own sliders and
checkboxes use. That is the system accent where the browser exposes it
(an installed web app, for one) and the browser's default elsewhere. Map
it, as above, to use your own instead.

Your overrides go in a stylesheet loaded after `panes.css`: its selectors
are ordinary class selectors, so at equal specificity the later rule wins.

`--pane-height` is the layout's height, `100dvh` by default. A page that
tracks `visualViewport` — because `dvh` is wrong the moment an on-screen
keyboard appears — should set this instead.

## Popovers

A pane is a box that scrolls, so a popover inside one is clipped by it.
`overlay()` returns an element over every pane, at the document's origin,
as wide as the body's containing block and of no height, so an absolutely
positioned child of it is placed and sized as it would be in the body:

```js
import { placePopover } from 'mullion/popover.js';

panes.overlay().append(menu);
placePopover(menu, x, y);   // and held inside the window
```

## The demo

```sh
npm run demo   # http://127.0.0.1:8080/demo/
```

Or [the same page on the web](https://mishan.github.io/mullion/).

`demo/` is a code playground: an editor per file, a preview, a console,
and a chart of what the preview drew. It is an ordinary page of
sections, and everything mullion does to it is one `createPanes` call
over them. The preview's program is held still while its pane is off
the screen, the chart stops drawing behind a tab, and the Console counts
on its tab what arrived while it was hidden. That is `onShow`, doing
the job it is for. **Plain page** in its header turns the tiler off.

The tests drive a different page, `test/fixture/`, built for the claims
they make: a fold, a box that scrolls sideways, a popover the pane would
clip.

```sh
npm install && npx playwright install chromium firefox webkit
npm test              # the fixture, in Chromium
npm test -- firefox   # or webkit
npm run test:demo     # the playground still works
npm run types         # the declarations, which are hand-written
npm run shot          # the gif above, re-recorded (needs ffmpeg)
```

## License

MIT. Copyright (c) 2026 Misha Nasledov.
