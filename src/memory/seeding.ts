/**
 * HyperSABMemory — Cold-Start Bootstrap Seeding (F1)
 * Derives first-boot facts from the workspace itself (README intro, package.json
 * stack, top-level layout, recent git subjects) and writes them straight through
 * SqliteStore.set()'s CAS path — bypassing remember() so seeds are never deduped
 * or superseded at write time. Seed ids are deterministic, so re-seeding is inert.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { SqliteStore, MemoryRecord } from './sqliteStore.js';

const execFileAsync = promisify(execFile);

/** Tag marking bootstrap facts; also gates the never-supersede scan in remember(). */
export const SEED_TAG = 'seeded';

type SeedCategory = 'architecture' | 'general';

interface SeedDraft {
  id: string;
  category: SeedCategory;
  content: string;
}

export type SeedRecord = Omit<MemoryRecord, 'timestamp'> & { timestamp?: string };

const CONTENT_CLIP = 240;

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > CONTENT_CLIP ? `${flat.slice(0, CONTENT_CLIP)}…` : flat;
}

function draft(id: string, category: SeedCategory, content: string): SeedDraft {
  return { id, category, content };
}

function toSeedRecord(seedDraft: SeedDraft): SeedRecord {
  return { ...seedDraft, tags: [SEED_TAG], source: 'seed' };
}

function readReadmeIntro(workspaceDir: string): string | null {
  for (const name of ['README.md', 'readme.md', 'Readme.md']) {
    const filePath = path.join(workspaceDir, name);
    if (!fs.existsSync(filePath)) continue;
    const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);
    const heading = lines.find((l) => /^#{1,6}\s+\S/.test(l))?.replace(/^#{1,6}\s+/, '').trim();
    const body = lines
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('<') && !l.startsWith('!['));
    const parts = [heading, body].filter((s): s is string => Boolean(s));
    return parts.length > 0 ? clip(parts.join(' — ')) : null;
  }
  return null;
}

function readPackageFacts(workspaceDir: string): { project: string | null; stack: string | null } {
  const filePath = path.join(workspaceDir, 'package.json');
  if (!fs.existsSync(filePath)) return { project: null, stack: null };
  try {
    const pkg = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
      name?: string;
      description?: string;
      type?: string;
      bin?: unknown;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const depCount = Object.keys(pkg.dependencies ?? {}).length;
    const language =
      pkg.devDependencies?.typescript || fs.existsSync(path.join(workspaceDir, 'tsconfig.json'))
        ? 'TypeScript'
        : 'JavaScript';
    const moduleKind = pkg.type === 'module' ? 'ESM' : 'CommonJS';
    const kind = pkg.bin ? ' CLI' : '';
    const project = pkg.name ? clip([pkg.name, pkg.description].filter(Boolean).join(' — ')) : null;
    return { project, stack: `${language} ${moduleKind}${kind}, ${depCount} runtime deps` };
  } catch {
    return { project: null, stack: null };
  }
}

function layoutDraft(
  workspaceDir: string,
  id: string,
  role: string,
  candidates: string[]
): SeedDraft | null {
  const dirName = candidates.find((c) => {
    const p = path.join(workspaceDir, c);
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  });
  return dirName ? draft(id, 'general', `Top-level ${dirName}/ directory present (${role})`) : null;
}

async function gitSubjectDigest(workspaceDir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['log', '-5', '--pretty=%s'], { cwd: workspaceDir });
    const subjects = stdout.split(/\r?\n/).filter(Boolean);
    return subjects.length > 0 ? clip(subjects.join(' | ')) : null;
  } catch {
    return null;
  }
}

export async function deriveBootstrapFacts(workspaceDir: string): Promise<SeedRecord[]> {
  const drafts: SeedDraft[] = [];
  const pkg = readPackageFacts(workspaceDir);
  if (pkg.project) drafts.push(draft('seed_project', 'architecture', `Project: ${pkg.project}`));
  if (pkg.stack) drafts.push(draft('seed_stack', 'architecture', `Stack: ${pkg.stack}`));

  const readme = readReadmeIntro(workspaceDir);
  if (readme) drafts.push(draft('seed_readme', 'architecture', `README: ${readme}`));

  const layoutSpecs: Array<[string, string, string[]]> = [
    ['seed_dir_src', 'implementation code', ['src', 'lib']],
    ['seed_dir_tests', 'tests', ['tests', 'test', '__tests__']],
    ['seed_dir_docs', 'documentation', ['docs', 'doc']]
  ];
  for (const [id, role, candidates] of layoutSpecs) {
    const layout = layoutDraft(workspaceDir, id, role, candidates);
    if (layout) drafts.push(layout);
  }

  const gitDigest = await gitSubjectDigest(workspaceDir);
  if (gitDigest) drafts.push(draft('seed_git', 'general', `Recent commits: ${gitDigest}`));

  return drafts.map(toSeedRecord);
}

export async function seedWorkspace(
  workspaceDir: string,
  store: SqliteStore = new SqliteStore(path.join(workspaceDir, '.hypersabmemory'))
): Promise<{ seeded: number; total: number }> {
  let seeded = 0;
  for (const fact of await deriveBootstrapFacts(workspaceDir)) {
    if (store.get(fact.id)) continue;
    store.set(fact);
    seeded++;
  }
  const total = store.getAll().filter((r) => r.source === 'seed').length;
  return { seeded, total };
}

export function writeGenesisRecord(
  workspaceDir: string,
  store: SqliteStore = new SqliteStore(path.join(workspaceDir, '.hypersabmemory'))
): MemoryRecord {
  return store.set({
    id: 'seed_genesis',
    category: 'decision',
    content: `GENESIS: workspace memory initialized ${new Date().toISOString().slice(0, 10)}`,
    tags: [SEED_TAG, 'genesis'],
    source: 'seed'
  });
}
