import { describe, expect, it } from 'vitest';
import { signJwt, verifyJwt } from './auth';

const S = 'test-secret-0123456789abcdef0123456789';

describe('verifyJwt', () => {
  it('accepts a valid HS256 token', () => {
    const t = signJwt({ sub: 'u-1', exp: 2e9 }, S);
    expect(verifyJwt(t, S)).toEqual({ userId: 'u-1' });
  });
  it('rejects wrong secret, expired, alg=none and garbage', () => {
    expect(
      verifyJwt(signJwt({ sub: 'u', exp: 2e9 }, 'other-secret-xxxxxxxxxxxxxxxxxxxxxx'), S),
    ).toBeNull();
    expect(verifyJwt(signJwt({ sub: 'u', exp: 1000 }, S), S)).toBeNull();
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"u"}').toString('base64url')}.`;
    expect(verifyJwt(none, S)).toBeNull();
    expect(verifyJwt('abc', S)).toBeNull();
    expect(verifyJwt('', S)).toBeNull();
  });
});
