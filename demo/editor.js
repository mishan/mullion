/*
 * Copyright (C) 2026 Misha Nasledov
 *
 * SPDX-License-Identifier: MIT
 */

/*
 * editor.js -- a <textarea> that looks like a code editor.
 *
 * The textarea stays the thing that is typed into: it keeps its id, its
 * undo, its selection and its place in the document, which is the point
 * of the page it is on. What is added is drawn around it -- a gutter of
 * line numbers and a colored copy of the text underneath a textarea whose
 * own text is transparent -- and both follow its scroll.
 *
 * The coloring is a handful of regular expressions, not a parser. It is
 * right about the three small files this playground opens on and close
 * enough about anything somebody types.
 */

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
                       .replace(/>/g, '&gt;');

const span = (cls, text) =>
    cls === null ? escape(text) : `<span class="t-${cls}">${escape(text)}</span>`;

/* Sticky expressions tried in order at each position; the first that
   matches names the token. The last rule of each always matches. */
const RULES = {
    js: [
        ['com', /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y],
        ['str', /'(?:\\.|[^'\\\n])*'?|"(?:\\.|[^"\\\n])*"?|`(?:\\[\s\S]|[^`\\])*`?/y],
        ['num', /\b\d[\d_]*(?:\.\d+)?\b/y],
        ['key', /\b(?:const|let|var|function|return|if|else|for|while|do|of|in|new|class|extends|import|export|from|async|await|try|catch|finally|throw|switch|case|break|continue|default|typeof|instanceof|this|true|false|null|undefined)\b/y],
        ['fn', /[A-Za-z_$][\w$]*(?=\s*\()/y],
        [null, /[A-Za-z_$][\w$]*|\s+|[\s\S]/y],
    ],
    css: [
        ['com', /\/\*[\s\S]*?(?:\*\/|$)/y],
        ['str', /'[^'\n]*'?|"[^"\n]*"?/y],
        ['key', /@[\w-]+|!important/y],
        ['prop', /--?[\w-]+(?=\s*:[^;{}]*[;}])|[a-z-]+(?=\s*:[^;{}]*[;}])/y],
        ['sel', /[.#]?[\w-]+(?=[^{};]*\{)/y],
        ['num', /#[\da-fA-F]{3,8}\b|-?(?:\d+\.?\d*|\.\d+)(?:[a-z]+|%)?/y],
        [null, /[\w-]+|\s+|[\s\S]/y],
    ],
};

function tokens (src, rules)
{
    let out = '';
    let pos = 0;

    while (pos < src.length)
    {
        for (const [cls, re] of rules)
        {
            re.lastIndex = pos;

            const m = re.exec(src);

            if (m !== null && m[0].length > 0)
            {
                out += span(cls, m[0]);
                pos += m[0].length;
                break;
            }
        }
    }

    return out;
}

/* Markup has one piece of state worth having -- inside a tag or not --
   so it is split on tags and comments first, and only a tag's insides
   are looked at for attributes. */
function html (src)
{
    return src.split(/(<!--[\s\S]*?(?:-->|$)|<[^>]*>?)/).map((part, i) =>
    {
        if (i % 2 === 0)
            return escape(part);

        if (part.startsWith('<!--'))
            return span('com', part);

        const m = /^(<\/?[\w-]*)([\s\S]*?)(\/?>)?$/.exec(part);
        const inside = m[2].replace(
            /([^\s=]+)(\s*=\s*)?("[^"]*"?|'[^']*'?|[^\s"'>]+)?/g,
            (_, name, eq = '', value = '') =>
                `\u0000a${name}\u0001${eq}${value ? `\u0000s${value}\u0001` : ''}`);

        return span('tag', m[1]) +
               escape(inside).replace(/\u0000([as])([^\u0001]*)\u0001/g,
                   (_, kind, text) =>
                       `<span class="t-${kind === 'a' ? 'attr' : 'str'}">${text}</span>`) +
               (m[3] ? span('tag', m[3]) : '');
    }).join('');
}

const paint = (lang, src) => lang === 'html' ? html(src)
                                             : tokens(src, RULES[lang]);

/* Two spaces, wherever a key asked for text: through execCommand where
   there is one, so that the edit is on the textarea's own undo stack,
   and by hand where there is not. */
function insert (area, text)
{
    area.focus();

    if (!document.execCommand?.('insertText', false, text))
    {
        area.setRangeText(text, area.selectionStart, area.selectionEnd, 'end');
        area.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

/* Mount one editor over `box', which holds its textarea and says its
   language as `data-lang'. Returns a function that redraws it, for a page
   that changed the text from outside. */
export function editor (box)
{
    const area = box.querySelector('textarea');
    const lang = box.dataset.lang;
    const gutter = document.createElement('pre');
    const field = document.createElement('div');
    const color = document.createElement('pre');

    gutter.className = 'gutter';
    gutter.setAttribute('aria-hidden', 'true');
    field.className = 'field';
    color.className = 'color';
    color.setAttribute('aria-hidden', 'true');

    area.wrap = 'off';
    area.spellcheck = false;
    area.autocapitalize = 'off';
    area.setAttribute('autocomplete', 'off');

    box.prepend(gutter);
    field.append(color, area);
    box.append(field);

    let lines = 0;

    const follow = () =>
    {
        color.style.transform =
            `translate(${-area.scrollLeft}px, ${-area.scrollTop}px)`;
        gutter.scrollTop = area.scrollTop;
    };

    const redraw = () =>
    {
        /* A trailing newline is a line with nothing on it, which a <pre>
           does not draw unless there is something after it. */
        color.innerHTML = `${paint(lang, area.value)}\n `;

        const n = area.value.split('\n').length;

        if (n !== lines)
        {
            lines = n;
            gutter.textContent = Array.from({ length: n }, (_, i) => i + 1)
                                      .join('\n') + '\n ';
        }

        follow();
    };

    area.addEventListener('input', redraw);
    area.addEventListener('scroll', follow);

    /* Tab indents, and Escape first lets it leave: a text box that keeps
       Tab for itself with no way out is a trap for anyone without a
       mouse. */
    let leaving = false;

    area.addEventListener('keydown', (e) =>
    {
        if (e.key === 'Escape')
        {
            leaving = true;
            return;
        }

        if (e.key === 'Tab' && !leaving && !e.shiftKey && !e.altKey &&
            !e.ctrlKey && !e.metaKey)
        {
            e.preventDefault();
            insert(area, '  ');
        }
        else if (e.key === 'Enter' && !e.shiftKey && !e.altKey &&
                 !e.ctrlKey && !e.metaKey)
        {
            /* The new line starts where the last one did. */
            const before = area.value.slice(0, area.selectionStart);
            const indent = /[ \t]*/.exec(before.slice(
                before.lastIndexOf('\n') + 1))[0];

            e.preventDefault();
            insert(area, `\n${indent}`);
        }

        leaving = false;
    });

    area.addEventListener('blur', () => { leaving = false; });

    redraw();

    return redraw;
}
