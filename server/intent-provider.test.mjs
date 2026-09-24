import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildChatCompletionBody,
  createIntentProviderConfig,
  requestIntentEnhancement,
  validateIntentApiInput,
} from './intent-provider.mjs'

const input = {
  rawText: 'RAG با بودجه نامشخص',
  normalizedText: 'rag با بودجه نامشخص',
  ambiguities: ['مقدار بودجه از متن قابل استخراج نیست.'],
}
const schema = { type: 'object', required: ['fields'], properties: { fields: { type: 'object' } } }

test('provider configuration is disabled and local by default', () => {
  const config = createIntentProviderConfig({})
  assert.equal(config.enabled, false)
  assert.equal(config.baseUrl, 'http://127.0.0.1:11434/v1')
  assert.equal(config.apiKey, '')
})

test('provider configuration supports any HTTP OpenAI-compatible endpoint', () => {
  const config = createIntentProviderConfig({
    TOROB_MATCH_INTENT_LLM_ENABLED: 'true',
    TOROB_MATCH_INTENT_LLM_BASE_URL: 'https://api.openai.com/v1/',
    TOROB_MATCH_INTENT_LLM_MODEL: 'example-model',
    TOROB_MATCH_INTENT_LLM_API_KEY: 'secret',
    TOROB_MATCH_INTENT_LLM_FORMAT: 'json_object',
  })
  assert.equal(config.enabled, true)
  assert.equal(config.baseUrl, 'https://api.openai.com/v1')
  assert.equal(config.model, 'example-model')
})

test('API input accepts bounded ambiguity context and rejects malformed input', () => {
  assert.equal(validateIntentApiInput(input), true)
  assert.equal(validateIntentApiInput({ ...input, rawText: '' }), false)
  assert.equal(validateIntentApiInput({ ...input, ambiguities: [] }), false)
})

test('chat request asks for the shared JSON schema without embedding an API key', () => {
  const config = createIntentProviderConfig({
    TOROB_MATCH_INTENT_LLM_ENABLED: 'true',
    TOROB_MATCH_INTENT_LLM_MODEL: 'model',
  })
  const body = buildChatCompletionBody(input, config, schema)
  assert.equal(body.response_format.type, 'json_schema')
  assert.deepEqual(body.response_format.json_schema.schema, schema)
  assert.equal(JSON.stringify(body).includes('apiKey'), false)
})

test('provider parses a structured response and sends authorization only server-side', async () => {
  const config = createIntentProviderConfig({
    TOROB_MATCH_INTENT_LLM_ENABLED: 'true',
    TOROB_MATCH_INTENT_LLM_BASE_URL: 'https://example.test/v1',
    TOROB_MATCH_INTENT_LLM_MODEL: 'model',
    TOROB_MATCH_INTENT_LLM_API_KEY: 'secret',
  })
  let request
  const fetchMock = async (url, init) => {
    request = { url, init }
    return new Response(JSON.stringify({
      choices: [{ message: { content: '```json\n{"fields":{}}\n```' } }],
    }), { status: 200 })
  }
  const result = await requestIntentEnhancement(input, config, schema, fetchMock)
  assert.deepEqual(result, { fields: {} })
  assert.equal(request.url, 'https://example.test/v1/chat/completions')
  assert.equal(request.init.headers.authorization, 'Bearer secret')
})
