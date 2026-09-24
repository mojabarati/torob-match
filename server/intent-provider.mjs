const SYSTEM_PROMPT = `تو فقط ابهام‌های استخراج معیار جست‌وجوی دوره در ترب مچ را تکمیل می‌کنی.
فقط JSON مطابق schema برگردان. واقعیت تازه نساز و فقط چیزی را پیشنهاد بده که از متن صریح یا به‌وضوح قابل استنباط است.
مقادیر بودجه به تومان، زمان هفتگی به ساعت و مهلت به هفته هستند.
اگر ابهامی قابل رفع نیست، fields را خالی برگردان. متن قطعی parser را تغییر نده.`

const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value)

export function createIntentProviderConfig(env = process.env) {
  const enabled = env.TOROB_MATCH_INTENT_LLM_ENABLED === 'true'
  const baseUrl = env.TOROB_MATCH_INTENT_LLM_BASE_URL || 'http://127.0.0.1:11434/v1'
  const model = env.TOROB_MATCH_INTENT_LLM_MODEL || ''
  const format = env.TOROB_MATCH_INTENT_LLM_FORMAT || 'json_schema'
  const timeoutMs = Number(env.TOROB_MATCH_INTENT_LLM_TIMEOUT_MS || 12_000)
  if (!['json_schema', 'json_object', 'none'].includes(format)) throw new Error('فرمت خروجی LLM معتبر نیست.')
  if (!Number.isFinite(timeoutMs) || timeoutMs < 500 || timeoutMs > 120_000) throw new Error('زمان انتظار LLM باید بین ۵۰۰ تا ۱۲۰٬۰۰۰ میلی‌ثانیه باشد.')
  const parsedUrl = new URL(baseUrl)
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('نشانی LLM باید HTTP یا HTTPS باشد.')
  if (enabled && !model) throw new Error('برای فعال‌کردن LLM باید نام مدل تنظیم شود.')
  return {
    enabled,
    baseUrl: parsedUrl.toString().replace(/\/$/, ''),
    model,
    apiKey: env.TOROB_MATCH_INTENT_LLM_API_KEY || '',
    format,
    timeoutMs,
  }
}

export function validateIntentApiInput(value) {
  if (!isRecord(value)) return false
  if (typeof value.rawText !== 'string' || value.rawText.length < 1 || value.rawText.length > 1_000) return false
  if (typeof value.normalizedText !== 'string' || value.normalizedText.length > 1_000) return false
  if (!Array.isArray(value.ambiguities) || value.ambiguities.length < 1 || value.ambiguities.length > 20) return false
  return value.ambiguities.every(item => typeof item === 'string' && item.length <= 300)
}

export function buildChatCompletionBody(input, config, schema) {
  const body = {
    model: config.model,
    temperature: 0,
    stream: false,
    max_tokens: 700,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          text_fa: input.rawText,
          normalized_text: input.normalizedText,
          unresolved_ambiguities: input.ambiguities,
        }),
      },
    ],
  }
  if (config.format === 'json_schema') {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'torob_match_intent_enhancement', strict: false, schema },
    }
  } else if (config.format === 'json_object') {
    body.response_format = { type: 'json_object' }
  }
  return body
}

function parseAssistantJson(content) {
  const cleaned = content.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  return JSON.parse(cleaned)
}

export async function requestIntentEnhancement(input, config, schema, fetchImpl = fetch) {
  if (!config.enabled) throw new Error('INTENT_PROVIDER_DISABLED')
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs)
  try {
    const headers = { 'content-type': 'application/json' }
    if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`
    const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildChatCompletionBody(input, config, schema)),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`INTENT_PROVIDER_HTTP_${response.status}`)
    const raw = await response.text()
    if (raw.length > 1_000_000) throw new Error('INTENT_PROVIDER_RESPONSE_TOO_LARGE')
    const envelope = JSON.parse(raw)
    const content = envelope?.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Error('INTENT_PROVIDER_MISSING_CONTENT')
    return parseAssistantJson(content)
  } finally {
    clearTimeout(timeoutId)
  }
}
