# PRD：本体工作台 V1

面向**业务人员**的对话式本体建模工作台：在 DeepSeek Harness Web 中通过多轮自然语言对话，把业务想法逐步沉淀为**需求文档**、**本体模型 YAML**（M1~M5+ME），并完成引用完整性校验。V1 只做"对话 → 需求文档 → 模型 → 校验"的建模链路，不生成可运行应用（V3 范围）；V1 无工具箱 UI 段（V2 范围）。

领域词汇见 `[CONTEXT.md](../../CONTEXT.md)` 与本文档「领域词汇」节（工作台新增词汇将以同一风格并入 CONTEXT.md）。架构决策见 `[docs/adr/0011-ontology-workbench-tools.md](../adr/0011-ontology-workbench-tools.md)`（随本 PRD 落地产出）。品牌视觉 Token 与原语见 `[docs/design/DESIGN.md](../design/DESIGN.md)`。本体建模规范参考 `WorkBuddy-AppBuilderSkill/specs/ontology_modeling_framework_v6.md`（十一模型元规范）与 `specs/AI需求探索与确认提示词V4.0.md`（九阶段需求探索）。

## 问题陈述

业务人员希望把一段业务想法变成可运行的领域应用，但存在三道门槛：

1. **需求没有沉淀**：想法只在对话里流转，散落、易失，无法形成结构化需求文档。
2. **模型不可得**：本体建模（M1~M5+ME 的 YAML）需要技术背景；让业务人员手写 YAML 不现实，让建模人员陪跑每个业务人员也不可扩展。
3. **链路断裂**：即使有模型，也没有一条"对话 → 需求 → 模型 → 校验 →（后续）应用"的连贯流水线；现有工具（AppBuilderSkill 等）偏生成器，缺少嵌入 Agent 工作台、由对话驱动的建模能力。

dsh 已提供 Agent Loop（多轮对话、工具调用、Workspace 绑定），但缺少"本体建模"这类领域工具。V1 补上这一环：让 Agent 通过 `ontology_*` 工具，在对话中完成需求探索与建模，模型落盘为可审计、可复用的 YAML。

## 解决方案

在 Web Agent preset（`standard` / `code` 等）追加 `ontology-*` 工具插件（`dsh-tool-ontology`），注册三个模型可调用工具：

| 工具 | 作用 | 对应本体模型 |
|------|------|--------------|
| `ontology_explore` | 九阶段需求探索：推进阶段、写入需求文档、维护 [已确认]/[待确认] 标记 | M4 场景 / M6 流程 |
| `ontology_model` | 生成/读取/更新某模型 YAML（M1~M5+ME），返回结构化摘要供对话继续 | M1/M2/M3/ME/M5 对象与行为 |
| `ontology_validate` | 校验模型引用完整性 + 输出模型清单与知识图谱数据 | M3 规则 |

**模型工作区约定**：绑定 Workspace 下 `.workbuddy/ontology/<项目>/`：

```
.workbuddy/ontology/<项目>/
├─ 需求文档.md                  # 九阶段探索产物（含 [已确认]/[待确认]/[AI自动补全] 标记）
├─ knowledge-graph-data.json  # 图谱结构化数据（每次模型落盘自动重建）
├─ 知识图谱.html              # 自包含可视化图谱（内嵌 ECharts，双击即看）
└─ yaml/
   ├─ m1-object-model.yaml     # 对象（聚合/子实体/属性/约束/字典/关联）
   ├─ m2-behavior-model.yaml   # 行为
   ├─ m3-rule-model.yaml       # 规则
   ├─ me-event-model.yaml      # 事件
   ├─ m4-scenario-model.yaml   # 场景（无则标注“无”)
   └─ m5-actor-model.yaml      # 主体（V1 默认“系统管理员”全权角色）
```

**可视化：直接嵌入 Onto-Model 前端（不重写）**：本工作台的**模型树、Canvas 图谱、模型编辑器均不重新实现**，而是直接复用现成的 Onto-Model 编辑器前端（React 应用，含 ModelTree / KnowledgeGraph / 各 Editor，已在 Onto-Model 项目验证）。V1 采用**内嵌浏览器打开**（方案 1）：对话建模落盘后，工具返回模型工作区入口，用 NanGeAGI 内嵌浏览器（`ui-browser` + Playwright）打开 Onto-Model 前端，业务人员在其中查看模型树、交互图谱并编辑模型。插件只负责**数据层**：图谱数据（`knowledge-graph-data.json`）确定性生成，渲染层完全交给 Onto-Model 前端。

