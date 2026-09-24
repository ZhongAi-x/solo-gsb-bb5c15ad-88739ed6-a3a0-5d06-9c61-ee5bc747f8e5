'use strict';

const crypto = require('node:crypto');

/**
 * 家谱图核心逻辑：关系校验与共同祖先查询（纯函数，不依赖存储层）
 *
 * 数据模型：
 *   member: { id: string, name: string }
 *   edge:   { id: string, parent: memberId, child: memberId }
 *
 * 边的方向 parent -> child。“沿父母链向上”即沿 child -> parent 的反向边遍历。
 */

const MAX_MEMBERS = 30;
const MAX_PARENTS_PER_CHILD = 2;

class ValidationError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.details = details || null;
  }
}

/** 构建邻接表。down[id] 为子女列表，up[id] 为父母列表。 */
function buildAdjacency(memberIds, edges) {
  const down = new Map(); // parent -> children
  const up = new Map(); // child -> parents
  for (const id of memberIds) {
    down.set(id, []);
    up.set(id, []);
  }
  for (const e of edges) {
    down.get(e.parent).push(e.child);
    up.get(e.child).push(e.parent);
  }
  return { down, up };
}

/** 从 start 沿父母链做 BFS，返回 { dist, preds }。 */
function bfsUp(start, up) {
  const dist = new Map([[start, 0]]);
  const preds = new Map(); // node -> 最短路径上的直接子女集合（指向 start 方向）
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const node = queue[qi];
    const d = dist.get(node);
    for (const parent of up.get(node) || []) {
      if (!dist.has(parent)) {
        dist.set(parent, d + 1);
        preds.set(parent, [node]);
        queue.push(parent);
      } else if (dist.get(parent) === d + 1) {
        // 同代数的不同最短路径都要保留
        preds.get(parent).push(node);
      }
    }
  }
  return { dist, preds };
}

/**
 * 根据 preds 还原 from -> ancestor 的全部最短路径。
 * 返回祖先为路径起点（路径表示“祖先 → … → 本人”的下行链）。
 */
function buildShortestPaths(ancestorId, fromId, preds) {
  if (ancestorId === fromId) return [[ancestorId]];
  const paths = [];
  const walk = (node, acc) => {
    const next = preds.get(node);
    if (!next) return;
    for (const child of next) {
      if (child === fromId) {
        paths.push([ancestorId, ...acc.slice().reverse(), fromId]);
      } else {
        walk(child, [...acc, child]);
      }
    }
  };
  walk(ancestorId, []);
  return paths;
}

/**
 * 查询两个人总代数最少的全部共同祖先。
 *
 * “总代数”定义为：从 a 到祖先的最短代数（边数）+ 从 b 到祖先的最短代数（边数）。
 * 保留总代数最小的所有共同祖先；每位祖先保留双方各自的全部最短路径。
 */
