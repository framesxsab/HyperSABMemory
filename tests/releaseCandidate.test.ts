
import { describe, expect, it } from 'vitest';
import { checkRegistry, releaseChannel } from '../scripts/release-candidate.mjs';

const preview = { version: '1.5.0-preview.1', tag: 'preview', latestBefore: '1.4.1', integrity: 'sha512-candidate' };
const metadata = () => ({
  name: 'hypersabmemory',
  versions: { '1.4.1': {} } as Record<string, { dist?: { integrity: string } }>,
  'dist-tags': { latest: '1.4.1' } as Record<string, string>
});
const changelog = (version: string) => '# Changelog\n## [Unreleased]\n\n## [' + version + '] - 2026-11-26\r\n';

describe('release candidate policy', () => {
  it('derives channels from the full version and requires the current changelog and exact tag', () => {
    expect(releaseChannel(preview.version, changelog(preview.version), 'v' + preview.version)).toBe('preview');
    expect(releaseChannel('1.5.0', changelog('1.5.0'))).toBe('latest');
    expect(() => releaseChannel(preview.version, changelog('1.4.1'))).toThrow('changelog');
    expect(() => releaseChannel(preview.version, changelog(preview.version).repeat(2))).toThrow('duplicate');
    expect(() => releaseChannel(preview.version, changelog(preview.version), 'v1.5.0')).toThrow('tag');
  });

  it.each(['01.5.0', '1.5.0-preview.01', '1.5.0-rc.1', '1.5.0+local', ' 1.5.0', '1.5.0\n'])('rejects %j', (version) => {
    expect(() => releaseChannel(version, changelog(version))).toThrow('canonical');
  });

  it('rejects incomplete metadata, duplicates and decreasing tag versions', () => {
    const data = metadata();
    expect(() => checkRegistry(data, preview)).not.toThrow();
    expect(() => checkRegistry({ name: 'hypersabmemory' }, preview)).toThrow('incomplete');
    data.versions[preview.version] = {};
    expect(() => checkRegistry(data, preview)).toThrow('already published');
    delete data.versions[preview.version];
    data.versions['1.5.0-preview.10'] = {};
    data['dist-tags'].preview = '1.5.0-preview.10';
    expect(() => checkRegistry(data, preview)).toThrow('backwards');
    expect(() => checkRegistry(data, { version: '1.4.0', tag: 'latest' })).toThrow('backwards');
  });

  it('requires registry bytes and the intended tag while preserving latest', () => {
    const data = metadata();
    data.versions[preview.version] = { dist: { integrity: preview.integrity } };
    expect(() => checkRegistry(data, preview, true)).toThrow('tag mismatch');
    data['dist-tags'].preview = preview.version;
    expect(() => checkRegistry(data, { ...preview, integrity: 'other' }, true)).toThrow('integrity');
    expect(() => checkRegistry(data, preview, true)).not.toThrow();
    data.versions['1.4.2'] = {};
    data['dist-tags'].latest = '1.4.2';
    expect(() => checkRegistry(data, preview, true)).toThrow('changed latest');
  });
});