**V1 建模边界**（对齐 AppBuilderSkill v1 口径）：十一模型中 V1 只落 `M1~M5+ME` 六份；`M6 流程 / M7 报表 / MU / MM / MI` 在 V1 标注"无"或省略，V2+ 逐步点亮。系统字段（`createdBy/createdAt/updatedBy/updatedAt`）由引擎自动维护，不在 M1 建模。

## 领域词汇

**本体工作台 (Ontology Workbench)**：dsh Web 中由对话驱动的本体建模能力，由 `ontology_*` 工具集实现。面向业务人员，不要求技术背景。
*避免使用*: 建模器（单独使用时易与编辑器混淆）、低代码平台

**需求文档 (Requirements Document)**：九阶段探索的落盘产物（Markdown），逐条标注来源状态 `[已确认]` / `[待确认]` / `[AI自动补全]`。是建模的唯一输入来源；待确认项清零前不得进入建模。
*避免使用*: 需求规格说明书（本工作台统一称需求文档）、PRD

**本体模型 (Ontology Model)**：按 v6 规范写入模型工作区的 YAML 文件（M1~M5+ME），是"对象/行为/规则/事件/场景/主体"的声明式表达，后续可被引擎消费生成应用。
*避免使用*: 元数据、配置

**模型工作区 (Model Workspace)**：绑定 Workspace 下 `.workbuddy/ontology/<项目>/` 目录，是需求文档与模型 YAML 的唯一落盘位置；跨 Session 持久，可由资源管理器直接浏览/编辑。
*避免使用*: 输出目录、产物目录

**建模对话 (Modeling Conversation)**：业务人员与 Agent 围绕一个项目进行的多轮对话，贯穿需求探索与建模；对话中的结论即时写入需求文档/模型。
*避免使用*: 会话（与 dsh Session 语境冲突）

**知识图谱产物 (Knowledge Graph Artifact)**：由当前项目全部已建模型自动生成的图谱数据（`knowledge-graph-data.json`）与自包含兜底可视化（`知识图谱.html`）。节点 = 对象/行为/规则/事件/场景/主体，边 = 引用/触发/订阅/授权/组合关系；每次模型落盘自动重建。**主渲染层**为嵌入的 Onto-Model 前端（模型树 + Canvas 图谱），`知识图谱.html` 仅作无嵌入环境下的兜底。
*避免使用*: 关系图（关系是图的子集）、架构图（容易与系统架构混淆）

## 用户故事

仅 Web 端。序号全文唯一递增。

US-1：作为业务人员，我想在对话里用自然语言描述业务想法（如"做一个设备维修工单系统"），以便不需要写任何代码或 YAML 就启动建模。

US-2：作为业务人员，我想让 Agent 按九阶段推进需求探索，每批只问 3~6 个问题且附 AI 建议答案，以便我逐批确认、不疲劳。

US-3：作为业务人员，当我回答"按AI建议"或直接确认时，我想探索结论立即写入需求文档并标记 `[已确认]`，以便文档反映最新共识。

US-4：作为业务人员，当某条需求没有确认时，我想它保持 `[待确认]` 且模型不会基于它生成，以免把未确认的内容带进模型。

US-5：作为业务人员，当待确认项清零后，我想 Agent 明确询问"是否进入建模"，且我同意前不生成任何 YAML，以便需求先行、建模后置。

US-6：作为业务人员，我想让 Agent 从需求文档生成 M1 对象模型（聚合根/子实体/属性/约束/数据字典/关联），以便我的业务对象变成结构化模型。

US-7：作为业务人员，我想让 Agent 继续生成 M2 行为 / M3 规则 / ME 事件 / M4 场景 / M5 主体，并对照 v6 规范逐条填充字段，以便模型完整且可被引擎消费。

US-8：作为业务人员，我想模型文件落在模型工作区且命名遵循约定（`m1-object-model.yaml` 等），以便我能用资源管理器直接查看/编辑，也便于后续工具链消费。

US-9：作为建模者，我想在建模后用 `ontology_validate` 校验引用完整性（行为 ownerEntity/appliedRules/producedEvents、事件 producer/subscriber 是否存在），以便尽早发现断链。

US-10：作为建模者，当校验失败时，我想看到逐条错误（code + message + nodeId），以便定位并修复。

