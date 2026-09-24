import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createIntentProviderConfig,
  requestIntentEnhancementDetailed,
} from '../server/intent-provider.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

function loadEnv(path) {
  const values = {}
  if (!existsSync(path)) return values
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 1) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2')
    values[key] = value
  }
  return values
}

const pricing = {
  'gpt-6-luna': { input: .10, cached: .01, output: .50 },
  'gpt-5.6-luna': { input: .20, cached: .02, output: 1.20 },
  'gpt-5.4-nano': { input: .20, cached: .02, output: 1.25 },
  'gpt-5.6-terra': { input: 2, cached: .20, output: 12 },
  'gpt-5.5': { input: 5, cached: .50, output: 30 },
}

const model = process.argv[2]
if (!model || !pricing[model]) throw new Error(`مدل پشتیبانی‌شده را وارد کنید: ${Object.keys(pricing).join('، ')}`)

const localEnv = loadEnv(join(root, '.env'))
const config = createIntentProviderConfig({
  ...process.env,
  ...localEnv,
  TOROB_MATCH_INTENT_LLM_ENABLED: 'true',
  TOROB_MATCH_INTENT_LLM_BASE_URL: 'https://api.openai.com/v1',
  TOROB_MATCH_INTENT_LLM_MODEL: model,
  TOROB_MATCH_INTENT_LLM_REASONING_EFFORT: 'none',
})
if (!config.apiKey) throw new Error('کلید API در فایل .env پیدا نشد.')

const scenarios = JSON.parse(readFileSync(join(root, 'data', 'intent-scenarios.json'), 'utf8'))
const expectedById = JSON.parse(readFileSync(join(root, 'data', 'intent-llm-eval-expected.json'), 'utf8'))
const schema = JSON.parse(readFileSync(join(root, 'data', 'intent-enhancer-schema.json'), 'utf8'))

const rows = []
for (const scenario of scenarios) {
  const expected = expectedById[scenario.id]
  const paths = Object.keys(expected)
  const started = performance.now()
  const { output, usage } = await requestIntentEnhancementDetailed({
    rawText: scenario.text,
    normalizedText: scenario.text,
    ambiguities: [`فقط این فیلدهای صریح را بررسی کن: ${paths.join('، ')}`],
  }, config, schema)
  const elapsedMs = Math.round(performance.now() - started)
  const actual = Object.fromEntries(Object.entries(output.fields ?? {}).map(([path, suggestion]) => [path, suggestion?.value]))
  const correct = paths.filter(path => Object.hasOwn(actual, path) && actual[path] === expected[path])
  const missing = paths.filter(path => !Object.hasOwn(actual, path))
  const incorrect = paths.filter(path => Object.hasOwn(actual, path) && actual[path] !== expected[path])
  const unexpected = Object.keys(actual).filter(path => !Object.hasOwn(expected, path))
  const promptTokens = usage?.prompt_tokens ?? 0
  const cachedTokens = usage?.prompt_tokens_details?.cached_tokens ?? 0
  const completionTokens = usage?.completion_tokens ?? 0
  const rates = pricing[model]
  const costUsd = ((promptTokens - cachedTokens) * rates.input + cachedTokens * rates.cached + completionTokens * rates.output) / 1_000_000
  const row = {
    id: scenario.id,
    elapsed_ms: elapsedMs,
    usage: { prompt_tokens: promptTokens, cached_tokens: cachedTokens, completion_tokens: completionTokens },
    cost_usd: costUsd,
    expected,
    actual,
    correct,
    missing,
    incorrect,
    unexpected,
  }
  rows.push(row)
  console.log(`${scenario.id}: ${correct.length}/${paths.length} correct, $${costUsd.toFixed(6)}, ${elapsedMs}ms`)
}

const totalExpected = rows.reduce((sum, row) => sum + Object.keys(row.expected).length, 0)
const totalCorrect = rows.reduce((sum, row) => sum + row.correct.length, 0)
const totalUnexpected = rows.reduce((sum, row) => sum + row.unexpected.length, 0)
const totalCost = rows.reduce((sum, row) => sum + row.cost_usd, 0)
const totalPromptTokens = rows.reduce((sum, row) => sum + row.usage.prompt_tokens, 0)
const totalCachedTokens = rows.reduce((sum, row) => sum + row.usage.cached_tokens, 0)
const totalCompletionTokens = rows.reduce((sum, row) => sum + row.usage.completion_tokens, 0)
const summary = {
  model,
  scenarios: rows.length,
  exact_field_accuracy: totalCorrect / totalExpected,
  correct_fields: totalCorrect,
  expected_fields: totalExpected,
  unexpected_fields: totalUnexpected,
  average_latency_ms: Math.round(rows.reduce((sum, row) => sum + row.elapsed_ms, 0) / rows.length),
  usage: {
    prompt_tokens: totalPromptTokens,
    cached_tokens: totalCachedTokens,
    completion_tokens: totalCompletionTokens,
  },
  cost_usd: totalCost,
  average_cost_usd: totalCost / rows.length,
}

const reportPath = join(root, 'test-results', `openai-intent-${model}.json`)
mkdirSync(dirname(reportPath), { recursive: true })
writeFileSync(reportPath, JSON.stringify({ summary, rows }, null, 2))
console.log(JSON.stringify(summary, null, 2))
console.log(`Report: ${reportPath}`)
