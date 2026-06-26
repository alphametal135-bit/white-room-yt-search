// api/ai-proxy.js
// ════════════════════════════════════════════════════════
// AI Proxy (نسخة Vercel) — يجرب الـ providers بالترتيب:
//   1. Anthropic (Claude Haiku)
//   2. Gemini
//   3. Cloudflare Workers AI
// ════════════════════════════════════════════════════════

function setHeaders(res, origin) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  // ❌ حذفنا Allow-Credentials — كانت invalid مع Allow-Origin: *
}

// timeout = 8s عشان Vercel Hobby plan الحد الأقصى 10s
function fetchWithTimeout(url, options, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ── 1) Anthropic — بيجرب كل المفاتيح بالترتيب ────────
// الأولوية:
//   1. ANTHROPIC_API_KEY  (الرئيسي)
//   2. zaatar             (الثاني)
//   3. ANTHROPIC_KEY_1, ANTHROPIC_KEY_2, ... (أي مفتاح تضيفه على Vercel باسم ANTHROPIC_KEY_*)
// عشان تضيف مفتاح جديد: روح Vercel Dashboard وضيف env var اسمه ANTHROPIC_KEY_3 مثلاً — بيتلاقى تلقائياً
async function tryAnthropic(prompt) {
  const extraKeys = Object.entries(process.env)
    .filter(([k]) => k.startsWith('ANTHROPIC_KEY_'))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);

  const keys = [
    process.env.ANTHROPIC_API_KEY,
    process.env.zaatar,
    ...extraKeys,
  ].filter(Boolean);

  if (!keys.length) return null;

  for (const key of keys) {
    try {
      const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      const data = await res.json();

      if (res.ok) {
        const text = data?.content?.[0]?.text || '';
        return text ? { text, model: 'claude-haiku' } : null;
      }

      // لو quota أو rate limit → جرب المفتاح الجاي
      const errMsg = data?.error?.message || '';
      const isQuota = res.status === 429
        || errMsg.includes('quota')
        || errMsg.includes('rate')
        || errMsg.includes('overloaded');

      if (isQuota) {
        console.warn('Anthropic key quota exceeded, trying next key...');
        continue;
      }

      // أي error تاني (مفتاح غلط، etc.) → وقف
      console.warn('Anthropic error:', res.status, errMsg);
      return null;

    } catch(e) {
      console.warn('Anthropic fetch error:', e.message);
      // timeout أو network error → جرب المفتاح الجاي
      continue;
    }
  }

  return null;
}

// ── 2) Gemini ──────────────────────────────────────────
async function tryGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const models = ['gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-2.0-flash'];

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    try {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
        }),
      });
      const data = await res.json();

      if (res.ok) {
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return text ? { text, model } : null;
      }

      const errMsg = data?.error?.message || '';
      const isQuota = errMsg.includes('quota') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('429');
      if (!isQuota) break;
      console.warn(`Gemini ${model} quota exceeded, trying next...`);
    } catch(e) {
      console.warn(`Gemini ${model} error:`, e.message);
      continue;
    }
  }
  return null;
}

// ── 3) Cloudflare Workers AI ───────────────────────────
async function tryCloudflare(prompt) {
  const token = process.env.CLOUDFLARE_AI_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) return null;

  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/meta/llama-3.1-8b-instruct`;
    const res = await fetchWithTimeout(url, {
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
    const data = await res.json();

    if (!res.ok || !data?.result?.response) {
      console.warn('Cloudflare AI failed:', data?.errors);
      return null;
    }
    return { text: data.result.response, model: 'llama-3.1-8b' };
  } catch(e) {
    console.warn('Cloudflare fetch error:', e.message);
    return null;
  }
}

// ── Handler الرئيسي ────────────────────────────────────
module.exports = async (req, res) => {
  const origin = req.headers.origin || '*';
  setHeaders(res, origin);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  let prompt;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    prompt = body.prompt;
  } catch {
    return res.status(400).json({ error: 'JSON غلط في الـ body' });
  }

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt مش موجود أو فاضي' });
  }

  try {
    const result =
      (await tryAnthropic(prompt)) ||
      (await tryGemini(prompt)) ||
      (await tryCloudflare(prompt));

    if (result) {
      return res.status(200).json(result);
    }

    return res.status(503).json({ error: 'كل الـ AI providers مش متاحة' });
  } catch (err) {
    console.error('Proxy error:', err.message);
    return res.status(500).json({ error: 'خطأ داخلي: ' + err.message });
  }
};
