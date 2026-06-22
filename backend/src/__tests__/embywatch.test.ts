// Verify that embywatch uses native fetch (no proxy) vs undici (proxy set).
// This is a regression guard for the container connectivity bug where all
// requests went through undici even without a proxy, causing TLS failures.

const { mockUndiciFetch, MockProxyAgent } = vi.hoisted(() => ({
  mockUndiciFetch: vi.fn(),
  MockProxyAgent: vi.fn(),
}));

vi.mock('undici', () => ({
  fetch: mockUndiciFetch,
  ProxyAgent: MockProxyAgent,
}));

vi.mock('../db/database', () => ({
  db: {
    prepare: vi.fn().mockReturnValue({
      get: vi.fn(),
    }),
  },
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../db/database';
import { runEmbywatch } from '../jobs/embywatch';

const baseConfig = { username: 'user', password: 'pass', playDuration: 1 };

// Each test only needs to verify which fetch path is taken on the first request
// (auth). We let it fail after that -- no need to simulate full playback.

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(db.prepare).mockReturnValue({ get: vi.fn().mockReturnValue(undefined) } as any);
});

describe('embywatch fetch routing', () => {
  it('uses native fetch when no proxy is configured', async () => {
    const nativeFetch = vi.fn().mockRejectedValue(
      Object.assign(new Error('net'), { cause: { code: 'ECONNREFUSED' } }),
    );
    vi.stubGlobal('fetch', nativeFetch);

    await expect(runEmbywatch('https://emby.example.com', baseConfig))
      .rejects.toThrow('Cannot reach Emby server');

    expect(nativeFetch).toHaveBeenCalled();
    expect(mockUndiciFetch).not.toHaveBeenCalled();
  });

  it('uses undici with ProxyAgent when a proxy URL is resolved', async () => {
    mockUndiciFetch.mockRejectedValue(
      Object.assign(new Error('net'), { cause: { code: 'ECONNREFUSED' } }),
    );

    vi.mocked(db.prepare).mockReturnValue({
      get: vi.fn().mockReturnValue({
        value: JSON.stringify([{ id: 'p1', name: 'My Proxy', url: 'http://proxy.local:3128' }]),
      }),
    } as any);

    const nativeFetch = vi.fn();
    vi.stubGlobal('fetch', nativeFetch);

    await expect(runEmbywatch('https://emby.example.com', { ...baseConfig, proxyId: 'p1' }))
      .rejects.toThrow('Cannot reach Emby server');

    expect(mockUndiciFetch).toHaveBeenCalled();
    expect(MockProxyAgent).toHaveBeenCalledWith('http://proxy.local:3128');
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it('falls back to native fetch when proxyId does not match any stored proxy', async () => {
    const nativeFetch = vi.fn().mockRejectedValue(new Error('net'));
    vi.stubGlobal('fetch', nativeFetch);

    vi.mocked(db.prepare).mockReturnValue({
      get: vi.fn().mockReturnValue({
        value: JSON.stringify([{ id: 'other', url: 'http://x' }]),
      }),
    } as any);

    await expect(runEmbywatch('https://emby.example.com', { ...baseConfig, proxyId: 'missing' }))
      .rejects.toThrow();

    expect(nativeFetch).toHaveBeenCalled();
    expect(mockUndiciFetch).not.toHaveBeenCalled();
  });

  it('wraps network errors with the full request URL and cause', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }),
    ));

    await expect(runEmbywatch('https://emby.example.com', baseConfig))
      .rejects.toThrow('Cannot reach Emby server at https://emby.example.com/Users/AuthenticateByName — ECONNREFUSED');
  });

  it('surfaces HTTP error status and Emby JSON message on non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: vi.fn().mockResolvedValue(JSON.stringify({ Message: 'Invalid credentials' })),
    }));

    await expect(runEmbywatch('https://emby.example.com', baseConfig))
      .rejects.toThrow('Invalid credentials');
  });
});
