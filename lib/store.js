'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  MAX_MEMBERS,
  ValidationError,
  validateState,
  validateNewEdge,
} = require('./family');

/**
 * 家谱存储：默认仅存内存；设置环境变量 PERSIST_FILE 后落盘为 JSON，
 * 容器中可通过挂载卷保留数据。
 */
class FamilyStore {
  constructor(persistFile) {
    this.persistFile = persistFile || null;
    this.members = new Map(); // id -> { id, name }（Map 保留插入顺序）
    this.edges = []; // { id, parent, child }
  }

  static async create(persistFile) {
    const store = new FamilyStore(persistFile);
    if (persistFile) {
      try {
        const raw = await fsp.readFile(persistFile, 'utf8');
        const data = JSON.parse(raw);
        const { members, edges } = validateState(data);
        for (const m of members) store.members.set(m.id, m);
        store.edges = edges;
      } catch (err) {
        if (err.code !== 'ENOENT') {
          throw new Error(`无法读取家谱数据文件 ${persistFile}: ${err.message}`);
        }
      }
    }
    return store;
  }

  snapshot() {
    return {
      maxMembers: MAX_MEMBERS,
      members: [...this.members.values()],
      edges: this.edges.map((e) => ({ ...e })),
    };
  }

  async persist() {
    if (!this.persistFile) return;
    const tmp = `${this.persistFile}.tmp`;
    const data = JSON.stringify(this.snapshot(), null, 2);
    await fsp.mkdir(path.dirname(this.persistFile), { recursive: true });
    await fsp.writeFile(tmp, data, 'utf8');
    await fsp.rename(tmp, this.persistFile);
  }

  addMember(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new ValidationError('EMPTY_NAME', '姓名不能为空');
    if (this.members.size >= MAX_MEMBERS) {
      throw new ValidationError('TOO_MANY_MEMBERS', `成员数量不能超过 ${MAX_MEMBERS} 人`, {
        limit: MAX_MEMBERS,
      });
    }
    const id = crypto.randomUUID();
    this.members.set(id, { id, name: trimmed });
    return this.members.get(id);
  }

  renameMember(id, name) {
    if (!this.members.has(id)) {
      throw new ValidationError('UNKNOWN_MEMBER', '成员不存在', { memberId: id });
    }
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new ValidationError('EMPTY_NAME', '姓名不能为空');
    this.members.set(id, { id, name: trimmed });
    return this.members.get(id);
  }

  /** 删除成员；与其相关的关系一并删除。 */
  removeMember(id) {
    if (!this.members.has(id)) {
      throw new ValidationError('UNKNOWN_MEMBER', '成员不存在', { memberId: id });
    }
    this.members.delete(id);
    this.edges = this.edges.filter((e) => e.parent !== id && e.child !== id);
  }

  addEdge(parent, child) {
    validateNewEdge(parent, child, [...this.members.values()], this.edges);
    const edge = { id: crypto.randomUUID(), parent, child };
    this.edges.push(edge);
    return edge;
  }

  removeEdge(id) {
    const idx = this.edges.findIndex((e) => e.id === id);
    if (idx === -1) throw new ValidationError('UNKNOWN_EDGE', '关系不存在', { edgeId: id });
    const [removed] = this.edges.splice(idx, 1);
    return removed;
  }

  /** 全量替换：校验通过才原子生效。 */
  replaceState(payload) {
    const { members, edges } = validateState(payload);
    this.members = new Map(members.map((m) => [m.id, m]));
    this.edges = edges.map((e) => ({ ...e }));
  }

  clear() {
    this.members = new Map();
    this.edges = [];
  }
}

module.exports = { FamilyStore };
