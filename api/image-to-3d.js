// /api/image-to-3d.js
// يستقبل صورة base64 ويبعتها لـ WaveSpeed (Hunyuan3D V3.1 Rapid)

export default async function handler(req, res) {
  // ── CORS ──
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

    if (!imageDataUrl) {
      return res.status(400).json({ error: 'لازم تبعت imageDataUrl' });
    }

    // ── رفع الصورة على WaveSpeed Storage أولاً ──
    // تحويل base64 dataURL لـ blob
    const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, '');
    const mimeMatch = imageDataUrl.match(/data:(image\/\w+);base64/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

    // بعت الصورة كـ binary لـ WaveSpeed upload
    const imageBuffer = Buffer.from(base64Data, 'base64');
    const formData = new FormData();
    const blob = new Blob([imageBuffer], { type: mimeType });
    formData.append('file', blob, 'image.jpg');

    const uploadRes = await fetch('https://api.wavespeed.ai/api/v3/files/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${WAVESPEED_API_KEY}` },
      body: formData,
    });

    const uploadData = await uploadRes.json();
    if (!uploadRes.ok) {
      return res.status(uploadRes.status).json({ error: uploadData.message || 'فشل رفع الصورة' });
    }

    const imageUrl = uploadData.data?.url || uploadData.url;
    if (!imageUrl) {
      return res.status(500).json({ error: 'مش لاقي رابط الصورة بعد الرفع' });
    }

    // ── إرسال طلب الـ 3D ──
    const genRes = await fetch('https://api.wavespeed.ai/api/v3/wavespeed-ai/hunyuan-3d-v3.1/image-to-3d-rapid', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WAVESPEED_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image: imageUrl }),
    });

    const genData = await genRes.json();
    if (!genRes.ok) {
      return res.status(genRes.status).json({ error: genData.message || 'WaveSpeed error' });
    }

    // رجّع الـ taskId (prediction id)
    const taskId = genData.data?.id || genData.id;
    return res.status(200).json({ taskId });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
