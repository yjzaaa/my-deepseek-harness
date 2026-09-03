/**
 * 校验 + 知识图谱数据生成（确定性，无 LLM）。
 */
import { GraphData } from '../types.js'

/** 从归一化后的 objectModel 提取聚合实体清单 */
export function extractAggregates(objectModel: any): Array<{ id: string; name: string; alias?: string; kind: string }> {
  const nodes: Array<{ id: string; name: string; alias?: string; kind: string }> = []
  for (const agg of objectModel?.aggregates ?? []) {
    if (!agg || typeof agg !== 'object') continue
    nodes.push({ id: agg.id ?? agg.alias ?? `agg-${nodes.length}`, name: agg.name ?? agg.alias ?? agg.id, alias: agg.alias, kind: 'aggregate' })
    const root = agg.rootEntity
    if (root && typeof root === 'object') {
      nodes.push({ id: root.alias ?? agg.id ?? `root-${nodes.length}`, name: root.name ?? root.alias, alias: root.alias, kind: 'aggregateRoot' })
    }
    for (const e of agg.internalEntities ?? []) {
      if (!e || typeof e !== 'object') continue
      nodes.push({ id: e.alias ?? `internal-${nodes.length}`, name: e.name ?? e.alias, alias: e.alias, kind: 'internalEntity' })
    }
  }
  for (const e of objectModel?.masterEntities ?? []) {
    if (!e || typeof e !== 'object') continue
    nodes.push({ id: e.alias ?? e.name, name: e.name ?? e.alias, alias: e.alias, kind: 'masterEntity' })
  }
  return nodes
}

export interface ValidationIssue {
  code: string
  message: string
  nodeId?: string
}

/** 引用完整性校验：行为.ownerEntity / appliedRules / producedEvents、事件 producer/subscriber 等 */
export function validateWorkspace(models: Record<string, any>): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const om = models.objectModel
  const entities = extractAggregates(om)
  const entityIds = new Set(entities.map(e => e.id))
  entities.forEach(e => e.alias && entityIds.add(e.alias))

  const behaviorIds = new Set((models.behaviorModel?.behaviors ?? []).map((b: any) => b.id))
  const ruleIds = new Set((models.ruleModel?.rules ?? []).map((r: any) => r.id))
  const eventIds = new Set((models.eventModel?.events ?? []).map((e: any) => e.eventId))

  for (const b of models.behaviorModel?.behaviors ?? []) {
    if (b.ownerEntity && !entityIds.has(b.ownerEntity)) {
      issues.push({ code: 'BEHAVIOR_OWNER_NOT_FOUND', message: `行为 ${b.id} 的 ownerEntity=${b.ownerEntity} 在对象模型中不存在`, nodeId: b.id })
    }
    for (const r of b.appliedRules ?? []) {
      if (!ruleIds.has(r)) issues.push({ code: 'RULE_NOT_FOUND', message: `行为 ${b.id} 引用的规则 ${r} 不存在`, nodeId: b.id })
    }
    for (const ev of b.producedEvents ?? []) {
      const id = typeof ev === 'string' ? ev : ev?.eventId
      if (id && !eventIds.has(id)) issues.push({ code: 'EVENT_NOT_FOUND', message: `行为 ${b.id} 产生的事件 ${id} 不存在`, nodeId: b.id })
    }
  }

  for (const e of models.eventModel?.events ?? []) {
    if (e.producerBehaviorRef && !behaviorIds.has(e.producerBehaviorRef)) {
      issues.push({ code: 'PRODUCER_NOT_FOUND', message: `事件 ${e.eventId} 的生产者行为 ${e.producerBehaviorRef} 不存在`, nodeId: e.eventId })
    }
    for (const s of e.subscriberBehaviorRefs ?? []) {
      if (!behaviorIds.has(s)) issues.push({ code: 'SUBSCRIBER_NOT_FOUND', message: `事件 ${e.eventId} 的订阅者行为 ${s} 不存在`, nodeId: e.eventId })
    }
  }
  return issues
}

