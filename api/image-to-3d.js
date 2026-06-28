// /api/image-to-3d.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const WAVESPEED_API_KEY = process.env.WAVESPEED_API_KEY;
  if (!WAVESPEED_API_KEY) {
    return res.status(500).json({ error: 'WAVESPEED_API_KEY غير موجود في إعدادات Vercel' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { imageDataUrl } = body;

    if (!imageDataUrl || typeof imageDataUrl !== 'string') {
      return res.status(400).json({ error: 'لازم تبعت imageDataUrl' });
    }

    // WaveSpeed بيقبل data URI مباشرة
    const genRes = await fetch(
      'https://api.wavespeed.ai/api/v3/wavespeed-ai/hunyuan-3d-v3.1/image-to-3d-rapid',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${WAVESPEED_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: imageDataUrl }),
      }
    );

    const genData = await genRes.json();

    if (!genRes.ok) {
      return res.status(genRes.status).json({
        error: genData?.message || genData?.detail || JSON.stringify(genData)
      });
    }

    const taskId = genData?.data?.id || genData?.id;
    if (!taskId) {
      return res.status(500).json({ error: 'مش لاقي task ID: ' + JSON.stringify(genData) });
    }

    return res.status(200).json({ taskId });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
