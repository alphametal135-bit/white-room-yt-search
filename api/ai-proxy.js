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
}

function fetchWithTimeout(url, options, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ── يدور على أول content block من نوع "text" بدل ما يفترض إنه content[0] دايماً ──
// (لو الموديل رجّع أكتر من block، أو أول block مش نصي لأي سبب، القديم كان بيرجّع فاضي)
function extractAnthropicText(data) {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const textBlock = blocks.find(b => b && b.type === 'text' && typeof b.text === 'string' && b.text.trim());
  return textBlock ? textBlock.text : '';
}

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

  let lastErr = '';

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
          max_tokens: 4096, // كان 1024 وده كان بيقطع رد الـ JSON لو الأسئلة كتير
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      const data = await res.json().catch(() => null);

      if (res.ok) {
        const text = extractAnthropicText(data);
        if (text) return { text, model: 'claude-haiku' };
        // نجح الطلب لكن مفيش نص — نسجل السبب ونكمل على المفتاح اللي بعده
        lastErr = 'رد ناجح لكن من غير نص (شكل content غير متوقع)';
        continue;
      }

      const errMsg = data?.error?.message || `HTTP ${res.status}`;
      lastErr = errMsg;

      const isQuota = res.status === 429
        || res.status === 529
        || res.status === 400 // ✅ credit balance too low بيرجع كـ 400 مش 429
        || errMsg.includes('quota')
        || errMsg.includes('rate')
        || errMsg.includes('overloaded')
        || errMsg.includes('credit')
        || errMsg.includes('balance')
        || errMsg.includes('low');

      if (isQuota) {
        console.warn('Anthropic key quota/credit exceeded, trying next key...', errMsg);
        continue; // ✅ يجرب المفتاح اللي بعده بدل ما يوقف على أول مفتاح فاضي
      }

      console.warn('Anthropic error:', res.status, errMsg);
      // خطأ مش متعلق بالكوتة (زي prompt غلط) — مفيش داعي نكمل بمفاتيح تانية
      return null;

    } catch(e) {
      lastErr = e.message;
      console.warn('Anthropic fetch error:', e.message);
      continue;
    }
  }

  console.warn('Anthropic: كل المفاتيح فشلت، آخر سبب:', lastErr);
  return null;
}

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
      const data = await res.json().catch(() => null);

      if (res.ok) {
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (text) return { text, model };
        continue;
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
    const data = await res.json().catch(() => null);

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

    // ✅ بدل ما نرجع رسالة عمومية، نوضح إن كل الـ providers اتفشلوا
    // (مفيد جداً وقت الدباجينج بدل "مش متاحة" بس)
    return res.status(503).json({ error: 'كل الـ AI providers فشلت (Anthropic + Gemini + Cloudflare) — راجع الـ logs على Vercel لمعرفة السبب بالتفصيل لكل واحد' });
  } catch (err) {
    console.error('Proxy error:', err.message);
    return res.status(500).json({ error: 'خطأ داخلي: ' + err.message });
  }
};