US-11：作为业务人员，当对话在模型工作区里发现已有模型时，我想它被读出并继续对话（读-改-写），以便二次建模不重复劳动。

US-12：作为业务人员，我想每个模型文件写入前都有一次确认（列出将写入的模型与字段摘要），以便我知道 Agent 做了什么、避免误写。

US-13：作为系统，我想 `ontology_explore` / `ontology_model` / `ontology_validate` 返回结构化 JSON（阶段清单 / 模型摘要 / 校验结果），以便 Agent Loop 据此继续编排对话。

US-14：作为业务人员，当任一模型写入成功后，我想图谱自动重建并落盘（`knowledge-graph-data.json` + `知识图谱.html`），以便模型工作区随时有最新的可视化视图。

US-15：作为业务人员，我想在建模后一键打开**嵌入的本体工作台界面**（Onto-Model 前端：模型树 + 交互式 Canvas 图谱 + 模型编辑器），以便不打开零散 YAML 文件就能理解并修改模型全貌。

US-16：作为业务人员，当图谱因模型断链而出现悬挂节点/边时，我想图谱同时标注校验问题，以便把“可视化”和“校验”对齐。

## 工具契约（V1）

### `ontology_explore`
- 参数：`action: 'start' | 'advance' | 'status'`，`project`（项目名），`answers?`（本批用户确认结果，数组）
- 返回：`{ phase, phaseName, questions: [{question, aiSuggestion, reason, alternative}], docPath, confirmed: number, pending: number }`
- 语义：`start` 初始化项目与需求文档；`advance` 记录 answers、推进阶段、写入 `需求文档.md`；`status` 只读当前进度。待确认项清零才允许返回 `canModel: true`。

### `ontology_model`
- 参数：`action: 'list' | 'read' | 'write' | 'delete'`，`project`，`modelKey`（objectModel/behaviorModel/ruleModel/eventModel/scenarioModel/actorModel），`data?`（write 时的模型对象）
- 返回：`list` → 模型文件清单；`read` → 模型对象（归一化后）；`write` → 写入确认摘要 + 写后校验结果 + **图谱重建结果**（`graph` 节点/边、`graphPath` 落盘路径）；`delete` → 删除结果
- 语义：`write` 前返回 `confirmSummary`，需二次 `write` 带 `confirmed: true` 才落盘（满足 US-12）；落盘成功后**自动重建图谱产物**（满足 US-14/US-15）。

### `ontology_validate`
- 参数：`project`，`modelKeys?`（默认全部已存在模型）
- 返回：`{ issues: [{code, message, nodeId}], modelSummary: [{modelKey, file, entities, behaviors, rules, events}], graph: {nodes, edges} }`

## UI 与设计要求

V1 无独立工具箱段；呈现发生在**对话流**内：

- 工具结果渲染为可折叠卡片（复用对话区 Tool 卡模式）；`ontology_model` 的模型摘要用 Markdown 列表呈现对象/行为/规则数量；`ontology_validate` 错误用语义错误色逐条列出。
- 需求文档路径与模型文件路径以可点击链接呈现（复用 Session 内文件链接跳转，可在文件编辑器打开）。

### 用户故事 ↔ 页面映射
对话区即 UI：US-1~US-12 全部经由对话消息 + 工具卡完成，无新增页面。

### 状态策略
- 项目状态（阶段、已确认/待确认项）以 `需求文档.md` 为单一事实来源，工具每次 `advance` 原子写回；不另设内存状态。
- 模型文件以磁盘为事实来源；对话中修改仅在 `write`（confirmed）时落盘。

## 实现决策

### 工具注册
- 新包 `packages/ontology/tool-ontology`（`dsh-tool-ontology`），在 Web Agent preset（`standard`/`code`/`cordis`）的 `cordis.patch.yml` 追加 `tool-ontology` 行（对齐 `tool-browser` 的注册方式）。
- 工具经 `ctx.tools.register(defineTool(...))` 注册；`inject: ['tools', 'systemPrompt']`；`systemPrompt.section` 注入一行建模约定（"用 `ontology_explore` 探索需求、`ontology_model` 建模、`ontology_validate` 校验；待确认项清零前不建模"）。

### 模型存储与归一化
- YAML 解析/序列化用 `js-yaml`；M1 归一化（扁平聚合/实体式 → 聚合根式）逻辑对齐 Onto-Model `workspace_service._normalize_object_model`，收敛为 `packages/ontology/tool-ontology/src/engine/yamlStore.ts`。
- 目录操作只允许模型工作区以内（防穿越）；文件命名映射 `modelKey → 约定文件名`。

