// 端到端冒烟：mock 最小 ctx，验证三个工具的全流程（不依赖 dsh runtime）
import { apply } from '../src/index.ts'
import { load } from 'js-yaml'
import { readFileSync, readdirSync } from 'node:fs'

const tools = []
const ctx = {
  tools: { register: (def) => { tools.push(def) } },
  systemPrompt: { section: () => {} },
  on: () => {}, get: () => undefined, inject: () => {},
}
apply(ctx)
console.log('注册工具:', tools.map(t => t.name).join(', '))

const byName = Object.fromEntries(tools.map(t => [t.name, t]))
const ws = 'D:/sharptoolbox/my-deepseek-harness/.tmp-owb-ws'
const exec = {}
async function call(name, args) { return byName[name].execute(args, exec) }
const sample = (f) => load(readFileSync(`D:/sharptoolbox/Onto-Model/sample/${f}`, 'utf-8'))

let r = await call('ontology_explore', { project: 'demo-repair', action: 'start', workspaceDir: ws })
console.log('\n[explore.start] phase:', r.phase, '| questions:', r.questions.length, '| canModel:', r.canModel)

r = await call('ontology_explore', { project: 'demo-repair', action: 'advance', workspaceDir: ws, answers: ['设备、工单、故障类型、维修人', '报修人/维修工程师/设备管理员'], note: '无审批流' })
console.log('[explore.advance] phase:', r.phase, '| canModel:', r.canModel)

r = await call('ontology_explore', { project: 'demo-repair', action: 'status', workspaceDir: ws })
console.log('[explore.status] phase:', r.phase, '| confirmed:', r.confirmed)

r = await call('ontology_model', { project: 'demo-repair', action: 'write', modelKey: 'objectModel', workspaceDir: ws, data: sample('m1-object-model.yaml') })
console.log('\n[model.write] needsConfirmation:', r.needsConfirmation, '| aggregates:', r.confirmSummary?.aggregates)

r = await call('ontology_model', { project: 'demo-repair', action: 'write', modelKey: 'objectModel', workspaceDir: ws, data: sample('m1-object-model.yaml'), confirmed: true })
console.log('[model.write.confirmed] written:', r.written, '| graph nodes:', r.graph?.nodes, '| issues:', r.issues?.length)

r = await call('ontology_model', { project: 'demo-repair', action: 'write', modelKey: 'behaviorModel', workspaceDir: ws, data: sample('m2-behavior-model.yaml'), confirmed: true })
console.log('[model.write.m2] written:', r.written)

r = await call('ontology_validate', { project: 'demo-repair', workspaceDir: ws })
console.log('\n[validate] issues:', r.issues.length, '| models:', r.modelSummary.map(m => `${m.label}(${m.entities ?? m.behaviors ?? m.rules ?? m.events})`).join(', '))
console.log('[validate] graph:', r.graph.nodes.length, 'nodes /', r.graph.edges.length, 'edges')

const files = readdirSync(`${ws}/.workbuddy/ontology/demo-repair`)
console.log('\n产物目录:', files.join(', '))
const yamlFiles = readdirSync(`${ws}/.workbuddy/ontology/demo-repair/yaml`)
console.log('yaml 目录:', yamlFiles.join(', '))
