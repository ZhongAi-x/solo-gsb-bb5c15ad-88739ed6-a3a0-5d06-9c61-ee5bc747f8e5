'use strict';

/* 家谱关系核对 —— 原生前端逻辑（无框架、无构建步骤） */

const els = {
  memberCount: document.getElementById('member-count'),
  membersAlert: document.getElementById('members-alert'),
  memberForm: document.getElementById('member-form'),
  memberName: document.getElementById('member-name'),
  loadSample: document.getElementById('load-sample'),
  clearAll: document.getElementById('clear-all'),
  memberList: document.getElementById('member-list'),

  edgesAlert: document.getElementById('edges-alert'),
  edgeForm: document.getElementById('edge-form'),
  edgeParent: document.getElementById('edge-parent'),
  edgeChild: document.getElementById('edge-child'),
  edgeList: document.getElementById('edge-list'),

  queryAlert: document.getElementById('query-alert'),
  queryForm: document.getElementById('query-form'),
  queryA: document.getElementById('query-a'),
  queryB: document.getElementById('query-b'),
  queryResult: document.getElementById('query-result'),
};

let state = { members: [], edges: [] };
const alertTimers = new WeakMap();

// ---------- 工具 ----------

async function api(url, options) {
  let res;
  try {
    res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch (networkErr) {
    throw new Error('无法连接服务器，请确认服务已启动');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error((data.error && data.error.message) || `请求失败（${res.status}）`), {
      code: data.error && data.error.code,
      details: data.error && data.error.details,
    });
  }
  return data;
}

function showAlert(el, message, type = 'error') {
  el.hidden = false;
  el.className = `alert ${type}`;
  el.textContent = message;
  const old = alertTimers.get(el);
  if (old) clearTimeout(old);
  if (type === 'success') {
    alertTimers.set(
      el,
      setTimeout(() => {
        el.hidden = true;
      }, 2500)
    );
  }
}

function clearAlert(el) {
  el.hidden = true;
  el.textContent = '';
}

function shortId(id) {
  return id.slice(0, 8);
}

function memberName(id) {
  const m = state.members.find((x) => x.id === id);
  return m ? m.name : `（已删除 ${shortId(id)}）`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------- 渲染 ----------

function setState(next) {
  state = next;
  render();
}

function render() {
  renderMembers();
  renderSelects();
  renderEdges();
}

function renderMembers() {
  els.memberCount.textContent = `${state.members.length}/30`;
  els.memberList.innerHTML = '';

  if (state.members.length === 0) {
    els.memberList.appendChild(el('li', 'empty', '暂无成员，请先添加或载入示例家谱'));
    return;
  }

  for (const m of state.members) {
    const li = el('li');
    const info = el('div');
    info.appendChild(el('span', null, m.name));
    info.appendChild(el('span', 'meta', `　ID: ${shortId(m.id)}`));
    const actions = el('div');

    const renameBtn = el('button', 'btn small', '改名');
    renameBtn.type = 'button';
    renameBtn.addEventListener('click', () => onRename(m.id, m.name));
    const delBtn = el('button', 'btn small danger', '删除');
    delBtn.type = 'button';
    delBtn.addEventListener('click', () => onRemoveMember(m));

    actions.appendChild(renameBtn);
    actions.appendChild(delBtn);
    li.appendChild(info);
    li.appendChild(actions);
    els.memberList.appendChild(li);
  }
}

function fillSelect(select, members, preferredId) {
  const prev = preferredId !== undefined ? preferredId : select.value;
  select.innerHTML = '';
  const placeholder = el('option', null, members.length ? '请选择…' : '（暂无成员）');
  placeholder.value = '';
  select.appendChild(placeholder);
  for (const m of members) {
    const opt = el('option', null, `${m.name}（${shortId(m.id)}）`);
    opt.value = m.id;
    select.appendChild(opt);
  }
  if (prev && members.some((m) => m.id === prev)) {
    select.value = prev;
  }
}

function renderSelects() {
  fillSelect(els.edgeParent, state.members);
  fillSelect(els.edgeChild, state.members);
  fillSelect(els.queryA, state.members);
  fillSelect(els.queryB, state.members);
}

function renderEdges() {
  els.edgeList.innerHTML = '';
  if (state.edges.length === 0) {
    els.edgeList.appendChild(el('li', 'empty', '暂无关系，请在上方添加“父母 → 子女”关系'));
    return;
  }
  for (const e of state.edges) {
    const li = el('li');
    const info = el('div');
    info.appendChild(el('span', null, `${memberName(e.parent)} → ${memberName(e.child)}`));
    const delBtn = el('button', 'btn small danger', '删除');
    delBtn.type = 'button';
    delBtn.addEventListener('click', () => onRemoveEdge(e.id));
    li.appendChild(info);
    li.appendChild(delBtn);
    els.edgeList.appendChild(li);
  }
}

// ---------- 成员操作 ----------

els.memberForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const name = els.memberName.value.trim();
  if (!name) {
    showAlert(els.membersAlert, '请输入姓名');
    return;
  }
  try {
    const data = await api('/api/members', { method: 'POST', body: JSON.stringify({ name }) });
    setState(data.state);
    els.memberName.value = '';
    clearAlert(els.edgesAlert);
    els.queryResult.innerHTML = '';
    showAlert(els.membersAlert, '成员已添加', 'success');
  } catch (err) {
    showAlert(els.membersAlert, err.message);
  }
});

