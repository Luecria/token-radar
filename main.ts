// Launch Radar's entrypoint (Node 22, standard library only, no network).
//
// Reads the sealed snapshot, fits the value model on the protocols that record
// a token (lib/model.ts), scores every ranked protocol with the fitted model,
// and writes the graded output: board.json, the dashboard's data.js, copies of
// dashboard/ and screenshots/, and dossier.json, the summary the judge reads,
// built with the vendored make.fun library.
//
// The program is deterministic: the same snapshot always writes the same bytes.
// It runs twice on the grader and both runs must agree.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const REPO_ROOT = fileURLToPath(new URL('.', import.meta.url));

/** The gate's caps, as the dossier library takes them. */
const DOSSIER_TEXT_BYTES = 65_536;
const SCREENSHOT_LIMIT = { max: 4, max_bytes: 524_288 };
const DASHBOARD_LIMIT = { max_files: 400, max_bytes: 4_194_304 };
const PLAIN_FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The value after `--name <value>` or `--name=<value>`, or the fallback. */
function flagValue(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`launch radar: ${message}\n`);
  process.exit(1);
}

const inputArg = flagValue('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const outDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

/** Copy a directory tree's regular files, skipping dot-names, and return the files copied. */
function copyTree(from: string, to: string, prefix = ''): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      copied.push(...copyTree(source, target, rel));
    } else if (entry.isFile() && statSync(source).isFile()) {
      copyFileSync(source, target);
      copied.push(rel);
    }
  }
  return copied;
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

// A re-run into the same directory must not keep stale files: the dossier is
// built from whatever the output holds, so the copied trees start empty.
rmSync(join(outDir, 'dashboard'), { recursive: true, force: true });
rmSync(join(outDir, 'screenshots'), { recursive: true, force: true });

const dashboardFiles = copyTree(join(REPO_ROOT, 'dashboard'), join(outDir, 'dashboard'));
if (!dashboardFiles.includes('index.html')) fail('dashboard/ holds no index.html: the page is what the judge reads');
// The dossier's text holds every dashboard file whole only while the source
// fits the text cap; past it the judge reads a partial source. Warn, never fail:
// the gate takes a cut dossier, but a cut source is a weaker entry.
const dashboardBytes = dashboardFiles.reduce((n, rel) => n + statSync(join(outDir, 'dashboard', rel)).size, 0);
if (dashboardBytes > DOSSIER_TEXT_BYTES) {
  process.stderr.write(`launch radar: warning: dashboard/ is ${dashboardBytes} bytes, over the ${DOSSIER_TEXT_BYTES} the dossier's text holds whole: the judge will read a partial source\n`);
}

const shots = copyTree(join(REPO_ROOT, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3 to 4, the board, a detail view, a filtered view and the model view`);
}
for (const name of shots) {
  if (!PLAIN_FILE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier is written last: the scorer rebuilds it from this output and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: DOSSIER_TEXT_BYTES, screenshots: SCREENSHOT_LIMIT, dashboard: DASHBOARD_LIMIT }),
);

process.stdout.write(
  `launch radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows ranked (${radar.early_size} early rows below the floor, ${radar.live_size} live-token protocols set aside)\n` +
    `launch radar: fit on ${radar.evidence.comp_count} comps: ln(mcap) = ${radar.evidence.fit.intercept.toFixed(3)} + ${radar.evidence.fit.slope.toFixed(3)} x ln(TVL); out-of-sample (${radar.evidence.oos.method}, ${radar.evidence.oos.test_n} held out) median |log error| ${radar.evidence.oos.med_abs_log_err}, ${radar.evidence.oos.within_2x === null ? 'n/a' : `${(radar.evidence.oos.within_2x * 100).toFixed(1)}%`} within 2x\n` +
    `launch radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, dashboard/ (${dashboardFiles.length} files, ${dashboardBytes} bytes), screenshots/ (${shots.length} images) and ${join(outDir, 'dossier.json')}\n`,
);