/** 生成知识图谱结构化数据（节点/边），与前端 graphBuilder 语义一致 */
export function buildGraphData(models: Record<string, any>): GraphData {
  const nodes: GraphData['nodes'] = []
  const edges: GraphData['edges'] = []
  const added = new Set<string>()
  const addNode = (id: string, label: string, cat: string, r: number) => {
    if (!id || added.has(id)) return
    added.add(id)
    nodes.push({ id, label, cat, r })
  }

  // 对象
  const entities = extractAggregates(models.objectModel)
  for (const e of entities) addNode(e.id, e.name, 'entity', e.kind === 'aggregate' ? 30 : 18)

  // 聚合关系边
  for (const agg of models.objectModel?.aggregates ?? []) {
    if (!agg || typeof agg !== 'object') continue
    const aggId = agg.id ?? agg.alias
    if (agg.rootEntity?.alias && aggId) edges.push({ s: aggId, t: agg.rootEntity.alias, type: 'composition', label: '聚合根' })
    for (const e of agg.internalEntities ?? []) {
      if (e?.alias && aggId) edges.push({ s: aggId, t: e.alias, type: 'composition', label: '包含' })
    }
  }

  // 归一化关联边
  for (const rel of models.objectModel?.associations ?? []) {
    if (rel?.source && rel?.target) edges.push({ s: rel.source, t: rel.target, type: rel.type ?? 'association', label: rel.sourceRole ?? '关联' })
  }

  // 行为
  for (const b of models.behaviorModel?.behaviors ?? []) {
    addNode(b.id, b.name ?? b.id, 'behavior', 18)
    if (b.ownerEntity) edges.push({ s: b.id, t: b.ownerEntity, type: 'event', label: '操作' })
    for (const r of b.appliedRules ?? []) edges.push({ s: b.id, t: r, type: 'applies_rule', label: '应用' })
    for (const ev of b.producedEvents ?? []) {
      const id = typeof ev === 'string' ? ev : ev?.eventId
      if (id) edges.push({ s: b.id, t: id, type: 'event', label: '产生' })
    }
  }
  // 规则
  for (const r of models.ruleModel?.rules ?? []) addNode(r.id, r.name ?? r.id, 'rule', 16)
  // 事件
  for (const e of models.eventModel?.events ?? []) {
    addNode(e.eventId, e.eventName ?? e.eventId, 'event', 16)
    if (e.producerBehaviorRef) edges.push({ s: e.producerBehaviorRef, t: e.eventId, type: 'event', label: '产生' })
    for (const s of e.subscriberBehaviorRefs ?? []) edges.push({ s: e.eventId, t: s, type: 'event', label: '订阅' })
  }
  // 场景
  for (const uc of models.scenarioModel?.use_cases ?? []) {
    addNode(uc.id, uc.name ?? uc.id, 'scenario', 20)
    for (const step of uc.primaryFlow ?? []) {
      if (step?.behaviorRef) edges.push({ s: uc.id, t: step.behaviorRef, type: 'triggers', label: '调用' })
    }
  }
  // 主体
  for (const a of models.actorModel?.actors ?? []) {
    addNode(a.actorId, a.name ?? a.actorId, 'actor', 18)
    for (const r of a.roles ?? []) edges.push({ s: a.actorId, t: r, type: 'authorization', label: '角色' })
  }
  for (const r of models.actorModel?.roles ?? []) {
    addNode(r.roleId, r.name ?? r.roleId, 'actor', 16)
    for (const p of r.permissions ?? []) edges.push({ s: r.roleId, t: p, type: 'authorization', label: '权限' })
  }
  for (const p of models.actorModel?.permissions ?? []) addNode(p.permissionId, p.permissionId, 'actor', 14)

  // 扩展类型（流程/报表/补偿/质量/度量/界面）—— 通用兜底
  const generic: Array<[string, string, string, string]> = [
    ['flowModel', 'flows', 'flow', 'flow'],
    ['reportModel', 'query_reports', 'report', 'report'],
    ['compensationModel', 'compensations', 'compensation', 'compensation'],
    ['qualityModel', 'quality_annotations', 'quality', 'quality'],
    ['metricModel', 'metrics', 'metric', 'metric'],
  ]
  for (const [key, listKey, cat, prefix] of generic) {
    for (const item of models[key]?.[listKey] ?? []) {
      if (!item || typeof item !== 'object') continue
      const id = item.id ?? item.compensationId ?? item.annotationId
      if (id) addNode(`${prefix}:${id}`, item.name ?? id, cat, 15)
    }
  }

  // 过滤悬挂边（端点不存在的边丢弃）
  const nodeIds = new Set(nodes.map(n => n.id))
  const cleanEdges = edges.filter(e => nodeIds.has(e.s) && nodeIds.has(e.t))
  return { nodes, edges: cleanEdges }
}
