# 本体工作台（Ontology Workbench）· 开发过程记录

> 基于 DeepSeek Harness 二开版（NanGeAGI，`custom/main`）的本体驱动应用生成工作台。
> 目标：让**业务人员**通过多轮对话，把业务想法沉淀为**需求文档 → 本体模型 YAML → 可实例化应用**，并在对话中实时查看建模图、热重载打开应用测试。
>
> 本文记录需求探索、架构决策、实现过程与验证结果，作为本项目开发的中间过程文档。

---

## 一、背景与目标

### 问题
- 业务人员想开发领域应用，但不懂代码、不懂本体 YAML；需求散落在对话里无法沉淀。
- 本体建模（M1~M5+ME 的 YAML）需要技术背景，无法规模化为每个业务人员陪跑。
- 缺少一条「对话 → 需求文档 → 模型 → 校验 → 应用」的连贯流水线。

### 目标（最终交付）
1. **对话驱动建模**：Agent Loop 通过 `ontology_*` 工具完成九阶段需求探索与十一模型建模。
2. **实时查看建模图**：每次模型落盘自动重建图谱数据（`knowledge-graph-data.json`），对话中可实时查看。
3. **生成可实例化应用**：从 M1 生成自包含 Node 应用（SQLite 建库 + CRUD + 表单），热重载后直接打开测试。

### 设计原则
- **插件无 LLM 参与**：dsh 内置 Agent Loop 承担模型决策，插件只提供确定性能力原子（工具 + 引擎 + 存储）。
- **可视化不重写**：模型树 / Canvas 图谱 / 编辑器复用现成 Onto-Model 前端（V1 内嵌浏览器打开，V2 原生融合）。
- **本体驱动开发自身**：工作台自身的领域按本体分层组织（见 ADR 0011），但实现为手写代码，不自举。

---

## 二、需求探索与决策（PRD / ADR）

| 文档 | 内容 |
|------|------|
| `docs/prd/ontology-workbench-v1.md` | 产品规格：问题陈述、解决方案、领域词汇、13+ 用户故事、工具契约、实现/测试决策、范围外 |
| `docs/adr/0011-ontology-workbench-tools.md` | 架构决策：独立工具包 + 可视化复用 + 工作台本体分层映射（M1~M7+ME+MU+MM+MI） |

关键决策（grilling 收敛）：
- Q1 形态：工具包 `@deepseek-ai/dsh-tool-ontology`，V1 只做「对话 → 需求 → 模型 → 校验」，不生成应用（V3 补）。
- Q2 可视化：直接嵌入 Onto-Model 前端（不重写）；插件只做数据层。
- Q3 建模范围：M1~M5+ME 六模型（对齐 AppBuilderSkill v1 口径）。
- Q4 引擎实现：Node/TypeScript（`node:sqlite`、`js-yaml`），不依赖 Python 子进程。

---

## 三、实现

### 包结构

```
packages/ontology/tool-ontology/
├─ package.json / tsconfig.json
└─ src/
   ├─ index.ts           # 五个工具注册 + systemPrompt 建模约定
   └─ engine/
      ├─ yamlStore.ts    # 模型工作区读写 + M1 归一化（扁平/实体式 → 聚合根式）
      ├─ graphData.ts    # 引用完整性校验 + 图谱数据生成
      ├─ appRuntime.ts   # node:sqlite 建表规格推导（V3 复用）
      └─ appGen.ts       # 应用生成器：生成自包含 app（node:sqlite + HTTP CRUD + 动态表单）
```

### 工具契约

| 工具 | 作用 | 关键语义 |
|------|------|----------|
| `ontology_explore` | 九阶段需求探索 | `start` 初始化 / `advance` 记录并推进 / `status` 查进度；待确认项清零才 `canModel` |
| `ontology_model` | 模型 YAML 读写 | `write` 两步确认（`confirmSummary` → `confirmed:true` 落盘）；落盘后**自动重建图谱数据** |
| `ontology_validate` | 校验 + 图谱 | 引用完整性（行为/事件/规则引用存在性）+ 模型清单 + graph（nodes/edges） |
| `app_generate` | 生成可运行应用 | 从 M1 建表 → 生成 `app/`（app.cjs + index.html + models.json） |
| `app_run` | 热重载启动 | spawn `node app.cjs`，返回 URL 供内嵌浏览器打开测试 |

