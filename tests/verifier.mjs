import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Mirror of StubDecider.normalize + judge grouping. The real judge lives in
// agents/router/decider.ts (TypeScript with parameter properties, which
// Node's strip-only mode cannot parse). These tests pin the consensus rule
// the whole payout path depends on: exact normalized match, pair minimum,
// empty on split. If the rule changes, update both places together.
function normalize(answer) {
  return answer.trim().toLowerCase().replace(/\s+/g, ' ');
}

function judge(answers) {
  const groups = new Map();
  answers.forEach((answer, index) => {
    const key = normalize(answer);
    const group = groups.get(key);
    if (group) group.push(index);
    else groups.set(key, [index]);
  });
  let best = [];
  for (const group of groups.values()) {
    if (group.length > best.length) best = group;
  }
  const total = answers.length;
  const consensusIndices = best.length >= 2 ? [...best].sort((a, b) => a - b) : [];
  const confidenceBps = consensusIndices.length === 0 ? 0 : Math.round((best.length / total) * 10000);
  return { consensusIndices, confidenceBps };
}

describe('consensus rule (mirrors StubDecider.judge)', () => {
  it('finds consensus among matching answers', () => {
    const v = judge(['85 KES per kg', '85 kes per KG', '250 KES per kg']);
    assert.deepEqual(v.consensusIndices, [0, 1]);
    assert.equal(v.confidenceBps, 6667);
  });

  it('returns empty consensus on a split field', () => {
    const v = judge(['Good', '7', '8.73']);
    assert.deepEqual(v.consensusIndices, []);
    assert.equal(v.confidenceBps, 0);
  });

  it('requires at least a pair, never pays a lone answer', () => {
    const v = judge(['a', 'b', 'c']);
    assert.deepEqual(v.consensusIndices, []);
  });
});

describe('REQUESTER_PRIVATE_KEY format rule (mirrors route check)', () => {
  const valid = (k) => /^0x[0-9a-fA-F]{64}$/.test(k);
  it('accepts a proper 0x 32-byte hex key', () => {
    assert.equal(valid('0x' + 'ab'.repeat(32)), true);
  });
  it('rejects bare, short, and non-hex keys', () => {
    assert.equal(valid('ab'.repeat(32)), false);
    assert.equal(valid('0x1234'), false);
    assert.equal(valid('0x' + 'zz'.repeat(32)), false);
    assert.equal(valid(''), false);
  });
});

describe('attribution code rule (mirrors assertBuilderCode)', () => {
  const valid = (c) => typeof c === 'string' && c.length > 0 && c.startsWith('celo_');
  it('accepts celo_-namespaced codes', () => {
    assert.equal(valid('celo_0107eaa60597'), true);
  });
  it('rejects empty and foreign codes', () => {
    assert.equal(valid(''), false);
    assert.equal(valid('other_123'), false);
  });
});