async function onRename(id, currentName) {
  const name = window.prompt('修改姓名：', currentName);
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) {
    showAlert(els.membersAlert, '姓名不能为空');
    return;
  }
  if (trimmed === currentName) return;
  try {
    const data = await api(`/api/members/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ name: trimmed }),
    });
    setState(data.state);
    showAlert(els.membersAlert, '姓名已更新', 'success');
  } catch (err) {
    showAlert(els.membersAlert, err.message);
  }
}

async function onRemoveMember(m) {
  const related = state.edges.filter((e) => e.parent === m.id || e.child === m.id).length;
  const msg = related
    ? `删除成员“${m.name}”将同时删除与其相关的 ${related} 条关系，确定吗？`
    : `确定删除成员“${m.name}”吗？`;
  if (!window.confirm(msg)) return;
  try {
    const data = await api(`/api/members/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
    setState(data.state);
    els.queryResult.innerHTML = '';
    showAlert(els.membersAlert, '成员已删除', 'success');
  } catch (err) {
    showAlert(els.membersAlert, err.message);
  }
}

// ---------- 关系操作 ----------

els.edgeForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const parent = els.edgeParent.value;
  const child = els.edgeChild.value;
  if (!parent || !child) {
    showAlert(els.edgesAlert, '请分别选择父母与子女');
    return;
  }
  try {
    const data = await api('/api/edges', { method: 'POST', body: JSON.stringify({ parent, child }) });
    setState(data.state);
    els.edgeParent.value = parent;
    els.edgeChild.value = child;
    els.queryResult.innerHTML = '';
    showAlert(els.edgesAlert, '关系已添加', 'success');
  } catch (err) {
    showAlert(els.edgesAlert, err.message);
  }
});

async function onRemoveEdge(id) {
  try {
    const data = await api(`/api/edges/${encodeURIComponent(id)}`, { method: 'DELETE' });
    setState(data.state);
    els.queryResult.innerHTML = '';
    showAlert(els.edgesAlert, '关系已删除，可重新查询', 'success');
  } catch (err) {
    showAlert(els.edgesAlert, err.message);
  }
}

// ---------- 示例 / 清空 ----------

els.loadSample.addEventListener('click', async () => {
  if (state.members.length && !window.confirm('载入示例将替换当前全部成员与关系，确定吗？')) return;
  try {
    const data = await api('/api/state/sample', { method: 'POST' });
    setState(data);
    els.queryResult.innerHTML = '';
    clearAlert(els.membersAlert);
    showAlert(els.edgesAlert, '示例家谱已载入，可在 ③ 中选择张明与张悦查询', 'success');
  } catch (err) {
    showAlert(els.edgesAlert, err.message);
  }
});

