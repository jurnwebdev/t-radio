// Policy test for the "may a song title be shown?" rule.
// Run with: npm test
//
// A title may only be shown while it is confirmed to be live. The rule
// lives in useNowPlayingTitle.js (isTitleFresh) so it can be checked
// without a browser.
import test from 'node:test'
import assert from 'node:assert/strict'
import { isTitleFresh } from './useNowPlayingTitle.js'

const T0 = 1_000_000_000_000

const state = (over = {}) => ({
  url: 'https://example.test/stream',
  key: 'Artist|Song',
  artist: 'Artist',
  title: 'Song',
  source: 'icy',
  confirmedAt: T0,
  changedAt: T0,
  answered: true,
  ...over,
})

test('a confirmed title is shown', () => {
  assert.equal(isTitleFresh(state(), T0), true)
})

test('an empty title is never shown', () => {
  assert.equal(isTitleFresh(state({ title: '' }), T0), false)
})

test('a title that was never confirmed is not shown', () => {
  assert.equal(isTitleFresh(state({ confirmedAt: 0 }), T0), false)
})

test('the title is dropped when the stream stops confirming it', () => {
  assert.equal(isTitleFresh(state(), T0 + 60_000), true)
  assert.equal(isTitleFresh(state(), T0 + 119_000), true)
  assert.equal(isTitleFresh(state(), T0 + 121_000), false)
  assert.equal(isTitleFresh(state(), T0 + 300_000), false)
})

test('a title that never changes is treated as stuck', () => {
  // The client keeps confirming it, but the string never changes.
  const stuck = (now) => state({ confirmedAt: now, changedAt: T0 })
  assert.equal(isTitleFresh(stuck(T0 + 9 * 60_000), T0 + 9 * 60_000), true)
  assert.equal(isTitleFresh(stuck(T0 + 11 * 60_000), T0 + 11 * 60_000), false)
})

test('a title that changes is fresh again', () => {
  const changed = state({ confirmedAt: T0 + 9 * 60_000, changedAt: T0 + 9 * 60_000 })
  assert.equal(isTitleFresh(changed, T0 + 9 * 60_000 + 30_000), true)
})
