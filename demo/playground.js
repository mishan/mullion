/*
 * Copyright (C) 2026 Misha Nasledov
 *
 * SPDX-License-Identifier: MIT
 */

/*
 * playground.js -- a code playground, tiled by mullion.
 *
 * Everything here is what a page would do anyway -- run the code, show
 * what it logged, keep the edits -- and the tiler is one call over it.
 * What the tiler is told back is where it earns its place:
 *
 *   - the preview's program is held still while the Preview pane is off
 *     the screen, and is not rebuilt for edits nobody can see;
 *   - the Activity chart draws only while somebody can see it;
 *   - the Console counts what arrived while it was hidden, on its tab;
 *   - and the Files list raises an editor wherever it is, including out
 *     of the drawer.
 */

import { createPanes } from '../src/panes.js';

import { editor } from './editor.js';
import { build, tell } from './preview.js';

const $ = (id) => document.getElementById(id);

const CATALOG = ['files', 'ed-html', 'ed-css', 'ed-js', 'preview',
                 'console', 'activity', 'keys'];

const EDITORS = { html: 'ed-html', css: 'ed-css', js: 'ed-js' };

const TITLES = Object.fromEntries(
    CATALOG.map((id) => [id, $(id).dataset.paneTitle]));

const LAYOUTS = {
    write: {
        dir: 'row', size: [0.14, 0.46, 0.4], kids: [
            { tabs: ['files'] },
            { tabs: ['ed-html', 'ed-css', 'ed-js'], active: 2 },
            { dir: 'col', size: [0.62, 0.38], kids: [
                { tabs: ['preview'] },
                { tabs: ['console', 'activity'] }] }],
    },
    debug: {
        dir: 'row', size: [0.45, 0.55], kids: [
            { dir: 'col', size: [0.6, 0.4], kids: [
                { tabs: ['ed-js', 'ed-html', 'ed-css'] },
                { tabs: ['console'] }] },
            { dir: 'col', size: [0.58, 0.42], kids: [
                { tabs: ['preview'] },
                { tabs: ['activity', 'keys'] }] }],
    },
};

/*
 * And a set for a phone, which is asked for (`?touch'): on a narrow
 * screen the plain page is the page, and tiling there is something to
 * try rather than something to be handed. Two panes to a screen, one
 * shape upright and another on its side, and the rest a tab away.
 */
const TOUCH = new URLSearchParams(location.search).has('touch');

const UPRIGHT = {
    write: {
        dir: 'col', size: [0.5, 0.5], kids: [
            { tabs: ['ed-js', 'ed-html', 'ed-css'] },
            { tabs: ['preview', 'console', 'activity'] }],
    },
    debug: {
        dir: 'col', size: [0.45, 0.55], kids: [
            { tabs: ['preview'] },
            { tabs: ['console', 'activity', 'ed-js', 'ed-html', 'ed-css'] }],
    },
};

const SIDEWAYS = {
    write: { ...UPRIGHT.write, dir: 'row' },
    debug: { ...UPRIGHT.debug, dir: 'row', size: [0.5, 0.5] },
};

const side = matchMedia('(orientation: landscape)');

const KEPT = 'mullion-playground';

/* Where a layout is kept: one store per shape of screen, so that turning
   a phone over and back finds each the way it was left. */
const store = () =>
    !TOUCH ? KEPT : `${KEPT}:${side.matches ? 'side' : 'up'}`;

const kept = (key, fallback) =>
{
    try
    {
        return JSON.parse(localStorage.getItem(`${KEPT}:${key}`)) ?? fallback;
    }
    catch
    {
        return fallback;
    }
};

const keep = (key, value) =>
{
    try
    {
        localStorage.setItem(`${KEPT}:${key}`, JSON.stringify(value));
    }
    catch
    {
        /* Private windows and full disks: the edits last this visit. */
    }
};

/* ---- the files ---- */

const area = (lang) => $(EDITORS[lang]).querySelector('textarea');

/* The edits from last time, over the examples in the markup. */
const saved = kept('files', {});

for (const lang of Object.keys(EDITORS))
    if (typeof saved[lang] === 'string')
        area(lang).value = saved[lang];

const redraw = Object.fromEntries(Object.keys(EDITORS).map(
    (lang) => [lang, editor($(EDITORS[lang]).querySelector('.editor'))]));

const source = () => Object.fromEntries(
    Object.keys(EDITORS).map((lang) => [lang, area(lang).value]));

