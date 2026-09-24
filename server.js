'use strict';

const path = require('node:path');
const express = require('express');
const { FamilyStore } = require('./lib/store');
const { ValidationError, findCommonAncestors } = require('./lib/family');
const { sample } = require('./lib/sample');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PERSIST_FILE = process.env.PERSIST_FILE || '';

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

let store;

/** 所有写操作成功后统一落盘（未配置 PERSIST_FILE 时为空操作）。 */
async function commit() {
  await store.persist();
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ---------- 成员 ----------

app.get('/api/state', (req, res) => {
  res.json(store.snapshot());
});

app.post('/api/members', asyncHandler(async (req, res) => {
  const member = store.addMember(req.body && req.body.name);
  await commit();
  res.status(201).json({ member, state: store.snapshot() });
}));

app.put('/api/members/:id', asyncHandler(async (req, res) => {
  const member = store.renameMember(req.params.id, req.body && req.body.name);
  await commit();
  res.json({ member, state: store.snapshot() });
}));

app.delete('/api/members/:id', asyncHandler(async (req, res) => {
  store.removeMember(req.params.id);
  await commit();
  res.json({ state: store.snapshot() });
}));

// ---------- 父母→子女 关系 ----------

app.post('/api/edges', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const edge = store.addEdge(body.parent, body.child);
  await commit();
  res.status(201).json({ edge, state: store.snapshot() });
}));

app.delete('/api/edges/:id', asyncHandler(async (req, res) => {
  store.removeEdge(req.params.id);
  await commit();
  res.json({ state: store.snapshot() });
}));

// ---------- 全量替换 / 示例 / 清空 ----------

app.put('/api/state', asyncHandler(async (req, res) => {
  store.replaceState(req.body || {});
  await commit();
  res.json(store.snapshot());
}));

app.post('/api/state/sample', asyncHandler(async (req, res) => {
  store.replaceState(sample);
  await commit();
  res.json(store.snapshot());
}));

app.delete('/api/state', asyncHandler(async (req, res) => {
  store.clear();
  await commit();
  res.json(store.snapshot());
}));

// ---------- 共同祖先查询（只读） ----------

app.get('/api/query', (req, res, next) => {
  const { a, b } = req.query;
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) {
    return next(new ValidationError('INVALID_QUERY', '请同时选择两位成员'));
  }
  try {
    const result = findCommonAncestors(a, b, [...store.members.values()], store.edges);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ---------- 错误处理 ----------

app.use('/api', (req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof ValidationError) {
    return res.status(400).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: '请求体不是合法 JSON' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: '请求体过大' } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: '服务器内部错误' } });
});

FamilyStore.create(PERSIST_FILE || null)
  .then((created) => {
    store = created;
    app.listen(PORT, HOST, () => {
      console.log(`家谱关系核对应用已启动：http://localhost:${PORT}（监听 ${HOST}:${PORT}）`);
      if (PERSIST_FILE) console.log(`数据持久化文件：${PERSIST_FILE}`);
    });
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });

module.exports = app;
