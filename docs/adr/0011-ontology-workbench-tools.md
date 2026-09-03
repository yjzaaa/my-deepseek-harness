# 本体工作台为独立工具插件 `dsh-tool-ontology`，可视化复用 Onto-Model 前端

本体工作台 V1 在 Web Agent preset 注册一个独立工具包 `packages/ontology/tool-ontology`（`dsh-tool-ontology`），经 `ctx.tools.register(defineTool(...))` 暴露 `ontology_explore` / `ontology_model` / `ontology_validate` 三个模型可调用工具；模型工作区约定为绑定 Workspace 下 `.workbuddy/ontology/<项目>/`。模型树、Canvas 图谱与模型编辑器**不重新实现**，直接嵌入现成的 Onto-Model 前端（ModelTree / KnowledgeGraph / 各 Editor）：V1 用内嵌浏览器（`ui-browser` + Playwright）打开 Onto-Model 前端（方案 1），V2 将其前端 build 产物交由 `webServer.register` 托管、数据 API 切换到插件 `yamlStore`（方案 2 原生融合）。插件只承担**数据层**（YAML 存储/归一化、引用校验、图谱数据生成），渲染层完全委托 Onto-Model 前端。需求与建模规范以 `WorkBuddy-AppBuilderSkill` 的 v6 规范与九阶段探索为权威，但实现为 Node/TypeScript，不依赖 Python 子进程。产品需求见 `docs/prd/ontology-workbench-v1.md`。

**Considered Options**

- **在插件内重写图谱/树/编辑器**：与已上线并验证的 Onto-Model 前端（Canvas 力导向图谱、分层模型树、M1~M5+ME 编辑器）重复劳动；且工作台的根本诉求是"业务人员对话出模型"，可视化只是查看手段，不值得双份实现。已排除。
- **以 Python 子进程桥接 AppBuilderSkill 引擎**：直接复用其建库/生成逻辑，但引入外部 Python 运行时、非自包含，与 dsh 插件生态（纯 Node/Cordis）相悖；仅把 v6 规范与九阶段文本作为"内容权威"引用，不引用其运行时。已排除。
- **把工具并进某个既有官方包（如 tool-browser）**：与 dsh"一功能一插件包"约定冲突，且本体工作台是领域插件、应独立演进。已排除。

**Consequences**

- 新增 `packages/ontology/tool-ontology`，并在 Web Agent preset（`standard`/`code`/`cordis`）的 `cordis.patch.yml` 追加 `tool-ontology` 行（对齐 `tool-browser` 注册方式）；`inject: ['tools', 'systemPrompt']`，`systemPrompt.section` 注入建模约定（"待确认项清零前不建模"等）。
- 模型工作区是数据唯一事实来源：需求文档（`需求文档.md`，含 `[已确认]/[待确认]` 标记）、模型 YAML（`yaml/m1-object-model.yaml` … `m5-actor-model.yaml`、`me-event-model.yaml`）、图谱数据（`knowledge-graph-data.json`）；`知识图谱.html` 为无嵌入环境兜底产物。
- 图谱数据由 `graphData.ts` 确定性生成（语义对齐 Onto-Model `graphBuilder`：对象/行为/规则/事件/场景/主体 + 组合/引用/触发/订阅/授权边），任何模型 `write` 落盘后自动重建；断链悬挂节点/边在数据中标注并列入校验 `issues`。
- V1 嵌入 Onto-Model 前端需其 Flask 后端（5000）一并运行；V2 通过前端托管 + API 切 `yamlStore` 去掉该依赖，使工作台完全自包含。
- `write` 采用"先返回 `confirmSummary`、二次确认 `confirmed: true` 才落盘"的两步语义，避免 Agent 误写模型。

## 本体分层映射（工作台自身的领域模型，Dogfood）

工作台自身按 v6 本体论组织其领域，实现仍为手写代码（不自举）：

| 模型 | 工作台自身的对应 |
|------|------------------|
| M1 对象 | 项目、需求文档、模型文件（M1~M5+ME）、聚合、模型工作区目录 |
| M2 行为 | `ontology_explore` / `ontology_model` / `ontology_validate` 三个工具 |
| M3 规则 | 引用完整性校验、命名约定、`write` 二次确认、待确认项清零才建模 |
| ME 事件 | （V1 可选）模型变更 / 图谱重建完成通知 |
| M4 场景 | 业务人员"对话生成应用"的建模场景 |
| M5 主体 | 业务人员（对话发起者）、建模者（校验者）、系统（Agent Loop） |
| M6 流程 | 九阶段需求探索 → 建模（M1→M5+ME）→ 校验 →（V3）生成应用 |
| M7 报表 | 模型清单 / 统计摘要（`ontology_validate` 返回 `modelSummary`） |
| MU 界面 | 嵌入的 Onto-Model 前端（模型树 + Canvas 图谱 + 编辑器） |
| MM 映射 | 模型 → 模型工作区文件的落盘映射（`modelKey → 约定文件名`） |
| MI 接口 | Agent Loop ↔ 插件工具契约（`ontology_*` 参数/返回） |
