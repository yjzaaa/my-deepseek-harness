/**
 * T5.1 应用表单页浏览器交互（Puppeteer + 系统 Chrome）：
 * 打开生成的 app 表单页 → 填表 → 提交 → 列表出现新数据（验证"打开应用即可测试"）。
 * Chrome 不存在时跳过。
 */
import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { generateApp } from '../src/engine/appGen.js'
import { writeModel, normalizeObjectModel } from '../src/engine/yamlStore.js'
import { load } from 'js-yaml'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const children: ChildProcess[] = []
afterEach(() => { for (const c of children) { try { c.kill() } catch { /* noop */ } } children.length = 0 })

async function startApp(ws: string, port = 0): Promise<string> {
  const appJs = join(ws, '.workbuddy', 'ontology', 'demo', 'app', 'app.cjs')
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [appJs, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] })
    children.push(child)
    const timer = setTimeout(() => reject(new Error('app start timeout')), 10000)
    let buf = ''
    child.stdout.on('data', (d: Buffer) => { buf += d.toString(); const m = buf.match(/APP_READY (\S+)/); if (m) { clearTimeout(timer); resolve(m[1]!) } })
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
  })
}

describe('T5.1 表单页浏览器交互', () => {
  it.skipIf(!existsSync(CHROME))('打开表单 → 填 Contract → 提交 → 列表出现新行', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'owb-browser-'))
    try {
      const m1 = load(require('node:fs').readFileSync('D:/sharptoolbox/Onto-Model/sample/m1-object-model.yaml', 'utf-8')) as any
      writeModel(join(ws, '.workbuddy', 'ontology', 'demo', 'yaml'), 'm1-object-model.yaml', normalizeObjectModel(m1))
      generateApp(ws, 'demo')
      const base = await startApp(ws)

      const { default: puppeteer } = await import('puppeteer-core')
      const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' })
      try {
        const page = await browser.newPage()
        await page.goto(base + '/', { waitUntil: 'networkidle0', timeout: 20000 })
        // 表单页已渲染 Contract 卡片与输入框
        const inputs = await page.$$('input[data-col]')
        expect(inputs.length).toBeGreaterThan(0)
        // 填 Contract 必填字段
        await page.evaluate(() => {
          const set = (col: string, val: string) => {
            const el = document.querySelector(`input[data-col="${col}"]`) as HTMLInputElement
            if (el) { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })) }
          }
          set('contractNo', 'HT-B1'); set('contractName', '浏览器测试合同'); set('status', '生效')
          set('productId', 'P1'); set('customerId', 'C1'); set('deptId', 'D1'); set('ownerId', 'E1')
          set('signDate', '2026-02-01'); set('totalAmount', '500'); set('purchaseAmount', '400'); set('taxRate', '0.13')
        })
        // 点 Contract 卡片的「新增」按钮
        await page.evaluate(() => {
          const card = [...document.querySelectorAll('.card')].find((c) => c.querySelector('h2')?.textContent?.includes('Contract'))
          const btn = [...card!.querySelectorAll('button')].find((b) => b.textContent?.includes('新增'))
          ;(btn as HTMLButtonElement).click()
        })
        await new Promise((r) => setTimeout(r, 1500))
        // 列表出现新行
        const tableHtml = await page.evaluate(() => {
          const card = [...document.querySelectorAll('.card')].find((c) => c.querySelector('h2')?.textContent?.includes('Contract'))
          return card!.querySelector('table')?.textContent ?? ''
        })
        expect(tableHtml).toContain('HT-B1')
        expect(tableHtml).toContain('浏览器测试合同')
      } finally {
        await browser.close()
      }
    } finally {
      rmSync(ws, { recursive: true, force: true })
    }
  }, 60_000)
})
