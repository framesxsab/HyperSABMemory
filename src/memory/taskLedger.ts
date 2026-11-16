import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { TokenCompressor } from '../harness/tokenCompressor.js';
import { captureTaskSources, type TaskSource } from '../harness/taskSources.js';
import { renderTaskCapsule } from '../harness/taskContext.js';

export type TaskState = 'ready' | 'claimed' | 'blocked' | 'reported_complete';

export interface TaskRecord {
  id: string;
  schemaVersion: 1;
  goal: string;
  constraints: string[];
  acceptanceCriteria: string[];
  sourceRefs: TaskSource[];
  decisions: string[];
  completedWork: string[];
  evidenceRefs: TaskSource[];
  openIssues: string[];
  blockers: string[];
  nextAction: string;
  summary: string;
  checks: string[];
  revision: number;
  leaseGeneration: number;
  state: TaskState;
  owner?: string;
  leaseExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  goal: string;
  constraints?: string[];
  acceptanceCriteria: string[];
  sourceRefs?: string[];
  decisions?: string[];
  completedWork?: string[];
  openIssues?: string[];
  blockers?: string[];
  nextAction?: string;
  summary?: string;
  checks?: string[];
}

export interface ClaimTaskInput {
  taskId: string;
  agentId: string;
  action?: 'acquire' | 'renew' | 'release';
  leaseMinutes?: number;
  leaseGeneration?: number;
}

export interface CheckpointTaskInput {
  taskId: string;
  agentId: string;
  expectedRevision: number;
  leaseGeneration: number;
  state?: 'claimed' | 'blocked' | 'reported_complete';
  summary?: string;
  decisions?: string[];
  completedWork?: string[];
  evidencePaths?: string[];
  sourcePaths?: string[];
  openIssues?: string[];
  blockers?: string[];
  nextAction?: string;
  checks?: string[];
}

export class TaskError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'TaskError';
  }
}

interface TaskFile {
  schemaVersion: 1;
  tasks: TaskRecord[];
}

const TASK_KEYS = [
  'id', 'schemaVersion', 'goal', 'constraints', 'acceptanceCriteria', 'sourceRefs',
  'decisions', 'completedWork', 'evidenceRefs', 'openIssues', 'blockers', 'nextAction',
  'summary', 'checks', 'revision', 'leaseGeneration', 'state', 'owner', 'leaseExpiresAt', 'createdAt', 'updatedAt'
];
const CREATE_KEYS = ['goal', 'constraints', 'acceptanceCriteria', 'sourceRefs', 'decisions', 'completedWork', 'openIssues', 'blockers', 'nextAction', 'summary', 'checks'];
const CHECKPOINT_KEYS = ['taskId', 'agentId', 'expectedRevision', 'leaseGeneration', 'state', 'summary', 'decisions', 'completedWork', 'evidencePaths', 'sourcePaths', 'openIssues', 'blockers', 'nextAction', 'checks'];
const ARRAY_FIELDS = ['constraints', 'acceptanceCriteria', 'decisions', 'completedWork', 'openIssues', 'blockers', 'checks'] as const;
const MAX_CAPSULE_TOKENS = 600;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TaskError('INVALID_INPUT', 'Expected an object.');
  }
  return value as Record<string, unknown>;
}

function keys(value: unknown, allowed: string[]): Record<string, unknown> {
  const record = object(value);
  const unexpected = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new TaskError('INVALID_INPUT', `Unknown field: ${unexpected[0]}`);
  return record;
}

function text(value: unknown, field: string, required = false, maxLength = 2400): string {
  if (typeof value !== 'string' || value.length > maxLength || value.includes('\0') || (required && !value.trim())) {
    throw new TaskError('INVALID_INPUT', `${field} must be ${required ? 'a non-empty' : 'a'} string of at most ${maxLength} characters.`);
  }
  return value.trim();
}

function strings(value: unknown, field: string, required = false): string[] {
  if (!Array.isArray(value) || value.length > 64 || (required && !value.length)) {
    throw new TaskError('INVALID_INPUT', `${field} must be ${required ? 'a non-empty ' : 'an '}array of at most 64 strings.`);
  }
  return value.map((item) => text(item, field, true));
}

