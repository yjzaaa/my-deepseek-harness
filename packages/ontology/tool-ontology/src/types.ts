/**
 * 本体模型公共类型（与 v6 规范对齐的最小交集）。
 * 引擎只消费这里定义的结构；未知字段透传保留。
 */

/** 模型类型 → 文件内 model_type 取值（后端归一化同款映射） */
export const MODEL_TYPE_TO_KEY: Record<string, string> = {
  AGGREGATE_OBJECT: 'objectModel',
  OBJECT: 'objectModel',
  BEHAVIOR: 'behaviorModel',
  RULE: 'ruleModel',
  EVENT: 'eventModel',
  SCENARIO: 'scenarioModel',
  ACTOR: 'actorModel',
  FLOW: 'flowModel',
  REPORT: 'reportModel',
  UI: 'uiModel',
  'UI-Model': 'uiModel',
  UI_MODEL: 'uiModel',
  MAPPING: 'mappingModel',
  MM: 'mappingModel',
  INTERFACE: 'interfaceModel',
  MI: 'interfaceModel',
  COMPENSATION: 'compensationModel',
  QUALITY: 'qualityModel',
  METRIC: 'metricModel',
}

export interface WorkspaceModels {
  [key: string]: any
}

/** 一个聚合（M1 归一化后的形态：每个聚合均含 rootEntity） */
export interface Aggregate {
  id?: string
  name?: string
  alias?: string
  rootEntity?: {
    alias?: string
    name?: string
    attributes?: any[]
    compositions?: any[]
    lifecycle?: string[]
    tags?: string[]
    [k: string]: any
  }
  internalEntities?: any[]
  aggregateConstraints?: any[]
  [k: string]: any
}

export interface GraphNode {
  id: string
  label: string
  cat: string
  r: number
}

export interface GraphEdge {
  s: string
  t: string
  type: string
  label: string
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}
