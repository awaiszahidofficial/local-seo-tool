import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { functions: { invoke: invokeMock } } }))

import { finishGscConnect, getGscStatus, startGscConnect, takeReturnPath } from '../lib/searchConsole'

beforeEach(() => {
  invokeMock.mockReset()
  sessionStorage.clear()
})

function httpError(status: number, body: unknown) {
  return { name: 'FunctionsHttpError', context: new Response(JSON.stringify(body), { status }) }
}

describe('searchConsole client', () => {
  it('returns the server message and code on errors', async () => {
    invokeMock.mockResolvedValue({ data: null, error: httpError(503, { error: 'Google is not set up yet.', code: 'not_configured' }) })
    expect(await getGscStatus()).toEqual({ data: null, error: 'Google is not set up yet.', code: 'not_configured' })
  })

  it('explains a missing deployment', async () => {
    invokeMock.mockResolvedValue({ data: null, error: httpError(404, { message: 'not found' }) })
    expect((await getGscStatus()).error).toMatch(/Deploy the gsc function/)
  })

  it('starts the sign-in with a random state and the callback address, and keeps a safe return path', async () => {
    invokeMock.mockResolvedValue({ data: { url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' }, error: null })
    const result = await startGscConnect('/search-console?project=1')
    expect(result.data?.url).toMatch(/^https:\/\/accounts\.google\.com\//)
    const body = invokeMock.mock.calls[0]?.[1]?.body as { action: string; redirectUri: string; state: string }
    expect(body.action).toBe('auth_url')
    expect(body.redirectUri).toBe(`${window.location.origin}/search-console/callback`)
    expect(body.state).toMatch(/^[0-9a-f]{48}$/)
    expect(takeReturnPath()).toBe('/search-console?project=1')
    expect(takeReturnPath()).toBe('/search-console') // used once
  })

  it('rejects a consent URL that is not Google’s', async () => {
    invokeMock.mockResolvedValue({ data: { url: 'https://evil.example/' }, error: null })
    expect((await startGscConnect('/search-console')).data).toBeNull()
  })

  it('never stores an off-site return path', async () => {
    invokeMock.mockResolvedValue({ data: { url: 'https://accounts.google.com/x' }, error: null })
    await startGscConnect('//evil.example')
    expect(takeReturnPath()).toBe('/search-console')
  })

  it('exchanges the code only when the state matches, and only once', async () => {
    invokeMock.mockResolvedValueOnce({ data: { url: 'https://accounts.google.com/x' }, error: null })
    await startGscConnect('/search-console')
    const state = (invokeMock.mock.calls[0]?.[1]?.body as { state: string }).state

    invokeMock.mockResolvedValueOnce({ data: { connected: true, email: 'a@b.c' }, error: null })
    const ok = await finishGscConnect(new URLSearchParams({ code: 'one-time-code', state }))
    expect(ok.data).toEqual({ connected: true, email: 'a@b.c' })
    expect(invokeMock.mock.calls[1]?.[1]?.body).toMatchObject({ action: 'exchange', code: 'one-time-code' })

    const replay = await finishGscConnect(new URLSearchParams({ code: 'one-time-code', state }))
    expect(replay.error).toMatch(/not valid or has expired/)
    expect(invokeMock).toHaveBeenCalledTimes(2)
  })

  it('reports a forged state and a denied consent without calling the server', async () => {
    sessionStorage.setItem('gsc-oauth-state', 'expected-state-value')
    expect((await finishGscConnect(new URLSearchParams({ code: 'c', state: 'other' }))).error).toMatch(/not valid/)
    expect((await finishGscConnect(new URLSearchParams({ error: 'access_denied' }))).error).toBe('Google access was not granted.')
    expect(invokeMock).not.toHaveBeenCalled()
  })
})
