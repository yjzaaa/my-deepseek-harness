/**
 * T3.2 真实 LLM 端到端（关键）：火山方舟 deepseek-v4-flash 会话中，
 * AI 自主调用 tool-ontology 完成「建模 → 校验 → 图谱数据」。
 *
 * 真实模型行为有随机性，采用「最小模型引导」避免超大工具参数，断言取关键不变量：
 * 建模工具被真实调用、至少对象模型落盘、图谱数据生成、校验被调用。
 * 未配置 ARK_API_KEY 时跳过。
 */
import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DeepSeekAdapter, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import * as ToolOntology from '../src/index.js'

const ARK_KEY = process.env.ARK_API_KEY ?? ''
const ARK_BASE = process.env.ARK_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/plan/v3'
const ARK_MODEL = process.env.ARK_MODEL ?? 'deepseek-v4-flash'

async function harness(ctx: Context) {
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ToolOntology)
  const connection = resolveAdapterOptions({ baseURL: ARK_BASE, reasoningEffort: 'off', models: [{ id: ARK_MODEL }] })
  const adapter = new DeepSeekAdapter({
    options: () => connection,
    resolveApiKey: async () => ARK_KEY,
    resolveUserId: () => 'test-owb',
  })
  ctx.llm.registerAdapter(['deepseek'], adapter)
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { dispose(); resolve() }
    })
  })
}

describe('T3.2 真实 LLM 建模全链路', () => {
  it.skipIf(!ARK_KEY)('AI 自主建最小模型并校验、生成图谱数据', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'owb-e2e-real-'))
    const ctx = new Context()
    await harness(ctx)
    const agent = ctx.agentLoop.create(SessionId('it-owb-real'), { provider: 'deepseek', model: ARK_MODEL })
    agent.followup(createUserMessage({
      content: [{
        type: 'text',
        text: `你是业务人员。请用 tool-ontology 工具为项目 demo（workspaceDir=${ws}）建一个最小模型：
1. ontology_model action=write modelKey=objectModel：M1 含 1 个聚合 Equipment（aggregates[].rootEntity.alias=Equipment，rootEntity.attributes 含 code 必填唯一、name 必填、status 枚举），model_type=AGGREGATE_OBJECT。第一次 write 返回 confirmSummary 后，用 confirmed:true 二次 write 落盘。
2. 再 write m2-behaviorModel（1 个行为 B1，ownerEntity=Equipment）、m3-ruleModel（1 条规则 R1）、m5-actorModel（1 个角色 ROLE1）。
3. ontology_validate 校验。
4. 汇报：建了几个模型、校验结果。保持每个模型精简。`,
      }],
      source: { kind: 'user' },
    }))
    await waitForIdle(ctx, agent)

    const log = agent.session.events
    const calls = log.filter((e) => e.type === 'tool/call').map((e: any) => e.data.name)
    // 关键不变量：建模与校验工具被真实调用
    expect(calls).toContain('ontology_model')
    expect(calls).toContain('ontology_validate')

    // 至少对象模型落盘
    const yamlDir = join(ws, '.workbuddy', 'ontology', 'demo', 'yaml')
    expect(existsSync(yamlDir)).toBe(true)
    const yamlFiles = readdirSync(yamlDir)
    expect(yamlFiles).toContain('m1-object-model.yaml')

    // 图谱数据生成（每次 write 自动重建）
    expect(existsSync(join(ws, '.workbuddy', 'ontology', 'demo', 'knowledge-graph-data.json'))).toBe(true)

    rmSync(ws, { recursive: true, force: true })
  }, 300_000)
})
