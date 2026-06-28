// مكانه على الفيرسل: /api/image-to-3d-status.js
// وظيفته: يسأل Meshy "خلصت ولا لسه؟" وعند الانتهاء يرجّع رابط ملف الـ GLB.

export default async function handler(req, res) {
  const MESHY_API_KEY = process.env.MESHY_API_KEY;
  if (!MESHY_API_KEY) {
    return res.status(500).json({ error: 'MESHY_API_KEY غير موجود في إعدادات Vercel' });
  }

  const { taskId } = req.query;
  if (!taskId) {
    return res.status(400).json({ error: 'لازم تبعت taskId' });
  }

  try {
    const meshyRes = await fetch(`https://api.meshy.ai/openapi/v1/image-to-3d/${taskId}`, {
      headers: { Authorization: `Bearer ${MESHY_API_KEY}` },
    });
    const data = await meshyRes.json();
    if (!meshyRes.ok) {
      return res.status(meshyRes.status).json({ error: data.message || 'Meshy error' });
    }

    return res.status(200).json({
      status: data.status, // PENDING | IN_PROGRESS | SUCCEEDED | FAILED
      progress: data.progress,
      glbUrl: data.model_urls ? data.model_urls.glb : null,
      thumbnailUrl: data.thumbnail_url || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
