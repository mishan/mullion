/*
 * Copyright (C) 2026 Misha Nasledov
 *
 * SPDX-License-Identifier: MIT
 */

/**
 * Types for `panes.js`, which is plain JavaScript and stays that way.
 *
 * The module has to be loadable by a browser as it stands: one of the
 * pages it was written for copies it into a site with no build step at
 * all, and a module that needs compiling before it can be read is a
 * module that page cannot use. So a declaration file rather than a
 * rewrite, which is what lets a TypeScript consumer and a build-less one
 * share one source.
 *
 * Hand-written from the module's own comments and checked against its
 * code. Anything wrong in here is wrong silently, which is the cost of
 * the arrangement and worth saying out loud.
 */

/** A leaf: one or more panes as tabs, with `active` an index into the
 *  ones currently in play. */
export interface PaneLeaf {
  tabs: string[];
  active?: number;
}

/** A split: a direction, a fraction per child, and the children. */
export interface PaneSplit {
  dir: 'row' | 'col';
  size: number[];
  kids: PaneNode[];
}

export type PaneNode = PaneLeaf | PaneSplit;

export interface PanesOptions {
  /** The element the layout is drawn into. */
  root: HTMLElement;
  /** Every pane this page has, in the document's order. Each is the id of
   *  an element marked `data-pane`; a name with no such element is
   *  skipped rather than raised. */
  catalog: string[];
  /** One default layout per mode. */
  layouts?: Record<string, PaneNode>;
  /** Which of them to open on. */
  mode: string;
  /** The localStorage key prefix; the mode is appended. */
  store?: string;
  /** Extra selector for "a key here is editing, not a command", beyond
   *  textarea, input, select and contenteditable. */
  editing?: string;
  /** A pane came into view, or left it. The whole of what tiling asks of
   *  a page: work behind a background tab can stop. Out of view is behind
   *  another tab, in the drawer, behind a zoomed pane, folded, off with
   *  its mode, scrolled more than 100px out of the window when not tiled,
   *  or in a browser tab or window nobody is looking at. */
  onShow?: (id: string, on: boolean) => void;
  /** Whether to tile when the screen allows it, absent `?panes=`. */
  on?: boolean;

  /** The screen a tiled layout is worth having on. */
  media?: string;
  /** A divider's thickness in CSS pixels; also written onto the root as
   *  `--pane-split`, so the stylesheet draws exactly this. */
  split?: number;
  /** A leaf's own floor in CSS pixels. */
  leaf?: number;
  /** How much of a leaf's edge counts as an edge when a tab is dropped
   *  on it, as a fraction of the box. */
  edge?: number;
  /** The query parameter that forces the tiler on or off. */
  param?: string;
  /** Where a layout is kept between visits. Any of the three may answer
   *  with a promise, for a layout kept on a server: the page opens on the
   *  default, and what was kept replaces it when it arrives, unless the
   *  mode has changed or somebody has moved something by then. Nothing is
   *  written over it while it is on its way, and writes are made one at
   *  a time, in order. What `setItem` and `removeItem` answer is waited
   *  for and otherwise ignored, so a `fetch` will do. */
  storage?: {
    getItem(key: string): string | null | PromiseLike<string | null>;
    setItem(key: string, value: string): unknown;
    removeItem(key: string): unknown;
  };
  /** The commands, merged over the defaults. */
  keys?: Partial<PaneKeys>;
  /** How the tabs and the drawer take a row too narrow for them: shrunk
   *  to fit, or at their own widths in a row that scrolls sideways. */
  strip?: 'shrink' | 'scroll';
  /** Whether a leaf with a single tab has a tab strip over it: `false`
   *  for none, or the ids of the panes that go without one when alone.
   *  Prefer the list: a leaf with no strip cannot be dragged or closed
   *  except by the chords. */
  lone?: boolean | string[];
  /** What the drawer of closed panes is labelled. */
  closed?: string;
  /** A button that puts the mode's default layout back, labeled with
   *  this: at the end of the first tab strip, or in the drawer's row when
   *  every leaf is bare. Its accessible name is this where it has words
   *  in it, and "Reset layout" where it is a glyph. None when null. */
  reset?: string | null;
  /** The layout changed -- a drag, a divider, a chord, a close, a reset,
   *  or a call on the handle -- with a copy of it and the mode it is for.
   *  Not for a change that changed nothing. Not for a layout loaded, or
   *  swapped in by a mode or `setLayouts`, except where a pane the page
   *  added was put into it, or where a kept layout arrived after the page
   *  had been told of the one it replaces. */
  onLayout?: (layout: PaneNode, mode: string) => void;
  /** Which version of the page's layouts this is. A layout kept under
   *  another version -- or under none, before a page first gave one -- is
   *  not read back, and the default comes up instead: the way to make a
   *  changed default reach people who have been here before. */
  version?: string | number;
  /** Whether a pane this page does not have yet will be added later, with
   *  `add`: its place in a kept layout is kept for it rather than dropped,
   *  and not drawn until it is added. Asked again when the layout is kept,
   *  and when a pane is removed -- one that will come back keeps its
   *  place, as a component unmounted and mounted again needs. */
  later?: (id: string) => boolean;
  /** A person closed an ephemeral pane -- by its cross, Alt W, a drop on
   *  the drawer -- or the page called `close` on one. Nothing has moved:
   *  the page ends it with `remove`, now or after asking, or keeps it by
   *  doing nothing. Without this, an ephemeral pane cannot be closed from
   *  the layout at all. */
  onDiscard?: ((id: string) => unknown) | null;
}

