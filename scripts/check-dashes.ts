import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

import { findLongDashes, formatHit, isCheckedFile } from './lib/long-dashes.ts';

const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
});
// The index still lists files deleted in the working tree until the deletion is staged.
const paths = listed
  .split('\n')
  .filter((path) => path !== '' && isCheckedFile(path) && existsSync(path));
const hits = findLongDashes(paths.map((path) => ({ path, content: readFileSync(path, 'utf8') })));

for (const hit of hits) {
  console.error(formatHit(hit));
}
if (hits.length > 0) {
  console.error(`\n${hits.length} long dash(es) found. Use "-" instead.`);
  process.exit(1);
}
