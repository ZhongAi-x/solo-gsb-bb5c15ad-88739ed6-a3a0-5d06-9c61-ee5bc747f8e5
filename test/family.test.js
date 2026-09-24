'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_MEMBERS,
  ValidationError,
  findCommonAncestors,
  validateState,
  validateNewEdge,
} = require('../lib/family');

/** 便捷构造：按成员名生成 id */
function stateOf(names, pairs) {
  const members = names.map((n) => ({ id: n, name: n }));
  const edges = pairs.map(([p, c], i) => ({ id: `e${i}`, parent: p, child: c }));
  return { members, edges };
}

test('无共同祖先时明确返回 hasCommonAncestor=false', () => {
  const { members, edges } = stateOf(['甲', '乙'], []);
  const r = findCommonAncestors('甲', '乙', members, edges);
  assert.equal(r.hasCommonAncestor, false);
  assert.equal(r.minTotalGenerations, null);
  assert.deepEqual(r.ancestors, []);
});

test('同一人查询：本人为 0 代共同祖先', () => {
  const { members, edges } = stateOf(['甲'], []);
  const r = findCommonAncestors('甲', '甲', members, edges);
  assert.equal(r.hasCommonAncestor, true);
  assert.equal(r.minTotalGenerations, 0);
  assert.equal(r.ancestors[0].ancestor, '甲');
  assert.deepEqual(r.ancestors[0].pathsFromA, [['甲']]);
});

test('直线链上的共同祖先与代数正确', () => {
  // 祖父 -> 父亲 -> 本人
  const { members, edges } = stateOf([
    '祖父', '父亲', '本人',
  ], [['祖父', '父亲'], ['父亲', '本人']]);
  const r = findCommonAncestors('本人', '父亲', members, edges);
  assert.equal(r.hasCommonAncestor, true);
  assert.equal(r.minTotalGenerations, 1);
  assert.equal(r.ancestors.length, 1);
  assert.equal(r.ancestors[0].ancestor, '父亲');
  assert.equal(r.ancestors[0].generationsFromA, 1);
  assert.equal(r.ancestors[0].generationsFromB, 0);
});

test('同代数的不同最短路径全部保留（菱形家族）', () => {
  // 祖父 ┬→ 父甲 ─┐
  //      └→ 父乙 ─┴→ 本人
  const { members, edges } = stateOf(
    ['祖父', '父甲', '父乙', '本人'],
    [
      ['祖父', '父甲'],
      ['祖父', '父乙'],
      ['父甲', '本人'],
      ['父乙', '本人'],
    ]
  );
  const r = findCommonAncestors('本人', '祖父', members, edges);
  assert.equal(r.minTotalGenerations, 2);
  assert.equal(r.ancestors.length, 1);
  const anc = r.ancestors[0];
  assert.equal(anc.pathsFromA.length, 2);
  assert.deepEqual(
    anc.pathsFromA.map((p) => p.join('>')).sort(),
    ['祖父>父甲>本人', '祖父>父乙>本人'].sort()
  );
  assert.deepEqual(anc.pathsFromB, [['祖父']]);
});

test('返回总代数最少的全部共同祖先（并列祖先）', () => {
  // 曾祖 -> 祖甲 -> 父 -> 甲
  // 曾祖 -> 祖乙 -> 乙
  const { members, edges } = stateOf(
    ['曾祖', '祖甲', '祖乙', '父', '甲', '乙'],
    [
      ['曾祖', '祖甲'],
      ['曾祖', '祖乙'],
      ['祖甲', '父'],
      ['父', '甲'],
      ['祖乙', '乙'],
    ]
  );
  const r = findCommonAncestors('甲', '乙', members, edges);
  // 唯一共同祖先为曾祖，甲 3 代 + 乙 2 代 = 5
  assert.equal(r.ancestors.length, 1);
  assert.equal(r.ancestors[0].ancestor, '曾祖');
  assert.equal(r.minTotalGenerations, 5);
});

