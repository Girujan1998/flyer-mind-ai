// Tee console output to logs/server.log so you can follow it from another
// terminal (`npm run logs`) while the app runs on a phone. Imported first in
// index.js. logs/ is gitignored.

import {createWriteStream, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspect} from 'node:util';

const LOG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'logs');
mkdirSync(LOG_DIR, {recursive: true});
const stream = createWriteStream(join(LOG_DIR, 'server.log'), {flags: 'a'});

const stamp = () => new Date().toISOString().slice(11, 23);
const fmt = a => (typeof a === 'string' ? a : inspect(a, {depth: 3}));

for (const level of ['log', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    original(...args);
    try {
      stream.write(`${stamp()} ${args.map(fmt).join(' ')}\n`);
    } catch {
      /* logging must never crash the server */
    }
  };
}

stream.write(`\n${stamp()} ── server starting ──\n`);
