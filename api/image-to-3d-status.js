// /api/image-to-3d-status.js
// يتحقق من حالة مهمة WaveSpeed ويرجّع رابط الـ GLB

export default async function handler(req, res) {
  // ── CORS ──
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const WAVESPEED_API_KEY = process.env.WAVESPEED_API_KEY;
  if (!WAVESPEED_API_KEY) {
    return res.status(500).json({ error: 'WAVESPEED_API_KEY غير موجود في إعدادات Vercel' });
  }

  const { taskId } = req.query;
  if (!taskId) {
    return res.status(400).json({ error: 'لازم تبعت taskId' });
  }

  try {
    const pollRes = await fetch(`https://api.wavespeed.ai/api/v3/predictions/${taskId}/result`, {
      headers: { Authorization: `Bearer ${WAVESPEED_API_KEY}` },
    });

    const data = await pollRes.json();
    if (!pollRes.ok) {
      return res.status(pollRes.status).json({ error: data.message || 'WaveSpeed error' });
    }

    // status: pending | processing | completed | failed
    const status = data.data?.status || data.status;
    const outputs = data.data?.outputs || data.outputs || [];
    const glbUrl = outputs[0] || null;

    // تحويل status لنفس format الـ HTML اللي بيتوقعه
    let mappedStatus = 'IN_PROGRESS';
    if (status === 'completed') mappedStatus = 'SUCCEEDED';
    if (status === 'failed')    mappedStatus = 'FAILED';
    if (status === 'pending')   mappedStatus = 'PENDING';

    return res.status(200).json({
      status: mappedStatus,
      progress: status === 'completed' ? 100 : status === 'processing' ? 50 : 0,
      glbUrl,
      thumbnailUrl: null,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
