/**
 * 应用运行时：从归一化的 M1 对象模型用 node:sqlite（内置）建库，提供 CRUD/查询。
 * 纯确定性执行，零 LLM 参与。
 */
import { DatabaseSync } from 'node:sqlite'

export interface TableSpec {
  table: string
  pk: string
  columns: Array<{ name: string; sqlType: string; required: boolean; unique: boolean }>
}

const SQL_TYPE: Record<string, string> = {
  String: 'TEXT', Integer: 'INTEGER', Decimal: 'REAL', Money: 'REAL',
  Date: 'TEXT', DateTime: 'TEXT', Boolean: 'INTEGER', Enum: 'TEXT',
  DictionaryRef: 'TEXT', AggregateRootRef: 'TEXT', Reference: 'TEXT', ValueObject: 'TEXT',
}

function colType(attr: any): string {
  return SQL_TYPE[attr?.type] ?? 'TEXT'
}

function colName(attr: any, index: number): string {
  return (typeof attr === 'string' ? attr : attr?.name) ?? `col_${index}`
}

/** 从 M1 提取建表规格（聚合根主表 + 子实体明细表） */
export function buildTableSpecs(objectModel: any): TableSpec[] {
  const specs: TableSpec[] = []
  for (const agg of objectModel?.aggregates ?? []) {
    if (!agg || typeof agg !== 'object') continue
    const root = agg.rootEntity
    if (!root || typeof root !== 'object') continue
    const alias = root.alias ?? agg.alias ?? `table_${specs.length}`
    const attrs = Array.isArray(root.attributes) ? root.attributes : []
    const pkAttr = attrs.find((a: any) => a?.unique && a?.required)
    const pk = pkAttr ? colName(pkAttr, attrs.indexOf(pkAttr)) : `${alias}_id`
    const columns = attrs.map((a: any, i: number) => ({
      name: colName(a, i),
      sqlType: colType(a),
      required: Boolean(a?.required),
      unique: Boolean(a?.unique),
    }))
    // 主键列
    if (!columns.some((c: { name: string }) => c.name === pk)) columns.unshift({ name: pk, sqlType: 'TEXT', required: true, unique: true })
    specs.push({ table: alias, pk, columns })

    // 子实体 → 明细表
    for (const e of agg.internalEntities ?? []) {
      if (!e || typeof e !== 'object') continue
      const t = e.alias ?? e.name
      const childAttrs = Array.isArray(e.attributes) ? e.attributes : []
      const childCols: TableSpec['columns'] = [
        { name: pk, sqlType: 'TEXT', required: true, unique: false },
        ...childAttrs.map((a: any, i: number) => ({ name: colName(a, i), sqlType: colType(a), required: Boolean(a?.required), unique: false })),
      ]
      specs.push({ table: t, pk: `${t}_id`, columns: childCols })
    }
  }
  return specs
}

/** 创建内存 SQLite 库并建表，返回运行句柄 */
export function createApp(objectModel: any): { db: DatabaseSync; specs: TableSpec[]; tables: string[] } {
  const db = new DatabaseSync(':memory:')
  const specs = buildTableSpecs(objectModel)
  for (const spec of specs) {
    const colDefs = spec.columns.map((c) => {
      let d = `"${c.name}" ${c.sqlType}`
      if (c.required) d += ' NOT NULL'
      if (c.unique) d += ' UNIQUE'
      return d
    })
    db.exec(`CREATE TABLE IF NOT EXISTS "${spec.table}" (${colDefs.join(', ')})`)
  }
  return { db, specs, tables: specs.map(s => s.table) }
}

export interface QueryResult {
  table: string
  columns: string[]
  rows: any[]
  count: number
}

/** 列出表及其列结构 */
export function listTables(specs: TableSpec[]): Array<{ table: string; columns: string[]; pk: string }> {
  return specs.map(s => ({ table: s.table, columns: s.columns.map(c => c.name), pk: s.pk }))
}

/** 查询一张表（支持可选 filter JSON） */
export function queryTable(db: DatabaseSync, spec: TableSpec, filter?: Record<string, any>): QueryResult {
  const where: string[] = []
  const params: any[] = []
  for (const [k, v] of Object.entries(filter ?? {})) {
    if (spec.columns.some(c => c.name === k)) {
      where.push(`"${k}" = ?`)
      params.push(String(v))
    }
  }
  const sql = `SELECT * FROM "${spec.table}"${where.length ? ' WHERE ' + where.join(' AND ') : ''}`
  const stmt = db.prepare(sql)
  const rows = stmt.all(...params) as any[]
  return { table: spec.table, columns: spec.columns.map(c => c.name), rows, count: rows.length }
}

/** 插入一行，返回该行（含主键） */
export function insertRow(db: DatabaseSync, spec: TableSpec, data: Record<string, any>): QueryResult {
  const cols = spec.columns.filter(c => c.name in data && data[c.name] !== undefined && data[c.name] !== '')
  const names = cols.map(c => c.name)
  const placeholders = names.map(() => '?')
  const values = cols.map(c => String(data[c.name]))
  if (names.length) {
    db.prepare(`INSERT INTO "${spec.table}" (${names.map(n => `"${n}"`).join(', ')}) VALUES (${placeholders.join(', ')})`).run(...values)
  } else {
    db.prepare(`INSERT INTO "${spec.table}" DEFAULT VALUES`).run()
  }
  return queryTable(db, spec)
}

/** 汇总：返回表清单 + 各表行数 */
export function summarize(db: DatabaseSync, specs: TableSpec[]): Array<{ table: string; rows: number }> {
  return specs.map((s) => {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM "${s.table}"`).get() as any
    return { table: s.table, rows: Number(row?.n ?? 0) }
  })
}
