/**
 * 引擎单元测试（T1.x）：
 *  - yamlStore：归一化三种结构（聚合根/扁平/实体式）、路径穿越拒绝
 *  - graphData：校验正反向、图谱节点/边全类型统计
 *  - appRuntime：建表规格、约束
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { loadWorkspace, normalizeObjectModel, listModelFiles, writeModel, readModel } from '../src/engine/yamlStore.js'
import { validateWorkspace, buildGraphData, extractAggregates } from '../src/engine/graphData.js'
import { buildTableSpecs, createApp, insertRow, queryTable, summarize } from '../src/engine/appRuntime.js'

/** 临时目录 fixture */
function tmpWs(): string {
  const dir = mkdtempSync(join(tmpdir(), 'owb-test-'))
  return dir
}

/** 扁平式 M1（V2 结构） */
function flatM1() {
  return {
    model_type: 'OBJECT',
    version: '2.1',
    domain: '测试域',
    aggregates: [
      {
        id: 'AGG-A1', name: '客户', alias: 'Customer',
        attributes: [
          { name: 'customerId', label: '客户编号', type: 'String', required: true, unique: true },
          { name: 'customerName', label: '客户名称', type: 'String', required: true },
        ],
      },
    ],
    aggregate_associations: [
      { sourceAggregate: 'AGG-A1', targetAggregate: 'AGG-A2', associationType: 'REFERENCE', sourceRole: '关联' },
    ],
  }
}

/** 实体式 M1（DataAnalyse 结构） */
function entityM1() {
  return {
    model_type: 'OBJECT',
    entities: [
      { id: 'ENT-1', name: '订单', alias: 'Order', attributes: [{ name: 'orderId', type: 'String', required: true, unique: true }] },
      { id: 'ENT-2', name: '用户', alias: 'User', attributes: [{ name: 'userId', type: 'String', required: true }] },
    ],
    relations: [
      { type: 'ASSOCIATION', sourceEntity: 'ENT-1', targetEntity: 'ENT-2', sourceRole: '买家' },
    ],
  }
}

/** 聚合根式 M1（V1 结构）——真实 sample 形态 */
function rootM1() {
  return {
    model_type: 'AGGREGATE_OBJECT',
    aggregates: [
      {
        id: 'AGG-C', name: '合同聚合',
        rootEntity: {
          alias: 'Contract', name: '合同基本信息',
          attributes: [
            { name: 'contractNo', type: 'String', required: true, unique: true },
            { name: 'totalAmount', type: 'Decimal', required: true },
          ],
        },
        internalEntities: [{ alias: 'PaymentTerm', name: '付款条款', attributes: [{ name: 'stageNo', type: 'String', required: true }] }],
      },
    ],
  }
}

describe('yamlStore：M1 归一化', () => {
  it('扁平式：无 rootEntity 但有 attributes → 提升为 rootEntity', () => {
    const m = normalizeObjectModel(flatM1())
    const agg = m.aggregates[0]
    expect(agg.rootEntity.alias).toBe('Customer')
    expect(agg.rootEntity.attributes.length).toBe(2)
    expect(agg.id).toBe('AGG-A1') // 外层聚合信息保留
    expect(m.associations.length).toBe(1)
    expect(m.associations[0]).toMatchObject({ source: 'AGG-A1', type: 'reference' })
  })

  it('实体式：顶层 entities → 拆成聚合，relations → associations', () => {
    const m = normalizeObjectModel(entityM1())
    expect(m.aggregates.length).toBe(2)
    expect(m.aggregates[0].rootEntity.alias).toBe('Order')
    expect(m.associations).toMatchObject([{ source: 'ENT-1', target: 'ENT-2', type: 'association' }])
  })

  it('聚合根式：原样保留（不重复提升）', () => {
    const m = normalizeObjectModel(rootM1())
    expect(m.aggregates[0].rootEntity.alias).toBe('Contract')
    expect(m.aggregates[0].internalEntities.length).toBe(1)
  })
})