function findCommonAncestors(aId, bId, members, edges) {
  const memberIds = members.map((m) => m.id);
  const idSet = new Set(memberIds);
  if (!idSet.has(aId) || !idSet.has(bId)) {
    throw new ValidationError('UNKNOWN_MEMBER', '查询对象不存在');
  }

  const { up } = buildAdjacency(memberIds, edges);
  const a = bfsUp(aId, up);
  const b = bfsUp(bId, up);

  // 同一人：本人就是自己代数为 0 的“共同祖先”
  if (aId === bId) {
    return {
      a: aId,
      b: bId,
      hasCommonAncestor: true,
      minTotalGenerations: 0,
      ancestors: [
        {
          ancestor: aId,
          generationsFromA: 0,
          generationsFromB: 0,
          totalGenerations: 0,
          pathsFromA: [[aId]],
          pathsFromB: [[bId]],
        },
      ],
    };
  }

  let best = Infinity;
  const candidates = [];
  for (const [ancestorId, da] of a.dist) {
    if (b.dist.has(ancestorId)) {
      const db = b.dist.get(ancestorId);
      const total = da + db;
      if (total < best) best = total;
      candidates.push({ ancestorId, da, db, total });
    }
  }

  if (candidates.length === 0) {
    return {
      a: aId,
      b: bId,
      hasCommonAncestor: false,
      minTotalGenerations: null,
      ancestors: [],
    };
  }

  const nameById = new Map(members.map((m) => [m.id, m.name]));
  const result = candidates
    .filter((c) => c.total === best)
    .map((c) => ({
      ancestor: c.ancestorId,
      generationsFromA: c.da,
      generationsFromB: c.db,
      totalGenerations: c.total,
      pathsFromA: buildShortestPaths(c.ancestorId, aId, a.preds),
      pathsFromB: buildShortestPaths(c.ancestorId, bId, b.preds),
    }))
    .sort((x, y) => {
      if (x.totalGenerations !== y.totalGenerations) {
        return x.totalGenerations - y.totalGenerations;
      }
      return nameById.get(x.ancestor).localeCompare(nameById.get(y.ancestor), 'zh-Hans-CN');
    });

  return {
    a: aId,
    b: bId,
    hasCommonAncestor: true,
    minTotalGenerations: best,
    ancestors: result,
  };
}

/**
 * 全量校验一批成员与边（用于整体替换/示例加载，要求通过后原子生效）。
 * 返回 { members, edges }（规范化后的对象，只取允许字段）。
 */
function validateState({ members, edges }) {
  if (!Array.isArray(members) || !Array.isArray(edges)) {
    throw new ValidationError('INVALID_PAYLOAD', 'members 与 edges 必须为数组');
  }
  if (members.length > MAX_MEMBERS) {
    throw new ValidationError(
      'TOO_MANY_MEMBERS',
      `成员数量不能超过 ${MAX_MEMBERS} 人（当前 ${members.length} 人）`,
      { limit: MAX_MEMBERS }
    );
  }

  const idSet = new Set();
  const normMembers = [];
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    if (!m || typeof m.id !== 'string' || typeof m.name !== 'string') {
      throw new ValidationError('INVALID_MEMBER', `第 ${i + 1} 名成员格式不正确`, { index: i });
    }
    const name = m.name.trim();
    if (!name) {
      throw new ValidationError('EMPTY_NAME', `第 ${i + 1} 名成员姓名不能为空`, { index: i });
    }
    if (idSet.has(m.id)) {
      throw new ValidationError('DUPLICATE_MEMBER_ID', `成员 ID 重复：${m.id}`, { index: i, id: m.id });
    }
    idSet.add(m.id);
    normMembers.push({ id: m.id, name });
  }

  const normEdges = [];
  const seen = new Set();
  const parentCount = new Map();
  const candidateEdges = [];

  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (!e || typeof e.parent !== 'string' || typeof e.child !== 'string') {
      throw new ValidationError('INVALID_EDGE', `第 ${i + 1} 条关系格式不正确`, { index: i });
    }
    const { parent, child } = e;
    if (!idSet.has(parent)) {
      throw new ValidationError('UNKNOWN_PARENT', `第 ${i + 1} 条关系的父母不存在`, { index: i, memberId: parent });
    }
    if (!idSet.has(child)) {
      throw new ValidationError('UNKNOWN_CHILD', `第 ${i + 1} 条关系的子女不存在`, { index: i, memberId: child });
    }
    if (parent === child) {
      throw new ValidationError('SELF_REFERENCE', `第 ${i + 1} 条关系不能指向本人（自指）`, {
        index: i,
        memberId: parent,
      });
    }
    const key = `${parent}->${child}`;
    if (seen.has(key)) {
      throw new ValidationError('DUPLICATE_EDGE', `第 ${i + 1} 条关系与已有关系重复`, { index: i });
    }
    seen.add(key);
    candidateEdges.push({ parent, child, index: i });
    parentCount.set(child, (parentCount.get(child) || 0) + 1);
  }

  // 每名子女至多两位父母
  for (const [childId, count] of parentCount) {
    if (count > MAX_PARENTS_PER_CHILD) {
      throw new ValidationError(
        'TOO_MANY_PARENTS',
        `每名子女至多有 ${MAX_PARENTS_PER_CHILD} 位父母`,
        { childId, limit: MAX_PARENTS_PER_CHILD, count }
      );
    }
  }

  // 祖先环路检测（Kahn 拓扑排序，边方向 parent -> child）
  const indegree = new Map([...idSet].map((id) => [id, 0]));
  const down = new Map([...idSet].map((id) => [id, []]));
  for (const e of candidateEdges) {
    down.get(e.parent).push(e.child);
    indegree.set(e.child, indegree.get(e.child) + 1);
  }
  const queue = [...idSet].filter((id) => indegree.get(id) === 0);
  let visited = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    visited++;
    for (const child of down.get(queue[qi])) {
      indegree.set(child, indegree.get(child) - 1);
      if (indegree.get(child) === 0) queue.push(child);
    }
  }
  if (visited !== idSet.size) {
    const inCycle = [...idSet].filter((id) => indegree.get(id) > 0);
    throw new ValidationError('CYCLE', '检测到祖先环路（父母链不允许成环）', { memberIds: inCycle });
  }

  for (const e of candidateEdges) {
    normEdges.push({
      id: typeof edges[e.index].id === 'string' && edges[e.index].id ? edges[e.index].id : crypto.randomUUID(),
      parent: e.parent,
      child: e.child,
    });
  }

  return { members: normMembers, edges: normEdges };
}

