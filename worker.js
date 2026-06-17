export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return handleAPI(request, env, url);
    }
    return env.ASSETS.fetch(request);
  }
};

async function handleAPI(request, env, url) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') return new Response(null, { headers });

  const isSupport = url.pathname.startsWith('/api/support/');
  const KV_KEY = isSupport ? 'support_meetings' : 'meetings';
  const basePath = isSupport ? '/api/support' : '/api';
  const meetingsPath = basePath + '/meetings';

  try {
    // GET /meetings - 全取得
    if (url.pathname === meetingsPath && request.method === 'GET') {
      const data = await env.HAIYO_KV.get(KV_KEY, 'json') || {};
      return new Response(JSON.stringify(data), { headers });
    }

    // GET /meetings/:id
    if (url.pathname.startsWith(meetingsPath + '/') && request.method === 'GET') {
      const parts = url.pathname.replace(meetingsPath + '/', '').split('/');
      const id = parts[0];
      const data = await env.HAIYO_KV.get(KV_KEY, 'json') || {};
      const meeting = data[id];
      if (!meeting) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers });
      return new Response(JSON.stringify(meeting), { headers });
    }

    // POST /meetings - 作成
    if (url.pathname === meetingsPath && request.method === 'POST') {
      const meeting = await request.json();
      const data = await env.HAIYO_KV.get(KV_KEY, 'json') || {};
      data[meeting.id] = meeting;
      await env.HAIYO_KV.put(KV_KEY, JSON.stringify(data));
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    // POST /meetings/:id/records - 1件追記（競合防止）
    if (url.pathname.match(new RegExp(`^${meetingsPath}/[^/]+/records$`)) && request.method === 'POST') {
      const id = url.pathname.replace(meetingsPath + '/', '').split('/')[0];
      const record = await request.json();
      // リトライ付きで追記
      for (let i = 0; i < 3; i++) {
        const data = await env.HAIYO_KV.get(KV_KEY, 'json') || {};
        if (!data[id]) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers });
        // 二重登録チェック（サーバーサイド）
        const records = data[id].records || [];
        const dup = records.find(r => r.name === record.name && r.childName === record.childName);
        if (dup) return new Response(JSON.stringify({ error: 'duplicate' }), { status: 409, headers });
        records.push(record);
        data[id].records = records;
        // attendeesも更新
        if (record.status === '出席' && record.cls && record.cls !== 'なし') {
          data[id].attendees = data[id].attendees || {};
          const cls = record.cls.split('・')[0];
          data[id].attendees[cls] = (data[id].attendees[cls] || 0) + 1;
        }
        try {
          await env.HAIYO_KV.put(KV_KEY, JSON.stringify(data));
          return new Response(JSON.stringify({ ok: true, record }), { headers });
        } catch (e) {
          if (i === 2) throw e;
          await new Promise(r => setTimeout(r, 100));
        }
      }
    }

    // PUT /meetings/:id - メタ情報更新（memo, date, title等）
    if (url.pathname.startsWith(meetingsPath + '/') && request.method === 'PUT') {
      const id = url.pathname.replace(meetingsPath + '/', '').split('/')[0];
      const update = await request.json();
      const data = await env.HAIYO_KV.get(KV_KEY, 'json') || {};
      if (!data[id]) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers });
      // recordsの上書きは受け付けない（追記エンドポイントを使う）
      const { records, ...safeUpdate } = update;
      data[id] = { ...data[id], ...safeUpdate };
      await env.HAIYO_KV.put(KV_KEY, JSON.stringify(data));
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    // DELETE /meetings/:id
    if (url.pathname.startsWith(meetingsPath + '/') && request.method === 'DELETE') {
      const id = url.pathname.replace(meetingsPath + '/', '').split('/')[0];
      const data = await env.HAIYO_KV.get(KV_KEY, 'json') || {};
      delete data[id];
      await env.HAIYO_KV.put(KV_KEY, JSON.stringify(data));
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