els.clearAll.addEventListener('click', async () => {
  if (!state.members.length && !state.edges.length) return;
  if (!window.confirm('确定清空全部成员与关系吗？此操作不可恢复。')) return;
  try {
    const data = await api('/api/state', { method: 'DELETE' });
    setState(data);
    els.queryResult.innerHTML = '';
    showAlert(els.membersAlert, '已清空全部数据', 'success');
  } catch (err) {
    showAlert(els.membersAlert, err.message);
  }
});

// ---------- 查询与结果渲染 ----------

els.queryForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  clearAlert(els.queryAlert);
  const a = els.queryA.value;
  const b = els.queryB.value;
  if (!a || !b) {
    showAlert(els.queryAlert, '请选择两位成员');
    return;
  }
  try {
    const result = await api(`/api/query?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
    renderResult(result);
  } catch (err) {
    els.queryResult.innerHTML = '';
    showAlert(els.queryAlert, err.message);
  }
});

function pathLine(pathIds) {
  const div = el('div', 'path-line');
  pathIds.forEach((id, i) => {
    if (i > 0) div.appendChild(el('span', 'sep', '→'));
    div.appendChild(el('span', 'node', memberName(id)));
  });
  div.appendChild(el('span', 'gen', `（${pathIds.length - 1} 代）`));
  return div;
}

function pathGroup(title, paths) {
  const group = el('div', 'path-group');
  group.appendChild(el('div', 'group-title', title));
  for (const p of paths) group.appendChild(pathLine(p));
  return group;
}

function renderResult(result) {
  const box = els.queryResult;
  box.innerHTML = '';
  const nameA = memberName(result.a);
  const nameB = memberName(result.b);

  if (result.a === result.b) {
    const note = el('div', 'alert info');
    note.hidden = false;
    note.textContent = `成员甲与成员乙为同一人（${nameA}），其最近共同祖先即本人，亲缘距离为 0 代。`;
    box.appendChild(note);
    return;
  }

  if (!result.hasCommonAncestor) {
    const note = el('div', 'alert info');
    note.hidden = false;
    note.textContent = `沿父母链向上追溯，${nameA} 与 ${nameB} 没有任何共同祖先。`;
    box.appendChild(note);
    box.appendChild(el('p', 'hint', '可在 ② 中补充或修改父母关系后重新查询。'));
    return;
  }

  const summary = el('div', 'result-summary');
  summary.appendChild(el('strong', null, `${nameA} 与 ${nameB}`));
  summary.append(' 的共同祖先查询结果：最少总代数 ');
  summary.appendChild(el('span', 'badge', `${result.minTotalGenerations} 代`));
  summary.append(`；共找到 ${result.ancestors.length} 位总代数最少的共同祖先。`);
  box.appendChild(summary);

  for (const anc of result.ancestors) {
    const block = el('div', 'ancestor-block');
    const h3 = el('h3');
    h3.appendChild(el('span', null, memberName(anc.ancestor)));
    h3.appendChild(
      el(
        'span',
        'tag',
        `总代数 ${anc.totalGenerations} = 甲方向 ${anc.generationsFromA} 代 + 乙方向 ${anc.generationsFromB} 代`
      )
    );
    block.appendChild(h3);
    block.appendChild(
      pathGroup(
        `${nameA} → 该祖先的全部最短路径（${anc.pathsFromA.length} 条，${anc.generationsFromA} 代）`,
        anc.pathsFromA
      )
    );
    block.appendChild(
      pathGroup(
        `${nameB} → 该祖先的全部最短路径（${anc.pathsFromB.length} 条，${anc.generationsFromB} 代）`,
        anc.pathsFromB
      )
    );
    box.appendChild(block);
  }
}

// ---------- 初始化 ----------

(async function init() {
  try {
    const data = await api('/api/state');
    setState(data);
  } catch (err) {
    showAlert(els.membersAlert, err.message);
  }
})();