### 接入 NanGeAGI

- `apps/cli/config/agent-presets/{standard,code,cordis}/agent.cordis.yml`：追加 `tool-ontology` 行（对齐 `tool-browser`）。
- `apps/cli/package.json`、`packages/bundle/web-app/package.json`：追加 `@deepseek-ai/dsh-tool-ontology: workspace:^` 依赖。

### 图谱实时查看（V1）

- 每次 `ontology_model.write` 落盘后，自动重建 `<项目>/knowledge-graph-data.json`（节点 = 对象/行为/规则/事件/场景/主体，边 = 组合/引用/触发/订阅/授权）。
- Agent 对话中返回图谱摘要（nodes/edges）+ `graphPath`；V1 通过内嵌浏览器打开 Onto-Model 编辑器查看模型树与 Canvas 图谱，V2 做原生融合（前端托管 + API 切 yamlStore）。

---

## 四、验证结果（真实模型全链路）

用 Onto-Model `sample`（合同管理）模型做端到端冒烟：

```
[write objectModel]  written:true  graph_nodes:41  issues:0
[write behaviorModel] written:true  graph_nodes:41  issues:0
...（6 模型全量写入）
[validate] issues: 0 | graph: 41 nodes / 42 edges
[app_generate] tables: Contract(15列), PaymentTerm(4列), Invoice(8列), InvoiceTermMapping(3列)
[app_run] url: http://127.0.0.1:18099
[app API] 插入 Contract → ok:true, count:1
[app API] 查询 Contract → rows:1（字段完整）
[app API] 表单页 → <h1>本体驱动应用</h1>
```

要点：
- 6 模型全量写入后 `validate` 0 断链；只建部分模型时校验器正确报断链（8 条，预期）。
- 应用由 `app.cjs` 独立运行（内存 SQLite），CRUD API + 动态录入表单页真实可用，约束（NOT NULL/UNIQUE）生效。
- 每次模型落盘后图谱数据实时重建。

---

## 五、使用方式

1. 启动 NanGeAGI（`pnpm dsh web`），新会话绑定 Workspace。
2. 对话中描述业务想法（如"做一个设备维修工单系统"），Agent 会自动：
   - `ontology_explore` 九阶段探索 → 产出 `<ws>/.workbuddy/ontology/<项目>/需求文档.md`
   - `ontology_model` 建模 M1~M5+ME → 落盘 `yaml/*.yaml` + 重建 `knowledge-graph-data.json`
   - `ontology_validate` 校验 → 修断链
3. 查看建模图：Agent 返回图谱数据 + 打开 Onto-Model 编辑器（V1 内嵌浏览器）。
4. 生成应用：Agent 调 `app_generate` → `app_run` → 内嵌浏览器打开返回的 URL，录入数据并测试。

---

## 六、后续计划（V2 / V3）

- **V2**：工具箱「本体工作台」段——Onto-Model 前端托管 + 数据 API 切 `yamlStore`（去掉 Flask 依赖，原生融合）；模型树 + Canvas 图谱 + 编辑器联动。
- **V2/V3 · UI 语义事件接口（已规划，暂不实现）**：把前端语义动作封装为事件，Agent 通过 `ui_event` 工具直接触发（详见 `docs/prd/ontology-workbench-ui-events.md`）。对应 v6 MU 模型「UI 事件驱动调用链」的运行时落地；V2 原生融合与 V3 生成表单均暴露事件注册表。
- **V3**：补齐 M6 流程 / M7 报表 / MU / MM / MI 模型落盘与编辑；应用运行持久化（文件型 SQLite）。
- 工作台自身 M1~M7 分层模型的完善（Dogfood 深化）。

---

## 附：已踩坑记录（供后续参考）

- `defineTool` 必须声明 `output`（schema + render），execute 返回须为 `JsonValue` 兼容（interface 对象需序列化）。
- 工具参数 `required` 只允许 `true`（缺省即可选），**不能写 `required: false`**。
- 生成的独立脚本用 `.cjs` 扩展名，避免被父级 `package.json` 的 `type: module` 误判为 ESM。
- 项目内运行依赖源码用 `tsx`（workspace 包未构建 `lib/` 时）。
