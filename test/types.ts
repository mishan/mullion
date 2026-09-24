/*
 * Copyright (C) 2026 Misha Nasledov
 *
 * SPDX-License-Identifier: MIT
 */

/*
 * types.ts -- the declarations, used the way a consumer would use them.
 *
 * panes.d.ts is hand-written and says so, which makes "anything wrong in
 * here is wrong silently" a real cost rather than a modest one. This is
 * what makes some of it loud: every name the package exports, reached
 * through the package's own exports map rather than by relative path, so
 * a subpath with no `types` beside it or a shape that drifted is a build
 * that fails here instead of an editor that lies somewhere else.
 *
 * It is compiled and never run -- `npm run types'.
 */

import { createPanes } from 'mullion';
import type { PaneNode, Panes, PanesOptions, PaneState } from 'mullion';
import { placePopover } from 'mullion/popover.js';

const layout: PaneNode = {
    dir: 'row', size: [0.6, 0.4], kids: [
        { dir: 'col', size: [0.7, 0.3], kids: [
            { tabs: ['editor'], active: 0 },
            { tabs: ['console'] }] },
        { tabs: ['inspector'] }],
};

const options: PanesOptions = {
    root: document.body,
    catalog: ['editor', 'console', 'inspector'],
    mode: 'default',
    layouts: { default: layout },
    onShow: (id: string, on: boolean) => { void id; void on; },
    keys: { close: ['KeyW'] },
    storage: window.sessionStorage,
    strip: 'scroll',
    lone: ['console'],
    closed: 'More:',
    reset: 'Reset layout',
    onLayout: (tree: PaneNode, mode: string) => { void tree; void mode; },
    version: 2,
    later: (id: string) => id.startsWith('file-'),
    onDiscard: (id: string) => { void id; },
};

/* And a storage that answers later, which is a server. */
const remote: PanesOptions['storage'] = {
    getItem: async (k: string) => (k === '' ? null : '{"tabs":[]}'),
    setItem: async (k: string, v: string) => { void k; void v; },
    removeItem: (k: string) => { void k; },
};

void remote;

const panes: Panes = createPanes(options);

panes.available('console', false);
panes.mode('default');
panes.present('editor', { focus: false });
panes.close('console');
panes.reset();
panes.setTitle('editor', 'notes.txt');
panes.setLayouts({ default: { tabs: ['editor'] } },
                 { store: 'side', split: 18, version: 'b' });

const put: boolean = panes.setLayout(layout);
const grew: boolean = panes.add('file-1',
                                { near: 'editor', focus: false, keep: true });
const states: PaneState[] = panes.panes();

void states;
const gone: HTMLElement | null = panes.remove('file-1');

void grew;
void gone;

void put;
panes.destroy();

const answers: [boolean, boolean, PaneNode | null, HTMLElement] =
    [panes.visible('editor'), panes.tiled(), panes.layout(), panes.overlay()];

void answers;

placePopover(document.createElement('div'), 10, 20);
