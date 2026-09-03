import { apply } from '../src/index.ts'
import { load } from 'js-yaml'
import { readFileSync, readdirSync } from 'node:fs'

const tools = []
const ctx = { tools: { register: (d) => tools.push(d) }, systemPrompt: { section: () => {} }, on: () => {}, get: () => undefined, inject: () => {} }
apply(ctx)
const byName = Object.fromEntries(tools.map(t => [t.name, t]))
const ws = 'D:/sharptoolbox/my-deepseek-harness/.tmp-owb-ws'
const exec = {}
async function call(name, args) { return byName[name].execute(args, exec) }
const sample = (f) => load(readFileSync(`D:/sharptoolbox/Onto-Model/sample/${f}`, 'utf-8'))

// 建模（m1..m5+me 全量写入）
for (const [key, f] of [['objectModel','m1-object-model.yaml'],['behaviorModel','m2-behavior-model.yaml'],['ruleModel','m3-rule-model.yaml'],['eventModel','me-event-model.yaml'],['scenarioModel','m4-scenario-model.yaml'],['actorModel','m5-actor-model.yaml']]) {
  const r = await call('ontology_model', { project: 'demo', action: 'write', modelKey: key, workspaceDir: ws, data: sample(f), confirmed: true })
  console.log(`[write ${key}] written:${r.written} graph_nodes:${r.graph?.nodes} issues:${r.issues?.length}`)
}

// validate（全量应 0 断链）
let r = await call('ontology_validate', { project: 'demo', workspaceDir: ws })
console.log('\n[validate] issues:', r.issues.length, '| graph:', r.graph.nodes.length, 'nodes /', r.graph.edges.length, 'edges')

// app_generate
r = await call('app_generate', { project: 'demo', workspaceDir: ws })
console.log('\n[app_generate] tables:', r.tables.map(t => `${t.table}(${t.columns.length}列)`).join(', '), '| dir:', r.appDir.split('/').slice(-3).join('/'))

// app_run（热重载启动）
r = await call('app_run', { project: 'demo', workspaceDir: ws, port: 18099 })
console.log('[app_run] url:', r.url, '| pid:', r.pid)

// 验证应用 API：建表 + 插入 + 查询
const base = r.url
const tables = await (await fetch(base + '/api/tables')).json()
console.log('\n[app API] 表:', tables.tables.map(t => `${t.table}(${t.rows})`).join(', '))
const c = tables.tables.find(t => t.table === 'Contract')
const ins = await (await fetch(base + '/api/Contract', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ contractNo: 'HT001', contractName: '测试合同', status: '生效', totalAmount: '1000' }) })).json()
console.log('[app API] 插入:', JSON.stringify(ins).slice(0, 120))
const q = await (await fetch(base + '/api/Contract')).json()
console.log('[app API] 查询:', q.rows.length, '条')

// 清理
try { (await import('node:child_process')).execSync(`taskkill /F /PID ${r.pid} /T 2>nul`) } catch {}
