/**
 * Agenda do quiz integrada ao Google Agenda (service account).
 *   POST /api/gcal { action: 'route' | 'slots' | 'book' | 'info', ... }
 *
 * - slots: lê o free/busy da agenda real e devolve só horários livres
 * - book:  revalida o horário e cria o evento na agenda (nome, WhatsApp e
 *          resultado do quiz na descrição)
 * - info:  dados do evento pra página call.html
 * Mesmo contrato que o front já usava com /api/agenda.
 *
 * Env:
 *   GCAL_SERVICE_ACCOUNT_JSON — JSON completo da chave da service account
 *   GCAL_CALENDAR_ID          — e-mail da agenda compartilhada com a service account
 *   GCAL_MEET_URL             — (opcional) link fixo de reunião (Google Meet)
 * Sem as duas primeiras, responde not_configured e o front usa a agenda local.
 */
import { createSign } from 'node:crypto';

const TZ = 'America/Sao_Paulo';
const OFFSET = '-03:00';              // Brasil sem horário de verão desde 2019
const OFFSET_MS = 3 * 3600 * 1000;
const DIAS_SEMANA = [1, 2, 3, 4, 5];  // 0=dom ... 6=sáb
const HORARIOS = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00'];
const DURACAO_MIN = 30;
const DIAS_ADIANTE = 14;
const MIN_HORAS = 3;

const CAL_ID = process.env.GCAL_CALENDAR_ID || '';
const MEET = /^https:\/\//.test(process.env.GCAL_MEET_URL || '') ? process.env.GCAL_MEET_URL : '';

const pad = (n) => String(n).padStart(2, '0');
const txt = (v, max = 200) => String(v ?? '').slice(0, max);

