/**
 * 应用层测试（T5.2）：生成的 app.cjs 真实运行 —— CRUD / 约束 / 404 / CORS。
 */
import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { load } from 'js-yaml'
import { generateApp } from '../src/engine/appGen.js'
import { writeModel, normalizeObjectModel } from '../src/engine/yamlStore.js'

const children: ChildProcess[] = []
afterEach(() => {
  for (const c of children) { try { c.kill() } catch { /* noop */ } }
  children.length = 0
})

function startApp(ws: string, project = 'demo', port = 0): Promise<string> {
  const appJs = join(ws, '.workbuddy', 'ontology', project, 'app', 'app.cjs')
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [appJs, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] })
    children.push(child)
    const timer = setTimeout(() => reject(new Error('app start timeout')), 10000)
    let buf = ''
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString()
      const m = buf.match(/APP_READY (\S+)/)
      if (m) { clearTimeout(timer); resolve(m[1]!) }
    })
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
  })
}

function m1() {
  return load(readFileSync('D:/sharptoolbox/Onto-Model/sample/m1-object-model.yaml', 'utf-8')) as any
}

async function setup(ws: string) {
  // 先写入 M1 到模型工作区（generateApp 从 yaml 加载）
  writeModel(join(ws, '.workbuddy', 'ontology', 'demo', 'yaml'), 'm1-object-model.yaml', normalizeObjectModel(m1()))
  generateApp(ws, 'demo')
  return startApp(ws)
}

describe('app.cjs 运行时（T5.2）', () => {
  it('建表 + 合法插入 + 查询 + 计数', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'owb-app-'))
    try {
      const base = await setup(ws)
      const tables = await (await fetch(base + '/api/tables')).json()
      expect(tables.tables.map((t: any) => t.table)).toEqual(expect.arrayContaining(['Contract', 'Invoice', 'PaymentTerm']))
      // 合法插入
      const ins = await (await fetch(base + '/api/Contract', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractNo: 'HT001', contractName: '合同1', status: '生效', productId: 'P1', customerId: 'C1', deptId: 'D1', ownerId: 'E1', signDate: '2026-01-01', totalAmount: '1000', purchaseAmount: '800', taxRate: '0.13' }),
      })).json()
      expect(ins.ok).toBe(true)
      expect(ins.count).toBe(1)
      // 查询过滤
      const q = await (await fetch(base + '/api/Contract?contractNo=HT001')).json()
      expect(q.count).toBe(1)
    } finally {
      rmSync(ws, { recursive: true, force: true })
    }
  })

  it('NOT NULL 违反 → 报错（约束生效）', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'owb-app-'))
    try {
      const base = await setup(ws)
      const r = await (await fetch(base + '/api/Contract', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contractNo: 'X' }),
      })).json()
      expect(r.ok).not.toBe(true)
      expect(JSON.stringify(r)).toContain('NOT NULL')
    } finally {
      rmSync(ws, { recursive: true, force: true })
    }
  })

  it('UNIQUE 违反 → 报错', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'owb-app-'))
    try {
      const base = await setup(ws)
      const body = JSON.stringify({ contractNo: 'HT001', contractName: 'c', status: '生效', productId: 'P', customerId: 'C', deptId: 'D', ownerId: 'E', signDate: '2026-01-01', totalAmount: '1', purchaseAmount: '1', taxRate: '0' })
      await fetch(base + '/api/Contract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      const dup = await (await fetch(base + '/api/Contract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).json()
      expect(JSON.stringify(dup)).toContain('UNIQUE')
    } finally {
      rmSync(ws, { recursive: true, force: true })
    }
  })

  it('不存在的表/路径 → 404 + CORS/OPTIONS', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'owb-app-'))
    try {
      const base = await setup(ws)
      const notFound = await fetch(base + '/api/NoSuchTable')
      expect(notFound.status).toBe(404)
      const opts = await fetch(base + '/api/Contract', { method: 'OPTIONS' })
      expect(opts.status).toBe(204)
      expect(opts.headers.get('Access-Control-Allow-Origin')).toBe('*')
    } finally {
      rmSync(ws, { recursive: true, force: true })
    }
  })

  it('表单页返回 HTML', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'owb-app-'))
    try {
      const base = await setup(ws)
      const page = await (await fetch(base + '/')).text()
      expect(page).toContain('本体驱动应用')
      expect(page).toContain('data-col')
    } finally {
      rmSync(ws, { recursive: true, force: true })
    }
  })
})

// 让 m1 可被 generateApp 使用：生成 M1 到模型工作区（generateApp 从 yaml 加载）
void m1
