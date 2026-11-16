const { env, argv, platform, stdout } = process;
const enabled = !(env.NO_COLOR || argv.includes('--no-color')) &&
  Boolean(env.FORCE_COLOR || argv.includes('--color') || platform === 'win32' || (stdout.isTTY && env.TERM !== 'dumb') || env.CI);

function color(code: number): (text: string) => string {
  const open = `\x1b[${code}m`;
  const close = '\x1b[39m';
  return (text) => {
    if (!enabled) return String(text);
    const firstClose = text.indexOf(close, open.length);
    const content = firstClose < 0 ? text : text.slice(0, firstClose) + text.slice(firstClose).replaceAll(close, open);
    return open + content + close;
  };
}

export default { red: color(31), green: color(32), yellow: color(33), cyan: color(36), gray: color(90) };