function brtParts(ms) {
  const d = new Date(ms - OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: d.getUTCDay(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
}
const slotMs = (date, hora) => Date.parse(`${date}T${hora}:00${OFFSET}`);

function candidatos(nowMs) {
  const out = [];
  const hoje = brtParts(nowMs);
  for (let i = 0; i <= DIAS_ADIANTE; i++) {
    const dt = new Date(Date.UTC(hoje.y, hoje.m - 1, hoje.d + i));
    if (!DIAS_SEMANA.includes(dt.getUTCDay())) continue;
    const date = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
    for (const hora of HORARIOS) {
      const ms = slotMs(date, hora);
      if (ms >= nowMs + MIN_HORAS * 3600000) out.push({ date, hora, ms });
    }
  }
  return out;
}

/* ---------- auth: JWT RS256 da service account → access token ---------- */
let cached = { token: '', exp: 0 };
async function getToken() {
  if (cached.token && Date.now() < cached.exp - 60000) return cached.token;
  const sa = JSON.parse(process.env.GCAL_SERVICE_ACCOUNT_JSON);
  const b64u = (v) => Buffer.from(v).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/calendar',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const sig = signer.sign(sa.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claim}.${sig}` }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error('token: ' + (j.error_description || j.error || res.status));
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.token;
}

const gfetch = (token, url, opts = {}) => fetch(url, {
  ...opts,
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
});

async function ocupados(token, fromMs, toMs) {
  const r = await gfetch(token, 'https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    body: JSON.stringify({ timeMin: new Date(fromMs).toISOString(), timeMax: new Date(toMs).toISOString(), timeZone: TZ, items: [{ id: CAL_ID }] }),
  });
  const j = await r.json();
  const cal = j.calendars && Object.values(j.calendars)[0];
  if (!r.ok || !cal || cal.errors) throw new Error('freebusy: ' + JSON.stringify((cal && cal.errors) || j.error || r.status));
  return (cal.busy || []).map((b) => [Date.parse(b.start), Date.parse(b.end)]);
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { headers: cors() });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let b = {};
  try { b = await req.json(); } catch { /* sem body */ }
  const action = b.action;

  if (action === 'route') return json({ ok: true });
  if (!process.env.GCAL_SERVICE_ACCOUNT_JSON || !CAL_ID) return json({ ok: false, reason: 'not_configured' });

  try {
    const token = await getToken();
    const now = Date.now();

    if (action === 'slots') {
      const cands = candidatos(now);
      if (!cands.length) return json({ ok: true, slots: {}, iso: {} });
      const busy = await ocupados(token, now, now + (DIAS_ADIANTE + 2) * 86400000);
      const slots = {}, iso = {};
      for (const c of cands) {
        const fim = c.ms + DURACAO_MIN * 60000;
        if (busy.some(([bs, be]) => c.ms < be && fim > bs)) continue;
        (slots[c.date] = slots[c.date] || []).push(c.hora);
        (iso[c.date] = iso[c.date] || {})[c.hora] = new Date(c.ms).toISOString();
      }
      return json({ ok: true, slots, iso });
    }

    if (action === 'book') {
      const start = Date.parse(b.start);
      if (!isFinite(start)) return json({ ok: false, reason: 'bad_start' });
      const p = brtParts(start);
      const hora = `${pad(p.hh)}:${pad(p.mm)}`;
      if (!DIAS_SEMANA.includes(p.wd) || !HORARIOS.includes(hora)
        || start < now + MIN_HORAS * 3600000 || start > now + (DIAS_ADIANTE + 1) * 86400000) {
        return json({ ok: false, reason: 'invalid_slot' });
      }
      const fim = start + DURACAO_MIN * 60000;
      if ((await ocupados(token, start, fim)).length) return json({ ok: false, reason: 'slot_taken' });

      const nome = txt(b.nome, 120), email = txt(b.email, 200);
      const wa = String(b.whatsapp || '').replace(/\D/g, '').slice(0, 20);
      const c = (b.contexto && typeof b.contexto === 'object') ? b.contexto : {};
      const descricao = [
        'Lead do Scanner do Envelhecimento',
        `Nome: ${nome}`,
        `WhatsApp: ${wa ? 'https://wa.me/' + wa : '—'}`,
        `E-mail: ${email || '—'}`,
        '',
        `Resultado: ${txt(c.classificacao)} (${txt(c.score, 6)}/28)`,
        `Pilares prioritários: ${txt(c.pilares)}`,
        `Maior preocupação: ${txt(c.preocupacao)}`,
        `Parentesco: ${txt(c.parentesco)}`,
        `Quem cuida hoje: ${txt(c.quemCuida)}`,
        `Investimento mensal: ${txt(c.investimento)}`,
        `Urgência: ${txt(c.urgencia)}`,
        MEET ? `\nReunião: ${MEET}` : '',
      ].join('\n');

      const r = await gfetch(token, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CAL_ID)}/events?sendUpdates=none`, {
        method: 'POST',
        body: JSON.stringify({
          summary: `Conversa Cuidado Seguro — ${nome}`,
          description: descricao,
          ...(MEET ? { location: MEET } : {}),
          start: { dateTime: new Date(start).toISOString(), timeZone: TZ },
          end: { dateTime: new Date(fim).toISOString(), timeZone: TZ },
          extendedProperties: { private: { nome, lead_ref: txt(b.metadata && b.metadata.lead_ref, 60) } },
          reminders: { useDefault: true },
        }),
      });
      const ev = await r.json();
      if (!r.ok || !ev.id) throw new Error('insert: ' + JSON.stringify(ev.error || r.status));
      return json({ ok: true, uid: ev.id, videoUrl: MEET, start: new Date(start).toISOString() });
    }

    if (action === 'info') {
      const uid = String(b.uid || '');
      if (!/^[A-Za-z0-9_-]{5,100}$/.test(uid)) return json({ ok: false, reason: 'bad_uid' });
      const r = await gfetch(token, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CAL_ID)}/events/${uid}`);
      const ev = await r.json();
      if (!r.ok) return json({ ok: false, reason: 'not_found' });
      return json({
        ok: true,
        nome: txt(ev.extendedProperties && ev.extendedProperties.private && ev.extendedProperties.private.nome, 60),
        start: ev.start && ev.start.dateTime,
        videoUrl: MEET,
      });
    }

    return json({ ok: false, reason: 'unknown_action' }, 400);
  } catch (err) {
    console.error('gcal error:', err.message);
    return json({ ok: false, reason: 'error' }, 500);
  }
};

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors() } });
}

export const config = { path: '/api/gcal' };
