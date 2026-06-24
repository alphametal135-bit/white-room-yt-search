// netlify/functions/ai-proxy.js

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: 'Method Not Allowed' };
  }

  try {
    const { prompt } = JSON.parse(event.body);
    if (!prompt) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'prompt مش موجود' }) };
    }

    // أول حاجة جرب Gemini
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      const geminiModels = ['gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-2.0-flash'];
      for (const model of geminiModels) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 8192 }
          }),
        });
        const data = await res.json();
        if (res.ok) {
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ text, model }) };
        }
        const errMsg = data?.error?.message || '';
        if (!errMsg.includes('quota') && !errMsg.includes('RESOURCE_EXHAUSTED') && !errMsg.includes('429')) break;
      }
    }

    // لو Gemini فشل، جرب Cloudflare Workers AI
    const cfToken = process.env.CLOUDFLARE_AI_TOKEN;
    const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (cfToken && cfAccountId) {
      const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/ai/run/@cf/meta/llama-3.1-8b-instruct`;
      const res = await fetch(cfUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cfToken}`
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 2048
        }),
      });
      const data = await res.json();
      if (res.ok && data?.result?.response) {
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ text: data.result.response, model: 'llama-3.1-8b' }) };
      }
    }

    return {
      statusCode: 429,
      headers: HEADERS,
      body: JSON.stringify({ error: 'كل الـ AI providers مش متاحة دلوقتي، جرب تاني بعد شوية' }),
    };

  } catch (err) {
    console.error('proxy error:', err.message);
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