const marks = () =>
{
    for (const [lang, id] of Object.entries(EDITORS))
    {
        const b = document.querySelector(`[data-open="${id}"]`);

        b.classList.toggle('edited',
                           area(lang).value !== area(lang).defaultValue);
        b.classList.toggle('on', panes.tiled() && panes.visible(id));
    }
};

/* ---- what is on the screen ---- */

const onScreen = new Map(CATALOG.map((id) => [id, false]));

const status = () =>
{
    const n = [...onScreen.values()].filter(Boolean).length;

    $('st-panes').textContent = `${n} of ${CATALOG.length} panes on screen`;

    for (const li of $('onscreen').children)
        li.classList.toggle('on', onScreen.get(li.dataset.id));

    const act = $('st-activity');

    act.replaceChildren(dot(onScreen.get('activity')),
                        `Activity ${onScreen.get('activity') ? 'drawing'
                                                             : 'resting'}`);
};

const dot = (on) =>
{
    const d = document.createElement('span');

    d.className = on ? 'dot on' : 'dot';

    return d;
};

$('onscreen').append(...CATALOG.map((id) =>
{
    const li = document.createElement('li');

    li.dataset.id = id;
    li.append(dot(false), TITLES[id]);

    return li;
}));

/* ---- the preview ---- */

const frame = $('frame');
let stale = true;       /* edited since it last ran */
let fps = 0;

const run = () =>
{
    stale = false;
    frame.srcdoc = build(source(), onScreen.get('preview'));
};

/* An edit runs the program again after a pause in the typing -- but only
   where somebody will see it run. Behind a tab, it waits to be shown. */
let typing = 0;

const edited = () =>
{
    keep('files', source());
    marks();
    stale = true;

    clearTimeout(typing);

    if ($('auto').checked && onScreen.get('preview'))
        typing = setTimeout(run, 500);
};

for (const lang of Object.keys(EDITORS))
    area(lang).addEventListener('input', edited);

$('run').addEventListener('click', run);

addEventListener('keydown', (e) =>
{
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey))
    {
        e.preventDefault();
        run();
    }
});

$('reset').addEventListener('click', () =>
{
    for (const lang of Object.keys(EDITORS))
    {
        area(lang).value = area(lang).defaultValue;
        redraw[lang]();
    }

    keep('files', {});
    marks();
    run();
});

/* ---- the console ---- */

const log = $('log');
let unread = 0;
let counts = { log: 0, warn: 0, error: 0 };

const tally = () =>
{
    const parts = [];

    if (counts.error > 0)
        parts.push(`${counts.error} error${counts.error === 1 ? '' : 's'}`);

    if (counts.warn > 0)
        parts.push(`${counts.warn} warning${counts.warn === 1 ? '' : 's'}`);

    $('tally').textContent = parts.join(' · ');
};

/* What its tab says: how much came in while nobody was looking. */
const title = () =>
    panes.setTitle('console', unread > 0 ? `Console (${unread})`
                                         : TITLES.console);

const say = (level, text, line) =>
{
    log.querySelector('.empty')?.remove();

    /* The same line again is a count on the last one, not another row. */
    const last = log.lastElementChild;

    if (last !== null && last.dataset.level === level &&
        last.dataset.text === text)
    {
        const n = Number(last.dataset.n) + 1;
        let badge = last.querySelector('.count');

        if (badge === null)
        {
            badge = document.createElement('span');
            badge.className = 'count';
            last.append(badge);
        }

        last.dataset.n = n;
        badge.textContent = n;
    }
    else
    {
        const li = document.createElement('li');
        const time = document.createElement('time');
        const body = document.createElement('span');

        li.className = `lv-${level}`;
        li.dataset.level = level;
        li.dataset.text = text;
        li.dataset.n = 1;
        time.textContent = new Date().toLocaleTimeString([], {
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false });
        body.className = 'text';
        body.textContent = text;
        li.append(time, body);

        if (line !== undefined)
        {
            const where = document.createElement('span');

            where.className = 'where';
            where.textContent = `app.js:${line}`;
            li.append(where);
        }

        log.append(li);

        while (log.children.length > 500)
            log.firstElementChild.remove();
    }

    const near = log.scrollHeight - log.scrollTop - log.clientHeight < 60;

    if (near)
        log.scrollTop = log.scrollHeight;

    if (level !== 'sys')
    {
        counts[level] = (counts[level] ?? 0) + 1;
        tally();

        if (!onScreen.get('console'))
        {
            unread++;
            title();
        }
    }
};

