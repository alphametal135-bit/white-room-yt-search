// مكانه على الفيرسل: /api/image-to-3d.js
// وظيفته: يستقبل الصورة (base64) من الموقع، ويبعتها لـ Meshy عشان يولّد مجسم 3D حقيقي،
// وده لازم يحصل من السيرفر (Vercel function) لأن Meshy ما بيسمحش بنداء مباشر من المتصفح.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const MESHY_API_KEY = process.env.MESHY_API_KEY;
  if (!MESHY_API_KEY) {
    return res.status(500).json({ error: 'MESHY_API_KEY غير موجود في إعدادات Vercel' });
  }

  try {
    const { imageDataUrl } = req.body; // "data:image/png;base64,...."
    if (!imageDataUrl) {
      return res.status(400).json({ error: 'لازم تبعت imageDataUrl' });
    }

    const meshyRes = await fetch('https://api.meshy.ai/openapi/v1/image-to-3d', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MESHY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_url: imageDataUrl, // Meshy بيقبل data URI مباشرة
        enable_pbr: true,
        should_remesh: true,
        should_texture: true,
        target_polycount: 30000,
        // pose_mode: 'a-pose', // مفيد لو الصورة شخص/شخصية وعايز وضعية موحدة للريغ بعدين
      }),
    });

    const data = await meshyRes.json();
    if (!meshyRes.ok) {
      return res.status(meshyRes.status).json({ error: data.message || 'Meshy error' });
    }

    // data = { result: "task_id" }
    return res.status(200).json({ taskId: data.result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
