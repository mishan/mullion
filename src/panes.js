/*
 * Copyright (C) 2026 Misha Nasledov
 *
 * SPDX-License-Identifier: MIT
 */

/*
 * mullion -- a page as tiles rather than as a scroll.
 *
 * A mullion is the bar that divides a window into panes, which is what
 * this is: splits, dividers, tabs and a drawer over a document somebody
 * else wrote. What a page shows are panels a person wants side by side,
 * and a document stacks them because that is what a document does -- so
 * on a screen with room for four at once, three of them are scrolled out
 * of sight.
 *
 * IT ADOPTS THE DOCUMENT and creates no content. Every element it shows
 * is one already in the page, marked `data-pane', moved into a layout and
 * put back where it was when the layout goes away. Every id survives and
 * every component keeps the element it was handed, which is what lets the
 * page work with the tiler off -- and the page with the tiler off is the
 * fallback, not a second mobile layout. There is no configuration object
 * describing your panels twice.
 *
 * THE CONTRACT THAT MATTERS is `onShow'. A pane that is not in front of
 * anybody is a pane whose work can stop, and a tab nobody has selected is
 * the clearest case there is: two canvases stacked cost one picture
 * rather than two. So the one thing a page has to do about tiling is
 * answer onShow, and the one thing this file promises is to ask.
 *
 * WHAT IT DOES NOT DO: lay anything out itself. The tree is nested flex
 * boxes with a fraction each and the browser does the arithmetic;
 * anything that cares about its own width observes its own element, as
 * it would anyway. There is no measurement loop here and no per-frame
 * JavaScript. It ships no colors it will not let you change and no rule
 * about which of your boxes stretches -- that is yours to say, and
 * panes.css says so at length.
 *
 * THE TREE is splits with a direction and a fraction per child, and
 * leaves holding panes:
 *
 *     { dir: 'row', size: [0.62, 0.38], kids: [
 *         { dir: 'col', size: [0.7, 0.3], kids: [
 *             { tabs: ['editor'] },
 *             { tabs: ['console'] } ] },
 *         { tabs: ['inspector'] } ] }
 *
 * Which is data, and comes from the page: one default per mode, in the
 * page's own script, because this file ships no opinion about where
 * anything goes. What a person does to it is kept under the page and the
 * mode, and a saved layout naming a pane the page has never heard of
 * drops it rather than being thrown away.
 *
 * A leaf holds more than one pane as tabs, and the panes no leaf holds
 * are the DRAWER: listed above the layout, one click from being put back.
 * A pane is closed to it by the cross on its own tab, by Alt W, or by
 * dragging its tab onto the drawer, and reopened by the button there
 * with its name on. Nothing a person does destroys a pane -- closing one
 * is putting it away.
 *
 * THE PAGE OWNS WHAT IS IN A PANE, and so when one begins and ends. The
 * catalog is what it has to start with; `add' takes on an element it
 * puts into the document later, and `remove' hands one back. A pane it
 * adds is ephemeral unless it asks otherwise: closing it asks the page,
 * through onDiscard, rather than filling the drawer with every file
 * anybody ever opened. Nothing here makes an element or deletes one.
 *
 * Two canvases stacked as tabs is where the tiling pays for itself: the
 * one behind stops drawing.
 *
 * WHAT IS POLICY AND NOT MECHANISM is an argument, with this page's
 * answer as the default: the screen worth tiling on (`media'), a
 * divider's thickness and a leaf's floor (`split', `leaf'), how much of
 * a leaf's edge is an edge (`edge'), the query parameter that turns it
 * on (`param'), where a layout is kept (`storage'), the chords (`keys'),
 * how a strip too narrow for its tabs takes them (`strip'), which panes
 * alone in a leaf go without one (`lone'), the drawer's label (`closed')
 * and a button to start over (`reset'). None of them is a rule -- they
 * are what this page would have hardcoded, written where somebody else
 * can disagree.
 */

/* The screen a tiled layout is worth having on. Both halves matter, and
   the second is the one that gets forgotten: a finger is not a mouse, and
   a divider you cannot grab is worse than no divider.

   `any-pointer' and not `pointer': a screen with a mouse or a trackpad
   anywhere is a screen somebody can drag a divider on. A tablet with a
   keyboard and trackpad attached calls its main pointer the finger, and
   it has 60em and a pointer that aims -- which is everything tiling
   asks for. */
const MEDIA = '(min-width: 60em) and (any-pointer: fine)';

/* A divider's thickness and a leaf's own floor, in CSS pixels. The first
   of these is also drawn, and the drawing reads it from the root as
   `--pane-split' rather than being told it twice -- the arithmetic that
   refuses a drag and the line the browser paints have to be the same
   number, and a comment asking two numbers to agree is not a mechanism. */
const SPLIT = 6;
const LEAF = 64;

/* How much of a leaf's edge is an edge: the outer fifth, which is enough
   to aim at with a pointer and leaves the middle -- the common answer,
   "put it in this one" -- most of the box. */
const EDGE = 0.2;

/* The attribute that means a pane's mode is not up.
 *
 * Its own and not `hidden'. Reading `hidden' is right for a page that
 * uses the attribute for this and nothing else, and wrong the moment a
 * page uses it for ordinary showing and hiding: a pane something else
 * hid would leave the layout without anything having said so, and the
 * layout would not put it back. panes.css draws the consequence, so the
 * attribute hides the element in the document as well.
 */
const OFF = 'data-pane-off';

const off = (el) => el.hasAttribute(OFF);

/*
 * What a command is, which is the part of this a page is most likely
 * to want different.
 *
 * Every command is a chord with Alt in it, and that is not this page's
 * peculiarity: anywhere the bare letters are already something -- notes
 * here, a chat composer elsewhere -- a tiler that took W for itself
 * would have taken them. It stays the default for that reason and is an
 * argument for when it is wrong.
 *
 * By `code' rather than by `key': a command is a place on the keyboard,
 * and Alt over a letter is a different letter on half the layouts there
 * are. The arrows are not in here because they are directions rather
 * than letters, and a layout where Up is not up is not a layout.
 */
const KEYS = {
    chord: (e) => e.altKey && !e.ctrlKey && !e.metaKey,
    splitRow: ['Backslash'],
    splitCol: ['Minus'],
    zoom: ['Enter', 'NumpadEnter'],
    close: ['KeyW'],
    reset: ['Digit0'],
};

/* Where a layout is kept between visits. localStorage by default and an
   object with the same three methods when a page has somewhere better --
   a profile on a server is the first thing anybody with accounts wants,
   and a server answers later, so any of the three may return a promise.
   Read lazily: a browser that refuses storage altogether throws on the
   property, and every call here is inside a try. */
const KEEP = {
    getItem: (k) => localStorage.getItem(k),
    setItem: (k, v) => localStorage.setItem(k, v),
    removeItem: (k) => localStorage.removeItem(k),
};

/* What the page is asking for, before the screen gets a say: `?panes=1'
   turns the tiler on, `?panes=0' refuses it, neither leaves the page's own
   default. The screen decides separately, so a narrow window with
   ?panes=1 is still the document -- which is the fallback working rather
   than the query string being ignored. */
function asked (param, fallback)
{
    const p = new URLSearchParams(location.search).get(param);

    return p === null ? fallback : p === '1';
}

