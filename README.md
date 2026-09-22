# mullion

A tiling layout for a page you already have.

A mullion is the bar that divides a window into panes. This is that, for
the web: splits, dividers, tabs, a drawer and a keyboard, over a document
somebody else wrote.

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
narrow window, or a pointer that is a finger — every element goes back
under its own parent, folded the way it was. The untiled page is the
fallback, not a second mobile layout, so there is one markup, one
stylesheet and one set of tests.

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

| | |
|---|---|
| drag a tab | onto a pane to stack, onto an edge to split, onto the drawer to close |
| the cross on a tab | close it to the drawer |
| a divider | drag, or focus it and use the arrows; double-click to even up |
| `Alt` + arrow | move the focus to the pane that way |
| `Alt Shift` + arrow | move the *pane* that way |
| `Alt \` / `Alt -` | split right / split down |
| `Alt Enter` | zoom one pane to fill the layout |
| `Alt W` | close the pane in front |
| `Alt 0` | forget the saved layout and start over |

Every command is a chord with `Alt` in it, because wherever the bare
letters already mean something — a text editor, a chat composer, a
keyboard instrument — a tiler that took `W` for itself would have taken
it. All of them are inert while the focus is in a text box, and all of
them are an argument (`keys`) for a page where that is still wrong.

## Markup

| attribute | what |
|---|---|
| `data-pane` | this element is a pane |
| `data-pane-title` | what its tab says (a `<details>`'s `<summary>` otherwise) |
| `data-pane-min` | how narrow a divider may make it, in pixels |
| `data-pane-off` | this pane's mode is not up — set it, or call `available()` |

`data-pane-off` and not `hidden`, deliberately: `hidden` is a word most
pages are already using for something else, and a layout that read it
would lose panes to an unrelated `el.hidden = true` and never put them
back.

## Options

Everything below is a default rather than a rule.

| | | default |
|---|---|---|
| `root` | where the layout is drawn | — |
| `catalog` | the ids of the panes, in document order | — |
| `mode` | which named layout to open on | — |
| `layouts` | one default tree per mode | every pane in one leaf |
| `onShow` | `(id, on)` — a pane came into view, or left it | — |
| `on` | tile when the screen allows it | `false` |
| `store` | localStorage key prefix; the mode is appended | `'panes'` |
| `editing` | extra selector for "a key here is text" | — |
| `media` | the screen worth tiling on | `(min-width: 60em) and (pointer: fine)` |
| `split` | a divider's thickness in pixels | `6` |
| `leaf` | a leaf's own floor in pixels | `64` |
| `edge` | how much of a leaf's edge is an edge | `0.2` |
| `param` | query parameter that forces it on or off | `'panes'` |
| `storage` | where a layout is kept | `localStorage` |
| `keys` | the commands, merged over the defaults | `Alt` chords |

And the handle it returns: `available(id, on)`, `mode(name)`,
`visible(id)`, `present(id, { focus })`, `close(id)`, `setTitle(id, text)`,
`layout()`, `overlay()`, `tiled()`.

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

`--pane-height` is the layout's height, `100dvh` by default. A page that
tracks `visualViewport` — because `dvh` is wrong the moment an on-screen
keyboard appears — should set this instead.

## Popovers

A pane is a box that scrolls, so a popover inside one is clipped by it.
`overlay()` returns an element over every pane, at the document's origin
and of no size, so an absolutely positioned child of it resolves against
the containing block the body would have given it:

```js
import { placePopover } from 'mullion/popover.js';

panes.overlay().append(menu);
placePopover(menu, x, y);   // and held inside the window
```

## The demo

```sh
npm run demo   # http://127.0.0.1:8080/demo/
```

`demo/` is also the fixture the tests drive, which is deliberate: what
the module promises is about a document, and a claim about a document
needs one with enough in it to be worth making.

```sh
npm install && npx playwright install chromium
npm test
```

## License

MIT. Copyright (c) 2026 Misha Nasledov.
