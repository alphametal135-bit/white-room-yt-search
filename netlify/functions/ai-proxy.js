// netlify/functions/ai-proxy.js
// ════════════════════════════════════════════════════════
// AI Proxy — بيجرب الـ providers بالترتيب:
//   1. Anthropic (Claude)
//   2. Gemini
//   3. Cloudflare Workers AI
//
// Environment Variables المطلوبة في Netlify Dashboard:
//   ANTHROPIC_API_KEY   ← مفتاح Claude (اختياري لو مش عندك)
//   GEMINI_API_KEY      ← مفتاح Gemini
//   CLOUDFLARE_AI_TOKEN ← توكن Cloudflare
//   CLOUDFLARE_ACCOUNT_ID ← Account ID بتاعك في Cloudflare
//   ALLOWED_ORIGIN      ← رابط موقعك (مثال: https://your-site.netlify.app)
// ════════════════════════════════════════════════════════

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*'; // ← حدد دومينك هنا

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Timeout helper — يقفل الـ fetch بعد عدد ثواني معين
function fetchWithTimeout(url, options, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

// ── 1) Anthropic (Claude) ──────────────────────────────
async function tryAnthropic(prompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const res = await fetchWithTimeout(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // أسرع موديل وأرخص
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    }
  );

  const data = await res.json();
  if (!res.ok) {
    console.warn('Anthropic error:', data?.error?.message);
    return null;
  }

  const text = data?.content?.[0]?.text || '';
  return text ? { text, model: 'claude-haiku' } : null;
}

// ── 2) Gemini ──────────────────────────────────────────
async function tryGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const models = ['gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-2.0-flash'];

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    let res, data;
    try {
      res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
        }),
      });
      data = await res.json();
    } catch (e) {
      console.warn(`Gemini ${model} fetch error:`, e.message);
      continue; // جرب الموديل اللي بعده
    }

    if (res.ok) {
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return text ? { text, model } : null;
    }

    const errMsg = data?.error?.message || '';
    const isQuota = errMsg.includes('quota') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('429');
    if (!isQuota) {
      // خطأ مش بسبب quota — مش هينفع نجرب موديل تاني
      console.warn(`Gemini ${model} failed (non-quota):`, errMsg);
      break;
    }
    // quota error → جرب الموديل اللي بعده
    console.warn(`Gemini ${model} quota exceeded, trying next...`);
  }

  return null;
}

// ── 3) Cloudflare Workers AI ───────────────────────────
async function tryCloudflare(prompt) {
  const token = process.env.CLOUDFLARE_AI_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) return null;

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/meta/llama-3.1-8b-instruct`;
  let res, data;
  try {
    res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2048,
      }),
    });
    data = await res.json();
  } catch (e) {
    console.warn('Cloudflare fetch error:', e.message);
    return null;
  }

  if (!res.ok || !data?.result?.response) {
    console.warn('Cloudflare AI failed:', data?.errors);
    return null;
  }

  return { text: data.result.response, model: 'llama-3.1-8b' };
}

// ── Handler الرئيسي ────────────────────────────────────
exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  let prompt;
  try {
    ({ prompt } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'JSON غلط في الـ body' }) };
  }

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'prompt مش موجود أو فاضي' }) };
  }

  try {
    // جرب كل provider بالترتيب
    const result =
      (await tryAnthropic(prompt)) ||
      (await tryGemini(prompt)) ||
      (await tryCloudflare(prompt));

    if (result) {
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify(result) };
    }

    return {
      statusCode: 503,
      headers: HEADERS,
      body: JSON.stringify({ error: 'كل الـ AI providers مش متاحة دلوقتي، جرب تاني بعد شوية' }),
    };

  } catch (err) {
    console.error('Proxy unexpected error:', err.message);
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: 'خطأ داخلي في السيرفر' }),
    };
  }
};