function timestamp(value: unknown, field: string): void {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new TaskError('INVALID_INPUT', `${field} must be an ISO timestamp.`);
  }
}

/** Local task coordination state, independent of durable memories and swarm broadcasts. */
export class TaskLedger {
  private readonly workspaceDir: string;
  private readonly directory: string;
  private readonly file: string;
  private readonly coordinator: string;
  private readonly now: () => Date;

  constructor(workspaceDir: string, options: { now?: () => Date } = {}) {
    try {
      this.workspaceDir = fs.realpathSync(workspaceDir);
      if (!fs.statSync(this.workspaceDir).isDirectory()) throw new Error('not a directory');
    } catch {
      throw new TaskError('INVALID_WORKSPACE', 'Task workspace must be an existing directory.');
    }
    this.directory = path.join(this.workspaceDir, '.hypersabmemory');
    this.file = path.join(this.directory, 'tasks.json');
    this.coordinator = path.join(this.directory, 'tasks-coordinator.sqlite');
    this.now = options.now ?? (() => new Date());
    this.safeStorage(false);
  }

  private safeStorage(create: boolean): void {
    if (!fs.existsSync(this.directory)) {
      if (!create) return;
      fs.mkdirSync(this.directory, { recursive: true });
    }
    const relative = path.relative(this.workspaceDir, fs.realpathSync(this.directory));
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new TaskError('STORAGE_PATH_ESCAPE', 'Task state directory escapes the workspace.');
    }
    for (const filename of [this.file, `${this.file}.tmp`, `${this.file}.bak`, `${this.file}.lock`, this.coordinator, `${this.coordinator}-journal`]) {
      try {
        if (fs.lstatSync(filename).isSymbolicLink()) throw new TaskError('STORAGE_PATH_ESCAPE', 'Task state files must not be symbolic links.');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }

  private capture(paths: unknown, field: string): TaskSource[] {
    const list = strings(paths, field);
    try {
      return captureTaskSources(this.workspaceDir, list);
    } catch (error) {
      throw new TaskError('INVALID_SOURCE_PATH', error instanceof Error ? error.message : 'Invalid source path.');
    }
  }

  private refs(value: unknown, field: string): void {
    if (!Array.isArray(value) || value.length > 64) throw new TaskError('INVALID_INPUT', `Invalid ${field}.`);
    for (const ref of value) {
      const entry = keys(ref, ['path', 'sha256']);
      const filename = text(entry.path, `${field}.path`, true);
      const relative = path.relative(this.workspaceDir, path.resolve(this.workspaceDir, filename));
      if (path.isAbsolute(filename) || !relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new TaskError('INVALID_INPUT', `${field} contains a path outside the workspace.`);
      }
      if (typeof entry.sha256 !== 'string' || !/^(?:[a-f0-9]{64})?$/.test(entry.sha256)) {
        throw new TaskError('INVALID_INPUT', `${field} contains an invalid content hash.`);
      }
    }
  }

  private validate(task: unknown): asserts task is TaskRecord {
    const record = keys(task, TASK_KEYS);
    if (record.schemaVersion !== 1) throw new TaskError('INVALID_INPUT', 'Invalid task schema version.');
    text(record.id, 'id', true, 100);
    text(record.goal, 'goal', true);
    text(record.summary, 'summary');
    text(record.nextAction, 'nextAction');
    for (const field of ARRAY_FIELDS) strings(record[field], field, field === 'acceptanceCriteria');
    this.refs(record.sourceRefs, 'sourceRefs');
    this.refs(record.evidenceRefs, 'evidenceRefs');
    if (!Number.isSafeInteger(record.revision) || (record.revision as number) < 1) throw new TaskError('INVALID_INPUT', 'Invalid task revision.');
    if (!Number.isSafeInteger(record.leaseGeneration) || (record.leaseGeneration as number) < 0) throw new TaskError('INVALID_INPUT', 'Invalid lease generation.');
    if (!['ready', 'claimed', 'blocked', 'reported_complete'].includes(record.state as string)) throw new TaskError('INVALID_INPUT', 'Invalid task state.');
    timestamp(record.createdAt, 'createdAt');
    timestamp(record.updatedAt, 'updatedAt');
    if ((record.owner === undefined) !== (record.leaseExpiresAt === undefined)) throw new TaskError('INVALID_INPUT', 'Task owner and lease must appear together.');
    if (record.owner !== undefined) {
      text(record.owner, 'owner', true, 128);
      timestamp(record.leaseExpiresAt, 'leaseExpiresAt');
      if (record.state === 'ready' || record.state === 'reported_complete') throw new TaskError('INVALID_INPUT', 'Task state cannot retain a claim.');
    }
    if (record.state === 'claimed' && record.owner === undefined) throw new TaskError('INVALID_INPUT', 'Claimed task requires an owner.');
    if (record.state === 'reported_complete' && (!(record.evidenceRefs as TaskSource[]).some((ref) => ref.sha256) || !(record.checks as string[]).length)) {
      throw new TaskError('EVIDENCE_REQUIRED', 'Reported completion requires a readable evidence file and a reported check.');
    }
    const estimatedTokens = TokenCompressor.estimateTokens(renderTaskCapsule(record as unknown as TaskRecord));
    if (estimatedTokens > MAX_CAPSULE_TOKENS) {
      throw new TaskError('CAPSULE_BUDGET_EXCEEDED', 'Task capsule exceeds 600 estimated tokens; use concise facts and evidence paths.', { estimatedTokens, limit: MAX_CAPSULE_TOKENS });
    }
  }

  private readFile(filename: string): TaskFile {
    const parsed: unknown = JSON.parse(fs.readFileSync(filename, 'utf8'));
    const record = keys(parsed, ['schemaVersion', 'tasks']);
    if (record.schemaVersion !== 1) throw new TaskError('UNSUPPORTED_TASK_SCHEMA', 'Unsupported task ledger schema version.');
    if (!Array.isArray(record.tasks)) throw new TaskError('INVALID_INPUT', 'Task ledger tasks must be an array.');
    const ids = new Set<string>();
    for (const task of record.tasks) {
      this.validate(task);
      if (ids.has(task.id)) throw new TaskError('INVALID_INPUT', 'Duplicate task identifier.');
      ids.add(task.id);
    }
    return { schemaVersion: 1, tasks: record.tasks };
  }

  private load(): TaskFile {
    this.safeStorage(false);
    if (!fs.existsSync(this.file) && !fs.existsSync(`${this.file}.bak`) && !fs.existsSync(`${this.file}.tmp`)) return { schemaVersion: 1, tasks: [] };
    try {
      return this.readFile(this.file);
    } catch (error) {
      if (error instanceof TaskError && error.code === 'UNSUPPORTED_TASK_SCHEMA') throw error;
      throw new TaskError('CORRUPT_TASK_LEDGER', 'Task ledger is unreadable; existing files were preserved for diagnosis.');
    }
  }

  private save(state: TaskFile): void {
    this.safeStorage(true);
    try {
      fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(state, null, 2), 'utf8');
      const fileFd = fs.openSync(`${this.file}.tmp`, 'r+');
      try { fs.fsyncSync(fileFd); } finally { fs.closeSync(fileFd); }
      try {
        fs.renameSync(`${this.file}.tmp`, this.file);
      } catch (error) {
        if (!['EPERM', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        fs.renameSync(`${this.file}.tmp`, this.file);
      }
      if (process.platform !== 'win32') {
        try {
          const directoryFd = fs.openSync(this.directory, 'r');
          try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
        } catch (error) {
          throw new TaskError('TASK_PERSISTENCE_UNCERTAIN', 'Task JSON was replaced, but directory durability could not be confirmed.', { cause: error instanceof Error ? error.message : String(error) });
        }
      }
      try { fs.copyFileSync(this.file, `${this.file}.bak`); }
      catch { console.warn('[HyperSABMemory :: Tasks] Task update persisted, but backup refresh failed.'); }
    } catch (error) {
      throw new TaskError('TASK_PERSISTENCE_FAILED', error instanceof Error ? error.message : 'Task write failed.');
    }
  }

  private clock(): Date {
    const now = this.now();
    if (!Number.isFinite(now.getTime())) throw new TaskError('INVALID_CLOCK', 'Task clock returned an invalid date.');
    return now;
  }

  private mutate(fn: (state: TaskFile) => TaskRecord): TaskRecord {
    this.safeStorage(true);
    let persisted = false;
    let db: Database.Database | undefined;
    try {
      db = new Database(this.coordinator, { timeout: 4000 });
      db.pragma('synchronous = FULL');
      db.exec('CREATE TABLE IF NOT EXISTS task_writer (id INTEGER PRIMARY KEY CHECK (id = 1), generation INTEGER NOT NULL); INSERT OR IGNORE INTO task_writer (id, generation) VALUES (1, 0);');
      const transaction = db.transaction(() => {
        db!.prepare('UPDATE task_writer SET generation = generation WHERE id = 1').run();
        const state = this.load();
        const result = fn(state);
        this.validate(result);
        this.save(state);
        persisted = true;
        return structuredClone(result);
      });
      return transaction.immediate();
    } catch (error) {
      if (error instanceof TaskError) throw error;
      if (persisted) throw new TaskError('TASK_COMMIT_UNCERTAIN', 'The task ledger was replaced, but the SQLite coordinator commit failed; read the task revision before retrying.', { cause: error instanceof Error ? error.message : String(error) });
      throw new TaskError('TASK_COORDINATION_FAILED', 'SQLite task coordination failed before task persistence; tasks.json was not changed.', { cause: error instanceof Error ? error.message : String(error) });
    } finally {
      try { db?.close(); } catch { /* transaction cleanup is handled by SQLite when the connection closes */ }
    }
  }

  private find(state: TaskFile, id: unknown): TaskRecord {
    const taskId = text(id, 'taskId', true, 100);
    const task = state.tasks.find((entry) => entry.id === taskId);
    if (!task) throw new TaskError('TASK_NOT_FOUND', `Task ${taskId} was not found.`, { taskId });
    return task;
  }

  private requireOwner(task: TaskRecord, agentId: string, now: Date): void {
    if (task.owner !== agentId) throw new TaskError('NOT_TASK_OWNER', 'Only the current task owner may update this task.', { owner: task.owner ?? null });
    if (!task.leaseExpiresAt || Date.parse(task.leaseExpiresAt) <= now.getTime()) throw new TaskError('LEASE_EXPIRED', 'Task claim has expired; reacquire it before updating.');
  }

  public create(input: CreateTaskInput): TaskRecord {
    const record = keys(input, CREATE_KEYS);
    const now = this.clock().toISOString();
    const task: TaskRecord = {
      id: `task_${randomUUID()}`,
      schemaVersion: 1,
      goal: text(record.goal, 'goal', true),
      constraints: strings(record.constraints ?? [], 'constraints'),
      acceptanceCriteria: strings(record.acceptanceCriteria, 'acceptanceCriteria', true),
      sourceRefs: this.capture(record.sourceRefs ?? [], 'sourceRefs'),
      decisions: strings(record.decisions ?? [], 'decisions'),
      completedWork: strings(record.completedWork ?? [], 'completedWork'),
      evidenceRefs: [],
      openIssues: strings(record.openIssues ?? [], 'openIssues'),
      blockers: strings(record.blockers ?? [], 'blockers'),
      nextAction: text(record.nextAction ?? '', 'nextAction'),
      summary: text(record.summary ?? '', 'summary'),
      checks: strings(record.checks ?? [], 'checks'),
      revision: 1,
      leaseGeneration: 0,
      state: 'ready',
      createdAt: now,
      updatedAt: now
    };
    this.validate(task);
    return this.mutate((state) => { state.tasks.push(task); return task; });
  }

  public claim(input: ClaimTaskInput): TaskRecord {
    const record = keys(input, ['taskId', 'agentId', 'action', 'leaseMinutes', 'leaseGeneration']);
    const agentId = text(record.agentId, 'agentId', true, 128);
    const action = record.action ?? 'acquire';
    if (!['acquire', 'renew', 'release'].includes(action as string)) throw new TaskError('INVALID_INPUT', 'Invalid claim action.');
    const leaseMinutes = record.leaseMinutes ?? 10;
    if (typeof leaseMinutes !== 'number' || !Number.isFinite(leaseMinutes) || leaseMinutes <= 0 || leaseMinutes > 1440) throw new TaskError('INVALID_INPUT', 'leaseMinutes must be positive and no greater than 1440.');
    return this.mutate((state) => {
      const task = this.find(state, record.taskId);
      const now = this.clock();
      if (task.state === 'reported_complete') throw new TaskError('TASK_COMPLETE', 'Reported-complete tasks cannot be claimed again.');
      if (action === 'release' || action === 'renew') {
        this.requireOwner(task, agentId, now);
        if (record.leaseGeneration !== task.leaseGeneration) throw new TaskError('OWNERSHIP_CONFLICT', 'Lease generation changed; reacquire ownership.');
      }
      else if (task.owner && task.owner !== agentId && Date.parse(task.leaseExpiresAt!) > now.getTime()) {
        throw new TaskError('CLAIM_CONFLICT', 'Task is already claimed.', { owner: task.owner, leaseExpiresAt: task.leaseExpiresAt });
      }
      if (action === 'release') {
        delete task.owner;
        delete task.leaseExpiresAt;
        if (task.state === 'claimed') task.state = 'ready';
      } else {
        if (action === 'acquire') task.leaseGeneration++;
        task.owner = agentId;
        task.leaseExpiresAt = new Date(now.getTime() + leaseMinutes * 60_000).toISOString();
        task.state = 'claimed';
      }
      task.revision++;
      task.updatedAt = now.toISOString();
      return task;
    });
  }

  public checkpoint(input: CheckpointTaskInput): TaskRecord {
    const record = keys(input, CHECKPOINT_KEYS);
    const agentId = text(record.agentId, 'agentId', true, 128);
    if (!Number.isSafeInteger(record.expectedRevision) || (record.expectedRevision as number) < 1) throw new TaskError('INVALID_INPUT', 'expectedRevision must be a positive integer.');
    if (record.state !== undefined && !['claimed', 'blocked', 'reported_complete'].includes(record.state as string)) throw new TaskError('INVALID_INPUT', 'Invalid checkpoint state.');
    return this.mutate((state) => {
      const task = this.find(state, record.taskId);
      if (task.revision !== record.expectedRevision) throw new TaskError('REVISION_CONFLICT', 'Task revision changed; reload and reconcile before checkpointing.', {
        expectedRevision: record.expectedRevision, currentRevision: task.revision, currentTask: structuredClone(task)
      });
      const now = this.clock();
      this.requireOwner(task, agentId, now);
      if (record.leaseGeneration !== task.leaseGeneration) throw new TaskError('OWNERSHIP_CONFLICT', 'Lease generation changed; reacquire ownership.');
      for (const field of ['decisions', 'completedWork', 'openIssues', 'blockers', 'checks'] as const) {
        if (record[field] !== undefined) task[field] = strings(record[field], field);
      }
      if (record.summary !== undefined) task.summary = text(record.summary, 'summary');
      if (record.nextAction !== undefined) task.nextAction = text(record.nextAction, 'nextAction');
      if (record.sourcePaths !== undefined) task.sourceRefs = this.capture(record.sourcePaths, 'sourcePaths');
      if (record.evidencePaths !== undefined) task.evidenceRefs = this.capture(record.evidencePaths, 'evidencePaths');
      task.state = (record.state as TaskState | undefined) ?? task.state;
      if (task.state === 'reported_complete') {
        if (!task.evidenceRefs.some((ref) => ref.sha256) || !task.checks.length) throw new TaskError('EVIDENCE_REQUIRED', 'Reported completion requires a readable evidence file and a reported check.');
        delete task.owner;
        delete task.leaseExpiresAt;
      }
      task.revision++;
      task.updatedAt = now.toISOString();
      return task;
    });
  }

  public get(taskId: string): TaskRecord {
    return structuredClone(this.find(this.load(), taskId));
  }

  public list(): TaskRecord[] {
    return structuredClone(this.load().tasks);
  }
}
