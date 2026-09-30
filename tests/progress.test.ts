import { describe, expect, it } from 'vitest';
import { parseProgress, sanitize } from '../src/progress';

const ids = ['a', 'b', 'c'];
const topics = ['liberties', 'atari'] as const;

describe('progress storage', () => {
  it('rejects garbage', () => {
    expect(parseProgress('not json', ids, [...topics])).toBeNull();
    expect(parseProgress('null', ids, [...topics])).toBeNull();
    expect(parseProgress('{"v":2,"problems":{}}', ids, [...topics])).toBeNull();
    expect(parseProgress('[1,2]', ids, [...topics])).toBeNull();
  });

  it('sanitises partially broken data', () => {
    const p = sanitize(
      {
        v: 1,
        current: 'zzz',
        problems: { a: { solved: true, attempts: -5, hints: 'x' }, b: 7, nope: { solved: true } },
        introsSeen: ['atari', 'bogus'],
        updatedAt: 'later',
      },
      ids,
      [...topics],
    )!;
    expect(p.current).toBe('a');
    expect(p.problems).toEqual({ a: { solved: true, attempts: 0, hints: 0, revealed: false } });
    expect(p.introsSeen).toEqual(['atari']);
    expect(p.updatedAt).toBe(0);
  });
});
