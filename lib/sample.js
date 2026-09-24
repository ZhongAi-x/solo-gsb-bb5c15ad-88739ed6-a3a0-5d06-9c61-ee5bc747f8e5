'use strict';

/**
 * 示例家谱（用于“载入示例”按钮）。
 * 结构（→ 表示父母→子女）：
 *   张德厚 ┐
 *          ├→ 张建国 → 张明
 *   王桂兰 ┘    └→ 张丽 → 张悦
 *   王桂兰 ─→ 张丽
 *
 * 查询 张明 与 张悦：
 *   经 张建国：张明→张建国(1代)，张悦→张丽→张建国(2代)，共 3 代
 *   经 王桂兰：张明→张建国→王桂兰(2代)，张悦→张丽→王桂兰(2代)，共 4 代
 * 张建国为总代数最少（3）的唯一共同祖先。
 * 查询 张明 与 张建国：共同祖先即张建国本人，共 1 代。
 */

const m = {
  dehou: 'm-dehou',
  guilan: 'm-guilan',
  jianguo: 'm-jianguo',
  zhangli: 'm-zhangli',
  zhangming: 'm-zhangming',
  zhangyue: 'm-zhangyue',
};

const sample = {
  members: [
    { id: m.dehou, name: '张德厚' },
    { id: m.guilan, name: '王桂兰' },
    { id: m.jianguo, name: '张建国' },
    { id: m.zhangli, name: '张丽' },
    { id: m.zhangming, name: '张明' },
    { id: m.zhangyue, name: '张悦' },
  ],
  edges: [
    { id: 'e1', parent: m.dehou, child: m.jianguo },
    { id: 'e2', parent: m.guilan, child: m.jianguo },
    { id: 'e3', parent: m.jianguo, child: m.zhangming },
    { id: 'e4', parent: m.guilan, child: m.zhangli },
    { id: 'e5', parent: m.zhangli, child: m.zhangyue },
    { id: 'e6', parent: m.jianguo, child: m.zhangli },
  ],
};

module.exports = { sample };
