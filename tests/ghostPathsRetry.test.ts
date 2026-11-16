import { expect, it, vi } from 'vitest';

const { git } = vi.hoisted(() => ({ git: vi.fn() }));
vi.mock('child_process', () => ({ execFileSync: git }));

import { detectGhostCollision } from '../src/harness/ghostPaths.js';

it('retries an index lock and still reports the matching snapshot', () => {
  const wait = vi.spyOn(Atomics, 'wait').mockReturnValue('timed-out');
  try {
    git.mockImplementationOnce(() => { throw new Error('index.lock'); })
      .mockReturnValueOnce('abcdef0123456789\n')
      .mockReturnValueOnce('changed.ts\n');
    expect(detectGhostCollision(process.cwd(), ['changed.ts'])).toEqual({ shortHash: 'abcdef0' });
    expect(git).toHaveBeenCalledTimes(3);
  } finally {
    wait.mockRestore();
  }
});