/** One pane, as `panes()` reports it. */
export interface PaneState {
  id: string;
  /** `lasting` panes go to the drawer when closed; `ephemeral` ones are
   *  the page's to end. */
  kind: 'lasting' | 'ephemeral';
  /** In front of its leaf or behind a tab in it, in the drawer, off with
   *  its mode, or in the document when there is no layout. */
  where: 'front' | 'behind' | 'drawer' | 'off' | 'document';
  visible: boolean;
}

export interface PaneKeys {
  /** Whether a keydown is a command at all. Alt by default, because
   *  wherever the bare letters already mean something a tiler that took
   *  one would have taken it. */
  chord: (e: KeyboardEvent) => boolean;
  /** `KeyboardEvent.code` values, not `key`: a command is a place on the
   *  keyboard. */
  splitRow: string[];
  splitCol: string[];
  zoom: string[];
  close: string[];
  reset: string[];
}

export interface Panes {
  /** Whether the mode a pane belongs to is up. Not the same as visible:
   *  an unavailable pane leaves the layout without being forgotten by
   *  it. Writes `data-pane-off` on the element, and deliberately not
   *  `hidden` -- see the note on the attribute in `panes.js`. */
  available(id: string, on: boolean): void;
  /** Switch to another named layout. */
  mode(name: string): void;
  /** Whether a pane is in front of anybody now. */
  visible(id: string): boolean;
  /** One element over every pane, for popovers: a pane scrolls, and a
   *  popover inside a scroller is clipped by it. */
  overlay(): HTMLElement;
  /** The layout as it stands, copied. */
  layout(): PaneNode | null;
  /** Put up a layout for the mode that is up, keep it, and tell
   *  `onLayout`. Panes the page does not have are dropped; a tree that is
   *  not the shape of a layout, or names no pane the page has, is
   *  refused, and this returns false. */
  setLayout(layout: PaneNode): boolean;
  /** Back to the mode's default layout, forgetting the one kept for it:
   *  what Alt 0 does. */
  reset(): void;
  /** Raise a pane: in front of its leaf, and out of the drawer if that is
   *  where it was -- back into the leaf it left, or beside the neighbor
   *  it had if its leaf closed with it. `focus: false` for a pane the page
   *  is raising at somebody rather than for them: out of the drawer, it
   *  goes into another leaf than the one with the focus, where there is
   *  another. Nothing without a layout. */
  present(id: string, opts?: { focus?: boolean }): void;
  /** Put a pane in the drawer -- or, for an ephemeral one, ask the page
   *  through `onDiscard`, as a person's close would. Nothing without a
   *  layout. */
  close(id: string): void;
  /** Take on a pane the page has put into the document since: an element
   *  with this id, marked `data-pane`. Tiled, it goes where a kept layout
   *  had it, as a tab in `near`'s leaf, or where the person last was, in
   *  front and with the focus -- unless `focus: false`, when a pane going
   *  back into a place kept for it goes back behind what was in front.
   *  Ephemeral -- a person's close asks `onDiscard` instead of using the
   *  drawer -- unless `keep: true`.
   *  False for an element that is not in the document, not marked, or
   *  already a pane. */
  add(id: string,
      opts?: { near?: string; focus?: boolean; keep?: boolean }): boolean;
  /** Every pane, in the order it was taken on: whether a person's close
   *  ends it, where it is, and what onShow was last told. */
  panes(): PaneState[];
  /** No longer a pane: out of the layout, told it has left the screen,
   *  and its element put back where it was in the document and returned,
   *  for the page to keep or delete. A pane `later` says will come back
   *  keeps its place, not drawn, until it is added again. Null for a pane
   *  there is not. */
  remove(id: string): HTMLElement | null;
  /** What its tab says. */
  setTitle(id: string, text: string): void;
  /** Whether a layout is up at all. */
  tiled(): boolean;
  /** Another set of layouts, in place: the layout that is up stays kept
   *  under its store, as every change to it was kept when it was made,
   *  and the mode's layout from the new set replaces it. Optionally a new
   *  store prefix, divider thickness and version. */
  setLayouts(layouts: Record<string, PaneNode>,
             opts?: { store?: string; split?: number;
                      version?: string | number }): void;
  /** Put every pane back under its own parent, take every listener off
   *  the window and the media query, and leave the page as it was found.
   *  Quiet if it has already been called; the handle does nothing after
   *  it. */
  destroy(): void;
}

export function createPanes(options: PanesOptions): Panes;
