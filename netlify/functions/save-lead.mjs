/**
 * Captura progressiva na tabela PRÓPRIA do funil (Scanner do Envelhecimento):
 * diag_instagram_leads (nome interno legado — só um detalhe de implementação;
 * criada/estendida pelo setup.sql, nenhuma tabela existente do banco é tocada).
 *
 * UPSERT atômico por lead_ref (on_conflict): cada etapa do funil reenvia
 * o estado completo e a linha evolui.
 *
 * Usa a chave service_role — só como env no backend, nunca no front.
 * Não dá pra fazer isso com a anon + RLS write-only: no Postgres, tanto
 * UPDATE com WHERE quanto ON CONFLICT DO UPDATE passam pelas policies de
 * SELECT pra enxergar a linha-alvo; sem leitura, todo update pega 0 linhas.
 * O projeto Supabase é dedicado a este funil (só esta tabela), então o
 * raio de alcance da chave fica contido nele.
 *
 * Env:
 *   SUPABASE_DIAG_SERVICE — chave service_role do projeto dedicado.
 *   SUPABASE_DIAG_KEY — fallback (anon): 1º save entra, updates falham
 *     alto no log — melhor que perder o lead inteiro em silêncio.
 *   SUPABASE_DIAG_URL — URL do projeto dedicado.
 */
const SUPABASE_URL = (process.env.SUPABASE_DIAG_URL || 'https://aktktxizmpwckvxbdjzf.supabase.co').replace(/\/+$/, '');
const TABLE = 'diag_instagram_leads';

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { headers: cors() });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const KEY = process.env.SUPABASE_DIAG_SERVICE || process.env.SUPABASE_DIAG_KEY;
    if (!KEY) return json({ error: 'SUPABASE_DIAG_SERVICE not configured' }, 500);

    const b = await req.json();
    if (!b.lead_ref || !b.nome) return json({ error: 'Missing lead_ref/nome' }, 400);

    const digits = String(b.whatsapp || '').replace(/\D/g, '');
    // o front já manda ddi+número (E.164 sem '+'); só prefixa '+' — não força 55 (quebraria estrangeiro)
    const e164 = digits ? `+${digits}` : '';
    const txt = (v, max = 300) => String(v ?? '').slice(0, max);
    const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;
    const respostas = (b.respostas && typeof b.respostas === 'object') ? b.respostas : null;

    const row = {
      lead_ref: txt(b.lead_ref, 60),
      status: txt(b.status || 'parcial', 20),
      nome: txt(b.nome, 120),
      email: txt(b.email, 200).toLowerCase(),
      whatsapp: e164,
      respostas,
      lead_score: num(b.score),
      classificacao: txt(b.classificacao, 60),
      pilares_prioritarios: txt(b.pilares_prioritarios, 200),
      parentesco: txt(b.parentesco, 60),
      investimento_mensal: txt(b.investimento_mensal, 40),
      quem_cuida: txt(b.quem_cuida, 80),
      maior_preocupacao: txt(b.maior_preocupacao, 80),
      urgencia: txt(b.urgencia, 40),
      qualificado: typeof b.qualificado === 'boolean' ? b.qualificado : null,
      call_track: txt(b.call_track, 12),
      vendedor: txt(b.vendedor, 60),
      agendado: b.agendado === true,
      agendamento_em: b.agendamento_em || null,
      booking_uid: txt(b.booking_uid, 80),
      video_url: txt(b.video_url, 300),
      utm_source: txt(b.utm_source, 200),
      utm_medium: txt(b.utm_medium, 200),
      utm_campaign: txt(b.utm_campaign, 200),
      utm_content: txt(b.utm_content, 200),
      utm_term: txt(b.utm_term, 200),
      fbclid: txt(b.fbclid, 255),
      referrer: txt(b.referrer, 300),
    };

    const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?on_conflict=lead_ref`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(row),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Supabase save error:', res.status, errText.slice(0, 300));
      return json({ error: 'DB save failed' }, 500);
    }
    return json({ ok: true });
  } catch (err) {
    console.error('save-lead error:', err);
    return json({ error: err.message }, 500);
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
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors() },
  });
}

export const config = { path: '/api/save-lead' };