/**
 * 向现有家谱增量添加一条边前的校验。
 * 假定现有图本身已合法（无自指/重复/环路、父母上限）。
 */
function validateNewEdge(parent, child, members, edges) {
  const idSet = new Set(members.map((m) => m.id));
  if (!idSet.has(parent)) {
    throw new ValidationError('UNKNOWN_PARENT', '父母不存在', { memberId: parent });
  }
  if (!idSet.has(child)) {
    throw new ValidationError('UNKNOWN_CHILD', '子女不存在', { memberId: child });
  }
  if (parent === child) {
    throw new ValidationError('SELF_REFERENCE', '不能将本人设为本人的父母（自指）', { memberId: parent });
  }
  if (edges.some((e) => e.parent === parent && e.child === child)) {
    throw new ValidationError('DUPLICATE_EDGE', '该父母→子女关系已存在（重复边）');
  }
  const parentCount = edges.filter((e) => e.child === child).length;
  if (parentCount >= MAX_PARENTS_PER_CHILD) {
    throw new ValidationError(
      'TOO_MANY_PARENTS',
      `该子女已有 ${MAX_PARENTS_PER_CHILD} 位父母，不能继续添加`,
      { childId: child, limit: MAX_PARENTS_PER_CHILD }
    );
  }
  // 新边 parent -> child 成环 ⇔ child 已位于 parent 的祖先链上
  // （即从 parent 沿父母链向上可以到达 child）
  const { up } = buildAdjacency([...idSet], edges);
  const reachable = new Set([parent]);
  const stack = [parent];
  while (stack.length) {
    const node = stack.pop();
    for (const p of up.get(node) || []) {
      if (!reachable.has(p)) {
        reachable.add(p);
        stack.push(p);
      }
    }
  }
  if (reachable.has(child)) {
    throw new ValidationError('CYCLE', '该关系会形成祖先环路，已拒绝', { parent, child });
  }
}

module.exports = {
  MAX_MEMBERS,
  MAX_PARENTS_PER_CHILD,
  ValidationError,
  buildAdjacency,
  bfsUp,
  buildShortestPaths,
  findCommonAncestors,
  validateState,
  validateNewEdge,
};
