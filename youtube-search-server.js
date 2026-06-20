// ════════════════════════════════════════════════════════════
// THE WHITE ROOM — سيرفر بحث YouTube Playlists (مستقل تماماً)
// وظيفته الوحيدة: استقبال اسم مادة دراسية، والبحث عن أنسب
// قائمة تشغيل (Playlist) عربية تعليمية على يوتيوب وإرجاعها.
// لا علاقة له بنظام تسجيل الدخول أو البيانات (Firebase شغّال
// بكل نظامه زي ما هو، السيرفر ده إضافة بس للبحث).
// ════════════════════════════════════════════════════════════

const express = require('express');
const cors = require('cors');

const PORT = process.env.PORT || 4000;
// ضع مفتاح YouTube Data API v3 هنا (أو في متغير بيئة YOUTUBE_API_KEY)
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || 'ضع_مفتاح_الـ_API_هنا';

const app = express();
app.use(cors());
app.use(express.json());

// كاش بسيط في الذاكرة عشان نقلل عدد طلبات الـ API (الحصة المجانية محدودة يومياً)
const cache = new Map(); // query -> { data, expiresAt }
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 ساعة

function getCached(key) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;
  cache.delete(key);
  return null;
}
function setCached(key, data) {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ── البحث الفعلي عن قائمة تشغيل عبر YouTube Data API v3 ──
async function searchPlaylist(subjectName) {
  const cacheKey = subjectName.trim().toLowerCase();
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const query = `${subjectName} كورس كامل شرح`;
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'playlist');
  url.searchParams.set('maxResults', '5');
  url.searchParams.set('relevanceLanguage', 'ar');
  url.searchParams.set('q', query);
  url.searchParams.set('key', YOUTUBE_API_KEY);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`YouTube API error ${res.status}: ${errBody}`);
  }
  const json = await res.json();
  const items = json.items || [];
  if (items.length === 0) return null;

  // ناخد أول نتيجة (الأكثر صلة حسب ترتيب يوتيوب نفسه)
  const top = items[0];
  const result = {
    playlistId: top.id.playlistId,
    title: top.snippet.title,
    channelTitle: top.snippet.channelTitle,
    thumbnail: (top.snippet.thumbnails && (top.snippet.thumbnails.medium || top.snippet.thumbnails.default) || {}).url || null
  };

  setCached(cacheKey, result);
  return result;
}

// ════════════════ Endpoint الوحيد المطلوب ════════════════
// GET /api/search-playlist?q=اسم المادة
app.get('/api/search-playlist', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'يرجى إرسال اسم المادة عبر ?q=' });

  if (!YOUTUBE_API_KEY || YOUTUBE_API_KEY === 'ضع_مفتاح_الـ_API_هنا') {
    return res.status(500).json({ error: 'لم يتم ضبط مفتاح YouTube API على السيرفر بعد' });
  }

  try {
    const result = await searchPlaylist(q);
    if (!result) return res.status(404).json({ error: 'لم يتم العثور على قائمة تشغيل مناسبة' });
    res.json(result);
  } catch (e) {
    console.error('YouTube search failed:', e.message);
    res.status(502).json({ error: 'فشل البحث في YouTube، حاول لاحقاً' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));

app.listen(PORT, () => console.log(`YouTube playlist search server running on port ${PORT}`));
