/**
 * 本体工作台工具集（dsh-tool-ontology）
 *
 * 面向业务人员的对话式本体建模工具：Agent Loop 通过
 *   ontology_explore   —— 九阶段需求探索，产出需求文档
 *   ontology_model     —— 生成/读取/更新本体模型 YAML（M1~M5+ME）
 *   ontology_validate  —— 引用完整性校验 + 模型清单 + 图谱数据
 * 完成「对话 → 需求文档 → 模型 → 校验」流水线。
 *
 * 本包只承担数据层（模型存储/归一化/校验/图谱数据生成）；
 * 可视化（模型树 + Canvas 图谱 + 编辑器）直接复用 Onto-Model 前端，不在本包重写。
 * 运行实现为 Node/TypeScript，不依赖 Python 子进程。
 * @module @deepseek-ai/dsh-tool-ontology
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { join } from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import {
  listModelFiles,
  readModel,
  writeModel,
  loadWorkspace,
  defaultFileName,
} from './engine/yamlStore.js'
import {
  validateWorkspace,
  buildGraphData,
  type ValidationIssue,
} from './engine/graphData.js'
import { generateApp } from './engine/appGen.js'

/** Cordis 插件名。 */
export const name = 'tool-ontology'
/** 需要的服务：工具注册 + 系统提示组装。 */
export const inject = ['tools', 'systemPrompt']

/** 模型类型 → 中文名（用于摘要展示） */
const MODEL_LABEL: Record<string, string> = {
  objectModel: '对象模型', behaviorModel: '行为模型', ruleModel: '规则模型',
  eventModel: '事件模型', scenarioModel: '场景模型', actorModel: '主体模型',
  flowModel: '流程模型', reportModel: '报表模型', uiModel: '界面模型',
  mappingModel: '映射模型', interfaceModel: '接口模型',
}

/** 九阶段需求探索（对齐 AppBuilderSkill V4.0） */
const PHASES = [
  '阶段零：原始需求接收与总体理解确认',
  '阶段一：业务对象',
  '阶段二：业务功能与规则',
  '阶段三：事件识别与跨对象影响分析',
  '阶段四：跨对象事件协同场景（可无）',
  '阶段五：端到端协同流与审批流（无审批流标注不适用）',
  '阶段六：查询统计与固定报表（至少建议 2 个）',
  '阶段七：岗位角色与功能权限（v1 默认单用户本地模式）',
  '阶段八：接口需求（v1 本地模式可简化为无外部接口）',
  '阶段九：UI 原型探索（可选）',
]

/** 项目目录：<workspaceDir>/.workbuddy/ontology/<project>/ */
function projectDir(workspaceDir: string, project: string): string {
  return join(workspaceDir, '.workbuddy', 'ontology', project)
}

function yamlDir(workspaceDir: string, project: string): string {
  return join(projectDir(workspaceDir, project), 'yaml')
}

/** 需求文档路径 */
function reqDocPath(workspaceDir: string, project: string): string {
  return join(projectDir(workspaceDir, project), '需求文档.md')
}

/** 渲染需求文档（含阶段进度与 [已确认]/[待确认]/[AI自动补全] 标记） */
function renderRequirementsDoc(project: string, entries: Array<{ phase: string; text: string; status: string }>): string {
  const lines = [
    `# ${project} · 需求文档`,
    '',
    '> 由本体工作台九阶段需求探索生成；`[已确认]` 项可进入建模，`[待确认]` 项不得建模。',
    '',
  ]
  let lastPhase = ''
  for (const e of entries) {
    if (e.phase !== lastPhase) {
      lines.push(`## ${e.phase}`, '')
      lastPhase = e.phase
    }
    lines.push(`- ${e.status} ${e.text}`, '')
  }
  return lines.join('\n')
}

/** 校验 tool 参数非空（defineTool 只做 schema 校验，这里补值校验） */
function requireString(v: unknown, label: string): string {
  if (typeof v !== 'string' || v.trim().length === 0) throw new Error(`invalid ${label}: expected a non-empty string`)
  return v.trim()
}

