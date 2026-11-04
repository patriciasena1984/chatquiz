/**
 * Agenda do quiz integrada ao Google Agenda via Google Apps Script
 * (gas/Code.gs, publicado na conta de quem atende — sem service account).
 *   POST /api/gcal { action: 'route' | 'slots' | 'book' | 'info', ... }
 *
 * - slots: lê o free/busy da agenda real e devolve só horários livres
 * - book:  revalida o horário e cria o evento com sala do Meet própria; o
 *          Google manda o convite por e-mail pra pessoa
 * - info:  dados do evento pra página call.html
 * Mesmo contrato que o front já usava com /api/agenda.
 *
 * Env:
 *   GCAL_SCRIPT_URL    — URL do app da web do Apps Script (termina em /exec)
 *   GCAL_SCRIPT_SECRET — mesmo segredo definido em SEGREDO no script
 * Sem as duas, responde not_configured e o front usa a agenda local.
 */

const TZ = 'America/Sao_Paulo';
const OFFSET = '-03:00';              // Brasil sem horário de verão desde 2019
const OFFSET_MS = 3 * 3600 * 1000;
const DIAS_SEMANA = [1, 2, 3, 4, 5];  // 0=dom ... 6=sáb
const HORARIOS = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00'];
const DURACAO_MIN = 30;
const DIAS_ADIANTE = 14;
const MIN_HORAS = 3;

const SCRIPT_URL = process.env.GCAL_SCRIPT_URL || '';
const SCRIPT_SECRET = process.env.GCAL_SCRIPT_SECRET || '';

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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

/* ---------- ponte com o Apps Script ---------- */
async function gas(action, payload = {}) {
  const res = await fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ secret: SCRIPT_SECRET, action, ...payload }),
    redirect: 'follow',
  });
  let j;
  try { j = await res.json(); } catch { throw new Error(`${action}: resposta inválida (${res.status})`); }
  if (!j.ok) throw new Error(`${action}: ${j.reason || res.status} ${j.message || ''}`);
  return j;
}

const ocupados = async (fromMs, toMs) => (await gas('busy', { from: fromMs, to: toMs })).busy;

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { headers: cors() });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let b = {};
  try { b = await req.json(); } catch { /* sem body */ }
  const action = b.action;

  if (action === 'route') return json({ ok: true });
  if (!SCRIPT_URL || !SCRIPT_SECRET) return json({ ok: false, reason: 'not_configured' });

  try {
    const now = Date.now();

    if (action === 'slots') {
      const cands = candidatos(now);
      if (!cands.length) return json({ ok: true, slots: {}, iso: {} });
      const busy = await ocupados(now, now + (DIAS_ADIANTE + 2) * 86400000);
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
      if ((await ocupados(start, fim)).length) return json({ ok: false, reason: 'slot_taken' });

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
      ].join('\n');

      const r = await gas('create', {
        summary: `Conversa Cuidado Seguro — ${nome}`,
        description: descricao,
        start, end: fim,
        nome,
        lead_ref: txt(b.metadata && b.metadata.lead_ref, 60),
        email: EMAIL_OK.test(email) ? email : '',
      });
      return json({ ok: true, uid: r.id, videoUrl: r.videoUrl || '', start: new Date(start).toISOString() });
    }

    if (action === 'info') {
      const uid = String(b.uid || '');
      if (!/^[A-Za-z0-9_-]{5,100}$/.test(uid)) return json({ ok: false, reason: 'bad_uid' });
      const ev = await gas('get', { id: uid }).catch(() => null);
      if (!ev) return json({ ok: false, reason: 'not_found' });
      return json({ ok: true, nome: txt(ev.nome, 60), start: ev.start, videoUrl: ev.videoUrl || '' });
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