### 校验规则（V1）
- 行为：`ownerEntity` / `appliedRules` / `producedEvents` 引用存在性
- 事件：`producerBehaviorRef` / `subscriberBehaviorRefs` 引用存在性
- 规则：`reusedBy` 引用存在性
- 未知/缺失 `model_type` 的 YAML 归入 `unrecognized`，不静默丢弃

### 可视化复用（不重写）
- 模型树、Canvas 图谱、模型编辑器**直接复用 Onto-Model 前端**（ModelTree / KnowledgeGraph / 各 Editor），不在 dsh 插件内重写任何渲染逻辑。
- 插件只负责数据层：图谱数据（节点/边）由 `graphData.ts` 确定性生成并落盘 `knowledge-graph-data.json`（语义对齐 Onto-Model `graphBuilder`：对象/行为/规则/事件/场景/主体 + 组合/引用/触发/订阅/授权边）；`知识图谱.html` 为自包含兑底产物（模板对齐 AppBuilderSkill `knowledge-graph-template.html`）。
- **V1 嵌入方式（方案 1）**：对话建模落盘 → 工具返回模型工作区入口 → 用 `ui-browser` 内嵌浏览器打开 Onto-Model 前端（需 Onto-Model Flask 后端 5000 一并运行）。
- **V2 嵌入方式（方案 2，原生融合）**：Onto-Model 前端 build 产物由 dsh `webServer.register` 托管，前端数据 API 切换到插件 `yamlStore`，去掉 Flask 依赖。
- 重建时机：任何模型 `write` 落盘后同步重建图谱数据；`ontology_validate` 只读不改写。悬挂节点/边（断链）在数据中标注并在 `issues` 中列出（满足 US-16）。

### 与 AppBuilderSkill 的关系
- 本工具复用其九阶段探索（V4.0）与 v6 建模规范作为**对话内容与字段语义的权威**（PRD 引用），但运行实现为 Node/TypeScript（不依赖 Python 子进程），保证插件自包含。
- V3 的"应用生成"复用其引擎语义（SQLite 建库 / CRUD / 表单），届时以 Node 实现（`node:sqlite`）。

## 测试决策

### 工具单元 seam
- `yamlStore`：读写/归一化/路径穿越拒绝（fixture 用 `sample` 工作区模型）。
- `validator`：引用完整性（构造缺失引用用例）。
- `graphData`：节点/边确定性推导（含断链悬挂标注）。
- 工具参数校验：缺参/非法 action 返回结构化错误。

### Agent 集成 seam
- 用 headless 会话（`examples/*/cordis.yml` 风格）跑一条端到端：`ontology_explore(start→advance×N→status canModel)` → `ontology_model(write m1..m5)` → `ontology_validate`，断言落盘文件、零断链，且**每次 write 后图谱产物已重建**（`knowledge-graph-data.json` 非空、`知识图谱.html` 存在）。
- Web browser snapshot seam（对齐既有 PRD）：对话工具卡渲染不回退。

## 范围外

- **工具箱「本体工作台」段 + 方案 2 原生融合**（Onto-Model 前端托管 + 数据 API 切换 `yamlStore`）→ V2；V1 用内嵌浏览器打开 Onto-Model 前端（方案 1）。
- **应用生成与运行**（`app_generate` / `app_run`：SQLite 建库、CRUD、表单、内嵌浏览器运行预览）→ V3。
- **M6 流程 / M7 报表 / MU / MM / MI 模型**的落盘与编辑 → V2+。
- 多用户 / 审批流 / 外部接口 / 权限登录 → 不在 V1（本地单用户口径）。
- 自举：工作台自身不消费"描述工作台的模型"驱动自身行为（需求与架构用本体论组织，实现为手写代码）。

## 补充说明

- **本体驱动开发自身**：本 PRD 即工作台开发的第一步（需求探索 + 规格化）；工作台的领域对象/行为/规则/流程见 `docs/adr/0011-ontology-workbench-tools.md` 中的本体分层映射（M1 项目/需求文档/模型文件，M2 三个工具，M3 校验规则，M6 九阶段→建模→校验流水线）。
- 与上游同步：本 PRD 建立在 `custom/main` 分支基线（NanGeAGI V5 桌面壳之后）；上游更新后需在实现前复查 `tool-browser` / `ui-browser` 等已合并先例。
