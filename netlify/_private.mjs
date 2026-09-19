/* ====================================================================
   PLACEHOLDER — commitado de propósito pros builds via Git funcionarem
   e os cron jobs serem registrados pela Netlify (ver .gitignore).
   Agenda/booking real e o pré-diagnóstico por IA usam dados fictícios
   até isso ser preenchido com o conteúdo de verdade (instância/closers
   reais do Cal.com). Quando isso acontecer, tirar do repo de novo.
   ==================================================================== */

// Framework de análise de conteúdo injetado no prompt do modelo.
export const CORE_METHOD_CONTEXT = `
## SEU FRAMEWORK DE ANÁLISE
### Pilar 1: ...
### Pilar 2: ...
### Pilar 3: ...
`;

// Monta o prompt de diagnóstico (system + mensagem do usuário).
export function buildDiagnosisPrompt({ nome, instagram, nicho, desafio, faturamento, uf, fatos, temRoteiro }) {
  const system = 'Você é um consultor... (regras de tom e formato).';
  const userMsg = `${CORE_METHOD_CONTEXT}\n## CONTEXTO\n- Nome: ${nome}\n- @${instagram}\n${fatos}\n## INSTRUÇÕES\n...`;
  return { system, userMsg };
}

// Instância self-hosted do Cal e pool de closers (com os links reais).
export const CAL_BASE = 'https://SUA-INSTANCIA-CAL.example.com/interno';
export const VENDEDORES = [
  { nome: 'Closer 1', eventTypeId: 0, link: 'https://SUA-INSTANCIA-CAL.example.com/closer1/evento', trilha: 'premium' },
];