const empty = () =>
{
    const li = document.createElement('li');

    li.className = 'empty';
    li.textContent = 'Nothing logged yet.';
    log.replaceChildren(li);
    counts = { log: 0, warn: 0, error: 0 };
    tally();
};

$('clear').addEventListener('click', empty);
empty();

frame.addEventListener('load', () => tell(frame, onScreen.get('preview')));

addEventListener('message', (e) =>
{
    if (e.source !== frame.contentWindow || e.data?.playground !== 1)
        return;

    if (e.data.kind === 'start')
        say('sys', 'Preview started');
    else if (e.data.kind === 'log')
        say(e.data.level === 'info' || e.data.level === 'debug'
                ? 'log' : e.data.level,
            e.data.text, e.data.line);
    else if (e.data.kind === 'fps')
        fps = e.data.fps;
});

/* ---- activity ---- */

/* One sample a second of what the preview drew, whether or not anybody
   is watching the chart: taking a number is cheap, drawing it is not. */
const HISTORY = 60;
const samples = [];
let sampled = performance.now();

setInterval(() =>
{
    const shown = onScreen.get('preview');
    const now = shown ? fps : 0;

    samples.push({ fps: now, resting: !shown });

    if (samples.length > HISTORY + 1)
        samples.shift();

    sampled = performance.now();
    fps = 0;

    const st = $('st-preview');

    st.replaceChildren(dot(shown),
                       shown ? `Preview ${now} fps` : 'Preview resting');
    $('fps').textContent = shown ? `${now} fps` : '';
}, 1000);

const chart = $('chart');
const pen = chart.getContext('2d');
let drawing = false;

new ResizeObserver(() =>
{
    const r = chart.getBoundingClientRect();

    chart.width = Math.max(1, Math.round(r.width * devicePixelRatio));
    chart.height = Math.max(1, Math.round(r.height * devicePixelRatio));
}).observe(chart);

const css = (name) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* Every frame while it is on the screen, so the line slides rather than
   steps -- which is exactly the work that should stop when it is not. */
const plot = () =>
{
    if (!drawing)
        return;

    const w = chart.width;
    const h = chart.height;
    const k = devicePixelRatio;
    const top = 12 * k;
    const bottom = h - 6 * k;
    const step = w / (HISTORY - 1);
    const slide = Math.min(1, (performance.now() - sampled) / 1000) * step;
    const y = (v) => bottom - Math.min(v, 60) / 60 * (bottom - top);
    const x = (i) => w - (samples.length - 1 - i) * step - slide;

    pen.clearRect(0, 0, w, h);

    /* The seconds the preview spent off the screen. */
    pen.fillStyle = css('--surface-2');

    samples.forEach((s, i) =>
    {
        if (s.resting)
            pen.fillRect(x(i) - step / 2, 0, step + 1, h);
    });

    pen.strokeStyle = css('--line');
    pen.lineWidth = k;
    pen.setLineDash([3 * k, 3 * k]);
    pen.beginPath();
    pen.moveTo(0, y(60));
    pen.lineTo(w, y(60));
    pen.stroke();
    pen.setLineDash([]);

    pen.fillStyle = css('--muted');
    pen.font = `${11 * k}px system-ui, sans-serif`;
    pen.fillText('60 fps', 6 * k, y(60) - 3 * k);

    if (samples.length > 1)
    {
        const accent = css('--accent');

        pen.beginPath();
        samples.forEach((s, i) =>
            i === 0 ? pen.moveTo(x(i), y(s.fps)) : pen.lineTo(x(i), y(s.fps)));

        pen.strokeStyle = accent;
        pen.lineWidth = 2 * k;
        pen.lineJoin = 'round';
        pen.stroke();

        pen.lineTo(x(samples.length - 1), bottom);
        pen.lineTo(x(0), bottom);
        pen.closePath();
        pen.fillStyle = accent;
        pen.globalAlpha = 0.15;
        pen.fill();
        pen.globalAlpha = 1;
    }

    requestAnimationFrame(plot);
};

/* ---- the tiler ---- */

const MODES = Object.keys(LAYOUTS);
let mode = kept('mode', 'write');

if (!MODES.includes(mode))
    mode = 'write';