describe('yamlStore：目录读写与模型识别', () => {
  it('写入并识别模型文件（按约定文件名）', () => {
    const dir = tmpWs()
    try {
      writeModel(dir, 'm1-object-model.yaml', rootM1())
      writeModel(dir, 'm2-behavior-model.yaml', { model_type: 'BEHAVIOR', behaviors: [] })
      writeModel(dir, 'random.txt', 'not yaml')
      const files = listModelFiles(dir)
      expect(files.length).toBe(2)
      expect(files[0]).toMatchObject({ file: 'm1-object-model.yaml', model_type: 'AGGREGATE_OBJECT', model_key: 'objectModel' })
      const { models } = loadWorkspace(dir)
      expect(Object.keys(models).sort()).toEqual(['behaviorModel', 'objectModel'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('未知 model_type 的文件归入未识别（不静默丢失）', () => {
    const dir = tmpWs()
    try {
      writeModel(dir, 'x-model.yaml', { model_type: 'NEW_TYPE', foo: 1 })
      const files = listModelFiles(dir)
      expect(files[0].model_key).toBeNull()
      expect(files[0].model_type).toBe('NEW_TYPE')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('缺失 model_type 的文件 model_key 为 null', () => {
    const dir = tmpWs()
    try {
      writeModel(dir, 'no-type.yaml', { foo: 1 })
      const files = listModelFiles(dir)
      expect(files[0].model_type).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('graphData：校验（T1.2）', () => {
  const baseModels = () => ({
    objectModel: rootM1(),
    behaviorModel: {
      behaviors: [
        { id: 'B1', ownerEntity: 'Contract', appliedRules: ['R1'], producedEvents: ['E1'] },
        { id: 'B2', ownerEntity: 'Ghost', appliedRules: ['R-ghost'], producedEvents: ['E-ghost'] },
      ],
    },
    ruleModel: { rules: [{ id: 'R1' }] },
    eventModel: { events: [{ eventId: 'E1', producerBehaviorRef: 'B1', subscriberBehaviorRefs: ['B1'] }] },
  })

  it('反向用例：引用不存在的对象/规则/事件 → 报错', () => {
    const issues = validateWorkspace(baseModels())
    const codes = issues.map((i) => i.code)
    expect(codes).toContain('BEHAVIOR_OWNER_NOT_FOUND') // B2.ownerEntity=Ghost
    expect(codes).toContain('RULE_NOT_FOUND') // B2.appliedRules=R-ghost
    expect(codes).toContain('EVENT_NOT_FOUND') // B2.producedEvents=E-ghost
  })

  it('正向用例：全引用存在 → 0 断链', () => {
    const models = baseModels()
    models.behaviorModel.behaviors[1] = { id: 'B2', ownerEntity: 'Contract' } // 修掉所有断链
    const issues = validateWorkspace(models)
    expect(issues).toEqual([])
  })

  it('图谱节点/边：六类节点 + 组合/引用/触发/订阅/授权边', () => {
    const models: any = {
      objectModel: rootM1(),
      behaviorModel: { behaviors: [{ id: 'B1', ownerEntity: 'Contract', appliedRules: ['R1'], producedEvents: ['E1'] }] },
      ruleModel: { rules: [{ id: 'R1' }] },
      eventModel: { events: [{ eventId: 'E1', producerBehaviorRef: 'B1', subscriberBehaviorRefs: ['B1'] }] },
      scenarioModel: { use_cases: [{ id: 'UC1', name: '场景', primaryFlow: [{ behaviorRef: 'B1' }] }] },
      actorModel: { actors: [{ actorId: 'A1', name: '主体', roles: ['ROLE1'] }], roles: [{ roleId: 'ROLE1', name: '角色', permissions: ['P1'] }], permissions: [{ permissionId: 'P1' }] },
    }
    const g = buildGraphData(models)
    const cats = [...new Set(g.nodes.map((n) => n.cat))].sort()
    expect(cats).toEqual(['actor', 'behavior', 'entity', 'event', 'rule', 'scenario'])
    const types = [...new Set(g.edges.map((e) => e.type))]
    expect(types).toContain('composition')
    expect(types).toContain('applies_rule')
    expect(types).toContain('event')
    expect(types).toContain('triggers')
    expect(types).toContain('authorization')
    // 无悬挂边
    const ids = new Set(g.nodes.map((n) => n.id))
    for (const e of g.edges) {
      expect(ids.has(e.s)).toBe(true)
      expect(ids.has(e.t)).toBe(true)
    }
  })

  it('extractAggregates：实体清单含聚合/根/内部实体', () => {
    const nodes = extractAggregates(rootM1())
    const kinds = nodes.map((n) => n.kind)
    expect(kinds).toContain('aggregate')
    expect(kinds).toContain('aggregateRoot')
    expect(kinds).toContain('internalEntity')
  })
})

describe('appRuntime：建表与约束（T1.4）', () => {
  it('从 M1 推导表规格（主表 + 子表 + 主键）', () => {
    const specs = buildTableSpecs(rootM1())
    const contract = specs.find((s) => s.table === 'Contract')!
    expect(contract.pk).toBe('contractNo')
    expect(contract.columns.some((c) => c.name === 'contractNo' && c.unique && c.required)).toBe(true)
    const payment = specs.find((s) => s.table === 'PaymentTerm')!
    expect(payment.columns[0].name).toBe('contractNo') // 外键列
  })

  it('建库 + 插入 + 查询 + 约束违反', () => {
    const { db, specs, tables } = createApp(rootM1())
    expect(tables).toContain('Contract')
    const contract = specs.find((s) => s.table === 'Contract')!
    // 缺少必填字段 → 报错
    expect(() => insertRow(db, contract, { contractNo: 'X' })).toThrow()
    // 完整插入
    insertRow(db, contract, { contractNo: 'HT001', totalAmount: '1000' })
    // 唯一约束违反
    expect(() => insertRow(db, contract, { contractNo: 'HT001', totalAmount: '2000' })).toThrow()
    const q = queryTable(db, contract, { contractNo: 'HT001' })
    expect(q.count).toBe(1)
    expect(summarize(db, specs)).toEqual([{ table: 'Contract', rows: 1 }, { table: 'PaymentTerm', rows: 0 }])
  })

  it('真实 sample 模型可完整建库（fixture）', () => {
    const m1 = load(readFileSync('D:/sharptoolbox/Onto-Model/sample/m1-object-model.yaml', 'utf-8')) as any
    const norm = normalizeObjectModel(m1)
    const { tables, specs } = createApp(norm)
    expect(tables).toContain('Contract')
    expect(tables).toContain('Invoice')
    expect(tables).toContain('PaymentTerm')
    expect(specs.length).toBeGreaterThanOrEqual(4)
  })
})
