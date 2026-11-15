// Offline Node 22 build. The snapshot is the only model input.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const filename = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const limits = { text_max_bytes: 65536, screenshots: { max: 4, max_bytes: 524288 }, dashboard: { max_files: 400, max_bytes: 4194304 } };

function options(): { input: string; output: string } {
  const result = { input: '/input', output: process.env.MAKEFUN_OUTPUT_DIR || '/output' };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const match = /^--(input|output)(?:=(.*))?$/.exec(args[i]);
    if (!match) throw new Error(`Unknown argument: ${args[i]}`);
    const value = match[2] ?? args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${match[1]}`);
    result[match[1] as 'input' | 'output'] = value;
  }
  return result;
}

// Walk deterministically and reject links/special files instead of silently omitting them.
function inventory(directory: string, prefix = ''): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (entry.name.startsWith('.')) continue;
    if (!filename.test(entry.name)) throw new Error(`Invalid artifact name: ${entry.name}`);
    const name = prefix + entry.name;
    if (entry.isDirectory()) files.push(...inventory(join(directory, entry.name), name + '/'));
    else if (entry.isFile()) files.push(name);
    else throw new Error(`Artifact must be a regular file: ${name}`);
  }
  return files;
}

function copyArtifacts(source: string, target: string, files: string[]): void {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const file of files) {
    const destination = join(target, file);
    mkdirSync(resolve(destination, '..'), { recursive: true });
    copyFileSync(join(source, file), destination);
  }
}

function inside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function build(): void {
  const args = options();
  const input = resolve(args.input.endsWith('.json') ? args.input : join(args.input, 'snapshot.json'));
  const output = resolve(args.output);
  // A mistyped output directory must never erase the source tree or input.
  if (inside(root, output) || inside(input, output)) throw new Error('Output must not contain the repository or snapshot');
  for (const folder of ['dashboard', 'screenshots', 'lib', 'vendor']) {
    if (inside(output, join(root, folder))) throw new Error('Output must not be inside source assets');
  }
  if (!existsSync(input)) throw new Error(`Snapshot missing: ${input}`);
  const snapshot = parseSnapshot(readFileSync(input, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue) throw new Error(issue);
  const dashboard = inventory(join(root, 'dashboard'));
  const shots = inventory(join(root, 'screenshots'));
  if (!dashboard.includes('index.html') || !dashboard.some(f => f.endsWith('.css')) || !dashboard.some(f => f.endsWith('.js'))) throw new Error('Dashboard needs HTML, CSS and JavaScript');
  if (shots.length < 3 || shots.length > 4 || shots.some(f => f.includes('/') || !/\.(png|jpe?g)$/i.test(f))) throw new Error('Expected 3–4 PNG/JPEG screenshots at the screenshot root');
  const bytes = dashboard.reduce((n, f) => n + statSync(join(root, 'dashboard', f)).size, 0);
  if (dashboard.length > limits.dashboard.max_files || bytes > limits.dashboard.max_bytes) throw new Error('Dashboard exceeds limits');
  mkdirSync(output, { recursive: true });
  copyArtifacts(join(root, 'dashboard'), join(output, 'dashboard'), dashboard);
  copyArtifacts(join(root, 'screenshots'), join(output, 'screenshots'), shots);
  writeFileSync(join(output, 'board.json'), JSON.stringify({ rows: board }) + '\n');
  writeFileSync(join(output, 'data.js'), dataScript(radar));
  const dossier = buildDossier(output, limits);
  if (Buffer.byteLength(dossier) > 1572864) throw new Error('Dossier exceeds 1.5 MiB');
  writeFileSync(join(output, 'dossier.json'), dossier);
  console.log(JSON.stringify({ model: radar.model_version, rows: board.length, watchlist: snapshot.watchlist.length, comps: radar.evidence.comp_count, development_holdout: radar.evidence.oos, dashboard_bytes: bytes, screenshots: shots.length, dossier_bytes: Buffer.byteLength(dossier) }));
}

try { build(); } catch (error) {
  console.error('launch radar:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