const shown = (id, on) =>
{
    onScreen.set(id, on);

    if (id === 'preview')
    {
        tell(frame, on);

        if (on && stale && $('auto').checked)
            run();
    }
    else if (id === 'activity' && on !== drawing)
    {
        drawing = on;

        if (on)
            requestAnimationFrame(plot);
    }
    else if (id === 'console' && on && unread > 0)
    {
        unread = 0;
        title();
    }
};

/* A note that the layout was kept, which fades. */
let fading = 0;

/* Every layout a person left, for an undo: onLayout says what each
   change came to, and setLayout puts an old one back. A mode or a
   screen of another shape is a history of its own, so either starts it
   over. */
const steps = [];
let now = null;
let undoing = false;

const forget = () =>
{
    steps.length = 0;
    now = panes.layout();
    $('undo').disabled = true;
};

$('undo').addEventListener('click', () =>
{
    const back = steps.pop();

    if (back === undefined)
        return;

    undoing = true;
    panes.setLayout(back);
    undoing = false;
    $('undo').disabled = steps.length === 0;
});

/* Null until createPanes returns: onShow is told about the first panes
   on the screen from inside it. */
let panes = null;

panes = createPanes({
    root: $('root'),
    catalog: CATALOG,
    layouts: !TOUCH ? LAYOUTS : side.matches ? SIDEWAYS : UPRIGHT,
    mode,
    store: store(),
    on: true,
    reset: '↺',
    version: 1,
    ...(TOUCH && {
        media: '(min-width: 20em)',
        strip: 'scroll',
        split: 18,
    }),
    onShow: (id, on) =>
    {
        shown(id, on);

        if (panes !== null)
        {
            status();
            marks();
        }
    },
    onLayout: (layout) =>
    {
        if (!undoing && now !== null)
        {
            steps.push(now);

            if (steps.length > 50)
                steps.shift();
        }

        now = layout;
        $('undo').disabled = steps.length === 0;

        const note = $('st-saved');

        note.textContent = 'Layout saved';
        note.classList.remove('gone');
        clearTimeout(fading);
        fading = setTimeout(() => note.classList.add('gone'), 1400);
    },
});

const pick = (name) =>
{
    mode = name;
    keep('mode', name);
    panes.mode(name);
    forget();

    for (const b of document.querySelectorAll('[data-mode]'))
        b.setAttribute('aria-pressed', String(b.dataset.mode === name));
};

for (const b of document.querySelectorAll('[data-mode]'))
    b.addEventListener('click', () => pick(b.dataset.mode));

pick(mode);

/* A file, raised wherever it is -- behind a tab, in another leaf, or in
   the drawer -- with its text box focused. On the plain page there is
   nothing to raise, and it is scrolled to instead. */
for (const b of document.querySelectorAll('[data-open]'))
    b.addEventListener('click', () =>
    {
        const id = b.dataset.open;
        const text = $(id).querySelector('textarea');

        if (panes.tiled())
            panes.present(id, { focus: false });
        else
            $(id).scrollIntoView({ behavior: 'smooth', block: 'start' });

        text.focus({ preventScroll: !panes.tiled() });
    });

if (TOUCH)
{
    side.addEventListener('change', () =>
    {
        panes.setLayouts(side.matches ? SIDEWAYS : UPRIGHT,
                         { store: store(), version: 1 });
        forget();
    });

    /* The layout is as tall as what is visible, which on a phone is the
       window less the keyboard when one is up -- and `dvh' does not know
       about the keyboard. */
    const fit = () =>
        document.documentElement.style.setProperty(
            '--pane-height', `${Math.round(visualViewport.height)}px`);

    visualViewport?.addEventListener('resize', fit);

    if (window.visualViewport)
        fit();

    document.documentElement.classList.add('touch');

    /* And the way to the plain page and back keeps the phone's set. */
    for (const a of document.querySelectorAll('.to-plain'))
        a.search = '?touch&panes=0';

    for (const a of document.querySelectorAll('.to-tiled, .if-forced a'))
        a.search = '?touch';
}

if (new URLSearchParams(location.search).get('panes') === '0')
    document.documentElement.classList.add('forced');

status();
marks();

if (onScreen.get('preview'))
    run();

/* What a harness may ask, the same shape the fixture offers. */
window.playground = {
    panes: () => [...CATALOG],
    layout: () => panes.layout(),
    pane: (what, ...args) => panes[what](...args),
    tiled: () => panes.tiled(),
    onScreen: () => Object.fromEntries(onScreen),
    drawing: () => drawing,
    samples: () => samples.map((s) => ({ ...s })),
};
