/*
 * Copyright (C) 2026 Misha Nasledov
 *
 * SPDX-License-Identifier: MIT
 */

/**
 * Types for `popover.js`, which is arithmetic and unrelated to tiling.
 *
 * Its own file beside its own module, and not folded into `panes.d.ts`:
 * a declaration for a function the module it claims to describe does not
 * export is a compile that succeeds and a call that is `undefined`.
 */

/** A popover at a page coordinate, held inside the window. */
export function placePopover(box: HTMLElement, x: number, y: number): void;
