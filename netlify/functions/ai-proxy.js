// netlify/functions/ai-proxy.js

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MODELS = [
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash-8b',
  'gemini-1.5-flash',
  'gemini-2.0-flash',
];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: 'GEMINI_API_KEY غير موجود في Netlify Environment Variables' }),
    };
  }

  try {
    const { prompt } = JSON.parse(event.body);
    if (!prompt) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'prompt مش موجود' }) };
    }

    let lastError = '';

    for (const model of MODELS) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

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
        return {
          statusCode: 200,
          headers: HEADERS,
          body: JSON.stringify({ text, model }),
        };
      }

      lastError = data?.error?.message || `${model} failed`;
      console.warn(`Model ${model} failed:`, lastError);

      if (!lastError.includes('quota') && !lastError.includes('RESOURCE_EXHAUSTED') && !lastError.includes('429')) {
        break;
      }
    }

    return {
      statusCode: 429,
      headers: HEADERS,
      body: JSON.stringify({ error: lastError }),
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
