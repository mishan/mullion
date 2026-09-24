/*
 * Copyright (C) 2026 Misha Nasledov
 *
 * SPDX-License-Identifier: MIT
 */

/*
 * preview.js -- the three files, as a page in a sandboxed <iframe>.
 *
 * The page is written as `srcdoc' with a little of this file's own
 * script ahead of the program's, which does two things a playground
 * needs and one that this playground is for:
 *
 *   - `console' and uncaught errors are posted up to the Console pane;
 *   - once a second, the frames the program drew are posted up to the
 *     Activity pane;
 *   - and `requestAnimationFrame' is held while the Preview pane is not
 *     on the screen. The program asks for a frame as it always does and
 *     is not answered until somebody can see it -- which is what onShow
 *     is for, carried one document further down.
 *
 * The frame is `sandbox="allow-scripts"' and nothing more, so what runs
 * in it has an origin of its own and cannot reach this page; the two talk
 * by postMessage alone, and a message is taken only from this frame.
 */

/* Runs in the frame, before the program. `SHOWN' is written in as the
   page is built, so a program started behind a tab does not draw one
   frame before it is told. */
const SHIM = (shown) => `
(() => {
  const post = (m) => parent.postMessage({ playground: 1, ...m }, '*');
  const text = (v) => {
    if (typeof v === 'string') return v;
    if (v instanceof Error) return String(v);
    try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
  };

  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const was = console[level].bind(console);
    console[level] = (...args) => {
      post({ kind: 'log', level, text: args.map(text).join(' ') });
      was(...args);
    };
  }

  addEventListener('error', (e) =>
    post({ kind: 'log', level: 'error', text: e.message, line: e.lineno }));
  addEventListener('unhandledrejection', (e) =>
    post({ kind: 'log', level: 'error',
           text: 'Unhandled rejection: ' + text(e.reason) }));

  const ask = requestAnimationFrame.bind(window);
  const cancel = cancelAnimationFrame.bind(window);
  const held = new Map();
  let shown = ${shown};
  let next = -1;
  let frames = 0;
  let last = -1;

  const counted = (cb) => (t) => {
    if (t !== last) { last = t; frames++; }
    cb(t);
  };

  window.requestAnimationFrame = (cb) => {
    if (shown) return ask(counted(cb));
    held.set(next, cb);
    return next--;
  };

  window.cancelAnimationFrame = (id) =>
    id < 0 ? held.delete(id) : cancel(id);

  addEventListener('message', (e) => {
    if (e.source !== parent || e.data?.playground !== 1) return;
    shown = e.data.shown;
    if (shown) {
      for (const cb of held.values()) ask(counted(cb));
      held.clear();
    }
  });

  setInterval(() => { post({ kind: 'fps', fps: frames }); frames = 0; }, 1000);
})();
`;

/* A closing tag inside the program would close the element it is in. */
const guard = (src, tag) => src.replace(new RegExp(`</(${tag})`, 'gi'), '<\\/$1');

/* The page, and the line the program's first line lands on -- an error
   in it is reported against the whole document, and the Console says
   where in app.js it was. */
export function build ({ html, css, js }, shown)
{
    const head = '<!doctype html>\n<html lang="en">\n<head>\n' +
                 '<meta charset="utf-8">\n' +
                 `<style>\n${guard(css, 'style')}\n</style>\n` +
                 `<script>${SHIM(shown)}</script>\n` +
                 `</head>\n<body>\n${html}\n<script>\n`;

    return {
        doc: `${head}${guard(js, 'script')}\n</script>\n</body>\n</html>\n`,
        first: head.split('\n').length,
    };
}

/* Tell the frame whether it is on the screen. */
export function tell (frame, shown)
{
    frame.contentWindow?.postMessage({ playground: 1, shown }, '*');
}
