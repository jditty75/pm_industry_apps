/*************** AGENDA ***************/
/**
 * Build an agenda for a given area + meeting date from a list of topic IDs.
 * Admin-only. Updates each topic's DiscussedOn / AgendaIds / Status / UpdatedAt
 * in a single batched setValues() write, then appends a Meetings row.
 */
function buildAgenda(area, meetingDateISO, topicIds) {
  requireAdmin_();
  if (AREAS.indexOf(area) === -1) throw new Error('Invalid area.');
  if (!topicIds || !topicIds.length) throw new Error('Select at least one topic.');

  const tSh = sh_(TOPICS_TAB);
  const range = tSh.getDataRange();
  const values = range.getValues();
  const headers = values[0];
  const idx = {};
  headers.forEach((h, i) => idx[h] = i);

  const meetingId = 'MTG-' + meetingDateISO.replace(/-/g, '') + '-' + area;
  const nowIso = new Date().toISOString();
  const selected = [];

  for (let i = 1; i < values.length; i++) {
    if (topicIds.indexOf(values[i][idx.ID]) === -1) continue;

    const existingDates   = splitList_(values[i][idx.DiscussedOn]);
    const existingAgendas = splitList_(values[i][idx.AgendaIds]);
    if (existingDates.indexOf(meetingDateISO) === -1) existingDates.push(meetingDateISO);
    if (existingAgendas.indexOf(meetingId) === -1)    existingAgendas.push(meetingId);

    values[i][idx.DiscussedOn] = existingDates.join('; ');
    values[i][idx.AgendaIds]   = existingAgendas.join('; ');
    values[i][idx.Status]      = 'Scheduled';
    values[i][idx.UpdatedAt]   = nowIso;

    // Surface admin-extension fields into the rendered agenda.
    selected.push({
      ID:          values[i][idx.ID],
      Title:       values[i][idx.Title],
      Description: values[i][idx.Description],
      Submitter:   values[i][idx.SubmitterName],
      Votes:       values[i][idx.Votes],
      Presenter:   idx.Presenter   !== undefined ? values[i][idx.Presenter]   : '',
      Priority:    idx.Priority    !== undefined ? values[i][idx.Priority]    : '',
      TargetMonth: idx.TargetMonth !== undefined ? values[i][idx.TargetMonth] : '',
      DriveLinks:  idx.DriveLinks  !== undefined ? parseDriveLinks_(values[i][idx.DriveLinks]) : []
    });
  }

  range.setValues(values); // single batched write

  const html = renderAgendaHtml_(area, meetingDateISO, selected, meetingId);

  sh_(MEETINGS_TAB).appendRow([
    meetingId,
    area,
    meetingDateISO,
    getCurrentUser().email,
    nowIso,
    topicIds.join('; '),
    html,
    'Planned',  // Status
    ''          // DiscussedAt
  ]);

  cacheBust_();
  return { ok: true, meetingId: meetingId, html: html };
}

/*************** MARK MEETING AS DISCUSSED ***************/
function markMeetingDiscussed(meetingId) {
  requireAdmin_();
  const mSh = sh_(MEETINGS_TAB);
  const mVals = mSh.getDataRange().getValues();
  const mHeaders = mVals[0];
  const mIdx = {};
  mHeaders.forEach((h, i) => mIdx[h] = i);

  let row = -1;
  let topicIds = [];
  for (let i = 1; i < mVals.length; i++) {
    if (mVals[i][mIdx.MeetingID] === meetingId) {
      row = i;
      topicIds = splitList_(mVals[i][mIdx.TopicIDs]);
      break;
    }
  }
  if (row === -1) throw new Error('Meeting not found.');

  if (mIdx.Status !== undefined)      mSh.getRange(row + 1, mIdx.Status + 1).setValue('Discussed');
  if (mIdx.DiscussedAt !== undefined) mSh.getRange(row + 1, mIdx.DiscussedAt + 1).setValue(new Date().toISOString());

  // Batch-update all included topics
  const tSh = sh_(TOPICS_TAB);
  const range = tSh.getDataRange();
  const vals = range.getValues();
  const headers = vals[0];
  const idx = {};
  headers.forEach((h, i) => idx[h] = i);

  let changed = false;
  const nowIso = new Date().toISOString();
  for (let i = 1; i < vals.length; i++) {
    if (topicIds.indexOf(vals[i][idx.ID]) !== -1) {
      vals[i][idx.Status] = 'Discussed';
      vals[i][idx.UpdatedAt] = nowIso;
      changed = true;
    }
  }
  if (changed) range.setValues(vals);

  cacheBust_();
  return { ok: true, count: topicIds.length };
}

/*************** BACK-COMPAT: keep old markDiscussed signature ***************/
function markDiscussed(meetingId) {
  return markMeetingDiscussed(meetingId);
}

