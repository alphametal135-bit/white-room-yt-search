// netlify/functions/ai-proxy.js
// Proxy لـ Google Gemini API — بيحل مشكلة CORS من المتصفح

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('ERROR: GEMINI_API_KEY missing');
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'GEMINI_API_KEY غير مضبوط في بيئة Netlify' }),
    };
  }

  try {
    const { prompt } = JSON.parse(event.body);
    console.log('PROMPT LENGTH:', prompt ? prompt.length : 0);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 8192 }
        }),
      }
    );

    console.log('GEMINI HTTP STATUS:', response.status);

    const data = await response.json();
    console.log('GEMINI RAW RESPONSE:', JSON.stringify(data).slice(0, 3000));

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('EXTRACTED TEXT LENGTH:', text.length);

    if (!text) {
      console.log('NO TEXT EXTRACTED - finishReason:', data?.candidates?.[0]?.finishReason, 'promptFeedback:', JSON.stringify(data?.promptFeedback));
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ text }),
    };
  } catch (err) {
    console.log('CATCH ERROR:', err.message);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
