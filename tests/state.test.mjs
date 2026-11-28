import test from 'node:test';
import assert from 'node:assert/strict';

test('state restores token, instanceId, mode, and collapsed workspaces from localStorage on module load', async () => {
  const store = new Map([
    ['dsh.token', 'tok_regression_123'],
    ['dsh.inst', 'inst_abc'],
    ['dsh.mode', 'lan'],
    ['dsh.collapsed', JSON.stringify(['ws1', 'ws2'])],
  ]);
  const prevLS = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    // Cache-bust query imports a fresh module instance against the mocked localStorage
    const { state } = await import(`../src/core/state.js?t=${Date.now()}`);
    assert.equal(state.token, 'tok_regression_123');
    assert.equal(state.instanceId, 'inst_abc');
    assert.equal(state.mode, 'lan');
    assert.deepEqual([...state.collapsed], ['ws1', 'ws2']);
  } finally {
    if (prevLS === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prevLS;
  }
});
