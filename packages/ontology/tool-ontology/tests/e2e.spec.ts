/**
 * 端到端测试（T3.x）：真实 Agent Loop 会话中工具可被调用、结果进会话、产物落盘。
 *
 * T3.1：mock adapter 驱动 AI 调用 tool-ontology 工具（可控，验证架构正确性）。
 * T3.2：真实 LLM（火山方舟 deepseek-v4-flash）会话中 AI 自主完成建模全链路。
 */
import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as ToolOntology from '../src/index.js'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

function findEvent<T extends SessionEvent['type']>(log: readonly SessionEvent[], type: T): Extract<SessionEvent, { type: T }> {
  const found = log.find((e) => e.type === type)
  if (!found) throw new Error(`no ${type} event`)
  return found as Extract<SessionEvent, { type: T }>
}

async function harness() {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ToolOntology)
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { dispose(); resolve() }
    })
  })
}

describe('T3.1 工具在真实 Agent Loop 中被调用（mock LLM）', () => {
  it('AI 依次调用 ontology_model(list→write两步→app_generate)，产物落盘、结果进会话', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'owb-e2e-'))
    const ctx = await harness()
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      // 1) list 模型
      toolCallResponse('c1', 'ontology_model', { project: 'demo', action: 'list', workspaceDir: ws }),
      // 2) write m1 第一步（未确认）
      toolCallResponse('c2', 'ontology_model', { project: 'demo', action: 'write', modelKey: 'objectModel', workspaceDir: ws, data: loadSample('m1-object-model.yaml') }),
      // 3) write m1 第二步（confirmed）
      toolCallResponse('c3', 'ontology_model', { project: 'demo', action: 'write', modelKey: 'objectModel', workspaceDir: ws, data: loadSample('m1-object-model.yaml'), confirmed: true }),
      // 4) 生成应用
      toolCallResponse('c4', 'app_generate', { project: 'demo', workspaceDir: ws }),
      textResponse('建模完成'),
    ]))
    const agent = ctx.agentLoop.create(SessionId('it-owb-mock'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: '为 demo 项目建模并生成应用' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const log = agent.session.events
    const calls = log.filter((e) => e.type === 'tool/call').map((e: any) => e.data.name)
    expect(calls).toEqual(['ontology_model', 'ontology_model', 'ontology_model', 'app_generate'])
    // 所有 tool/result 非错误
    const results = log.filter((e) => e.type === 'tool/result')
    expect(results.length).toBe(4)
    for (const r of results) expect((r as any).data.message.content[0]?.isError).toBe(false)
    // 产物落盘
    const yamlDir = join(ws, '.workbuddy', 'ontology', 'demo', 'yaml')
    expect(readdirSync(yamlDir)).toContain('m1-object-model.yaml')
    const appDir = join(ws, '.workbuddy', 'ontology', 'demo', 'app')
    expect(readdirSync(appDir)).toEqual(expect.arrayContaining(['app.cjs', 'index.html']))
    rmSync(ws, { recursive: true, force: true })
  })
})

/** 读取真实 sample 模型（fixture） */
function loadSample(name: string): any {
  const { load } = require('js-yaml') as typeof import('js-yaml')
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  return load(readFileSync(`D:/sharptoolbox/Onto-Model/sample/${name}`, 'utf-8'))
}
