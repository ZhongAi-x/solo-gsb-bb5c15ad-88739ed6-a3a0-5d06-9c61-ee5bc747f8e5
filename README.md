# 家谱关系核对（Family Tree Checker）

一个纯本地运行的家谱关系核对网页：录入成员与“父母 → 子女”关系，选择两人后沿父母链查找**总代数最少的全部共同祖先**，并展示双方到每个祖先的**全部最短亲缘路径与代数**（同代数的不同路径全部保留）。修改关系后可随时重新查询。

技术栈：Node.js + Express + 原生 HTML/CSS/JavaScript（无前端框架、无构建步骤）。

## 单条命令启动

需要本机已安装 Docker（含 Compose 插件，Docker Desktop 自带）。在项目根目录执行：

```bash
docker compose up --build -d
```

构建时会自动安装全部依赖，启动后浏览器访问：

> **http://localhost:3000**

停止与清理：

```bash
docker compose down          # 停止并删除容器（数据卷保留）
docker compose down -v       # 停止并同时删除家谱数据
```

> 不想用 Docker 也可以：`npm install && npm start`，同样访问 http://localhost:3000 。

## 必要配置

所有配置均为**可选**，默认值即可直接运行。通过 `compose.yaml` 的 `environment` / 端口映射调整：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| 宿主机端口映射 | `3000:3000` | 若本机 3000 端口被占用，把 `compose.yaml` 中改为如 `8080:3000`，再访问 http://localhost:8080 |
| `PORT` | `3000` | 容器内服务监听端口，一般无需修改 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `PERSIST_FILE` | `/data/family.json` | 数据持久化文件路径；容器中已挂载命名卷 `family-data`，重启不丢数据。**留空则仅存内存**，重启清空 |

## 访问地址及端口

- 应用页面：<http://localhost:3000>
- 数据接口前缀：`http://localhost:3000/api`

## 功能说明

1. **成员管理（上限 30 人）**：添加、改名、删除成员；删除成员会一并删除与其相关的关系。
2. **关系管理（父母 → 子女）**：每名子女至多登记两位父母。系统在添加关系时即拒绝：
   - 自指（把本人设为本人的父母）；
   - 重复边（同一对父母→子女关系登记两次）；
   - 祖先环路（添加后父母链成环，例如 A 的祖先是 A 本人）；
   - 超过两位父母。
3. **共同祖先查询**：选择成员甲、成员乙后点击查询。
   - 沿双方父母链向上做最短路径搜索；
   - 仅保留**总代数最少**（甲方到祖先代数 + 乙方到祖先代数）的共同祖先，并列的全部保留；
   - 对每位祖先分别列出甲方、乙方各自的**全部最短路径**，同代数的不同路径（如菱形家族中的两条上行链）全部展示；
   - 双方没有共同祖先时明确提示；选同一人时提示其本人即 0 代共同祖先。
4. **修改后重新查询**：增删成员、增删关系后再次点击“查询共同祖先”即按最新关系计算。
5. 提供“**载入示例家谱**”一键体验（示例中查询“张明 / 张悦”可看到总代数 3 的共同祖先“张建国”），以及“清空全部”。

## 关系与查询规则

- 一条边表示 `父母 → 子女`；两条边可以表示一位子女的父亲与母亲。
- “代数”按路径上的边数计算：父亲→本人为 1 代，祖父→父亲→本人为 2 代。
- 共同祖先的总代数 = 甲到祖先的最短代数 + 乙到祖先的最短代数，取最小值；达到该最小值的每位祖先都返回。
- 共同祖先允许是其中一人本人（如查“本人”与“父亲”，最近共同祖先即父亲，总代数 1）。

## HTTP API（供脚本/调试使用）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/state` | 获取全部成员与关系 |
| POST | `/api/members` | 添加成员 `{ "name": "张明" }`（超 30 人返回 400） |
| PUT | `/api/members/:id` | 改名 `{ "name": "新名字" }` |
| DELETE | `/api/members/:id` | 删除成员及其相关关系 |
| POST | `/api/edges` | 添加关系 `{ "parent": "成员id", "child": "成员id" }` |
| DELETE | `/api/edges/:id` | 删除一条关系 |
| GET | `/api/query?a=成员id&b=成员id` | 查询共同祖先与全部最短路径 |
| PUT | `/api/state` | 全量替换 `{ "members": [...], "edges": [...] }`，整体校验通过才生效 |
| POST | `/api/state/sample` | 载入示例家谱 |
| DELETE | `/api/state` | 清空全部数据 |

校验失败统一返回 `400` 与错误码，例如：

```json
{ "error": { "code": "CYCLE", "message": "该关系会形成祖先环路，已拒绝", "details": {} } }
```

错误码：`SELF_REFERENCE`、`DUPLICATE_EDGE`、`CYCLE`、`TOO_MANY_PARENTS`、`TOO_MANY_MEMBERS`、`UNKNOWN_PARENT`、`UNKNOWN_CHILD`、`EMPTY_NAME` 等。

## 本地开发（不使用 Docker）

要求 Node.js ≥ 18。

```bash
npm install        # 安装依赖
npm start          # 启动服务，访问 http://localhost:3000
npm run dev        # 以 --watch 模式启动，改代码自动重启
npm test           # 运行核心算法单元测试（node:test，无额外依赖）
```

本地运行时默认数据仅存内存；需要持久化则指定：

```bash
PERSIST_FILE=./data/family.json npm start
```

## 目录结构

```
.
├── Dockerfile            # 多阶段构建：构建阶段安装依赖，运行阶段精简镜像
├── compose.yaml          # 一条命令启动（端口/持久化配置在此）
├── server.js             # Express 服务与 API 路由
├── lib/
│   ├── family.js         # 核心算法：环路/重复/自指校验 + 共同祖先最短路径
│   ├── store.js          # 内存存储与可选 JSON 持久化
│   └── sample.js         # 示例家谱
├── public/               # 原生前端（index.html / styles.css / app.js）
└── test/family.test.js   # 核心算法测试
```
