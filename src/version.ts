import * as fs from 'fs';

/**
 * Single source of truth for the displayed version: reads package.json at
 * runtime relative to this module, which sits one level below the package
 * root both in src/ and in compiled dist/.
 */
export function getPackageVersion(): string {
  try {
    const raw = fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8');
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
