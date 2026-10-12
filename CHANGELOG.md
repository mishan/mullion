# Changelog

## Unreleased

### Fixed

- On a touch screen a divider's step buttons were always shown, over the
  panes either side of it and whatever controls those had there. They
  show once the divider is tapped, and go with a tap anywhere else.
- The check that a scrolling strip's tablist holds only tabs looked at
  the wrong page.

## 0.5.0 — 2026-10-12

Keyboard and screen-reader work. Every move a drag makes has a menu and
a chord, a divider moves from the keys, and what the layout does is said
aloud. A strip's tablist holds only its tabs: a page that styled
`.panetabwrap` or found the tablist as `.panetabs[role="tablist"]`
should read Changed below.

### Added

- **A pinned corner.** `setCornerPinned(id, on)` keeps a pane's corner in
  sight while it is in front of its leaf, for a pane whose first row makes
  room for it.
- **Said aloud.** A pane moved, split off, zoomed, closed or reopened by a
  person is said in a status region of the layout's own: "Notes moved
  left".
- **A divider from the keys, all the way.** `Home` and `End` take it to
  either limit and `Enter` evens up the split, as a double-click does. It
  names the pane before it with `aria-controls`.
- A tab names the chords that act on its pane in `aria-keyshortcuts`, and
  the drawer is a group named by its label.
- **Nothing needs a drag.** A tab's `⋯` button, a right click on the
  tab, or `Menu` or `Shift F10` on it, opens a menu of what a drag does:
  move the pane to the leaf on any side, split it off right or below,
  move it along its strip, or close it. A divider has a step either side of its middle, shown while
  the pointer is on it (always, where nothing hovers), that moves it a
  click at a time.

### Changed

- **The strip's markup.** `.panetabwrap` is gone, and `.panetabs` is no
  longer the tablist: `.panetablist` in it is, with `display: contents`,
  and each tab's `⋯` and `×` are in a `.panetabctl` beside it, placed by
  CSS `order`. A page that styled `.panetabwrap` should style `.panetab`
  and `.panetabctl`; one that looked for `.panetabs[role="tablist"]`
  should look for `.panetablist`.
- The focus is drawn: a ring inside a tab or a cross, where the strip
  cut the browser's off, and on a divider, apart from the color a
  pointer over it gives the line.
- A divider's line defaults to `#949494`, 3:1 on white, rather than the
  panes' border color; `--pane-line` still sets both.
- With forced colors, the divider and the focus are drawn in system
  colors and the selected tab is underlined.
- A tab and its cross are at least 24 pixels each way.
- A tab's cross is out of the tab order, as a tablist's closing tabs
  have it: `Delete` on the tab closes its pane, and the cross is the
  pointer's.
- `Alt Shift` and an arrow toward the layout's edge, for a pane alone in
  its leaf, is refused rather than taken for a split of nothing.
- `Alt Shift` and left or right, from a tab in a strip of several, moves
  the tab along the strip, and out of the leaf only past either end.
- A right click on a tab opens the pane's menu rather than the browser's
  context menu.
- The `⋯` takes room on every tab, and the tab in front shows two
  controls beside its title rather than one. In the corner, the pane in
  front always has the `⋯` and so the wrapper that held its cross, about
  24 pixels more, even for a pane with no cross: a page that sizes its
  first row by `--pane-corner` for `setCornerPinned` gets the new width
  there, and one that sized it by hand should look again.
- The strip's borders and the reset button are placed by logical
  properties, so they go to the other side in a page that reads right
  to left.

### Fixed

- A strip's tablist held its tabs' `⋯` and `×` buttons and Reset layout
  as well as its tabs, which a tablist may not. The tablist is now an
  element of its own in the strip, with the tabs as its children; the
  buttons are beside it in the row, and each tab's stay beside it on
  screen.
- Escape from a background tab's menu, opened with the pointer, left the
  focus on the page: the button it went back to was hidden by then.
- The focus fell to the page's top when the window narrowed past
  `media` and the layout went: what had it in a pane keeps it, and a tab
  that went with the layout leaves it in its pane.
- Alt and an arrow onto a leaf with no strip left the focus where it
  was. It goes to the leaf's panel.

## 0.4.0 — 2026-09-28

A leaf's tabs can sit in its top corner, as icons, instead of across it,
and a pane's tab can have an icon. The layout format is written down,
with cases another implementation can run, and has fields reserved for
mullion-gtk. Nothing changes for a page that uses neither.

### Added

- **The layout, written down.** [docs/layout.md](docs/layout.md) says
  what a layout may hold, how a kept one is read back, and what is kept,
  byte for byte, so another implementation of the model can read the
  layouts mullion keeps. `test/layouts.json` has 60 cases, run in the
  suite, for that implementation to run too. `floating`, `zoom` and
  `closed` are reserved as envelope fields and `slots` as a leaf's, for
  mullion-gtk; mullion reads past them.
- **Tabs in the corner.** `header: 'corner'` takes the strip off every
  leaf and puts its tabs over the leaf's top corner instead, seen while
  the pointer or the focus is in it: the panes' icons, a grip for a pane
  alone, and a cross for the one in front. They drag, drop and take the
  arrow keys as a strip does. `--pane-corner` on the leaf is their width,
  for a pane's first row to leave room; `setHeader` changes it once up.
- **Icons.** `data-pane-icon`, or `setIcon`, gives a pane's tab an image:
  beside its title in a strip, in place of it in the corner.

### Fixed

- **A share of `1e999` in a kept layout** was read as Infinity, put up,
  and written back as `null`, which does not read back: the layout reset
  itself on the next visit. A share has to be finite, and one that is not
  refuses the layout.

## 0.3.0 — 2026-09-24

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
- **`drawer`**: an element of the page's to list the closed panes in,
  such as a phone's side menu, instead of a row above the layout. The
  list is appended to it while tiled and taken out when the tiler is off,
  and the rest of the element is left alone. `drawer: false` lists them
  nowhere, for a page that builds its own menu from `panes()` and
  `present()`.
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