/*************** AGENDA HTML RENDERING ***************/
function renderAgendaHtml_(area, dateISO, topics, meetingId) {
  const t = HtmlService.createTemplateFromFile('AgendaTemplate');
  t.area      = area;
  t.dateISO   = dateISO;
  t.topics    = topics;
  t.meetingId = meetingId;
  return t.evaluate().getContent();
}

function getAgendaHtml(meetingId) {
  const rows = sh_(MEETINGS_TAB).getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === meetingId) return rows[i][6];
  }
  throw new Error('Meeting not found.');
}

/*************** MEETINGS LIST ***************/
function listMeetings(area) {
  const rows = rowsToObjects_(sh_(MEETINGS_TAB));
  return rows
    .filter(r => !area || r.Area === area)
    .map(r => ({
      MeetingID:   String(r.MeetingID || ''),
      Area:        String(r.Area || ''),
      MeetingDate: formatCell_(r.MeetingDate),
      CreatedBy:   String(r.CreatedBy || ''),
      CreatedAt:   formatCell_(r.CreatedAt),
      TopicIDs:    String(r.TopicIDs || ''),
      Status:      String(r.Status || 'Planned'),
      DiscussedAt: formatCell_(r.DiscussedAt)
    }))
    .sort((a, b) => String(b.MeetingDate).localeCompare(String(a.MeetingDate)));
}

/*************** TOPIC HISTORY ***************/
function getTopicHistory(topicId) {
  if (!topicId) throw new Error('Missing topic ID.');
  const topics = rowsToObjects_(sh_(TOPICS_TAB));
  const topic = topics.find(t => String(t.ID) === String(topicId));
  if (!topic) throw new Error('Topic not found: ' + topicId);

  const meetings = rowsToObjects_(sh_(MEETINGS_TAB));
  const ids = splitList_(topic.AgendaIds);
  const history = meetings
    .filter(m => ids.indexOf(String(m.MeetingID)) !== -1)
    .map(m => ({
      MeetingID:   String(m.MeetingID || ''),
      Area:        String(m.Area || ''),
      MeetingDate: formatCell_(m.MeetingDate),
      Status:      String(m.Status || 'Planned'),
      DiscussedAt: formatCell_(m.DiscussedAt)
    }))
    .sort((a, b) => String(b.MeetingDate).localeCompare(String(a.MeetingDate)));

  return {
    topic: {
      ID:          String(topic.ID || ''),
      Title:       String(topic.Title || ''),
      Area:        String(topic.Area || ''),
      Status:      String(topic.Status || 'Proposed'),
      Submitter:   String(topic.SubmitterName || topic.SubmitterEmail || ''),
      Votes:       Number(topic.Votes) || 0,
      DiscussedOn: String(topic.DiscussedOn || ''),
      // Surface admin-extension context in history view too.
      Presenter:   String(topic.Presenter || ''),
      Priority:    String(topic.Priority || ''),
      TargetMonth: String(topic.TargetMonth || '')
    },
    history: history
  };
}

/*************** MONTHLY ROLLUP ***************/
// Returns:
// {
//   months: ['2025-11', '2025-12', ...],
//   areas:  ['HCM', 'FIN', 'PATT'],
//   data:   {
//     'HCM': { '2025-11': { submitted, scheduled, discussed, votes }, ... },
//     ...
//   }
// }
function getMonthlyRollup(months) {
  months = Math.max(1, Math.min(24, parseInt(months || 6, 10)));
  const topics = rowsToObjects_(sh_(TOPICS_TAB));
  const meetings = rowsToObjects_(sh_(MEETINGS_TAB));

  const now = new Date();
  const monthKeys = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthKeys.push(Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM'));
  }

  const data = {};
  AREAS.forEach(a => {
    data[a] = {};
    monthKeys.forEach(mk => {
      data[a][mk] = { submitted: 0, scheduled: 0, discussed: 0, votes: 0 };
    });
  });

  // Submissions & votes — bucketed by CreatedAt month.
  // Skip Archived topics so the rollup reflects active pipeline only.
  topics.forEach(t => {
    if (String(t.Status) === 'Archived') return;
    const created = t.CreatedAt ? String(t.CreatedAt).slice(0, 7) : '';
    if (data[t.Area] && data[t.Area][created]) {
      data[t.Area][created].submitted += 1;
      data[t.Area][created].votes += Number(t.Votes) || 0;
    }
  });

  // Scheduled / discussed — bucketed by MeetingDate month.
  meetings.forEach(m => {
    const mk = String(m.MeetingDate).slice(0, 7);
    const n = splitList_(m.TopicIDs).length;
    if (data[m.Area] && data[m.Area][mk]) {
      if (String(m.Status) === 'Discussed') {
        data[m.Area][mk].discussed += n;
      } else {
        data[m.Area][mk].scheduled += n;
      }
    }
  });

  return { months: monthKeys, areas: AREAS, data: data };
}