test('多个并列最近祖先都保留（父母为共同祖先的交叉情形）', () => {
  // p1 -> c1, p2 -> c1; p1 -> c2, p2 -> c2
  // c1 与 c2 的共同祖先：p1（2代）与 p2（2代），均保留
  const { members, edges } = stateOf(
    ['p1', 'p2', 'c1', 'c2'],
    [
      ['p1', 'c1'],
      ['p2', 'c1'],
      ['p1', 'c2'],
      ['p2', 'c2'],
    ]
  );
  const r = findCommonAncestors('c1', 'c2', members, edges);
  assert.equal(r.minTotalGenerations, 2);
  assert.deepEqual(
    r.ancestors.map((a) => a.ancestor).sort(),
    ['p1', 'p2']
  );
});

test('validateState 拒绝自指', () => {
  const payload = stateOf(['甲'], [['甲', '甲']]);
  assert.throws(() => validateState(payload), (err) => err.code === 'SELF_REFERENCE');
});

test('validateState 拒绝重复边', () => {
  const payload = {
    members: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    edges: [
      { id: 'e1', parent: 'a', child: 'b' },
      { id: 'e2', parent: 'a', child: 'b' },
    ],
  };
  assert.throws(() => validateState(payload), (err) => err.code === 'DUPLICATE_EDGE');
});

test('validateState 拒绝祖先环路', () => {
  // a -> b -> c -> a
  const payload = stateOf(['a', 'b', 'c'], [
    ['a', 'b'],
    ['b', 'c'],
    ['c', 'a'],
  ]);
  assert.throws(() => validateState(payload), (err) => err.code === 'CYCLE');
});

test('validateState 拒绝超过两位父母', () => {
  const payload = stateOf(['p1', 'p2', 'p3', 'c'], [
    ['p1', 'c'],
    ['p2', 'c'],
    ['p3', 'c'],
  ]);
  assert.throws(() => validateState(payload), (err) => err.code === 'TOO_MANY_PARENTS');
});

test('validateState 允许恰好两位父母', () => {
  const payload = stateOf(['p1', 'p2', 'c'], [
    ['p1', 'c'],
    ['p2', 'c'],
  ]);
  assert.doesNotThrow(() => validateState(payload));
});

test('validateState 拒绝超过成员上限', () => {
  const payload = {
    members: Array.from({ length: MAX_MEMBERS + 1 }, (_, i) => ({ id: `m${i}`, name: `成员${i}` })),
    edges: [],
  };
  assert.throws(() => validateState(payload), (err) => err.code === 'TOO_MANY_MEMBERS');
});

test('validateState 拒绝引用不存在成员的边', () => {
  const payload = { members: [{ id: 'a', name: 'A' }], edges: [{ parent: 'a', child: 'x' }] };
  assert.throws(() => validateState(payload), (err) => err.code === 'UNKNOWN_CHILD');
});

test('validateState 拒绝空姓名', () => {
  assert.throws(
    () => validateState({ members: [{ id: 'a', name: '   ' }], edges: [] }),
    (err) => err.code === 'EMPTY_NAME'
  );
});

test('validateNewEdge 增量拦截会成环的边', () => {
  const { members, edges } = stateOf(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]);
  // 已有 a->b->c，再添加 c->a 必然成环
  assert.throws(
    () => validateNewEdge('c', 'a', members, edges),
    (err) => err.code === 'CYCLE'
  );
});

test('validateNewEdge 拦截自指、重复边与第三位父母', () => {
  const { members, edges } = stateOf(['p1', 'p2', 'c'], [
    ['p1', 'c'],
    ['p2', 'c'],
  ]);
  const more = members.map((m) => ({ ...m }));
  more.push({ id: 'x', name: 'X' });
  assert.throws(() => validateNewEdge('x', 'x', more, edges), (e) => e.code === 'SELF_REFERENCE');
  assert.throws(() => validateNewEdge('p1', 'c', more, edges), (e) => e.code === 'DUPLICATE_EDGE');
  assert.throws(() => validateNewEdge('x', 'c', more, edges), (e) => e.code === 'TOO_MANY_PARENTS');
});

test('validateState 是 ValidationError 类型', () => {
  assert.throws(
    () => validateState({ members: 'no', edges: [] }),
    (err) => err instanceof ValidationError && err.code === 'INVALID_PAYLOAD'
  );
});