export function createPanes ({ root, catalog, layouts, mode,
                               store = 'panes', editing = '',
                               onShow = () => {}, on = false,
                               media = MEDIA, split = SPLIT,
                               /* `least' here and `leaf' outside: a leaf
                                  is what most of this file calls a node,
                                  and an option that shares the name is
                                  read as one wherever it is passed. */
                               leaf: least = LEAF,
                               edge = EDGE, param = 'panes',
                               storage = KEEP, keys = {},
                               strip = 'shrink', lone = true,
                               closed: label = 'Closed:',
                               drawer: shelf = null,
                               reset: again = null,
                               onLayout = () => {}, version,
                               later = () => false, onDiscard = null })
{
    /* The commands, with a page's own over the defaults rather than
       instead of them: overriding the one chord that clashes should not
       cost you the other five. */
    const keymap = { ...KEYS, ...keys };

    /* The class every rule in panes.css keys on, put here rather than
       asked of the page: what the layout is drawn into is whatever
       element this was handed, and a stylesheet naming the id one page
       happened to choose was a stylesheet naming its one consumer. */
    root.classList.add('panesroot');

    /* How the tabs and the drawer take a row too narrow for them: shrunk
       to fit, every name cut short, or left their own widths in a row that
       scrolls -- which is what a phone wants, where "Pian..." beside
       "Cha..." names nothing. And whether a leaf with one tab still has a
       strip over it: on a desktop that strip is the handle a pane is
       dragged and closed by, on a phone a row of height spent saying
       "Keys" over a keyboard. A class on the root and one on each such
       leaf, so panes.css says what each means.
     *
       `lone' as a list names the panes that go without, and is the one
       to use: `false' takes the strip off any pane somebody moves into
       a leaf of its own, and with it the only way to drag or close it
       where there is no keyboard for the chords. */
    root.classList.toggle('panescroll', strip === 'scroll');

    const bare = (id) => (Array.isArray(lone) ? lone.includes(id) : !lone);

    /* And the one number the drawing and the arithmetic share, written
       where the drawing can read it, and written again by setLayouts. */
    root.style.setProperty('--pane-split', `${split}px`);

    /* Where a key means editing rather than a command: a chord typed
       into a text box is text. Deliberately wide -- a list and a slider
       answer to the arrow keys themselves, and Alt with an arrow is
       close enough to those to leave alone. `editing' adds to it. */
    const editable = ['textarea', 'input', 'select', '[contenteditable]',
                      ...(editing ? [editing] : [])].join(', ');

    /* id -> the element, where it came from, and what it is worth. In
       the catalog's order, which is the document's. */
    const panes = new Map();

    /* id -> what onShow was last told, so it is told only of changes. */
    const shown = new Map();

    /* id -> the leaf it was last in, so that reopening a pane is putting
       it back rather than dropping it wherever the pointer last was.
       The leaf itself and not an address: a split collapses when the
       last pane leaves it, and every index around it moves. A leaf the
       tree no longer holds is no answer, and then the drawer falls back
       to the leaf that was last touched -- which is what it always
       did. */
    const home = new Map();

    /* id -> where its leaf was, for a pane that was the last one in it.
       Its leaf went with it, so `home' has nothing to offer; what is
       left is the leaf or split it sat beside, which side, which way the
       split ran and what share it had. The neighbor is kept and not an
       address for the same reason: a collapse moves it up a level, and
       it is the same object when it gets there. */
    const spot = new Map();

    const screen = matchMedia(media);
    const wanted = asked(param, on);

    let tiled = false;
    let dead = false;           /* once destroy() has handed it all back */
    let above = null;           /* the overlay, once anything wants one */
    let hint = null;            /* where a dragged tab would land */

    /* The layout that is up, and which of the page's it came from. */
    let tree = null;
    let where = mode;

    /* What each render found: which panes are in front of somebody, which
       were put into the document at all, and which node each rendered
       leaf is. */
    let onScreen = new Set();
    let attached = new Set();
    let seen = new Map();

    /* The leaf the next pane out of the drawer goes into, and the one
       the keyboard is in. */
    let focus = null;

    /* The leaf filling the layout, if one is. Zoom is what makes tiling
       bearable on a laptop and it costs nothing: the rest are drawn and
       not shown, so that coming back out of it moves nothing, and onShow
       fires for everything that just left the screen. */
    let zoom = null;

    /* A pane taken on: what it is called, how narrow it may be, and
       where it came from. For the catalog here, and for `add' later. */
    const enlist = (id, el) =>
    {
        /* A <details>'s summary is its title, already written and already
           right; the attribute is for everything else. */
        const summary = el.tagName === 'DETAILS'
            ? el.querySelector(':scope > summary') : null;

        /* A floor of nothing is a floor: `0' is a number the markup
           said, and only a missing or unreadable one is the default. */
        const floor = Number.parseFloat(el.dataset.paneMin);

        const p = {
            id, el, summary,
            title: el.dataset.paneTitle ?? summary?.textContent.trim() ?? id,
            min: floor >= 0 ? floor : 240,

            /* Where it came from. A remembered sibling is no address:
               the panes around this one are being moved too, so by the
               time this is put back the element it used to be before may
               itself be somewhere else. A <template> left in its place
               is an address that cannot move and shows nothing. */
            slot: document.createElement('template'),

            host: null,             /* the section it is shown in */
            wasOpen: true,          /* the fold it had before adoption */
            fold: null,             /* the listener, so destroy() can go */

            /* Added once the page was up, and the pane named to put it
               beside when the layout does not say where it goes. */
            added: false,
            near: null,

            /* Whether a person's close ends it rather than putting it in
               the drawer -- which it asks the page to do, since the page
               owns what is in it. What `add' takes on is this unless it
               asks to be kept; what the markup has never is. */
            ephemeral: false,
        };

        panes.set(id, p);

        /* Kept rather than written inline, because `destroy' has to be
           able to take it off again: a module that adopts a document has
           to be able to hand it back whole. */
        if (summary !== null)
        {
            p.fold = () => settle();
            el.addEventListener('toggle', p.fold);
        }

        return p;
    };

    for (const id of catalog)
    {
        const el = document.getElementById(id);

        /* A page that does not have this one. A catalog is written
           against a document, and two pages sharing most of their panes
           share most of a catalog -- so a name this page has no element
           for is not an error. It is a pane this page does not have, and
           it is left out rather than raised. */
        if (el === null || !el.hasAttribute('data-pane'))
            continue;

        enlist(id, el);
    }

    /* The panes a person has put away: in the drawer because somebody
       closed them, rather than because a layout never had them. A pane
       the page added is always somewhere in the layout unless it is one
       of these. */
    const dismissed = new Set();

    /* How far outside the window a pane in the document still counts as
       on the screen: close enough that scrolling to it finds it already
       drawn rather than starting to. */
    const NEAR = 100;

    /* id -> whether that pane is on the screen in the document, as the
       browser last said. Not there is not asked yet, and then the pane's
       box is measured instead: saying yes until the browser gets round to
       answering is telling a pane below the fold to start, and then to
       stop again. */
    const inView = new Map();

    const near = (el) =>
    {
        const r = el.getBoundingClientRect();

        return r.bottom >= -NEAR && r.top <= innerHeight + NEAR &&
               r.right >= -NEAR && r.left <= innerWidth + NEAR;
    };

    /* The document is a scroll, and a pane scrolled out of it is as out
       of sight as one behind a tab. Watched only while there is no
       layout: a tiled pane is on the screen if it is in front, which the
       render already knows. */
    const sight = typeof IntersectionObserver === 'function'
        ? new IntersectionObserver((changes) =>
          {
              /* Only for a pane there still is: an answer already on its
                 way when one is removed would otherwise be the first
                 thing an id added again is told. */
              for (const e of changes)
                  if (panes.get(e.target.id)?.el === e.target)
                      inView.set(e.target.id, e.isIntersecting);

              settle();
          }, { rootMargin: `${NEAR}px` })
        : null;

    let watching = false;

    const watch = (on) =>
    {
        if (sight === null || on === watching)
            return;

        watching = on;
        inView.clear();
        sight.disconnect();

        if (on)
            for (const p of panes.values())
                sight.observe(p.el);
    };

    /* Whether a pane's work is worth doing.
     *
     * Four ways for the answer to be no and one thing done about all of
     * them: the mode it belongs to is not up (the attribute available()
     * sets), the window is not being looked at (another browser tab, a
     * minimized window), and then either it is folded away or scrolled
     * out of the document, or -- once there is a layout to be out of --
     * it is not in front in it. */
    const visible = (p) =>
        !off(p.el) && !document.hidden &&
        (tiled ? onScreen.has(p.id)
               : (p.summary === null || p.el.open) &&
                 (inView.get(p.id) ?? near(p.el)));

    /* Whether a pane is in play at all: this page has it and the mode it
       belongs to is up. Everything the layout does is over these. */
    const playable = (id) =>
    {
        const p = panes.get(id);

        return p !== undefined && !off(p.el);
    };

    /* What each pane's work is told, and only where the answer changed.
       Called after anything that could have moved one: a fold, a mode, a
       layout. */
    const settle = () =>
    {
        for (const [id, p] of panes)
        {
            const now = visible(p);

            if (shown.get(id) !== now)
            {
                shown.set(id, now);
                onShow(id, now);
            }
        }
    };

    /* ---- adopting, and putting back ---- */

    const adopt = (p) =>
    {
        if (p.host !== null)
            return p.host;

        const body = document.createElement('div');

        body.className = 'panebody';

        /* The leaf's tab strip is this pane's header, so the pane itself
           is the region and nothing more: a box with what was adopted in
           it, labelled by the tab that raises it. */
        p.host = document.createElement('section');
        p.host.className = 'pane';
        p.host.id = `pane-${p.id}`;

        /* `tabpanel' rather than `region': the strip above it is a
           tablist whether it holds one tab or four, so what this is is
           the panel that tab controls. Named by the tab, through
           `aria-labelledby' rather than an `aria-label' beside it -- two
           names on one element is one of them quietly winning. */
        p.host.setAttribute('role', 'tabpanel');

        p.el.replaceWith(p.slot);
        body.append(p.el);
        p.host.append(body);

        /* Forced open, and the summary hidden: the pane's own header is
           the disclosure now. What it was folded to is kept for the way
           back. */
        if (p.summary !== null)
        {
            p.wasOpen = p.el.open;
            p.el.open = true;
            p.summary.hidden = true;
        }

        return p.host;
    };

    const restore = (p) =>
    {
        if (p.host === null)
            return;

        if (p.summary !== null)
        {
            p.el.open = p.wasOpen;
            p.summary.hidden = false;
        }

        p.slot.replaceWith(p.el);
        p.host.remove();
        p.host = null;
    };

    /* ---- the layout ---- */

    /* A leaf is a node with panes in it; anything else is a split. */
    const isLeaf = (node) => Array.isArray(node.tabs);

    /* What is left of a node once the panes the mode does not have are
       taken out of it. The tree keeps them -- an unavailable pane leaves
       the layout without being forgotten by it, so coming back to a mode
       puts its panes where they were -- and every walk below asks this
       rather than reading `kids' and `tabs' directly. */
    const liveTabs = (leaf) => leaf.tabs.filter(playable);

    const alive = (node) =>
        isLeaf(node) ? liveTabs(node).length > 0 : node.kids.some(alive);

    const liveKids = (node) => node.kids.filter(alive);

    /* What a fraction is worth as `flex-grow': its share of the live
     * children's, rather than the number itself.
     *
     * The numbers are shares of a split and a split's children come and
     * go -- one closed to the drawer, one whose mode is not up -- so
     * what is left of them sums to less than one. A `flex-grow' under
     * one is the CSS rule nobody means: the children take that much of
     * the box and the remainder is a gap with no pane in it and no
     * divider to drag. Closing the third of three panes used to leave a
     * fifth of the column behind that way, dead and unreclaimable.
     * Dividing by what they come to is the whole of the fix.
     */
    const grow = (node, i) =>
    {
        const total = liveKids(node).reduce(
            (a, k) => a + node.size[node.kids.indexOf(k)], 0);

        return String(node.size[i] / (total > 0 ? total : 1));
    };

    /* How narrow a node may be made: a pane's own minimum, a row's the
       sum of its children's with the dividers between them, a column's
       the widest of them. And the same the other way up, where what a
       leaf asks for is a header and a line under it -- a pane has a
       width it is worth having and no height that means anything. */
    const minAcross = (node, row) =>
    {
        if (isLeaf(node))
            return row ? Math.max(...liveTabs(node).map(
                             (id) => panes.get(id).min))
                       : least;

        const kids = liveKids(node);
        const mins = kids.map((k) => minAcross(k, row));

        return (node.dir === 'row') === row
            ? mins.reduce((a, b) => a + b, 0) + (kids.length - 1) * split
            : Math.max(...mins);
    };

    /* ---- what a layout is worth keeping ---- */

    /* A saved layout, read back. Anything that is not a tree of the
       shape this file writes is not one: localStorage is a place other
       things write too, and a layout half-read is worse than the
       default. */
    const sane = (node) =>
        node !== null && typeof node === 'object' &&
        (Array.isArray(node.tabs)
            ? node.tabs.every((id) => typeof id === 'string') &&
              (node.active === undefined ||
               (Number.isInteger(node.active) && node.active >= 0))
            : ['row', 'col'].includes(node.dir) &&
              Array.isArray(node.kids) && node.kids.length > 1 &&
              Array.isArray(node.size) &&
              node.size.length === node.kids.length &&
              node.size.every((f) => typeof f === 'number' && f > 0) &&
              node.kids.every(sane));

    /* And a pane this page has never heard of, dropped -- which is not an
       error and resets nothing. The other way round is the drawer: a pane
       the layout has never seen is simply not in it.

       Unless the page says it will have it later: a pane it adds once it
       is up -- a file opened again, say -- is not here yet when the
       layout is read, and `later' is what keeps its place for it. Kept
       and not drawn, as a pane whose mode is down is.

       So is a pane named twice, after the first: it has one element, and
       two leaves claiming it would pull its box back and forth between
       them on every render, each tab controlling a panel the other has. */
    const known = (node, taken = new Set()) =>
    {
        if (isLeaf(node))
        {
            const tabs = node.tabs.filter((id) =>
                (panes.has(id) || later(id)) && !taken.has(id) &&
                taken.add(id));

            return tabs.length === 0 ? null
                 : { tabs,
                     active: Math.min(node.active ?? 0, tabs.length - 1) };
        }

        const kids = [], size = [];

        node.kids.forEach((k, i) =>
        {
            const kept = known(k, taken);

            if (kept !== null)
            {
                kids.push(kept);
                size.push(node.size[i]);
            }
        });

        return kids.length === 0 ? null
             : kids.length === 1 ? kids[0]
             : { dir: node.dir, size, kids };
    };

    /* Whether a tree names any pane this page has now, whatever mode
       it is in. */
    const holdsAny = (node) =>
        isLeaf(node) ? node.tabs.some((id) => panes.has(id))
                     : node.kids.some(holdsAny);

    const key = () => `${store}:${where}`;

    /* A promise from the storage, which is a server's answer: a write
       that fails is the same as one that throws, and is not left for the
       window to report as unhandled. */
    /* The storage's work, one thing at a time where it answers later.
     *
     * A server takes writes in whatever order they arrive, and a slow
     * one can land after the one that followed it -- an old layout put
     * back over a new one, or over a reset. So each waits for the last,
     * a read waits for the writes before it, and a failure is the same
     * as one that throws: not left for the window to report. A storage
     * that answers at once is called at once.
     */
    let queue = null;

    const track = (p) =>
    {
        const mine = Promise.resolve(p).then(() => {}, () => {});

        queue = mine;
        mine.then(() =>
        {
            if (queue === mine)
                queue = null;
        });
    };

    const write = (op) =>
    {
        const run = () =>
        {
            try
            {
                return op();
            }
            catch
            {
                /* A browser that refuses to remember is a browser that
                   opens on the default, which is a layout and not a
                   failure. */
                return undefined;
            }
        };

        if (queue !== null)
            track(queue.then(run));
        else
        {
            const r = run();

            if (typeof r?.then === 'function')
                track(r);
        }
    };

    /* What is kept: the tree, or -- where the page has said which version
     * of its layouts this is -- the tree with that version on it.
     *
     * The version is how a page changes its mind. A kept layout outlives
     * the default it was made from, so a page that moves a pane, or adds
     * one, would otherwise go on showing everybody who has been here
     * before what they left -- the new pane in the drawer, where nobody
     * looks. A layout kept under another version is not read back, and
     * the page's new default is what comes up.
     */
    const kept = () =>
    {
        /* And a place kept for a pane still to come, asked about again:
           a page whose `later' says what really exists -- the files that
           are still there -- lets go of the rest here, rather than a
           layout keeping a place for a deleted file for ever. The layout
           that is up keeps its own tree; this is what is written. */
        const trimmed = known(structuredClone(tree)) ?? { tabs: [] };

        return JSON.stringify(version === undefined
            ? trimmed : { version, layout: trimmed });
    };

    /* How many times the layout has been asked for or changed. A saved
       layout that arrives late is put up only if nothing has happened
       since it was asked for: what somebody did in the meantime is newer
       than what they did last visit. */
    let edits = 0;

    /* The load a kept layout is still on its way for, if one is; and
       whether the page has been told of a layout since it was asked for,
       which it will have to be told of again once it comes. While one is
       on its way nothing is written: what is in the storage is what is
       coming, and the default up in the meantime is not worth keeping
       over it. */
    let waiting = 0;
    let owed = false;

    /* The layout as the page was last told of it, or as it was loaded:
       what a change is a change from. */
    let last = null;

    const snapshot = () => JSON.stringify(tree);

    const save = () =>
    {
        if (waiting !== 0 || tree === null)
            return;

        const text = kept();
        const at = key();

        write(() => storage.setItem(at, text));
    };

    /* Kept and told of, if it is anything new: what the page does to the
       layout on its own account, such as putting a pane it has just
       added somewhere, and the end of everything a person does. Not
       counted as somebody's change, so a kept layout on its way is still
       put up when it comes -- with this done again over it. True if it
       was new. */
    const told = () =>
    {
        const now = snapshot();

        if (now === last)
            return false;

        last = now;
        owed ||= waiting !== 0;
        save();
        onLayout(structuredClone(tree), where);

        return true;
    };

    /* Somebody changed the layout: it is kept, and the page is told, with
       a copy -- which is what a page keeping layouts somewhere of its own
       needs, and a page offering undo, and one that only wants to know.
       Newer than any kept layout still on its way, which is not put up
       when it comes. A change that changed nothing -- a pane raised that
       was in front, a divider pressed at its limit -- is none of these. */
    const changed = () =>
    {
        if (snapshot() === last)
            return;

        edits++;
        waiting = 0;
        owed = false;
        told();
    };

    /* What the page asked for while a kept layout was on its way, done
       again over it once it comes: a pane raised at somebody. */
    const raised = new Set();

    /* A kept layout on its way no longer wanted: another is being put
       up, from another store or mode or from nothing. */
    const abandon = () =>
    {
        waiting = 0;
        owed = false;
        raised.clear();
    };

    /* A saved layout, as the page's own tree: or null, for one that is
       not there, does not parse, was kept under another version, or keeps
       nothing this page has. */
    const read = (text) =>
    {
        try
        {
            const got = JSON.parse(text);
            const saved = version === undefined ? got
                : got?.version === version ? got.layout ?? null : null;

            const tree = saved !== null && sane(saved) ? known(saved) : null;

            /* One that keeps only panes still to come is no layout yet. */
            return tree !== null && holdsAny(tree) ? tree : null;
        }
        catch
        {
            return null;
        }
    };

    /* The page's own layout for the mode that is up. A saved layout that
       keeps nothing -- every pane closed, or every one it names gone from
       the page -- is no layout, and what there is instead is this, rather
       than every pane stacked in one leaf. */
    const fresh = () =>
        known(structuredClone(layouts?.[where] ??
                              { tabs: [...panes.keys()] })) ??
        { tabs: [...panes.keys()] };

    /* The layout for the mode that is up: what somebody last left, or the
     * page's own default for it.
     *
     * A storage that answers with a promise is answered with the default
     * now and what was kept once it arrives, so that the page is never
     * waiting on a server to be laid out -- unless, by then, the mode has
     * changed, or somebody has moved something, or it has all been handed
     * back.
     */
    const load = () =>
    {
        const ask = ++edits;
        const at = key();
        let saved = null;

        abandon();

        try
        {
            /* After any write still going, so as to read what it wrote. */
            const got = queue !== null
                ? queue.then(() => storage.getItem(at))
                : storage.getItem(at);

            if (typeof got?.then === 'function')
            {
                waiting = ask;
                got.then((text) => arrive(ask, at, text),
                         () => arrive(ask, at, null));
            }
            else
                saved = read(got);
        }
        catch
        {
            saved = null;
        }

        tree = saved ?? fresh();
        last = snapshot();
        stray();
        told();
    };

    /* A kept layout, arrived. Put up if it is still the one asked for and
     * nobody has changed anything since; with the panes the page added in
     * the meantime put into it and the panes it raised raised again, and
     * then kept and told of once -- the page may have been told of the
     * default it replaces. Drawn before the page is told, so that nothing
     * the page does about it leaves the screen behind.
     */
    const arrive = (ask, at, text) =>
    {
        if (waiting !== ask)
            return;

        waiting = 0;

        const kept = dead || ask !== edits || at !== key() ? null
                   : read(text);
        const again = owed;

        owed = false;

        if (kept === null)
        {
            /* Nothing kept, or nothing usable: what is up stays, and is
               what gets kept, if the page was told of it. */
            if (again && !dead)
                save();

            raised.clear();

            return;
        }

        tree = kept;
        last = snapshot();
        stray();

        for (const id of raised)
            if (playable(id))
            {
                const leaf = leafWith(id) ?? target(panes.get(id));

                if (leafWith(id) === null)
                    into(id, leaf);
                else
                    leaf.active = liveTabs(leaf).indexOf(id);
            }

        raised.clear();

        if (tiled)
            render();

        if (again)
            last = null;

        told();
    };

    /* ---- moving a pane about ---- */

    /* Which leaf holds a pane, and which split holds a node. The tree is
       small -- a handful of leaves -- so it is walked rather than kept
       with parent links, which would be one more thing for a saved
       layout to be wrong about. */
    const leafWith = (id, node = tree) =>
        isLeaf(node)
            ? (node.tabs.includes(id) ? node : null)
            : node.kids.reduce((f, k) => f ?? leafWith(id, k), null);

    const parentOf = (target, node = tree) =>
        isLeaf(node) ? null
            : node.kids.includes(target) ? node
            : node.kids.reduce((f, k) => f ?? parentOf(target, k), null);

    const firstLeaf = (node = tree) =>
        isLeaf(node) ? node : firstLeaf(node.kids[0]);

    /* The element a leaf was last drawn as, which is how anything that
       needs pixels -- whether a split would fit, where a drop would land
       -- asks the browser rather than working them out again. */
    const boxOf = (leaf) =>
        [...seen].find(([, node]) => node === leaf)?.[0];

    /* A leaf with nothing left in it, taken out of the tree, and the
       split above it collapsed if that leaves it with one child --
       a split of one is not a split. */
    const empty = (leaf) =>
    {
        const up = parentOf(leaf);

        if (up === null)
        {
            tree = { tabs: [], active: 0 };
            return;
        }

        const i = up.kids.indexOf(leaf);

        up.kids.splice(i, 1);
        up.size.splice(i, 1);

        if (up.kids.length > 1)
            return;

        const only = up.kids[0];
        const over = parentOf(up);

        if (over === null)
            tree = only;
        else
            over.kids[over.kids.indexOf(up)] = only;

        /* A pane closed beside this split, and waiting to come back
           beside it, comes back beside what is left of it -- and beside
           the split again if the pane just closed out of it comes back
           first and makes it again (see `reopen'). */
        for (const s of spot.values())
            if (s.next === up)
            {
                s.next = only;
                s.via = up.dir;
            }
    };

    /* Out of the layout: into the drawer, which is where every pane not
       in the tree is. Nothing is destroyed -- a drawer is the whole
       reason closing a pane is not losing it. */
    const drawer = (id) =>
    {
        const leaf = leafWith(id);

        if (leaf === null)
            return;

        /* What was in front stays in front, which is an index that
           shifts when the tab leaving sat before it. Clamping alone
           would leave the index where it was and raise the neighbor
           instead. Counted over the tabs in play, since that is what
           `active' is an index into. */
        const at = liveTabs(leaf).indexOf(id);
        const was = leaf.active ?? 0;

        home.set(id, leaf);

        leaf.tabs.splice(leaf.tabs.indexOf(id), 1);
        leaf.active = Math.max(0, Math.min(at !== -1 && at < was ? was - 1
                                                                : was,
                                           liveTabs(leaf).length - 1));

        const up = leaf.tabs.length === 0 ? parentOf(leaf) : null;

        if (up === null)
            spot.delete(id);
        else
        {
            const i = up.kids.indexOf(leaf);
            const total = up.size.reduce((a, b) => a + b, 0);

            spot.set(id, { next: up.kids[i > 0 ? i - 1 : i + 1],
                           after: i > 0, dir: up.dir,
                           share: up.size[i] / total });
        }

        if (leaf.tabs.length === 0)
            empty(leaf);
    };

    /* What a person's close does to a pane, by its kind.
     *
     * A lasting pane goes to the drawer. An ephemeral one is not the
     * layout's to end: the page is asked, through onDiscard, and ends it
     * with `remove' -- now, after asking about unsaved changes, or not
     * at all. So nothing moves here for one, and without onDiscard it
     * cannot be closed from the layout at all: no cross, no chord, no
     * drop on the drawer. True where a close happened here and now.
     */
    const closable = (id) =>
        !panes.get(id).ephemeral || typeof onDiscard === 'function';

    const dismiss = (id) =>
    {
        if (!panes.get(id).ephemeral)
        {
            putAway(id);
            return true;
        }

        if (closable(id))
            onDiscard(id);

        return false;
    };

    /* Put away by somebody, which is the drawer, and remembered as put
       away: a pane the page added stays where somebody put it. */
    const putAway = (id) =>
    {
        drawer(id);
        dismissed.add(id);
    };

    /* Into a leaf, as the tab in front of it: before the tab named, at
       the end of the strip for null, or -- for nothing said -- at the
       end, unless it is in this leaf already. By name and not by place,
       since taking this one out of the strip first moves every place
       after it. */
    const into = (id, leaf, before) =>
    {
        /* Into the leaf it is already in, and nowhere in particular -- or
           onto a strip with nothing else in it to go before or after: in
           front, where it was. Moving it to the end of the strip was
           never what that asked, and taking it out first empties a leaf
           of one, which takes the leaf out of the tree it is going
           back into. */
        if (leafWith(id) === leaf &&
            (before === undefined || liveTabs(leaf).length === 1))
        {
            leaf.active = liveTabs(leaf).indexOf(id);
            return;
        }

        drawer(id);
        dismissed.delete(id);

        const at = typeof before === 'string' ? leaf.tabs.indexOf(before) : -1;

        leaf.tabs.splice(at === -1 ? leaf.tabs.length : at, 0, id);

        /* Counted over the tabs in play and not over all of them:
           `active' is an index into the first, and a leaf holding a pane
           whose mode is down has fewer of the one than the other. */
        leaf.active = liveTabs(leaf).indexOf(id);
    };

    /* And beside one, which is what splitting is: the leaf is replaced by
       a split holding it and the newcomer, each with half of what the
       leaf had. Refused where the two could not both have their minimum
       -- a split nobody can see either side of is not a split. */
    const beside = (id, leaf, dir, after) =>
    {
        const from = leafWith(id);

        /* Counted over the tabs in play: a leaf whose only other tabs are
           off with their mode, or places kept for panes still to come,
           has nothing on the screen to split from. */
        if (from === leaf && liveTabs(leaf).length === 1)
            return;

        drawer(id);

        /* Out of the drawer by a split is out of it as much as by a
           click: no longer somebody's to have put away. */
        dismissed.delete(id);

        const made = { tabs: [id], active: 0 };
        const pair = { dir, size: [0.5, 0.5],
                       kids: after ? [leaf, made] : [made, leaf] };
        const up = parentOf(leaf);

        if (up === null)
            tree = pair;
        else
            up.kids[up.kids.indexOf(leaf)] = pair;
    };

    /*
     * Back out of the drawer, to where it was: the leaf it was last in,
     * if the tree still has it; or, if it emptied that leaf on its way
     * out, a leaf of its own beside the neighbor it had, on the same
     * side and with the same share -- as a sibling again where the split
     * it was in still runs that way, or in a split of two made for it
     * where that one collapsed. Where neither is left, into `fallback'.
     * `avoid' is a leaf it must not be put in front of. Returns the leaf
     * it went into.
     */
    const reopen = (id, fallback, avoid = null) =>
    {
        const back = home.get(id);

        if (back !== undefined && back !== avoid && holds(back))
        {
            into(id, back);
            return back;
        }

        const was = spot.get(id);

        if (was === undefined || !holds(was.next))
        {
            into(id, fallback);
            return fallback;
        }

        /* The leaf it left, empty, rather than a new one: another pane
           closed beside it may be keeping it as its neighbor, and is
           put back beside it too only if it is the same leaf. */
        const made = back !== undefined && back.tabs.length === 0
            ? back : { tabs: [], active: 0 };
        const up = parentOf(was.next);

        if (up !== null && up.dir === was.dir)
        {
            const total = up.size.reduce((a, b) => a + b, 0);
            const i = up.kids.indexOf(was.next) + (was.after ? 1 : 0);

            /* Its share back, and the rest of the split what is left,
               in the proportions they have now. */
            up.size = up.size.map((v) => v / total * (1 - was.share));
            up.kids.splice(i, 0, made);
            up.size.splice(i, 0, was.share);
        }
        else
        {
            const pair = {
                dir: was.dir,
                size: was.after ? [1 - was.share, was.share]
                                : [was.share, 1 - was.share],
                kids: was.after ? [was.next, made] : [made, was.next],
            };

            if (up === null)
                tree = pair;
            else
                up.kids[up.kids.indexOf(was.next)] = pair;

            /* The split this was closed out of, made again: a pane
               closed beside it before it collapsed goes beside it
               again, not beside the one leaf that was left of it. */
            for (const s of spot.values())
                if (s.next === was.next && s.via === was.dir)
                {
                    s.next = pair;
                    delete s.via;
                }
        }

        into(id, made);

        return made;
    };

    /* Whether a leaf has room to be split in a direction: both halves
       have to fit what the panes under them asked for. */
    const splittable = (leaf, id, dir) =>
    {
        const box = boxOf(leaf);

        if (box === undefined)
            return false;

        const rect = box.getBoundingClientRect();
        const row = dir === 'row';
        const want = minAcross(leaf, row) +
                     (row ? panes.get(id).min : least) + split;

        return (row ? rect.width : rect.height) >= want;
    };

    /* A leaf about to be put in front of somebody, which a zoom on
       another leaf would leave drawn and not shown. What was asked for
       wins over what was zoomed. */
    const unzoomFor = (leaf) =>
    {
        if (zoom !== null && zoom !== leaf)
            zoom = null;
    };

    /* By id, whatever is in it: a pane's id is the page's, and a `.' or
       a `:' in one is a class or a pseudo-class to a selector. */
    const find = (id) => root.querySelector(`#${CSS.escape(id)}`);

    /* Whether a row runs from the right where this element is: a page
     * that reads right to left lays a split's first child out on the
     * right, and everything that turns a direction on the screen into a
     * place in the tree -- an arrow key, a pointer dragged, an edge
     * dropped on -- has to turn it the other way round there. Asked of
     * the element each time rather than of the page once: a direction
     * is inherited, and can change under any box.
     */
    const backward = (el) => getComputedStyle(el).direction === 'rtl';

    /* ---- dragging a tab ---- */

    /* Where a tab would land if it were let go here: a place in a strip,
       a leaf to be moved into, an edge of one to be split off, or the
       drawer. */
    const under = (x, y, id) =>
    {
        const at = document.elementFromPoint(x, y);

        if (at === null)
            return null;

        const tray = at.closest('.panedrawer');

        /* Over the drawer itself, and not over the whole layout: what a
           drop does is put this pane there, and a hint the size of the
           root says the opposite of that. */
        if (tray !== null)
            return closable(id) ? { drop: 'drawer', box: tray } : null;

        const box = at.closest('.paneleaf');
        const leaf = seen.get(box);

        if (leaf === undefined)
            return null;

        /* Over the strip, which is a row of places: before the first tab
           whose middle is past the pointer, or after the last. The tab
           being dragged is not a place -- it is what is moving -- so
           holding it over itself puts it back where it was. */
        const strip = at.closest('.panetabs');

        if (strip !== null)
        {
            /* The way the strip reads: in a page that reads leftward the
               next tab is the one to the left, and a tab goes before one
               by landing on its right. */
            const rtl = backward(strip);
            const tabs = [...strip.querySelectorAll('.panetab')]
                .map((t) => [t.id.replace(/^panetab-/, ''),
                             t.getBoundingClientRect()])
                .filter(([other]) => other !== id);
            const past = (t) => (rtl ? t.left + t.width / 2 < x
                                     : t.left + t.width / 2 > x);
            const next = tabs.find(([, t]) => past(t));
            const last = tabs.at(-1)?.[1];
            const row = strip.getBoundingClientRect();

            return { drop: 'tab', leaf, box: strip,
                     before: next?.[0] ?? null,
                     x: next !== undefined ? (rtl ? next[1].right
                                                  : next[1].left)
                      : last !== undefined ? (rtl ? last.left : last.right)
                      : rtl ? row.right : row.left };
        }

        const r = box.getBoundingClientRect();
        const fx = (x - r.left) / r.width;
        const fy = (y - r.top) / r.height;
        /* The outer `edge' of the box on each side, which is enough to
           aim at with a pointer and leaves the middle -- the common
           answer, "put it in this one" -- most of the box. */
        const side =
            fx < edge ? ['row', false] : fx > 1 - edge ? ['row', true]
          : fy < edge ? ['col', false] : fy > 1 - edge ? ['col', true]
          : null;

        if (side === null || !splittable(leaf, id, side[0]))
            return { drop: 'into', leaf, box };

        /* `far' is the right or the bottom half, which is what is drawn;
           `after' is which side of the leaf it goes in the tree, which
           for a row is the other one in a page that reads leftward. */
        const [dir, far] = side;

        return { drop: 'beside', leaf, box, dir, far,
                 after: dir === 'row' && backward(box) ? !far : far };
    };

    /* What the drop would do, drawn over the pane it would do it to. */
    const mark = (where) =>
    {
        if (hint === null)
        {
            hint = el('panedrop');
            hint.hidden = true;
            root.append(hint);
        }

        if (where === null)
        {
            hint.hidden = true;
            return;
        }

        const r = (where.box ?? root).getBoundingClientRect();
        const o = root.getBoundingClientRect();

        /* A place in a strip is a line between two tabs, not a box. */
        hint.classList.toggle('paneslot', where.drop === 'tab');

        if (where.drop === 'tab')
        {
            hint.hidden = false;
            hint.style.left = `${where.x - o.left}px`;
            hint.style.top = `${r.top - o.top}px`;
            hint.style.width = '';
            hint.style.height = `${r.height}px`;

            return;
        }

        const half = where.drop === 'beside';
        const row = where.dir === 'row';

        hint.hidden = false;
        hint.style.left = `${r.left - o.left +
            (half && row && where.far ? r.width / 2 : 0)}px`;
        hint.style.top = `${r.top - o.top +
            (half && !row && where.far ? r.height / 2 : 0)}px`;
        hint.style.width = `${half && row ? r.width / 2 : r.width}px`;
        hint.style.height = `${half && !row ? r.height / 2 : r.height}px`;
    };

    /* A tab, dragged. Pointer events rather than the browser's own drag:
       what is being moved is a box in a layout, and what has to be shown
       while it moves is where it would land, which the browser's drag
       image knows nothing about. */
    const grab = (tab, id) =>
    {
        tab.addEventListener('pointerdown', (e) =>
        {
            if (e.button !== 0)
                return;

            const from = { x: e.clientX, y: e.clientY };
            let dragging = false;
            let where = null;

            /* This pointer's, and no other's: a pen and a finger on the
               same strip are two gestures. */
            const mine = (m) => m.pointerId === e.pointerId;

            const move = (m) =>
            {
                if (!mine(m) || (!dragging &&
                    Math.hypot(m.clientX - from.x, m.clientY - from.y) < 5))
                    return;

                dragging = true;
                tab.classList.add('panedragging');

                /* And the drawer, which is where this could be dropped
                   and is not on the screen while it is empty. Closing
                   the first pane should not need the drawer to already
                   have one in it. */
                root.classList.add('panedrag');
                where = under(m.clientX, m.clientY, id);
                mark(where);
            };

            const tidy = () =>
            {
                window.removeEventListener('pointermove', move, true);
                tab.classList.remove('panedragging');
                root.classList.remove('panedrag');
                mark(null);
            };

            /* Escape, which is how anybody expects to take back a drag
             * they did not mean. The tab stops following the pointer and
             * the hint goes, but the pointer is still held down: letting
             * go of it later is still the end of a drag, and still not a
             * click on whatever tab it is over.
             */
            const escape = (k) =>
            {
                if (k.key !== 'Escape' || !dragging)
                    return;

                where = null;
                tidy();
                k.preventDefault();
                k.stopPropagation();
            };

            const up = (u) =>
            {
                if (!mine(u))
                    return;

                window.removeEventListener('pointerup', up, true);
                window.removeEventListener('pointercancel', up, true);
                window.removeEventListener('keydown', escape, true);
                tidy();

                if (!dragging)
                    return;

                /* A drag is not a click, and the browser sends one
                   anyway: let go anywhere that is not a drop and the
                   button pressed is the button clicked, which raises a
                   tab or reopens a closed pane nobody asked to reopen.
                   Taken for this one click and no other -- where a drop
                   does land the element is gone before it would come. */
                const stop = (c) =>
                {
                    c.stopImmediatePropagation();
                    c.preventDefault();
                };

                tab.addEventListener('click', stop,
                                     { capture: true, once: true });
                setTimeout(() =>
                    tab.removeEventListener('click', stop, true), 0);

                /* Let go over what a render since has taken away -- a
                   leaf no longer in the tree, a pane the page removed,
                   or everything, handed back -- is let go over nothing. */
                if (where === null || dead || !panes.has(id) ||
                    (where.leaf !== undefined && !holds(where.leaf)))
                    return;

                const was = JSON.stringify(tree);

                if (where.drop === 'drawer')
                    dismiss(id);
                else if (where.drop === 'tab')
                    into(id, where.leaf, where.before);
                else if (where.drop === 'into')
                    into(id, where.leaf);
                else
                    beside(id, where.leaf, where.dir, where.after);

                /* A tab let go where it was is not a new layout. */
                if (JSON.stringify(tree) !== was)
                    changed();

                render();
            };

            /* The capture is what makes elementFromPoint the question
               being asked: without it the tab stops hearing the pointer
               the moment it leaves its own box. Heard on the window and
               not on the tab, because a render while the pointer is down
               -- a title, a pane added, a kept layout arriving -- makes
               the tab again, and one taken out of the document hears
               nothing: the drag would never end, and its Escape would be
               the page's for good. */
            tab.setPointerCapture(e.pointerId);
            window.addEventListener('pointermove', move, true);
            window.addEventListener('pointerup', up, true);
            window.addEventListener('pointercancel', up, true);

            /* Captured, and on the window: the focus may be anywhere, and
               an Escape that ended a drag is not also one for the page. */
            window.addEventListener('keydown', escape, true);
        });
    };

    /* ---- drawing it ---- */

    const el = (cls) =>
    {
        const d = document.createElement('div');

        d.className = cls;

        return d;
    };

    /*
     * The box a node is drawn as, kept from render to render.
     *
     * Which is most of what makes a render cheap, and all of what makes
     * it harmless. Building the tree out of new elements every time means
     * every pane is taken out of the document and put back, and the
     * document does not treat that as a move: a box somebody had scrolled
     * half way down is at the top again, an <iframe> loads a second time,
     * a media element stops. None of which anybody asked for, and all of
     * which used to happen on every tab click.
     *
     * So a node keeps its box, a box keeps the panes that did not go
     * anywhere, and what a render moves is what actually moved. Weakly,
     * because the tree is replaced whole on a mode or a reset and the
     * nodes it held are then nobody's.
     */
    const boxes = new WeakMap();
    const rails = new WeakMap();

    const elementFor = (node) =>
    {
        let box = boxes.get(node);

        if (box !== undefined)
            return box;

        box = el(isLeaf(node) ? 'paneleaf' : 'panebox');
        boxes.set(node, box);

        if (isLeaf(node))
        {
            const strip = el('panetabs');

            strip.setAttribute('role', 'tablist');
            strip.setAttribute('aria-label', 'Panes');
            box.append(strip);

            /* Which leaf the next thing out of the drawer goes into, and
               which one the keyboard is in. Captured, because a press
               that lands in a canvas never reaches this box otherwise.
               Once, now that the box outlives the render. */
            box.addEventListener('pointerdown', () => { focus = node; },
                                 true);
        }

        return box;
    };

    /* The box that stands for a node, which is not always its own: a
       split with one live child is that child, since there is nothing to
       divide. */
    const standIn = (node) =>
        !isLeaf(node) && liveKids(node).length === 1
            ? standIn(liveKids(node)[0])
            : elementFor(node);

    /*
     * Moved, and not taken out and put back, where the browser can.
     *
     * Some moves are real ones. A split that loses its last pane but one
     * collapses, and the box that is left goes up a level into the split
     * above -- and an ordinary insert is a removal and an insertion, so
     * an <iframe> in it loads again and a box in it is scrolled to the
     * top. `moveBefore' is a move the document keeps state through.
     * Both ends have to be in the document for it, which every render
     * here already sees to; anything else is an ordinary insert.
     *
     * And where it is scrolled to, written back by hand. `moveBefore'
     * keeps it in Chromium and not in Firefox, which keeps the <iframe>
     * and puts every scroller in what moved back at the start -- and an
     * ordinary insert does that everywhere.
     */
    const place = (parent, child, before = null) =>
    {
        const held = child.isConnected ? scrolls(child) : [];

        move(parent, child, before);

        for (const [box, left, top] of held)
        {
            if (box.scrollLeft !== left)
                box.scrollLeft = left;

            if (box.scrollTop !== top)
                box.scrollTop = top;
        }
    };

    /* Every box under this one that is scrolled away from its start.
     *
     * Out of the boxes somebody has scrolled, which the document says as
     * it happens, rather than out of every element there is: asking each
     * where it is scrolled to lays out whatever is not drawn, and a pane
     * of a hundred thousand rows took the best part of a second to close
     * that way, and four in Firefox.
     */
    const scrolled = new Set();

    const noteScroll = (e) =>
    {
        if (e.target instanceof Element && root.contains(e.target))
            scrolled.add(e.target);
    };

    document.addEventListener('scroll', noteScroll, true);

    const scrolls = (under) =>
    {
        const found = [];

        for (const box of scrolled)
            if (!box.isConnected)
                scrolled.delete(box);
            else if (under.contains(box) &&
                     (box.scrollLeft !== 0 || box.scrollTop !== 0))
                found.push([box, box.scrollLeft, box.scrollTop]);

        return found;
    };

    const move = (parent, child, before) =>
    {
        if (parent.moveBefore !== undefined && parent.isConnected &&
            child.isConnected)
        {
            /* Style brought up to date on both sides of the move.
               Chromium's renderer has crashed outright -- the page gone
               -- on a move into a box one of whose children had just
               been hidden or shown, before the move or after it: a pane
               behind a tab is exactly that. Laying the document out
               either side prevents it -- a read of a computed style is
               not always enough, a read of a size is -- and `fillLeaf'
               also settles which panes are hidden before it moves any.
               Both stay until the browser's fix is what people have. */
            void parent.offsetWidth;

            try
            {
                parent.moveBefore(child, before);
                void parent.offsetWidth;
                return;
            }
            catch
            {
                /* A move the browser will not make whole is an ordinary
                   one, which is what there was before. */
            }
        }

        parent.insertBefore(child, before);
    };

    /* What each render's arranging left over, with the box it was left
       in. Taken out at the end of the render and not as it is found: a
       box that is going can still hold a pane that is not -- a closed
       one, on its way to `keep' -- and a pane moved out of a box still
       in the document is moved, where one taken out with it is not. */
    let stale = [];

    /* The children a box is to have, in that order, with nothing left
       after them -- and anything already where it belongs left alone,
       which is the point of the whole arrangement: moving an element is
       what costs. */
    const arrange = (box, kids) =>
    {
        kids.forEach((kid, i) =>
        {
            if (box.children[i] !== kid)
                place(box, kid, box.children[i] ?? null);
        });

        for (const extra of [...box.children].slice(kids.length))
            stale.push([box, extra]);
    };

    /* A leaf: a strip of tabs and a host per pane, with the one in front
     * shown and the rest beside it, hidden.
     *
     * The strip is the pane's header when there is one pane, and a row of
     * them when there are more; it is the same element either way, which
     * is why a <details> adopted here can hand its disclosure over to it
     * without the page having two kinds of header to style.
     *
     * The strip is written out again every time because it is buttons and
     * nothing else. The hosts are not: one is touched only where it has
     * come from somewhere else. What order they sit in says nothing --
     * one of them is shown and the rest are not -- so it is not made to
     * say anything, and a tab raised over another moves no boxes at all.
     */
    const fillLeaf = (leaf) =>
    {
        const ids = liveTabs(leaf);
        const box = elementFor(leaf);
        const strip = box.firstElementChild;
        const wraps = [];

        box.classList.toggle('panebare', ids.length === 1 && bare(ids[0]));

        leaf.active = Math.min(Math.max(leaf.active ?? 0, 0), ids.length - 1);

        /* Which host is shown, settled for all of them before any is
           moved. A host hidden after another has been moved in beside it
           is what has taken Chromium's renderer down (see `move'), and
           there is no order of moves that makes that safe -- only not
           doing it. */
        ids.forEach((id, i) =>
        {
            adopt(panes.get(id)).hidden = i !== leaf.active;
        });

        ids.forEach((id, i) =>
        {
            const p = panes.get(id);
            const host = adopt(p);

            /* The tab and the cross that closes it, in a wrapper of
               their own. A tablist's children are tabs, and a cross is
               not one -- `presentation' is what lets a tablist hold the
               pair and go on owning the tab inside it. It is also what
               keeps a tab's text the pane's title and nothing else. */
            const wrap = el('panetabwrap');
            const tab = document.createElement('button');
            const shut = document.createElement('button');
            const front = i === leaf.active;

            wrap.setAttribute('role', 'presentation');

            tab.type = 'button';
            tab.className = 'panetab';
            tab.id = `panetab-${id}`;
            tab.textContent = p.title;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-controls', host.id);
            tab.setAttribute('aria-selected', String(front));

            /* Roving: one pane, one stop -- and the cross beside it, so
               closing a pane needs no chord to be found. Tabbing through
               a layout should pass the panes, not every tab of every one
               of them. */
            tab.tabIndex = front ? 0 : -1;
            tab.addEventListener('click', () => raise(leaf, i));
            tab.addEventListener('keydown', (e) => along(e, leaf, ids, i));
            grab(tab, id);

            shut.type = 'button';
            shut.className = 'paneshut';
            shut.id = `paneshut-${id}`;
            shut.textContent = '×';
            shut.title = `Close ${p.title}`;
            shut.setAttribute('aria-label', `Close ${p.title}`);
            shut.tabIndex = front ? 0 : -1;
            shut.addEventListener('click', () => shutTab(id, leaf));

            host.setAttribute('aria-labelledby', tab.id);

            /* In front of somebody, which a zoom is entitled to answer
               no to: the other leaves are drawn and not shown, and a
               pane nobody can see is a pane whose work can stop whatever
               the reason nobody can see it. */
            if (front && (zoom === null || zoom === leaf))
                onScreen.add(id);

            attached.add(id);

            if (host.parentElement !== box)
                place(box, host);

            /* No cross for a pane nothing here can close: an ephemeral
               one on a page that has not said how it ends. */
            wrap.append(tab, ...(closable(id) ? [shut] : []));
            wraps.push(wrap);
        });

        strip.replaceChildren(...wraps);

        box.style.minWidth = `${minAcross(leaf, true)}px`;
        box.style.minHeight = `${least}px`;
        box.classList.toggle('panefront', zoom === leaf);
        box.hidden = false;
        seen.set(box, leaf);
    };

    /* A pane put away from its own tab, which is the drawer and not the
     * bin.
     *
     * The focus follows it, onto the drawer button that brings it back
     * -- the one thing left on the page that names it. A cross that
     * closed a pane and left the keyboard somewhere up the document is
     * how a person ends up not finding it again, and the drawer is only
     * an answer to that if it is where they are looking.
     */
    const shutTab = (id, leaf) =>
    {
        if (!dismiss(id))
            return;

        focus = leaf;
        changed();
        render();

        /* Onto its button in the drawer where the keyboard can reach one
           -- not where the drawer is a menu of the page's that is shut,
           and not for a pane that has no button to come back by. There,
           onto the tab in front of what is left, as Alt W does, rather
           than out to the top of the document. */
        const back = tray.querySelector(`#${CSS.escape(`panereopen-${id}`)}`);

        back?.focus();

        if (back === null || document.activeElement !== back)
            raiseTab(holds(leaf) ? leaf : firstLeaf());
    };

    /* The tab in front of a leaf, with the focus left where the person
       put it: a tab they clicked is a tab they are on. */
    const raise = (leaf, i) =>
    {
        const id = liveTabs(leaf)[i];

        if (leaf.active === i)
            return;

        leaf.active = i;
        changed();
        render();
        find(`panetab-${id}`)?.focus();
    };

    /* Along the strip. Moving the focus moves the tab, which is what a
       tablist does when what a tab shows costs nothing to show. */
    const along = (e, leaf, ids, i) =>
    {
        /* Plain keys only. The chords are the window's, and a tab that
           answered Alt and an arrow as well would raise its neighbor
           before the chord asked which pane is in front -- and the
           chord would move that one. */
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey)
            return;

        /* The arrow pointing the way the strip reads is the next tab.
           Any other key is not this strip's: Enter and Space are the
           button's, Tab is the page's. */
        const arrow = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
        const step = arrow === undefined ? undefined
                   : arrow * (backward(e.currentTarget) ? -1 : 1);
        const to = e.key === 'Home' ? 0
                 : e.key === 'End' ? ids.length - 1
                 : step === undefined ? -1
                 : (i + step + ids.length) % ids.length;

        if (to < 0)
            return;

        raise(leaf, to);
        e.preventDefault();
    };

    /* What a divider is worth saying about itself: which share of the two
       beside it the first one has. Written out rather than closed over,
       since the divider outlives the pair. */
    const tell = (node, at, bar) =>
    {
        const kids = liveKids(node);
        const a = kids[at];
        const b = kids[at + 1];

        if (a === undefined || b === undefined)
            return;

        const fa = node.size[node.kids.indexOf(a)];
        const fb = node.size[node.kids.indexOf(b)];

        bar.setAttribute('aria-valuenow',
                         String(Math.round(fa / (fa + fb) * 100)));
    };

    /* A divider between two of a split's live children, which is the one
     * control the layout has of its own.
     *
     * A drag moves a fraction and nothing else: the two panes on either
     * side share what they had between them, every other fraction in the
     * tree is untouched, and the browser lays the result out. Neither
     * side goes below its minimum, which for a row is the widest pane
     * under it and for a column is a header and a line.
     *
     * Kept from render to render like every other box here, and by its
     * place in the split rather than by the pair it happens to be
     * between: what is on either side of a divider changes and the
     * divider does not, so it asks when it is used instead of
     * remembering.
     */
    const dividerOf = (node, at) =>
    {
        const bars = rails.get(node) ?? [];

        if (bars[at] !== undefined)
            return bars[at];

        const row = node.dir === 'row';
        const bar = el('panesplit');

        const sides = () =>
        {
            const kids = liveKids(node);
            const a = kids[at];
            const b = kids[at + 1];

            return a === undefined || b === undefined ? null
                 : { ia: node.kids.indexOf(a), ib: node.kids.indexOf(b),
                     ea: standIn(a), eb: standIn(b) };
        };

        bar.setAttribute('role', 'separator');
        bar.setAttribute('aria-orientation', row ? 'vertical' : 'horizontal');

        /* A separator somebody can put the focus on is a control, and a
           control with no name is one a screen reader announces as
           nothing at all. */
        bar.setAttribute('aria-label', row ? 'Resize columns' : 'Resize rows');
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', '100');
        bar.tabIndex = 0;

        /* By pixels rather than by fractions: what the two are worth now
           is what the browser made of them, so the drag follows the
           pointer exactly whatever else is in the split. */
        const by = (pixels) =>
        {
            const s = sides();

            if (s === null)
                return;

            const ra = s.ea.getBoundingClientRect();
            const rb = s.eb.getBoundingClientRect();
            const was = row ? ra.width : ra.height;
            const both = was + (row ? rb.width : rb.height);
            const floor = minAcross(node.kids[s.ia], row);
            const ceiling = both - minAcross(node.kids[s.ib], row);
            const sum = node.size[s.ia] + node.size[s.ib];

            /* Two panes that cannot both have what they asked for: the
               browser has already overflowed them and there is no
               fraction that makes it better. */
            if (ceiling < floor)
                return;

            const now = Math.max(floor, Math.min(ceiling, was + pixels));

            node.size[s.ia] = sum * (now / both);
            node.size[s.ib] = sum - node.size[s.ia];
            s.ea.style.flexGrow = grow(node, s.ia);
            s.eb.style.flexGrow = grow(node, s.ib);
            tell(node, at, bar);
        };

        bar.addEventListener('pointerdown', (e) =>
        {
            let from = row ? e.clientX : e.clientY;
            let moved = false;

            const move = (m) =>
            {
                const to = row ? m.clientX : m.clientY;

                moved ||= to !== from;
                by((to - from) * (row && backward(bar) ? -1 : 1));
                from = to;
            };

            /* Kept and told only if it went anywhere: a press on a
               divider is not a new layout. */
            const up = () =>
            {
                bar.removeEventListener('pointermove', move);
                bar.removeEventListener('pointerup', up);
                bar.removeEventListener('pointercancel', up);

                if (moved)
                    changed();
            };

            bar.setPointerCapture(e.pointerId);
            bar.addEventListener('pointermove', move);
            bar.addEventListener('pointerup', up);
            bar.addEventListener('pointercancel', up);
            e.preventDefault();
        });

        /* A fraction moved without a pointer, which is the whole of what
           a separator is for to anybody driving this from the keys. */
        bar.addEventListener('keydown', (e) =>
        {
            const step = { ArrowLeft: -1, ArrowUp: -1,
                           ArrowRight: 1, ArrowDown: 1 }[e.key];

            if (step === undefined)
                return;

            /* Left and right the way the pointer would go: in a row that
               reads leftward, the first child is the one on the right. */
            const flip = e.key === 'ArrowLeft' || e.key === 'ArrowRight';

            by(step * 16 * (flip && row && backward(bar) ? -1 : 1));
            changed();
            e.preventDefault();
        });

        /* Every share of the split it is in, equal. */
        bar.addEventListener('dblclick', () =>
        {
            const kids = liveKids(node);
            const share = kids.reduce(
                (a, k) => a + node.size[node.kids.indexOf(k)], 0) /
                kids.length;

            for (const k of kids)
                node.size[node.kids.indexOf(k)] = share;

            changed();
            render();
        });

        bars[at] = bar;
        rails.set(node, bars);

        return bar;
    };

    /* A split: its live children with their fractions as `flex-grow', and
       a divider between each pair. A split with one live child is that
       child -- there is nothing to divide -- which is what `standIn' says
       and what this follows. */
    const fill = (node) =>
    {
        if (isLeaf(node))
        {
            fillLeaf(node);
            return;
        }

        const kids = liveKids(node);

        if (kids.length === 1)
        {
            fill(kids[0]);
            return;
        }

        const box = elementFor(node);
        const want = [];

        box.dataset.dir = node.dir;

        kids.forEach((k, i) =>
        {
            const child = standIn(k);

            child.style.flexGrow = grow(node, node.kids.indexOf(k));

            if (i > 0)
            {
                const bar = dividerOf(node, i - 1);

                tell(node, i - 1, bar);
                want.push(bar);
            }

            want.push(child);
        });

        arrange(box, want);

        /* Filled after they are in place, and not before: a box takes its
           children only while it is itself in the document, or the first
           render after a split would detach every pane under it -- which
           is the thing all of this is shaped to avoid. */
        kids.forEach(fill);
    };

    /* The mode's layout as the page wrote it: what was kept is forgotten
       and the tree is made again from the default. By the chord, by the
       drawer's button, or by the page.

       Made here and not read back through `load': a storage that answers
       later may not have forgotten yet, and would hand back the layout
       this is starting over from. */
    const reset = () =>
    {
        const at = key();

        /* Nothing to forget is the same as forgetting. Not written over
           with the default, either: a page's default may change, and a
           layout nobody made is not one to keep. */
        write(() => storage.removeItem(at));

        edits++;
        abandon();
        zoom = null;
        tree = fresh();
        stray();
        focus = null;
        render();
        last = snapshot();
        onLayout(structuredClone(tree), where);
    };

    /* The mode's own layout back, where a chord cannot be pressed: a
       phone, whose only other way out of a leaf with no strip is the
       storage in its settings. One button, kept, and put by `seat' at
       the end of the first strip there is -- room every layout has
       spare -- or in the drawer's row when every leaf is bare. */
    let again$ = null;

    if (again !== null)
    {
        const wrap = el('panereset');
        const button = document.createElement('button');

        wrap.setAttribute('role', 'presentation');
        button.type = 'button';
        button.textContent = again;
        button.title = 'Put back the layout this page starts with';
        /* Named "Reset layout" where what it shows is a glyph, which
           says nothing aloud; where it shows words, those are its name,
           since a name that is not the words on it is not one somebody
           using speech can say to press it. */
        if (!/\p{L}/u.test(again))
            button.setAttribute('aria-label', 'Reset layout');
        button.addEventListener('click', () => reset());
        wrap.append(button);
        again$ = wrap;
    }

    const seat = () =>
    {
        if (again$ === null)
            return;

        /* By the tree and not the document: a render leaves the boxes
           of a layout that is going in the root until their panes are
           out of them. */
        const shows = (node) =>
            (isLeaf(node)
                ? (liveTabs(node).length > 0 &&
                   (zoom === null || zoom === node) &&
                   !elementFor(node).classList.contains('panebare')
                    ? node : null)
                : liveKids(node).reduce((f, k) => f ?? shows(k), null));
        const leaf = tree !== null && alive(tree) ? shows(tree) : null;
        const strip = leaf === null ? undefined
                                    : elementFor(leaf).firstElementChild;

        if (strip !== undefined)
            strip.append(again$);
        else
        {
            tray.append(again$);
            tray.hidden = false;
        }
    };

    /* The panes no leaf has room for, listed above the layout: one click
       from being put back, into the leaf they left or -- where that leaf
       closed with them -- whichever one was last touched. Nothing here
       is a pane that has gone; a drawer is what makes closing one
       something other than losing it.
     *
       Or listed in `drawer', an element of the page's, when it has one:
       a phone's side menu, where the row above the layout was height the
       layout wanted. The same element and the same buttons, drawn into
       the page's box rather than the root, and taken out of it with the
       tiler. */
    const tray = el('panedrawer');

    const drawerOf = (out) =>
    {
        const made = [];

        tray.hidden = out.length === 0;

        if (out.length > 0)
        {
            /* Said, rather than left to be inferred from a row of
               dashed buttons: what these are is the panes that are not
               on the screen, and a person who has just closed one is
               looking for exactly that sentence. */
            const said = document.createElement('span');

            said.className = 'panedrawerlabel';
            said.textContent = label;
            made.push(said);
        }

        for (const id of out)
        {
            const button = document.createElement('button');

            button.type = 'button';
            button.className = 'paneclosed';
            button.id = `panereopen-${id}`;
            button.textContent = panes.get(id).title;
            button.title = `Reopen ${panes.get(id).title}`;
            button.addEventListener('click', () =>
            {
                const to = reopen(id, focus ?? firstLeaf());

                unzoomFor(to);
                changed();
                render();
                find(`panetab-${id}`)?.focus();
            });

            grab(button, id);
            made.push(button);
        }

        tray.replaceChildren(...made);

        return tray;
    };

    /* Which panes the tree holds, whether or not this render drew them:
       what the drawer lists is what no leaf has, and a zoomed pane has
       not closed the rest. */
    let inLayout = new Set();

    const holding = (node, found = new Set()) =>
    {
        if (isLeaf(node))
            node.tabs.filter(playable).forEach((id) => found.add(id));
        else
            node.kids.forEach((k) => holding(k, found));

        return found;
    };

    /* The drawer's list: every pane the mode has that the layout does
       not. Closing one puts it here and nothing else happens to it. */
    const closed = () => [...panes.keys()].filter(
        (id) => playable(id) && !inLayout.has(id) &&
                !panes.get(id).ephemeral);

    /* Where a pane the page added goes when the layout has no place for
       it: the leaf of the pane it was added beside, or the one last used,
       or the first there is. */
    const target = (p) =>
    {
        const beside = p.near === null ? null : leafWith(p.near);

        return beside !== null && playable(p.near) ? beside
             : focus !== null && holds(focus) ? focus
             : firstLeaf();
    };

    /* The panes the page added that a layout just put up does not have,
     * and that nobody put away, each put where `target' says. Asked
     * wherever a layout arrives -- read back, reset, swapped in by a
     * mode, set by the page -- since the page, having opened a pane,
     * should not find it in the drawer because of which. True if any
     * was.
     */
    const stray = () =>
    {
        let any = false;

        for (const p of panes.values())
            if (p.added && !dismissed.has(p.id) && playable(p.id) &&
                leafWith(p.id) === null)
            {
                into(p.id, target(p));
                any = true;
            }

        return any;
    };

    /* Whether a node is still part of the tree: a split that collapsed
       took its children's addresses with it. */
    const holds = (target, node = tree) =>
        node === target ||
        (!isLeaf(node) && node.kids.some((k) => holds(target, k)));

    /* The ones this render did not draw, kept out of sight but in the
       document. Out of the document they would be out of getElementById
       too, and a page that was handed its elements by name is a page a
       pane put away must not have been taken apart. One element, kept,
       for the same reason as all the others -- and not drawn rather
       than not displayed, which panes.css says why. */
    const keep = el('panekeep');

    /* And a leaf with nothing in it, for a layout every pane has been
       closed out of. */
    let blank = null;

    const render = () =>
    {
        const was = document.activeElement;
        const from = was instanceof Element
            ? was.closest('.pane')?.id.replace(/^pane-/, '') ?? null : null;
        const tab = was instanceof Element &&
                    was.classList.contains('panetab') ? was.id : null;

        watch(!tiled && !dead);

        if (!tiled)
        {
            for (const p of panes.values())
                restore(p);

            onScreen = new Set();
            attached = new Set();
            inLayout = new Set();
            seen = new Map();
            hint = null;
            root.replaceChildren();
            tray.remove();
            root.classList.remove('panezoom');
            settle();

            return;
        }

        if (tree === null)
            load();

        /* Adopted whether or not the layout has room for it: a pane in
           the drawer is one this page still owns and still has to be
           able to put back. */
        for (const p of panes.values())
            adopt(p);

        if (zoom !== null && (!holds(zoom) || !alive(zoom)))
            zoom = null;

        onScreen = new Set();
        attached = new Set();
        seen = new Map();
        hint = null;
        stale = [];
        inLayout = holding(tree);

        const out = closed();
        const some = alive(tree);

        if (blank === null)
        {
            blank = el('paneleaf');

            /* A layout every pane has been closed out of, which is a
               blank box and reads as a broken page rather than an empty
               one. The drawer above it holds all of them; this says
               so. */
            const note = el('paneempty');

            note.textContent = 'Every pane is closed. Reopen one from ' +
                               'the row above.';
            blank.append(note);
        }

        const made = some ? standIn(tree) : blank;

        /* A fraction is a share of a split, and what goes here is not in
           one: a box kept from an earlier render may have been somebody's
           child then and carry their `flex-grow' still, which at the top
           of the layout is the rule `grow' exists to avoid -- a layout
           taking 45% of the room and leaving the rest blank. Whatever is
           below this has its share written by `fill'; this has none. */
        made.style.removeProperty('flex-grow');

        blank.hidden = some;
        root.classList.toggle('panezoom', zoom !== null);

        /* The layout goes in before it is filled, so that every box takes
           its children while it is already in the document: what a render
           moves should be what moved, and an element appended to a
           detached parent has moved whether anything asked it to or
           not. */
        drawerOf(out);

        if (shelf !== null && tray.parentElement !== shelf)
            shelf.append(tray);

        arrange(root, shelf === null ? [tray, made, keep] : [made, keep]);

        if (some)
            fill(tree);

        seat();

        for (const p of panes.values())
            if (!attached.has(p.id) && p.host !== null)
            {
                p.host.hidden = true;

                if (p.host.parentElement !== keep)
                    place(keep, p.host);
            }

        /* And now what was left over, which by here holds nothing
           anybody still wants. Only where it still is: whatever a later
           arranging took from where it had been left is somebody's
           child again. */
        for (const [box, extra] of stale)
            if (extra.parentElement === box)
                extra.remove();

        stale = [];

        /* And every pane not on the screen laid out where it now is,
           before it is left there. A pane hidden or moved while its
           layout is out of date keeps that layout undone for as long as
           it is not drawn, and Chromium lays it out from nothing when it
           is shown again -- every scroller in it back at the start.
           Asking the size of something inside it is what lays it out
           now, while where it was scrolled to is still there to keep.
           Asking the pane's own size is not: that is outside what is not
           drawn, and answers without going in. */
        for (const p of panes.values())
            if (p.host !== null && p.host.hidden)
                void p.host.firstElementChild.offsetWidth;

        /* A leaf that went away takes the focus with it: a split that
           collapsed is not a place to put the next pane into. */
        if (focus !== null && boxOf(focus) === undefined)
            focus = null;

        settle();
        refocus(was, from, tab);
    };

    /* Focus, after the layout has moved under it.
     *
     * Never stolen and never dropped: what somebody was in is still what
     * they are in, unless the pane holding it has just gone off the
     * screen -- and then it is that pane's own tab rather than the top of
     * the page, which is where the browser would have put it.
     */
    const refocus = (was, from, tab) =>
    {
        if (!(was instanceof HTMLElement) || was === document.body)
            return;

        if (was.isConnected && was.checkVisibility())
        {
            if (document.activeElement !== was)
                was.focus();

            return;
        }

        /* `||' and not `??': the first of these is `false' whenever the
           focus was not on a tab, and a nullish fallback does not fall
           through a `false'. */
        const back = (tab !== null && find(tab)) ||
                     (from !== null && find(`panetab-${from}`));

        if (back)
            back.focus();
    };

    /* ---- driving it from the keys ----
     *
     * With a constraint this page has and most do not: the letters are
     * the letters may already be something. The page this began on binds
     * Z-/ and Q-P to musical notes; a chat client has a composer. So
     * every command here is a chord with Alt in it, never a bare letter,
     * and every one of them is inert while the focus is in a text box --
     * and all of it is an argument (`keys') for a page where that is
     * still wrong.
     *
     * By `code' rather than by `key': a command is a place on the
     * keyboard, and Alt over a letter is a different letter on half the
     * layouts there are.
     */
    const WAY = {
        ArrowLeft: [-1, 0], ArrowRight: [1, 0],
        ArrowUp: [0, -1], ArrowDown: [0, 1],
    };

    /* The leaf a command is about: the one the focus is in, or the one
       last pressed in, or the first there is. */
    const current = () =>
    {
        const at = document.activeElement;
        const box = at instanceof Element ? at.closest('.paneleaf') : null;

        return seen.get(box) ?? (focus !== null && boxOf(focus) !== undefined
                                     ? focus : firstLeaf());
    };

    /* The leaf that way: of the ones whose middle lies in the direction
       the arrow points, the nearest. */
    const toward = (leaf, [dx, dy]) =>
    {
        /* One pane filling the layout is one pane there is: the others
           are drawn, so that unzooming costs nothing, and a direction is
           not a way to reach something nobody can see. */
        if (zoom !== null)
            return null;

        const here = boxOf(leaf)?.getBoundingClientRect();

        if (here === undefined)
            return null;

        const cx = here.left + here.width / 2;
        const cy = here.top + here.height / 2;
        let best = null;
        let near = Infinity;

        for (const [box, node] of seen)
        {
            if (node === leaf)
                continue;

            const r = box.getBoundingClientRect();
            const x = r.left + r.width / 2 - cx;
            const y = r.top + r.height / 2 - cy;

            if (dx !== 0 && (Math.sign(x) !== dx || Math.abs(x) < Math.abs(y)))
                continue;

            if (dy !== 0 && (Math.sign(y) !== dy || Math.abs(y) < Math.abs(x)))
                continue;

            if (Math.hypot(x, y) < near)
            {
                near = Math.hypot(x, y);
                best = node;
            }
        }

        return best;
    };

    const raiseTab = (leaf) =>
        boxOf(leaf)?.querySelector('.panetab[aria-selected="true"]')?.focus();

    const done = (leaf) =>
    {
        focus = leaf;
        changed();
        render();
        raiseTab(leaf);
    };

    const command = (e) =>
    {
        if (!tiled || !keymap.chord(e))
            return;

        if (e.target instanceof Element &&
            e.target.closest(editable) !== null)
            return;

        const leaf = current();
        const ids = liveTabs(leaf);
        const id = ids[leaf.active];
        const way = WAY[e.code];

        /* Everything below Alt and a plain arrow is about a pane, and a
           layout with nothing in it has none. */
        if (id === undefined && !(way !== undefined && !e.shiftKey))
            return;

        if (way !== undefined && !e.shiftKey)
        {
            const to = toward(leaf, way);

            if (to !== null)
            {
                focus = to;
                raiseTab(to);
            }
        }
        else if (way !== undefined)
        {
            /* This pane, that way: into the leaf the arrow points at, or
               -- where there is none -- off the edge of this one into a
               half of its own. */
            const to = toward(leaf, way);
            const dir = way[0] !== 0 ? 'row' : 'col';

            /* Off the edge is a split, and refused where a split is:
               the same question the drop and the split chord ask. */
            if (to === null && !splittable(leaf, id, dir))
                return;

            if (to !== null)
                into(id, to);
            else
                beside(id, leaf, dir,
                       way[1] > 0 ||
                       (way[0] !== 0 &&
                        (way[0] > 0) !== backward(boxOf(leaf))));

            unzoomFor(leafWith(id));
            done(leafWith(id) ?? leaf);
        }
        else if (keymap.splitRow.includes(e.code) ||
                 keymap.splitCol.includes(e.code))
        {
            /* Split: the pane in front moves into a half of its own. A
               leaf with nothing else in it has nothing to split off, so
               it opens the first pane in the drawer there instead. */
            const dir = keymap.splitRow.includes(e.code) ? 'row' : 'col';
            const other = closed()[0];
            const moving = ids.length > 1 ? id : other;

            /* And refused where the two halves could not both have their
               minimum, which is the question a drop onto an edge asks
               too: a chord is another way to ask for a split, not
               another rule about when one is allowed. */
            if (moving === undefined || !splittable(leaf, moving, dir))
                return;

            beside(moving, leaf, dir, true);
            done(leaf);
        }
        else if (keymap.zoom.includes(e.code))
        {
            zoom = zoom === null ? leaf : null;
            render();
            raiseTab(zoom ?? leaf);
        }
        else if (keymap.close.includes(e.code))
        {
            if (!dismiss(id))
            {
                e.preventDefault();
                return;
            }

            /* Onto a leaf still in the tree: the one this was, if it
               kept anything, or the first there is. A leaf that closed
               with its last pane has no tab to be on, and the focus
               would fall out to the top of the document. */
            done(holds(leaf) ? leaf : firstLeaf());
        }
        else if (keymap.reset.includes(e.code))
            reset();
        else
            return;

        e.preventDefault();
    };

    window.addEventListener('keydown', command);
    document.addEventListener('visibilitychange', settle);

    const apply = () =>
    {
        const want = wanted && screen.matches;

        if (want === tiled)
            return;

        tiled = want;
        document.body.classList.toggle('tiled', tiled);
        render();
    };

    screen.addEventListener('change', apply);

    tiled = wanted && screen.matches;
    document.body.classList.toggle('tiled', tiled);
    render();

    return {
        /* Whether the mode this pane belongs to is up. Availability is
         * not visibility: an unavailable pane leaves the layout without
         * being forgotten by it, so leaving a mode and coming back puts
         * that mode's panes where they were.
         *
         * Through `data-pane-off' rather than `hidden'. The attribute is
         * this module's, which is the point: a page that uses `hidden'
         * for ordinary showing and hiding -- and most do -- would
         * otherwise take panes out of the layout by accident and never
         * get them back. panes.css hides the element either way, so a
         * page that starts a pane off says so in the markup with the
         * same attribute. */
        available: (id, ok) =>
        {
            const p = panes.get(id);

            if (dead || p === undefined || off(p.el) === !ok)
                return;

            /* What is in front of its leaf stays in front: `active' is a
               place among the tabs in play, and this one coming or going
               moves every place after it. */
            const leaf = tree === null ? null : leafWith(id);
            const front = leaf === null ? undefined
                        : liveTabs(leaf)[leaf.active ?? 0];

            p.el.toggleAttribute(OFF, !ok);

            if (front !== undefined && front !== id)
                leaf.active = liveTabs(leaf).indexOf(front);

            /* A pane the page added while its mode was down had nowhere
               to go then, and has now. */
            if (ok && tree !== null && stray())
                told();

            if (tiled)
                render();
            else
                settle();
        },

        /* Which layout is up. The modes have different panes, so they
           have a layout each -- a default of the page's and whatever
           somebody has made of it since, kept under the page and the
           mode. */
        mode: (name) =>
        {
            if (dead || name === where)
                return;

            abandon();
            where = name;
            tree = null;

            if (tiled)
                render();
        },

        /* Whether a pane is in front of anybody now -- the same answer
           onShow was last given, for a page that has to ask rather than
           wait to be told. */
        visible: (id) =>
        {
            const p = panes.get(id);

            return p !== undefined && visible(p);
        },

        /* One element over every pane, for the things that sit beside
           what they belong to rather than inside it -- a menu off a
           handle, the parameters of the thing under the pointer. A pane
           scrolls, and a popover inside a scroller is clipped by it.
         *
           At the document's origin, as wide as the body's containing
           block and of no height, so what is placed in it is placed in
           page coordinates, and given the room, exactly as it was when
           the body held it. */
        overlay: () =>
        {
            if (above === null && !dead)
            {
                above = document.createElement('div');
                above.className = 'paneoverlay';
                document.body.append(above);
            }

            return above;
        },

        /* The layout as it stands, which is what is kept and what comes
           back. A copy: what somebody reads it for is to compare it with
           itself later. */
        layout: () => (tree === null ? null : structuredClone(tree)),

        /* And the other way: a layout put up, for the mode that is up --
         * a preset, one read out of a link, a step back through an undo.
         * Kept and told of like any other change, since it is one.
         *
         * Read the way a kept layout is read, because it is data from
         * somewhere just as much: a pane this page has never heard of is
         * dropped rather than refused, and a tree that is not the shape
         * of one is refused -- false, and the layout left as it was --
         * rather than half put up. Written whether or not it is tiled
         * now, so that it is what comes up when it is.
         */
        setLayout: (next) =>
        {
            if (dead)
                return false;

            let made = null;

            try
            {
                made = sane(next) ? known(structuredClone(next)) : null;
            }
            catch
            {
                made = null;
            }

            /* And one that names only panes still to come is no layout
               yet, as it would not be read back. */
            if (made === null || !holdsAny(made))
                return false;

            zoom = null;
            focus = null;
            tree = made;
            stray();
            changed();

            if (tiled)
                render();

            return true;
        },

        /* Back to the mode's default, as Alt 0 does. */
        reset: () =>
        {
            if (!dead)
                reset();
        },

        /* Raised: in front of whatever leaf holds it, and out of the
         * drawer if that is where it was. Nothing to raise it above
         * without a layout -- untiled, the page is the document it
         * always was and every pane is already on it.
         *
         * With the focus by default, since what asks for a pane by name
         * is usually somebody who wants to be in it. `focus: false' is
         * for the other caller: a page raising a box to show somebody
         * a message they did not ask for. A file that did not parse is
         * read by whoever was editing it, and taking the cursor out of
         * the text box to point at the reason costs them their place
         * in it.
         */
        present: (id, { focus: take = true } = {}) =>
        {
            if (!tiled || !panes.has(id) || !playable(id))
                return;

            /* Where it goes when the layout does not have it at all.
               Asked for, it goes where the person is. Raised at them, it
               goes anywhere but there: a box put in front of the file
               somebody was editing, at the moment they pressed a button
               in it, answers one question by hiding another. */
            const at = take ? null : document.activeElement;
            const busy = at instanceof Element
                ? seen.get(at.closest('.paneleaf')) : undefined;
            const away = busy === undefined
                ? null : [...seen.values()].find((n) => n !== busy) ?? null;

            /* Out of the drawer, it goes back where it was -- except in
               front of the leaf being worked in, when raised at somebody:
               beside it is fine, over it is not. */
            let leaf = leafWith(id);

            if (leaf === null)
                leaf = reopen(id, away ?? focus ?? firstLeaf(), busy ?? null);
            else
                leaf.active = liveTabs(leaf).indexOf(id);

            focus = leaf;
            unzoomFor(leaf);

            /* The page's doing, not a person's: a kept layout still on
               its way is still put up, with this pane raised in it. */
            if (waiting !== 0)
                raised.add(id);

            told();
            render();

            if (take)
                find(`panetab-${id}`)?.focus();
        },

        /* Every pane there is, in the order they were taken on, with
         * what it is and where: for a page that opens things and has to
         * keep count of them -- to close the oldest, or list what is
         * open. `where' is `front' or `behind' in a leaf, `drawer',
         * `off' for a pane whose mode is not up, or `document' when
         * there is no layout; `visible' is what onShow was last told.
         */
        panes: () => [...panes.values()].map((p) =>
        {
            const leaf = tree === null ? null : leafWith(p.id);

            return {
                id: p.id,
                kind: p.ephemeral ? 'ephemeral' : 'lasting',
                where: off(p.el) ? 'off'
                     : !tiled ? 'document'
                     : leaf === null ? 'drawer'
                     : liveTabs(leaf)[leaf.active] === p.id ? 'front'
                     : 'behind',
                visible: visible(p),
            };
        }),

        /* A pane the page did not have when this began: an element it
         * has put into the document since, marked `data-pane', and taken
         * on here as a catalog entry would have been.
         *
         * In the document first, and by the page: that is where the pane
         * goes back to when there is no layout, and what `remove' hands
         * back. Refused -- false -- for an element that is not there, not
         * marked, or already a pane.
         *
         * Tiled, it goes where the layout kept it, if `later' kept a
         * place for it; beside `near' if that is a pane in the layout; or
         * where the person last was. In front, and with the focus unless
         * `focus: false' -- a page putting back the files somebody had
         * open is not asking to be in every one of them.
         */
        add: (id, { near = null, focus: take = true,
                    keep = false } = {}) =>
        {
            const el = document.getElementById(id);

            if (dead || panes.has(id) || el === null || !el.isConnected ||
                !el.hasAttribute('data-pane'))
                return false;

            /* A place kept for it, and what is in front there now: a pane
               put back where it was, quietly, is put back behind what was
               in front of it, as it was left. */
            const dormant = tree === null ? null : leafWith(id);
            const front = dormant === null ? undefined
                        : liveTabs(dormant)[dormant.active ?? 0];

            const p = enlist(id, el);

            p.added = true;
            p.near = near;
            p.ephemeral = !keep;

            if (watching)
                sight.observe(el);

            /* No layout yet, which is where it gets a place when there is
               one; or a pane whose mode is not up, which has no place to
               be put in until it is. */
            if (tree === null || !playable(id))
            {
                if (tiled)
                    render();
                else
                    settle();

                return true;
            }

            const leaf = leafWith(id) ?? target(p);

            if (leafWith(id) === null)
                into(id, leaf);
            else
                leaf.active = liveTabs(leaf).indexOf(
                    take || front === undefined ? id : front);

            /* Told of, and not counted as somebody's change: a page
               putting back the files that were open when it last closed
               does it before a kept layout on its way has arrived, and
               that layout is still the one to put up. */
            told();

            if (!tiled)
            {
                settle();
                return true;
            }

            focus = leaf;
            unzoomFor(leaf);
            render();

            if (take)
                find(`panetab-${id}`)?.focus();

            return true;
        },

        /* And the other way: a pane no longer one, and its element handed
         * back where it was in the document -- the page's to keep or to
         * delete, since a module that creates no content has no business
         * deleting any. Returned, or null for a pane there is not.
         *
         * Out of the layout the way a close takes it, split and all, but
         * not into the drawer: the drawer is for what can come back.
         * onShow hears it leave the screen one last time.
         */
        remove: (id) =>
        {
            const p = panes.get(id);

            if (dead || p === undefined)
                return null;

            const held = tree !== null && leafWith(id) !== null;
            const leaf = held ? leafWith(id) : null;

            /* Where the keyboard goes if it was in this pane or on its
               tab: the tab in front of what is left, rather than the top
               of the document. */
            const at = document.activeElement;
            const inside = at instanceof Element &&
                (p.host?.contains(at) || at.id === `panetab-${id}` ||
                 at.id === `paneshut-${id}`);

            if (held)
                drawer(id);

            home.delete(id);
            spot.delete(id);
            dismissed.delete(id);
            inView.delete(id);
            sight?.unobserve(p.el);

            if (p.fold !== null)
                p.el.removeEventListener('toggle', p.fold);

            if (shown.get(id) === true)
                onShow(id, false);

            shown.delete(id);
            restore(p);
            panes.delete(id);

            /* The page's doing, as `add' is. */
            if (held)
                told();

            if (tiled)
            {
                render();

                if (inside)
                    raiseTab(holds(leaf) ? leaf : firstLeaf());
            }

            return p.el;
        },

        /* And put away, which is the drawer and not the bin -- or, for
           an ephemeral pane, the same question a person's close asks of
           the page. There is no drawer without a layout, for the same
           reason. */
        close: (id) =>
        {
            if (!tiled || !panes.has(id) || !dismiss(id))
                return;

            changed();
            render();
        },

        /* What its tab says. The markup's title is what a pane opens
           with; this is for a pane whose title is a file somebody has
           just opened in it. */
        setTitle: (id, text) =>
        {
            const p = panes.get(id);

            if (dead || p === undefined)
                return;

            p.title = text;
            render();
        },

        tiled: () => tiled,

        /* Another set of layouts, in place: the layout that is up is kept
         * under the store it came from, and the mode's layout from the
         * new set -- what was saved under the new store, or its default --
         * replaces it. With a new divider thickness and a new version
         * if they are given.
         *
         * For a page with more than one shape to be: a phone turned on
         * its side has neither the height for the split it had upright
         * nor any use for a tab strip across the short side. Without
         * this it was destroy() and a second createPanes, and every pane
         * put back into the document only to be adopted again.
         */
        setLayouts: (next, { store: to = store, split: thick = split,
                             version: now = version } = {}) =>
        {
            if (dead)
                return;

            /* The layout that is up was kept when it was made, and a
               default on screen while a kept one is on its way is not
               to be kept over it. */
            abandon();
            layouts = next;
            store = to;
            split = thick;
            version = now;
            root.style.setProperty('--pane-split', `${split}px`);

            zoom = null;
            tree = null;
            focus = null;

            if (tiled)
                render();
        },

        /* Handed back: every pane under its own parent again, every
         * listener off whatever it was on, and the classes and the
         * overlay gone from the page.
         *
         * A module that adopts a document owes the document a way out of
         * it. Without one there is no unmounting the thing this was drawn
         * into -- and no calling createPanes twice over the same page
         * either, since the second keydown handler would answer the same
         * chord as the first. Quiet if it has already been said.
         */
        destroy: () =>
        {
            if (dead)
                return;

            dead = true;
            window.removeEventListener('keydown', command);
            document.removeEventListener('visibilitychange', settle);
            document.removeEventListener('scroll', noteScroll, true);
            screen.removeEventListener('change', apply);

            for (const p of panes.values())
                if (p.fold !== null)
                    p.el.removeEventListener('toggle', p.fold);

            /* Through the same path the threshold takes, so that putting
               the document back is one piece of code and not two: every
               pane goes home and onShow is told what the page now is. */
            tiled = false;
            document.body.classList.remove('tiled');
            render();

            root.classList.remove('panesroot', 'panescroll', 'panedrag');
            root.style.removeProperty('--pane-split');
            /* What the page put in the overlay is the page's, and goes
               back to the body it came from rather than out with it. */
            if (above !== null)
            {
                document.body.append(...above.children);
                above.remove();
                above = null;
            }
        },
    };
}
