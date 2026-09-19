/**
 * Ping periódico no Supabase pra evitar a pausa automática do plano
 * gratuito (o Supabase pausa projetos após ~7 dias sem atividade de API).
 * Roda sozinha via cron (netlify.toml) — não é chamada pelo front.
 *
 * Faz uma leitura mínima (1 linha, 1 coluna) na tabela de leads: gera
 * atividade de API real sem custo nenhum de leitura relevante.
 *
 * Env: SUPABASE_DIAG_SERVICE (ou SUPABASE_DIAG_KEY) + SUPABASE_DIAG_URL.
 */
const SUPABASE_URL = (process.env.SUPABASE_DIAG_URL || '').replace(/\/+$/, '');

export default async () => {
  const KEY = process.env.SUPABASE_DIAG_SERVICE || process.env.SUPABASE_DIAG_KEY;
  if (!SUPABASE_URL || !KEY) {
    console.error('keepalive-supabase: env não configurada');
    return new Response('env missing', { status: 500 });
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/diag_instagram_leads?select=id&limit=1`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    console.log('keepalive-supabase:', res.status, new Date().toISOString());
    return new Response(res.ok ? 'ok' : `supabase respondeu ${res.status}`, { status: res.ok ? 200 : 502 });
  } catch (err) {
    console.error('keepalive-supabase error:', err.message);
    return new Response('error', { status: 500 });
  }
};

// funções agendadas (schedule) não podem ter "path" custom — a Netlify
// dispara sozinha, não é uma rota HTTP pública
export const config = {
  schedule: '0 8 */3 * *', // a cada 3 dias às 08:00 UTC — bem dentro da janela de 7 dias do Supabase
};
