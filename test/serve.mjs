/*
 * Copyright (C) 2026 Misha Nasledov
 *
 * SPDX-License-Identifier: MIT
 */

/*
 * serve.mjs -- files over HTTP, for the demo and for check.mjs.
 *
 * Small on purpose. A module with no runtime dependencies should not
 * grow a development one to look at its own demo page, and everything
 * this has to do is answer GET with a file and the right type: ES
 * modules need `text/javascript' or a browser refuses to import them,
 * which is the whole reason `file://' will not do.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'text/javascript; charset=utf-8',
    '.mjs':  'text/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg':  'image/svg+xml',
};

/* Resolves once the port is known: `listen' is asynchronous, so a server
   returned any earlier has `address()' of null and the caller finds out
   by dereferencing it. */
export function serve (root, port = 0, host = '127.0.0.1')
{
    root = path.resolve(root);

    const server = http.createServer((req, res) =>
    {
        const url = new URL(req.url, 'http://localhost');
        const file = path.join(root, decodeURIComponent(url.pathname));

        /* A path that climbs out of the root is not a path this answers,
           however it was spelled. */
        if (!file.startsWith(root))
        {
            res.writeHead(403).end('no');
            return;
        }

        fs.readFile(file, (err, body) =>
        {
            if (err)
            {
                res.writeHead(404).end('not here');
                return;
            }

            res.writeHead(200, {
                'Content-Type': TYPES[path.extname(file)] ??
                                'application/octet-stream',
                'Cache-Control': 'no-store',
            });
            res.end(body);
        });
    });

    return new Promise((ok, no) =>
    {
        server.once('error', no);
        server.listen(port, host, () => ok(server));
    });
}

/* `node test/serve.mjs' to look at the demo by hand. */
if (process.argv[1] === fileURLToPath(import.meta.url))
{
    const here = path.dirname(fileURLToPath(import.meta.url));
    const site = await serve(path.join(here, '..'), 8080);

    process.stdout.write(`http://127.0.0.1:${site.address().port}/demo/\n`);
}