/** 统一 output 定义：schema 用无约束 JSON，render 将规范结果序列化为文本块。 */
const jsonOutput = {
  schema: { type: 'json' } as const,
  render: (_args: any, value: any): ContentBlock[] => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

/** 把校验问题序列化为 JsonValue 兼容数组（nodeId 可选值转 null）。 */
function issuesToJson(issues: ValidationIssue[]): Array<{ code: string; message: string; nodeId: string | null }> {
  return issues.map(i => ({ code: i.code, message: i.message, nodeId: i.nodeId ?? null }))
}

/**
 * 注册全部本体工作台工具。
 */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:ontology',
    order: 115,
    text: '使用本体工作台建模流程：先调 `ontology_explore` 做九阶段需求探索（待确认项清零前不建模），再调 `ontology_model` 生成/更新 M1~M5+ME 模型，最后用 `ontology_validate` 校验。模型写入前会先返回确认摘要，需带 `confirmed: true` 二次确认才落盘；模型落盘后自动重建图谱数据。',
  })

  // ── ontology_explore ─────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'ontology_explore',
    description:
      '对业务人员做九阶段需求探索并写入需求文档：`start` 初始化项目，`advance` 记录本批确认并推进阶段，`status` 查看进度。'
      + '每批只返回 3~6 个问题，每个问题附 AI 建议答案与理由；用户可答「按AI建议」或逐条确认。'
      + '需求文档位于 <workspaceDir>/.workbuddy/ontology/<project>/需求文档.md。待确认项清零后才允许进入建模。',
    parameters: {
      project: { type: 'string', required: true, description: '项目名（英文短名，如 device-repair）' },
      action: { type: 'string', required: true, description: "'start' 初始化 | 'advance' 记录回答并推进 | 'status' 只读进度" },
      workspaceDir: { type: 'string', description: '绑定工作区根目录（默认当前工作目录）' },
      answers: { type: 'array', description: 'advance 时的本批回答，如 ["按AI建议", "设备、工单、故障类型"]' },
      note: { type: 'string', description: 'advance 时写入文档的补充说明' },
    },
    output: jsonOutput,
    async execute(args: any) {
      const project = requireString(args.project, 'project')
      const action = requireString(args.action, 'action')
      const workspaceDir = requireString(args.workspaceDir ?? process.cwd(), 'workspaceDir')
      const dir = projectDir(workspaceDir, project)
      const docPath = reqDocPath(workspaceDir, project)

      if (action === 'start') {
        mkdirSync(yamlDir(workspaceDir, project), { recursive: true })
        const intro = [
          { phase: PHASES[0]!, text: `总体理解：围绕「${project}」开展本体建模，目标产出需求文档与 M1~M5+ME 模型 YAML。`, status: '[已确认]' },
          { phase: PHASES[0]!, text: '开始逐批确认业务对象、功能、规则、事件、场景、流程、报表、角色与接口。', status: '[已确认]' },
        ]
        writeModel(dir, '需求文档.md', null) // ensure dir exists; real doc written below
        const fs = await import('node:fs')
        fs.writeFileSync(docPath, renderRequirementsDoc(project, intro), 'utf-8')
        return {
          project, docPath, phase: PHASES[0]!, phaseIndex: 0,
          questions: [
            { question: '这个系统主要解决什么业务问题？核心单据是什么？', aiSuggestion: '以设备维修为例：设备台账 + 维修工单 + 故障类型 + 维修人', reason: '阶段零需要锁定领域边界与核心实体', alternative: '用户也可直接描述业务场景' },
            { question: '哪些角色会使用系统？', aiSuggestion: '报修人、维修工程师、设备管理员、审批人（若有审批流）', reason: '阶段七会细化角色权限，此处先摸底', alternative: 'v1 可先单用户' },
            { question: '有没有审批流或端到端流程？', aiSuggestion: '若无明确审批需求，登记「无审批流」不虚构', reason: '阶段五需要明确，避免虚构审批流', alternative: '有审批则说明审批层级' },
          ],
          confirmed: 2, pending: 0, canModel: false,
        }
      }

      if (action === 'status') {
        if (!existsSync(docPath)) return { project, docPath, phase: null, phaseIndex: -1, questions: [], confirmed: 0, pending: 0, canModel: false, error: '需求文档不存在，先调用 start' }
        const fs = await import('node:fs')
        const text = fs.readFileSync(docPath, 'utf-8')
        const confirmed = (text.match(/\[已确认\]/g) ?? []).length
        const pending = (text.match(/\[待确认\]/g) ?? []).length
        const current = PHASES.find(p => text.includes(`## ${p}`))
        return { project, docPath, phase: current ?? null, phaseIndex: PHASES.indexOf(current ?? '') , questions: [], confirmed, pending, canModel: pending === 0 && confirmed > 0 }
      }

      if (action === 'advance') {
        const fs = await import('node:fs')
        const entries: Array<{ phase: string; text: string; status: string }> = []
        const answers = Array.isArray(args.answers) ? args.answers : []
        const phase = PHASES[Math.min(1, Math.max(0, Number(args.phaseIndex ?? 1)))]!
        const texts = answers.length
          ? answers.map((a: any, i: number) => `${i + 1}. ${String(a)}`)
          : (args.note ? [String(args.note)] : ['（本批未填写回答）'])
        for (const t of texts) entries.push({ phase, text: t, status: '[已确认]' })
        if (args.note) entries.push({ phase, text: String(args.note), status: '[AI自动补全]' })
        writeModel(dir, '需求文档.md', null)
        fs.writeFileSync(docPath, renderRequirementsDoc(project, entries), 'utf-8')
        const next = Number(args.phaseIndex ?? 0) + 1
        const confirmed = (args.confirmedCount ?? 0) + answers.length
        return {
          project, docPath, phase: (PHASES[next] ?? PHASES[PHASES.length - 1])!, phaseIndex: next,
          questions: next >= PHASES.length
            ? []
            : [{ question: `进入${PHASES[next]!}，请确认以下内容`, aiSuggestion: '按 AI 建议逐步确认', reason: '九阶段逐批推进', alternative: '可跳过不适用阶段' }],
          confirmed, pending: 0, canModel: next >= PHASES.length,
        }
      }

      throw new Error(`invalid action: ${action} (expect start|advance|status)`)
    },
  }))

  // ── ontology_model ───────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'ontology_model',
    description:
      '生成/读取/更新本体模型 YAML（M1~M5+ME）并维护图谱数据。'
      + '`write` 分两步：先返回确认摘要（confirmSummary），Agent 带 `confirmed: true` 二次调用才落盘；'
      + '落盘后自动重建 <workspaceDir>/.workbuddy/ontology/<project>/knowledge-graph-data.json。'
      + '模型文件位于 .../yaml/m1-object-model.yaml 等约定文件名。',
    parameters: {
      project: { type: 'string', required: true, description: '项目名' },
      action: { type: 'string', required: true, description: "'list' | 'read' | 'write' | 'delete'" },
      modelKey: { type: 'string', description: '模型 key：objectModel/behaviorModel/ruleModel/eventModel/scenarioModel/actorModel' },
      data: { type: 'object', additionalProperties: true, description: 'write 时的模型对象（含 model_type）' },
      confirmed: { type: 'boolean', description: 'write 二次确认标记' },
      workspaceDir: { type: 'string', description: '绑定工作区根目录（默认当前工作目录）' },
    },
    output: jsonOutput,
    async execute(args: any) {
      const project = requireString(args.project, 'project')
      const action = requireString(args.action, 'action')
      const workspaceDir = requireString(args.workspaceDir ?? process.cwd(), 'workspaceDir')
      const dir = yamlDir(workspaceDir, project)
      const files = listModelFiles(dir)

      if (action === 'list') {
        return { project, files: files.map(f => ({ file: f.file, model_type: f.model_type, model_key: f.model_key })) }
      }

      if (action === 'read') {
        const modelKey = requireString(args.modelKey, 'modelKey')
        const file = files.find(f => f.model_key === modelKey)?.file ?? defaultFileName(modelKey)
        const data = readModel(dir, file)
        return { project, modelKey, file, data }
      }

      if (action === 'delete') {
        const modelKey = requireString(args.modelKey, 'modelKey')
        const file = files.find(f => f.model_key === modelKey)?.file
        if (!file) return { project, modelKey, deleted: false, reason: '模型文件不存在' }
        const fs = await import('node:fs')
        fs.rmSync(join(dir, file))
        return { project, modelKey, file, deleted: true }
      }

      if (action === 'write') {
        const modelKey = requireString(args.modelKey, 'modelKey')
        if (!args.data || typeof args.data !== 'object') throw new Error('invalid data: write 需要 data 对象')
        const file = defaultFileName(modelKey)
        const summary = summarizeModel(modelKey, args.data)
        if (args.confirmed !== true) {
          return { project, modelKey, file, confirmSummary: summary, needsConfirmation: true }
        }
        writeModel(dir, file, args.data)
        // 重建图谱数据（全部已建模型）
        const { models } = loadWorkspace(dir)
        const graph = buildGraphData(models)
        const graphDir = projectDir(workspaceDir, project)
        const fs = await import('node:fs')
        fs.writeFileSync(join(graphDir, 'knowledge-graph-data.json'), JSON.stringify({ nodes: graph.nodes, edges: graph.edges }, null, 2), 'utf-8')
        const issues = validateWorkspace(models)
        return { project, modelKey, file, written: true, graph: { nodes: graph.nodes.length, edges: graph.edges.length }, graphPath: join(graphDir, 'knowledge-graph-data.json'), issues: issuesToJson(issues) }
      }

      throw new Error(`invalid action: ${action} (expect list|read|write|delete)`)
    },
  }))

  // ── ontology_validate ────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'ontology_validate',
    description:
      '校验项目模型引用完整性（行为 ownerEntity/appliedRules/producedEvents、事件 producer/subscriber 引用是否存在），'
      + '并返回模型清单（entities/behaviors/rules/events 数量）与知识图谱数据（nodes/edges）。只读，不改写文件。',
    parameters: {
      project: { type: 'string', required: true, description: '项目名' },
      workspaceDir: { type: 'string', description: '绑定工作区根目录（默认当前工作目录）' },
    },
    output: jsonOutput,
    async execute(args: any) {
      const project = requireString(args.project, 'project')
      const workspaceDir = requireString(args.workspaceDir ?? process.cwd(), 'workspaceDir')
      const dir = yamlDir(workspaceDir, project)
      const { models, files } = loadWorkspace(dir)
      const issues = validateWorkspace(models)
      const graph = buildGraphData(models)
      const modelSummary = files
        .filter(f => f.model_key)
        .map((f) => {
          const m = models[f.model_key!]
          return {
            modelKey: f.model_key,
            file: f.file,
            label: MODEL_LABEL[f.model_key!] ?? f.model_key,
            entities: countOf(m, ['aggregates', 'entities', 'masterEntities']),
            behaviors: countOf(m, ['behaviors']),
            rules: countOf(m, ['rules']),
            events: countOf(m, ['events']),
          }
        })
      return {
        project, issues: issuesToJson(issues), modelSummary,
        graph: {
          nodes: graph.nodes.map(n => ({ id: n.id, label: n.label, cat: n.cat, r: n.r })),
          edges: graph.edges.map(e => ({ s: e.s, t: e.t, type: e.type, label: e.label })),
        },
      }
    },
  }))

  // ── app_generate / app_run（V3：生成可运行应用 + 热重载打开测试）─────────
  ctx.tools.register(defineTool({
    name: 'app_generate',
    description:
      '从已建的本体模型（M1）生成一个可运行的自包含应用（node:sqlite 建库 + CRUD API + 录入表单页），'
      + '落在 <workspaceDir>/.workbuddy/ontology/<project>/app/。随后调用 `app_run` 启动，用内嵌浏览器打开测试。'
      + '注意：应用在内存 SQLite 中运行，重启后数据清空。',
    parameters: {
      project: { type: 'string', required: true, description: '项目名' },
      workspaceDir: { type: 'string', description: '绑定工作区根目录（默认当前工作目录）' },
    },
    output: jsonOutput,
    async execute(args: any) {
      const project = requireString(args.project, 'project')
      const workspaceDir = requireString(args.workspaceDir ?? process.cwd(), 'workspaceDir')
      const app = generateApp(workspaceDir, project)
      return { project, appDir: app.appDir, files: app.files, tables: app.tables.map(t => ({ table: t.table, pk: t.pk, columns: t.columns })), next: '调用 app_run 启动应用' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'app_run',
    description:
      '启动由 `app_generate` 生成的应用（spawn node app.js），返回可打开的 URL；'
      + '用内嵌浏览器（browser_navigate / host.browserCreateTab）打开该 URL 即可录入数据并测试。'
      + '可传 port 指定端口（默认随机空闲端口）。每次调用都会重启一个新实例（内存库，数据重置）。',
    parameters: {
      project: { type: 'string', required: true, description: '项目名' },
      workspaceDir: { type: 'string', description: '绑定工作区根目录（默认当前工作目录）' },
      port: { type: 'integer', description: '指定端口（默认随机）' },
    },
    output: jsonOutput,
    async execute(args: any) {
      const project = requireString(args.project, 'project')
      const workspaceDir = requireString(args.workspaceDir ?? process.cwd(), 'workspaceDir')
      const appDir = join(workspaceDir, '.workbuddy', 'ontology', project, 'app')
      const appJs = join(appDir, 'app.cjs')
      if (!existsSync(appJs)) throw new Error('应用未生成：先调用 app_generate')
      const port = typeof args.port === 'number' ? args.port : 0
      return new Promise<{ running: boolean; url: string; pid: number | null; appDir: string; hint: string }>((resolve, reject) => {
        const child = spawn(process.execPath, [appJs, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] })
        const timer = setTimeout(() => { try { child.kill() } catch { /* noop */ } ; reject(new Error('应用启动超时（10s）')) }, 10000)
        let buf = ''
        child.stdout.on('data', (d: Buffer) => {
          buf += d.toString()
          const m = buf.match(/APP_READY (\S+)/)
          if (m) {
            clearTimeout(timer)
            resolve({ running: true, url: m[1]!, pid: child.pid ?? null, appDir, hint: '用内嵌浏览器打开 ' + m[1]! + ' 录入数据并测试' })
          }
        })
        child.on('error', (e) => { clearTimeout(timer); reject(e) })
        child.stderr.on('data', (d: Buffer) => console.error('[app_run]', d.toString()))
      })
    },
  }))
}

