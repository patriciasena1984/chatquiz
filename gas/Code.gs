/**
 * Ponte entre o quiz (Netlify) e o Google Agenda de quem publica este script.
 * Roda como a dona da conta: cria o evento com sala do Meet própria e manda
 * o convite por e-mail pra pessoa. Só responde se o SEGREDO bater.
 *
 * Requer o serviço avançado "Google Calendar API" (Serviços → + → Google Calendar API).
 */
const SEGREDO = 'COLE_AQUI_O_SEGREDO';
const TZ = 'America/Sao_Paulo';

function doPost(e) {
  try {
    const b = JSON.parse(e.postData.contents);
    if (b.secret !== SEGREDO) return out({ ok: false, reason: 'forbidden' });

    if (b.action === 'busy') {
      const r = Calendar.Freebusy.query({
        timeMin: new Date(b.from).toISOString(),
        timeMax: new Date(b.to).toISOString(),
        timeZone: TZ,
        items: [{ id: 'primary' }],
      });
      const cal = r.calendars && r.calendars.primary;
      return out({ ok: true, busy: ((cal && cal.busy) || []).map(x => [Date.parse(x.start), Date.parse(x.end)]) });
    }

    if (b.action === 'create') {
      const ev = {
        summary: b.summary,
        description: b.description,
        start: { dateTime: new Date(b.start).toISOString(), timeZone: TZ },
        end: { dateTime: new Date(b.end).toISOString(), timeZone: TZ },
        reminders: { useDefault: true },
        extendedProperties: { private: { nome: String(b.nome || ''), lead_ref: String(b.lead_ref || '') } },
        conferenceData: { createRequest: { requestId: Utilities.getUuid(), conferenceSolutionKey: { type: 'hangoutsMeet' } } },
      };
      if (b.email) ev.attendees = [{ email: b.email }];
      const r = Calendar.Events.insert(ev, 'primary', { conferenceDataVersion: 1, sendUpdates: b.email ? 'all' : 'none' });
      return out({ ok: true, id: r.id, videoUrl: r.hangoutLink || '' });
    }

    if (b.action === 'get') {
      const r = Calendar.Events.get('primary', String(b.id));
      const p = (r.extendedProperties && r.extendedProperties.private) || {};
      return out({ ok: true, nome: p.nome || '', start: r.start && r.start.dateTime, videoUrl: r.hangoutLink || '' });
    }

    return out({ ok: false, reason: 'unknown_action' });
  } catch (err) {
    return out({ ok: false, reason: 'error', message: String(err && err.message || err) });
  }
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// Rode UMA vez (botão Executar) pra conceder as permissões de agenda.
function autorizar() {
  Calendar.Calendars.get('primary');
}
