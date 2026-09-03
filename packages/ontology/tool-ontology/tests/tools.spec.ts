/**
 * 工具行为测试（T2.x）：mock ctx 注册，覆盖各 action 分支 + 参数校验错误路径。
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { apply } from '../src/index.js'

type ToolDef = { name: string; execute: (args: any, exec: any) => Promise<any> }

function harness(): { tools: Map<string, ToolDef>; ws: string } {
  const tools = new Map<string, ToolDef>()
  const ctx: any = {
    tools: { register: (d: ToolDef) => tools.set(d.name, d) },
    systemPrompt: { section: () => {} },
    on: () => {}, get: () => undefined, inject: () => {},
  }
  apply(ctx)
  const ws = mkdtempSync(join(tmpdir(), 'owb-tool-'))
  return { tools, ws }
}

function sample(name: string): any {
  return load(readFileSync(`D:/sharptoolbox/Onto-Model/sample/${name}`, 'utf-8'))
}

describe('ontology_explore（T2.2）', () => {
  it('start：初始化项目、写需求文档、返回问题与 canModel=false', async () => {
    const { tools, ws } = harness()
    const r = await tools.get('ontology_explore')!.execute({ project: 'demo', action: 'start', workspaceDir: ws }, {})
    expect(r.phase).toContain('阶段零')
    expect(r.questions.length).toBe(3)
    expect(r.canModel).toBe(false)
    expect(readdirSync(join(ws, '.workbuddy', 'ontology', 'demo'))).toContain('需求文档.md')
    rmSync(ws, { recursive: true, force: true })
  })

  it('advance：记录回答、推进阶段、写入文档', async () => {
    const { tools, ws } = harness()
    await tools.get('ontology_explore')!.execute({ project: 'demo', action: 'start', workspaceDir: ws }, {})
    const r = await tools.get('ontology_explore')!.execute({
      project: 'demo', action: 'advance', workspaceDir: ws,
      answers: ['设备、工单', '维修工程师'], note: '无审批流',
    }, {})
    expect(r.phase).toContain('阶段一')
    expect(r.confirmed).toBeGreaterThan(0)
    rmSync(ws, { recursive: true, force: true })
  })

  it('status：需求文档不存在时返回 error', async () => {
    const { tools, ws } = harness()
    const r = await tools.get('ontology_explore')!.execute({ project: 'demo', action: 'status', workspaceDir: ws }, {})
    expect(r.error).toBeTruthy()
    rmSync(ws, { recursive: true, force: true })
  })

  it('非法 action → 结构化错误', async () => {
    const { tools, ws } = harness()
    await expect(tools.get('ontology_explore')!.execute({ project: 'demo', action: 'bogus', workspaceDir: ws }, {}))
      .rejects.toThrow(/invalid action/)
    rmSync(ws, { recursive: true, force: true })
  })
})

describe('ontology_model（T2.2）', () => {
  it('write 两步确认：先 confirmSummary，confirmed=true 才落盘', async () => {
    const { tools, ws } = harness()
    const data = sample('m1-object-model.yaml')
    const first = await tools.get('ontology_model')!.execute({ project: 'demo', action: 'write', modelKey: 'objectModel', workspaceDir: ws, data }, {})
    expect(first.needsConfirmation).toBe(true)
    expect(first.confirmSummary.aggregates).toBe(2)
    // 未确认 → 未落盘（目录不存在）
    expect(existsSync(join(ws, '.workbuddy', 'ontology', 'demo', 'yaml'))).toBe(false)
    const second = await tools.get('ontology_model')!.execute({ project: 'demo', action: 'write', modelKey: 'objectModel', workspaceDir: ws, data, confirmed: true }, {})
    expect(second.written).toBe(true)
    expect(second.graph.nodes).toBeGreaterThan(0) // 图谱重建
    expect(readdirSync(join(ws, '.workbuddy', 'ontology', 'demo', 'yaml'))).toContain('m1-object-model.yaml')
    expect(readdirSync(join(ws, '.workbuddy', 'ontology', 'demo'))).toContain('knowledge-graph-data.json')
    rmSync(ws, { recursive: true, force: true })
  })

  it('list / read / delete', async () => {
    const { tools, ws } = harness()
    const data = sample('m1-object-model.yaml')
    await tools.get('ontology_model')!.execute({ project: 'demo', action: 'write', modelKey: 'objectModel', workspaceDir: ws, data, confirmed: true }, {})
    const list = await tools.get('ontology_model')!.execute({ project: 'demo', action: 'list', workspaceDir: ws }, {})
    expect(list.files[0].model_key).toBe('objectModel')
    const read = await tools.get('ontology_model')!.execute({ project: 'demo', action: 'read', modelKey: 'objectModel', workspaceDir: ws }, {})
    expect(read.data.model_type).toBe('AGGREGATE_OBJECT')
    const del = await tools.get('ontology_model')!.execute({ project: 'demo', action: 'delete', modelKey: 'objectModel', workspaceDir: ws }, {})
    expect(del.deleted).toBe(true)
    rmSync(ws, { recursive: true, force: true })
  })

  it('缺参（project 为空）→ 结构化错误', async () => {
    const { tools, ws } = harness()
    await expect(tools.get('ontology_model')!.execute({ project: '', action: 'list', workspaceDir: ws }, {}))
      .rejects.toThrow(/invalid project/)
    rmSync(ws, { recursive: true, force: true })
  })
})

describe('ontology_validate（T2.2）', () => {
  it('全量模型 → 0 断链 + 模型清单 + 图谱', async () => {
    const { tools, ws } = harness()
    for (const [key, f] of [
      ['objectModel', 'm1-object-model.yaml'], ['behaviorModel', 'm2-behavior-model.yaml'],
      ['ruleModel', 'm3-rule-model.yaml'], ['eventModel', 'me-event-model.yaml'],
      ['scenarioModel', 'm4-scenario-model.yaml'], ['actorModel', 'm5-actor-model.yaml'],
    ] as const) {
      await tools.get('ontology_model')!.execute({ project: 'demo', action: 'write', modelKey: key, workspaceDir: ws, data: sample(f), confirmed: true }, {})
    }
    const r = await tools.get('ontology_validate')!.execute({ project: 'demo', workspaceDir: ws }, {})
    expect(r.issues).toEqual([])
    expect(r.modelSummary.length).toBe(6)
    expect(r.graph.nodes.length).toBeGreaterThan(30)
    rmSync(ws, { recursive: true, force: true })
  })

  it('部分模型 → 报断链（行为引用未建模型）', async () => {
    const { tools, ws } = harness()
    await tools.get('ontology_model')!.execute({ project: 'demo', action: 'write', modelKey: 'objectModel', workspaceDir: ws, data: sample('m1-object-model.yaml'), confirmed: true }, {})
    await tools.get('ontology_model')!.execute({ project: 'demo', action: 'write', modelKey: 'behaviorModel', workspaceDir: ws, data: sample('m2-behavior-model.yaml'), confirmed: true }, {})
    const r = await tools.get('ontology_validate')!.execute({ project: 'demo', workspaceDir: ws }, {})
    expect(r.issues.length).toBeGreaterThan(0)
    expect(r.issues[0].code).toMatch(/NOT_FOUND/)
    rmSync(ws, { recursive: true, force: true })
  })
})

describe('app_generate / app_run（T2.2 / T5）', () => {
  it('生成应用：从 M1 建表 + 文件落盘', async () => {
    const { tools, ws } = harness()
    await tools.get('ontology_model')!.execute({ project: 'demo', action: 'write', modelKey: 'objectModel', workspaceDir: ws, data: sample('m1-object-model.yaml'), confirmed: true }, {})
    const r = await tools.get('app_generate')!.execute({ project: 'demo', workspaceDir: ws }, {})
    expect(r.tables.map((t: any) => t.table)).toEqual(expect.arrayContaining(['Contract', 'Invoice']))
    expect(readdirSync(r.appDir)).toEqual(expect.arrayContaining(['app.cjs', 'index.html', 'models.json']))
    rmSync(ws, { recursive: true, force: true })
  })

  it('未生成先 run → 报错', async () => {
    const { tools, ws } = harness()
    await expect(tools.get('app_run')!.execute({ project: 'demo', workspaceDir: ws }, {}))
      .rejects.toThrow(/应用未生成/)
    rmSync(ws, { recursive: true, force: true })
  })
})
