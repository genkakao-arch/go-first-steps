// npm run validate [-- --show <id>]
import { boardFromLists, boardToDiagram } from '../src/go/board';
import { PROBLEMS } from '../src/data/problems';
import { TOPICS } from '../src/data/topics';
import { validateSet } from '../src/data/validate';

const show = process.argv.indexOf('--show');
if (show >= 0) {
  for (const id of process.argv.slice(show + 1)) {
    const p = PROBLEMS.find((x) => x.id === id);
    if (!p) continue;
    console.log(`\n${p.id} — ${p.title}\n${p.prompt}`);
    const rows = boardToDiagram(boardFromLists(p.black, p.white).board);
    rows.forEach((r, i) => console.log(`${9 - i} ${r.split('').join(' ')}`));
    console.log('  A B C D E F G H J');
  }
  process.exit(0);
}

const t0 = Date.now();
const issues = validateSet(PROBLEMS, TOPICS);
const errors = issues.filter((i) => i.level === 'error');
const warnings = issues.filter((i) => i.level === 'warning');
for (const i of issues) console.log(`${i.level === 'error' ? 'ERROR' : 'warn '} [${i.id}] ${i.msg}`);
const bad = new Set(errors.map((e) => e.id).filter((id) => id !== '*'));
const valid = PROBLEMS.filter((p) => !bad.has(p.id)).length;
console.log(`\nproblems: ${PROBLEMS.length}, valid: ${valid}, invalid: ${bad.size}, errors: ${errors.length}, warnings: ${warnings.length} (${Date.now() - t0} ms)`);
process.exit(errors.length ? 1 : 0);
