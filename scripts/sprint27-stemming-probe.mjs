import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import ts from 'typescript';
import { SPRINT25_DEVELOPMENT } from '../dist/eval/sprint25DevelopmentFixture.js';
import { captureTaskSources } from '../dist/harness/taskSources.js';

assert(process.argv[2], 'provide the absolute index.js path from a temporary stemmer installation');
const stemmerUrl = pathToFileURL(path.resolve(process.argv[2])).href;
let original = fs.readFileSync('src/memory/hybridSearch.ts', 'utf8').replace(/^import \{ stemmer \} from 'stemmer';\r?\n/m, '');
const normalizeStart = original.indexOf('function normalizeToken(token: string): string {');
const normalizeEnd = original.indexOf('export function tokenizeSearchText', normalizeStart);
assert(normalizeStart >= 0 && normalizeEnd > normalizeStart);
const legacyNormalization = `function normalizeToken(token: string): string {\nif (token.length > 5 && token.endsWith('ies')) return token.slice(0, -3) + 'y';\nif (token.length > 5 && /(?:ches|shes|sses|xes|zes)$/.test(token)) return token.slice(0, -2);\nif (token.length > 4 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);\nreturn token;\n}\n`;
original = original.slice(0, normalizeStart) + legacyNormalization + original.slice(normalizeEnd);
assert(original.includes('.map(normalizeToken);'));
const normalization = `const stems = new Map();\nfunction stemToken(token) { if (COMMON_QUERY_TERMS.has(token) || !/^[a-z]+$/.test(token)) return token; if (stems.has(token)) return stems.get(token); const result = stemmer(token); if (stems.size >= 8192) stems.clear(); stems.set(token, result); return result; }\n`;
const candidateSource = `import { stemmer } from '${stemmerUrl}';\n${normalization}` + original.replace('.map(normalizeToken);', '.map(stemToken);').replace(/^import .* from '\.\/.*';\r?\n/gm, '');
const transpile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(transpile(source)).toString('base64')}`;
const hybridUrl = moduleUrl(candidateSource);
const candidateModule = await import(hybridUrl);
const baselineUrl = moduleUrl(original.replace(/^import .* from '\.\/.*';\r?\n/gm, ''));
const baselineModule = await import(baselineUrl);
async function grounderFor(engineUrl) {
  const groundedSource = fs.readFileSync('src/memory/groundedSearch.ts', 'utf8').replace("from './hybridSearch.js'", `from '${engineUrl}'`).replace("from '../harness/taskSources.js'", `from '${pathToFileURL(path.resolve('dist/harness/taskSources.js')).href}'`);
  return (await import(moduleUrl(groundedSource))).searchGrounded;
}
const candidateGrounded = await grounderFor(hybridUrl);
const baselineGrounded = await grounderFor(baselineUrl);
const root = process.cwd();
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.posix.join(directory, entry.name);
    if (entry.isSymbolicLink() || filename === 'src/eval') continue;
    if (entry.isDirectory()) walk(filename);
    else if (entry.isFile() && filename.endsWith('.ts') && !['tests/repositoryTaskEvaluation.test.ts', 'tests/groundedSearch.test.ts'].includes(filename)) files.push(filename);
  }
}
walk('src');
walk('tests');
if (fs.existsSync('Architecture.md')) files.push('Architecture.md');
files.sort();
const records = files.map(filename => ({ id: filename, category: 'architecture', content: fs.readFileSync(filename, 'utf8'), artifacts: [filename], status: 'active', timestamp: '2026-10-27T00:00:00.000Z' }));
const sources = files.flatMap(filename => captureTaskSources(root, [filename]));
const memory = { getActive: () => records };
const output = {};
for (const [name, Engine, ground] of [['baseline', baselineModule.HybridSearchEngine, baselineGrounded], ['porter', candidateModule.HybridSearchEngine, candidateGrounded]]) {
  const engine = new Engine(root, memory, {});
  const times = [];
  const results = SPRINT25_DEVELOPMENT.map(item => {
    const started = performance.now();
    const result = { item, raw: engine.searchRecords(item.query, 5), grounded: ground(engine, root, item.query, sources) };
    times.push(performance.now() - started);
    return result;
  });
  times.sort((first, second) => first - second);
  const answered = results.filter(result => result.item.relevantPaths.length);
  const hits = (result, ids) => ids.filter(id => result.item.relevantPaths.includes(id)).length;
  const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  output[name] = {
    rawP5: mean(answered.map(result => hits(result, result.raw.map(record => record.id)) / 5)),
    rawRecall5: mean(answered.map(result => hits(result, result.raw.map(record => record.id)) / result.item.relevantPaths.length)),
    groundedP5: mean(answered.map(result => hits(result, result.grounded.evidence.map(item => item.record.id)) / 5)),
    groundedRecall5: mean(answered.map(result => hits(result, result.grounded.evidence.map(item => item.record.id)) / result.item.relevantPaths.length)),
    supportedAnswerable: answered.filter(result => result.grounded.canAssert).length,
    unsupportedNoAnswer: results.filter(result => !result.item.relevantPaths.length && result.grounded.canAssert).length,
    noAnswerCandidates: results.filter(result => !result.item.relevantPaths.length && result.raw.length).length,
    combinedLatency: { p50: times[Math.ceil(times.length * 0.5) - 1], p95: times[Math.ceil(times.length * 0.95) - 1] },
    perQuery: answered.map(result => ({ query: result.item.query, rawHits: hits(result, result.raw.map(record => record.id)), groundedHits: hits(result, result.grounded.evidence.map(item => item.record.id)) }))
  };
}
console.log(JSON.stringify({ files: files.length, cases: SPRINT25_DEVELOPMENT.length, sameSnapshot: true, humanReviewed: false, ...output }, null, 2));
