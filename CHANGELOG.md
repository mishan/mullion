# Changelog

## 0.3.0 — unreleased

A page can now add and remove panes while it is up, keep its layouts on a
server, and put a layout up itself. A person can reorder tabs, take back
a drag, and use a layout in a page that reads right to left. The suite
runs in Firefox and WebKit as well as Chromium.

### Changes to check when upgrading

- **`onShow` says `false` in more places.** With the tiler off, a pane
  scrolled more than 100px out of the window is out of sight. In either
  mode, so is every pane in a browser tab or window nobody is looking at.
  Work that has to go on in the background should not stop on
  `onShow(id, false)`.
- **The default `media` is `(min-width: 60em) and (any-pointer: fine)`**,
  so a tablet with a trackpad attached tiles. A screen with only a finger
  still gets the plain page.
- **`.panealone` is gone.** A leaf with no tab strip is marked
  `.panebare` itself, and `lone` also takes a list of the panes that go
  without a strip when alone.
- **A tab let go over its own leaf stays where it is**, in front. It used
  to move to the end of the strip.
- **`setLayouts` no longer writes the layout that is up.** Every change is
  kept when it is made, so there is nothing new to write.
- **`onLayout` is not told of a change that changes nothing**, such as a
  pane raised that was already in front.

### Added

- **Panes the page adds.** `add(id, { near, focus, keep })` takes on an
  element the page has put into the document since, and `remove(id)`
  hands it back, in its place in the document, for the page to keep or
  delete. `panes()` lists every pane with its kind and where it is.
- **A lifecycle for them.** An added pane is ephemeral unless `add` is
  given `keep: true`. A person's close of an ephemeral pane asks the page
  through the new `onDiscard(id)` option, and the page ends it with
  `remove`, or keeps it. Ephemeral panes never go to the drawer. Without
  `onDiscard` they have no close button.
- **`later(id)`** keeps a saved layout's place for a pane the page will
  add, rather than dropping it when the layout is read, and for a pane
  removed that will come back, as a component unmounted and mounted
  again (React's `StrictMode`, a hidden `<Activity>`) does.
- **A Frameworks section in the README**: how to use mullion with React
  and Vue without either losing track of the elements mullion moves.
- **`onLayout(layout, mode)`**, told of every change with a copy of the
  tree.
- **Storage that answers later.** `getItem`, `setItem` and `removeItem`
  may return promises. The page opens on its default, and the saved
  layout replaces it when it arrives unless somebody has moved something
  first. Nothing is written over it while it is on its way, and writes go
  one at a time, in the order they were made.
- **`version`**: a layout saved under another version is not read back,
  so a changed default reaches people who have been here before.
  `setLayouts` takes one too.
- **`setLayout(layout)`** puts a layout up for the mode that is up, for a
  preset, a link or an undo.
- **`reset()`**, and the **`reset`** option: a button that starts the
  layout over, for a screen with no `Alt 0` to press.
- **Tabs can be reordered**: a tab let go over a tab strip goes between
  the two tabs either side of the pointer, marked with a line while it is
  dragged.
- **`Esc` takes back a tab drag.**
- **Right to left**, every direction is the one on the screen: the arrows
  along a strip, dividers dragged or moved by their arrow keys, a tab
  dropped on an edge or a strip, and `Alt Shift` with an arrow.
- **A pane brought back goes where it was**, from the drawer or by
  `present()`, even when its leaf closed with it: beside the same
  neighbor, on the same side, with the same share.

### Fixed

- In Firefox and WebKit, a pane moved by a split collapsing around it, or
  closed and brought back, lost where it was scrolled to.
- Chromium's renderer could crash, taking the page with it, on a move
  into a leaf as another pane in it was hidden or shown, as when a pane
  sharing a leaf was made unavailable and available again. mullion now
  works around this browser bug.
- A render while a tab was being dragged (a title changing, a mode
  coming up) left the drag unfinished.
- The tab in front of a leaf changed when another tab in the leaf went
  off with its mode and came back.

### Also

- The demo is a small code playground, and the test fixture moved to
  `test/fixture/`.
- `npm test -- firefox` or `npm test -- webkit` runs the suite in those
  browsers, and CI runs all three.

## 0.2.0 — 2026-09-23

### Added

- `strip: 'scroll'` keeps tabs and the drawer at their own widths in a
  row that scrolls sideways.
- `lone: false` draws no tab strip over a leaf with one tab.
- `closed`, the drawer's label.
- `setLayouts(layouts, { store, split })` swaps in another set of layouts
  without taking the tiler down, for a phone with one layout upright and
  another on its side.

### Changed

- `--pane-held` defaults to `AccentColor`, the color of the page's own
  form controls, rather than `#5050ff`.

### Fixed

- A finger dragging a divider moved it a few pixels before the browser
  took the gesture for a scroll.

## 0.1.2 — 2026-09-23

### Fixed

- `Alt Shift` with an arrow moved the neighboring pane.
- Popovers in `overlay()` were as narrow as their content allows.
- A drag let go over nothing counted as a click.
- `present()` and reopening from the drawer put a pane where a zoom hid
  it.
- Reloading after closing every pane stacked every pane in one leaf.
- `data-pane-min="0"` meant the default.
- A pane moved by a split collapsing around it loaded its `<iframe>`s
  again. Moves use `moveBefore` where the browser has it.

## 0.1.1 — 2026-09-22

The first release.