function countOf(model: any, keys: string[]): number {
  if (!model || typeof model !== 'object') return 0
  let n = 0
  for (const k of keys) if (Array.isArray(model[k])) n += model[k].length
  return n
}

function summarizeModel(modelKey: string, data: any): Record<string, any> {
  const label = MODEL_LABEL[modelKey] ?? modelKey
  const s: Record<string, any> = { modelKey, label, model_type: data.model_type ?? null }
  if (modelKey === 'objectModel') {
    const aggs = Array.isArray(data.aggregates) ? data.aggregates : []
    s.aggregates = aggs.length
    s.entities = aggs.filter((a: any) => a?.rootEntity).map((a: any) => a.rootEntity?.alias ?? a.id)
  }
  if (modelKey === 'behaviorModel') s.behaviors = Array.isArray(data.behaviors) ? data.behaviors.map((b: any) => b.id ?? b.name) : []
  if (modelKey === 'ruleModel') s.rules = Array.isArray(data.rules) ? data.rules.map((r: any) => r.id ?? r.name) : []
  if (modelKey === 'eventModel') s.events = Array.isArray(data.events) ? data.events.map((e: any) => e.eventId) : []
  if (modelKey === 'actorModel') {
    s.actors = Array.isArray(data.actors) ? data.actors.length : 0
    s.roles = Array.isArray(data.roles) ? data.roles.length : 0
    s.permissions = Array.isArray(data.permissions) ? data.permissions.length : 0
  }
  return s
}
