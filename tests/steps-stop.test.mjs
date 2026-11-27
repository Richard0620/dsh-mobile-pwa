import test from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../src/core/state.js';
import { applyLiveSteps, findTodoPhase, resetSteps, samePhase } from '../src/features/steps.js';
import { normalizeStopSummary, stopSummaryHasContent } from '../src/features/stop-summary.js';

test('applyLiveSteps supports full replace, incremental update, and turn isolation', () => {
  resetSteps();
  applyLiveSteps({ turn: 1, full: true, steps: [{ key: 'a', step: { text: '读文件', status: 'running' } }] });
  assert.equal(state.steps.length, 1);
  assert.equal(state.steps[0].step.status, 'running');

  // Incremental update on same key
  applyLiveSteps({
    turn: 1,
    full: false,
    steps: [
      { key: 'a', step: { text: '读文件', status: 'done' } },
      { key: 'b', step: { text: '跑测试', status: 'running' } },
    ],
  });
  assert.equal(state.steps.length, 2);
  assert.equal(state.steps[0].step.status, 'done');
  assert.equal(state.steps[1].key, 'b');

  // New turn isolates previous turn steps
  applyLiveSteps({ turn: 2, full: false, steps: [{ key: 'c', step: { text: '新轮步骤', status: 'running' } }] });
  assert.equal(state.stepsTurn, 2);
  assert.equal(state.steps.length, 1);
  assert.equal(state.steps[0].key, 'c');
});

test('findTodoPhase extracts todo_write phase and samePhase compares accurately', () => {
  const frame = {
    event: {
      data: {
        blocks: [{ name: 'todo_write', details: { phase: { index: 2, total: 5, label: '写测试' } } }],
      },
    },
  };
  const ph = findTodoPhase(frame);
  assert.deepEqual(ph, { index: 2, total: 5, label: '写测试' });
  assert.equal(samePhase(ph, { ...ph }), true);
  assert.equal(samePhase(ph, { ...ph, index: 3 }), false);
});

test('normalizeStopSummary and stopSummaryHasContent handle partial and empty payloads', () => {
  assert.equal(stopSummaryHasContent(normalizeStopSummary(null)), false);
  const s = normalizeStopSummary({ summary: { did: ['改完构建脚本'], unfinished: ['跑回归测试'], outboundCount: 1 } });
  assert.equal(stopSummaryHasContent(s), true);
  assert.deepEqual(s.did, ['改完构建脚本']);
  assert.deepEqual(s.unfinished, ['跑回归测试']);
  assert.equal(s.sent, 1);
});
