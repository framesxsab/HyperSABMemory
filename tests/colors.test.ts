import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('formats all used colors and restores nested foreground colors', async () => {
  vi.stubEnv('NO_COLOR', '');
  vi.stubEnv('FORCE_COLOR', '1');
  const { default: colors } = await import('../src/cli/colors.js');
  for (const [name, code] of [['red', 31], ['green', 32], ['yellow', 33], ['cyan', 36], ['gray', 90]] as const) {
    expect(colors[name]('hello')).toBe(`\x1b[${code}mhello\x1b[39m`);
    expect(colors[name]('hello\x1b[39mworld')).toBe(`\x1b[${code}mhello\x1b[${code}mworld\x1b[39m`);
    expect(colors[name]('\x1b[39mhello')).toBe(`\x1b[${code}m\x1b[39mhello\x1b[39m`);
  }
});

it('honors --no-color even when color is forced', async () => {
  vi.stubEnv('NO_COLOR', '');
  vi.stubEnv('FORCE_COLOR', '1');
  process.argv.push('--no-color');
  try {
    const { default: colors } = await import('../src/cli/colors.js');
    expect(colors.green('hello')).toBe('hello');
  } finally {
    process.argv.pop();
  }
});

it('honors NO_COLOR even when color is forced', async () => {
  vi.stubEnv('NO_COLOR', '1');
  vi.stubEnv('FORCE_COLOR', '1');
  const { default: colors } = await import('../src/cli/colors.js');
  expect(colors.red('hello')).toBe('hello');
});
