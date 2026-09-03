# PRD：UI 语义事件接口（Ontology Workbench UI Events）

> **状态：规划中（Proposed）· 暂不实现**
> 本文记录一个已确认方向的设计，作为 V2/V3 的输入；当前版本（V1）不实现。
> 关联：`docs/prd/ontology-workbench-v1.md`、`docs/adr/0011-ontology-workbench-tools.md`、v6 规范 §10 MU UI 模型（UI 事件驱动调用链）。

## 问题陈述

工作台与生成的应用都包含前端界面（录入表单、图谱查看器、模型编辑器）。当前 Agent 若要驱动这些界面，只能走底层浏览器操作（`browser_click` / `browser_type`）：AI 需要读取 accessibility 树、理解布局、模拟点击与输入——**脆弱、依赖像素级 UI、与领域语义脱节**。

我们希望：把前端每个**语义动作**（提交表单、查询列表、切换视图、聚焦节点）抽象成**事件**，让 Agent（AI）像用户一样**直接触发这些事件**，而不需要理解 UI 布局。

## 解决方案

引入「**UI 语义事件接口（UI Semantic Event Surface）**」：

```
① 事件注册表（Event Registry）：一份 JSON，描述该界面可触发的全部语义事件
   { eventId, label, argsSchema, 对应行为/目标 }
   （如 Contract 表单: contract.submit / contract.query / form.reset；
     图谱: graph.switch_view / graph.focus_node / graph.export）
② 前端/应用暴露这些事件：监听事件并执行对应动作（提交、查询、导航…）
③ Agent 通过通用工具 ui_event(eventId, args) 触发
④ Agent Loop 里 AI 自主决定触发哪个事件（对话驱动界面，无需模拟点击）
```

### 与 v6 规范的关系
这是 **MU（UI 模型）"UI 事件驱动调用链（callChain）"的运行时落地**：
- v6：用户操作（屏幕/元素/事件）→ VALIDATE → BEHAVIOR_CALL → EVENT_EMIT …
- 本设计：**AI 扮演"用户"**，通过 `ui_event` 触发同一套调用链。
- 事件注册表对应 MU 中屏幕/元素的事件声明；`ui_event` 是 MI（接口模型）里一个通用的系统边界接口。

### 与 browser 工具的边界（互补，不替代）
| 方式 | 使用场景 |
|------|----------|
| `ui_event`（语义事件）| **首选**：我们自己的界面（工作台、生成的应用）直接暴露语义接口 |
| `browser_click/type`（底层操作）| 兜底：任意外部网页 / 语义接口未覆盖的操作 |

## 领域词汇

**UI 语义事件 (UI Semantic Event)**：界面上的一个语义动作（如 `contract.submit`），由 `{ eventId, argsSchema, 处理行为 }` 定义；不依赖布局与选择器。
*避免使用*: 点击事件（那是物理事件）、回调（那是实现细节）

**事件注册表 (Event Registry)**：描述某界面可触发事件的 JSON 清单，既是 AI 的调用契约，也是前端监听的唯一事实来源。
*避免使用*: 事件总线（可能暗示运行时广播，本设计是声明式清单）

**ui_event 工具**：Agent 触发语义事件的通用工具；读注册表校验参数，分发给前端执行。
*避免使用*: robot、自动化脚本（本设计是 AI 驱动的语义操作）

## 用户故事

US-E1：作为业务人员，当我在对话里说"帮我新增一条合同记录"时，AI 调 `ui_event{eventId:'contract.submit', args:{...}}`，应用即执行提交——无需模拟点击表单。
*（本 PRD 的用户故事编号使用 US-E* 前缀，区别于 V1 的 US-*。）*

US-E2：作为业务人员，当我让 AI"把图谱切换到行为视图"，AI 触发 `graph.switch_view` 事件，图谱即时响应。

US-E3：作为建模者，当 AI 操作表单后，我希望事件触发的行为与人工点击完全一致（同一调用链），以便所见即所得。

US-E4：作为系统，我希望每个事件的 `argsSchema` 能被校验，非法参数返回结构化错误，以便 AI 及时修正。

## 事件契约（草案）

### `ui_event` 工具
- 参数：`surface`（界面 id，如 `app:contract-form` / `workbench:graph`），`eventId`（语义事件 id），`args`（参数对象）
- 返回：`{ ok, eventId, result, next? }`；失败返回结构化错误（缺参数 / 未注册 / 执行失败）
- 语义：从事件注册表解析事件 → 校验 args → 交给前端执行对应动作 → 返回结果

### 事件注册表示例
```json
{
  "surface": "app:contract-form",
  "events": [
    { "eventId": "contract.submit", "label": "新增合同", "argsSchema": { "contractNo": "string", "contractName": "string", "totalAmount": "number" } },
    { "eventId": "contract.query",  "label": "查询合同", "argsSchema": { "contractNo": "string?" } }
  ]
}
```

## 实现决策（V2/V3 落地时机）

- **V2（原生融合）**：工作台前端托管进 dsh（`webServer` + client）后，事件注册表随界面一起暴露；`ui_event` 工具注册到 Agent preset。
- **V3（生成应用）**：`app_generate` 生成的表单页把每个 CRUD 动作暴露为语义事件（`<table>.submit` / `.query` / `.reset`），与 HTTP API 共用同一层。
- 事件注册表由界面声明（一份 JSON），前端监听 + `ui_event` 共用，避免双份维护。
- 图谱查看器暴露 `graph.*` 事件（切换视图 / 聚焦节点 / 高亮关联）。

## 测试决策（落地时）

- 单元：注册表解析、argsSchema 校验。
- 集成：headless 会话里 AI 调 `ui_event` 驱动表单提交，断言与人工操作结果一致。
- Web snapshot：事件触发后的 UI 状态不回退。

## 范围外 / 暂不实现（本 PRD 明确）

- **本期不实现任何代码**：本文仅作为设计输入与决策记录。
- 不做跨界面的事件广播总线（Event Bus）；本设计是**声明式清单 + 定向分发**，避免运行期全局广播带来的不可预测性。
- 不替代 browser 工具（外部页面仍走 browser_click）。
- 不做复杂的事件编排/工作流引擎（那属于 M6 流程模型范畴，另行设计）。
