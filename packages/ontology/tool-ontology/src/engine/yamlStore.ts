/**
 * 模型存储层：读写工作区目录下的本体 YAML 文件。
 * 纯确定性，不含任何 LLM 调用。
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { MODEL_TYPE_TO_KEY } from '../types.js'

export interface ModelFileInfo {
  file: string
  model_type: string | null
  model_key: string | null
}

/** 列出目录下所有 yaml 文件及其识别出的模型类型 */
export function listModelFiles(dir: string): ModelFileInfo[] {
  if (!existsSync(dir)) return []
  const out: ModelFileInfo[] = []
  for (const f of readdirSync(dir)) {
    if (!/\.ya?ml$/i.test(f)) continue
    const full = join(dir, f)
    let model_type: string | null = null
    try {
      const doc = yaml.load(readFileSync(full, 'utf-8')) as any
      if (doc && typeof doc === 'object') model_type = doc.model_type ?? null
    } catch {
      model_type = null
    }
    out.push({ file: f, model_type, model_key: model_type ? (MODEL_TYPE_TO_KEY[model_type] ?? null) : null })
  }
  return out.sort((a, b) => a.file.localeCompare(b.file))
}

/** 读取单个 YAML 文件为对象 */
export function readModel(dir: string, file: string): any {
  const full = join(dir, file)
  if (!existsSync(full)) throw new Error(`模型文件不存在: ${file}`)
  const doc = yaml.load(readFileSync(full, 'utf-8')) as any
  if (!doc || typeof doc !== 'object') throw new Error(`文件不是有效的 YAML 对象: ${file}`)
  return doc
}

/** 写入单个 YAML 文件（原子写） */
export function writeModel(dir: string, file: string, data: any): void {
  mkdirSync(dir, { recursive: true })
  const full = join(dir, file)
  const yamlText = yaml.dump(data, { noRefs: true, lineWidth: -1 })
  writeFileSync(full, yamlText, 'utf-8')
}

/**
 * M1 归一化：把多种结构形态（聚合根式/扁平式/实体式）统一为「每个聚合含 rootEntity」。
 * 与 Onto-Model 后端 workspace_service._normalize_object_model 对齐。
 */
export function normalizeObjectModel(m: any): any {
  if (!m || typeof m !== 'object') return m
  const out: any = { ...m }

  // 实体式：顶层 entities → 拆成聚合
  if (!out.aggregates && Array.isArray(out.entities)) {
    out.aggregates = out.entities
      .filter((e: any) => e && typeof e === 'object')
      .map((entity: any) => ({
        id: entity.id,
        name: entity.name ?? entity.alias ?? entity.id,
        rootEntity: {
          alias: entity.alias ?? entity.id,
          name: entity.name ?? entity.alias ?? entity.id,
          description: entity.description,
          lifecycle: entity.lifecycle,
          tags: entity.tags,
          attributes: entity.attributes,
        },
      }))
  }

  // 扁平式：aggregate 无 rootEntity 但有 attributes → 提升
  if (Array.isArray(out.aggregates)) {
    out.aggregates = out.aggregates.map((agg: any) => {
      if (!agg || typeof agg !== 'object') return agg
      if ('rootEntity' in agg || agg.attributes === undefined) return agg
      const root: any = {}
      for (const k of ['alias', 'name', 'description', 'lifecycle', 'tags', 'attributes', 'constraints', 'compositions', 'aggregateConstraints']) {
        if (k in agg) root[k] = agg[k]
      }
      const rest: any = {}
      for (const [k, v] of Object.entries(agg)) if (!(k in root)) rest[k] = v
      return { ...rest, rootEntity: root }
    })
  }

  // 统一关联表
  const associations: any[] = []
  for (const rel of out.relations ?? []) {
    if (!rel || typeof rel !== 'object') continue
    associations.push({
      source: rel.sourceEntity ?? rel.source,
      target: rel.targetEntity ?? rel.target,
      type: (rel.type ?? 'association').toLowerCase(),
      sourceRole: rel.sourceRole,
      targetRole: rel.targetRole,
      cascadeDelete: rel.cascadeDelete ?? false,
    })
  }
  for (const assoc of out.aggregate_associations ?? []) {
    if (!assoc || typeof assoc !== 'object') continue
    associations.push({
      source: assoc.sourceAggregate,
      target: assoc.targetAggregate,
      type: (assoc.associationType ?? 'reference').toLowerCase(),
      sourceRole: assoc.sourceRole,
      targetRole: assoc.targetRole,
      referenceField: assoc.referenceField,
    })
  }
  if (associations.length) out.associations = associations

  return out
}

/** 从工作区目录读取全部已识别模型，返回归一化后的 models 表 */
export function loadWorkspace(dir: string): { models: Record<string, any>; files: ModelFileInfo[] } {
  const files = listModelFiles(dir)
  const models: Record<string, any> = {}
  for (const f of files) {
    if (!f.model_key) continue
    const doc = readModel(dir, f.file)
    models[f.model_key] = f.model_key === 'objectModel' ? normalizeObjectModel(doc) : doc
  }
  return { models, files }
}

/** 生成模型文件命名（model_key → 约定文件名），供新建时使用 */
export function defaultFileName(modelKey: string): string {
  const map: Record<string, string> = {
    objectModel: 'm1-object-model.yaml',
    behaviorModel: 'm2-behavior-model.yaml',
    ruleModel: 'm3-rule-model.yaml',
    eventModel: 'me-event-model.yaml',
    scenarioModel: 'm4-scenario-model.yaml',
    actorModel: 'm5-actor-model.yaml',
    flowModel: 'm6-flow-model.yaml',
    reportModel: 'm7-report-model.yaml',
    uiModel: 'mu-ui-model.yaml',
    mappingModel: 'm-mapping-model.yaml',
    interfaceModel: 'mi-interface-model.yaml',
    compensationModel: 'm6-compensation-model.yaml',
    qualityModel: 'm7-quality-model.yaml',
    metricModel: 'm_metric_model.yaml',
  }
  return map[modelKey] ?? `${modelKey}.yaml`
}
