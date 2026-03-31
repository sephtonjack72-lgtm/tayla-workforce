/* ══════════════════════════════════════════════════════
   Tayla Workforce — Timesheets
   timesheets.js
══════════════════════════════════════════════════════ */

let timesheets = JSON.parse(localStorage.getItem('wf_timesheets') || '[]');

// ══════════════════════════════════════════════════════
//  SUPABASE
// ══════════════════════════════════════════════════════

async function dbLoadTimesheets(weekStart, weekEnd) {
  if (!_businessId) return;
  const { data, error } = await _supabase
    .from('timesheets').select('*')
    .eq('business_id', _businessId)
    .gte('date', weekStart)
    .lte('date', weekEnd);
  if (error) { console.error('Load timesheets failed:', error); return; }
  const other = timesheets.filter(t => t.date < weekStart || t.date > weekEnd);
  timesheets = [...other, ...(data || [])];
  localStorage.setItem('wf_timesheets', JSON.stringify(timesheets));
}

async function dbSaveTimesheet(ts) {
  const idx = timesheets.findIndex(t => t.id === ts.id);
  if (idx >= 0) timesheets[idx] = ts; else timesheets.push(ts);
  localStorage.setItem('wf_timesheets', JSON.stringify(timesheets));
  if (!_businessId) return;
  const { error } = await _supabase
    .from('timesheets').upsert({ ...ts, business_id: _businessId }, { onConflict: 'id' });
  if (error) { console.error('Save timesheet failed:', error); toast('⚠ Failed to sync: ' + error.message); }
}

async function dbDeleteTimesheet(id) {
  timesheets = timesheets.filter(t => t.id !== id);
  localStorage.setItem('wf_timesheets', JSON.stringify(timesheets));
  if (!_businessId) return;
  await _supabase.from('timesheets').delete().eq('id', id);
}

// ══════════════════════════════════════════════════════
//  RENDER
// ══════════════════════════════════════════════════════

let _tsWeekStart = getWeekStart(new Date().toISOString().split('T')[0]);

function tsWeekNav(dir) {
  const d = new Date(_tsWeekStart);
  d.setDate(d.getDate() + dir * 7);
  _tsWeekStart = d.toISOString().split('T')[0];
  renderTimesheets();
}

function renderTimesheets() {
  const weekDates = getWeekDates(_tsWeekStart);
  const weekEnd   = weekDates[6];

  Promise.resolve(dbLoadTimesheets(_tsWeekStart, weekEnd)).then(() => renderTimesheetTable(weekDates));

  const label = document.getElementById('ts-week-label');
  if (label) {
    const start = new Date(_tsWeekStart);
    const end   = new Date(weekEnd);
    label.textContent = `${start.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} — ${end.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }

  renderTimesheetKPIs(weekDates);
}

function renderTimesheetTable(weekDates) {
  const tbody = document.getElementById('ts-tbody');
  const empty = document.getElementById('ts-empty');
  if (!tbody) return;

  const activeEmps = employees.filter(e => e.active !== false);

  // Collect all timesheet entries for this week
  const weekTs = timesheets.filter(t => weekDates.includes(t.date));

  // Also show rostered shifts that don't have a timesheet entry yet
  const weekShifts = shifts.filter(s => weekDates.includes(s.date) && s.status !== 'cancelled');

  // Build rows — one per employee per day with a timesheet or shift
  const rows = [];
  activeEmps.forEach(emp => {
    weekDates.forEach(date => {
      const ts    = weekTs.find(t => t.employee_id === emp.id && t.date === date);
      const shift = weekShifts.find(s => s.employee_id === emp.id && s.date === date);
      if (ts || shift) rows.push({ emp, date, ts, shift });
    });
  });

  if (!rows.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  const statusBadge = status => ({
    pending:  '<span class="badge badge-yellow">Pending</span>',
    approved: '<span class="badge badge-green">Approved</span>',
    rejected: '<span class="badge badge-red">Rejected</span>',
    rostered: '<span class="badge badge-grey">Rostered</span>',
  })[status] || '';

  tbody.innerHTML = rows.map(({ emp, date, ts, shift }) => {
    const entry = ts || {
      start_time: shift?.start_time,
      end_time:   shift?.end_time,
      break_mins: shift?.break_mins,
      status:     'rostered',
    };
    const pay = entry.start_time && entry.end_time
      ? calcShiftPay({ date, start_time: entry.start_time, end_time: entry.end_time, break_mins: entry.break_mins }, emp)
      : null;

    const initials = ((emp.first_name?.[0] || '') + (emp.last_name?.[0] || '')).toUpperCase();

    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <div class="avatar" style="width:28px;height:28px;font-size:10px;">${initials}</div>
            <div>
              <div style="font-weight:500;">${emp.first_name} ${emp.last_name}</div>
              <div style="font-size:11px;color:var(--text3);">${emp.employment_type || 'casual'}</div>
            </div>
          </div>
        </td>
        <td style="font-size:12px;">
          <div style="font-weight:500;">${new Date(date).toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short'})}</div>
          ${isPublicHoliday(date) ? '<span style="font-size:10px;color:var(--danger);">Public Holiday</span>' : ''}
        </td>
        <td>
          ${shift ? `<div style="font-size:11px;color:var(--text3);">${fmtTime(shift.start_time)}–${fmtTime(shift.end_time)}</div>` : '<span style="color:var(--text3);font-size:11px;">No shift</span>'}
        </td>
        <td>
          <div style="display:flex;gap:6px;align-items:center;">
            <input type="time" value="${ts?.start_time || shift?.start_time || ''}"
              style="padding:4px 8px;font-size:12px;width:90px;"
              onchange="updateTsEntry('${emp.id}','${date}','start_time',this.value)">
            <span style="color:var(--text3);">–</span>
            <input type="time" value="${ts?.end_time || shift?.end_time || ''}"
              style="padding:4px 8px;font-size:12px;width:90px;"
              onchange="updateTsEntry('${emp.id}','${date}','end_time',this.value)">
          </div>
        </td>
        <td class="mono" style="font-size:12px;">${pay ? pay.workedHours + 'h' : '—'}</td>
        <td class="mono" style="font-size:12px;font-weight:600;">${pay ? fmt(pay.totalPay) : '—'}</td>
        <td>${statusBadge(ts?.status || 'rostered')}</td>
        <td>
          <div class="flex-gap">
            ${ts?.status === 'pending' ? `
              <button class="btn btn-success btn-sm" onclick="approveTimesheet('${ts.id}')">✓ Approve</button>
              <button class="btn btn-ghost btn-sm" style="color:var(--danger);" onclick="rejectTimesheet('${ts.id}')">✕</button>
            ` : ''}
            ${!ts ? `<button class="btn btn-ghost btn-sm" onclick="createTimesheetFromShift('${emp.id}','${date}')">+ Add</button>` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderTimesheetKPIs(weekDates) {
  const el = document.getElementById('ts-kpis');
  if (!el) return;
  const weekTs = timesheets.filter(t => weekDates.includes(t.date));
  const pending  = weekTs.filter(t => t.status === 'pending').length;
  const approved = weekTs.filter(t => t.status === 'approved').length;

  let totalHours = 0, totalCost = 0;
  employees.filter(e => e.active !== false).forEach(emp => {
    const empTs = weekTs.filter(t => t.employee_id === emp.id && t.status === 'approved');
    empTs.forEach(ts => {
      if (ts.start_time && ts.end_time) {
        const pay = calcShiftPay({ date: ts.date, start_time: ts.start_time, end_time: ts.end_time, break_mins: ts.break_mins }, emp);
        totalHours += pay.workedHours;
        totalCost  += pay.totalPay;
      }
    });
  });

  el.innerHTML = `
    <div class="kpi"><div class="kpi-label">Pending Approval</div><div class="kpi-value ${pending > 0 ? 'warning' : ''}">${pending}</div></div>
    <div class="kpi"><div class="kpi-label">Approved</div><div class="kpi-value positive">${approved}</div></div>
    <div class="kpi"><div class="kpi-label">Approved Hours</div><div class="kpi-value">${totalHours.toFixed(1)}h</div></div>
    <div class="kpi"><div class="kpi-label">Approved Cost</div><div class="kpi-value negative">${fmt(totalCost)}</div></div>
  `;
}

// ══════════════════════════════════════════════════════
//  TIMESHEET ACTIONS
// ══════════════════════════════════════════════════════

async function updateTsEntry(employeeId, date, field, value) {
  let ts = timesheets.find(t => t.employee_id === employeeId && t.date === date);
  if (!ts) {
    ts = {
      id: uid(), employee_id: employeeId, date,
      status: 'pending', created_at: new Date().toISOString(),
    };
  }
  ts[field] = value;
  ts.updated_at = new Date().toISOString();

  // Auto-calculate break
  if (ts.start_time && ts.end_time && !ts.break_mins) {
    const startM = parseInt(ts.start_time.split(':')[0]) * 60 + parseInt(ts.start_time.split(':')[1]);
    const endM   = parseInt(ts.end_time.split(':')[0])   * 60 + parseInt(ts.end_time.split(':')[1]);
    ts.break_mins = calcBreakMins((endM - startM) / 60) || null;
  }

  await dbSaveTimesheet(ts);
  renderTimesheetKPIs(getWeekDates(_tsWeekStart));
}

async function approveTimesheet(id) {
  const ts = timesheets.find(t => t.id === id);
  if (!ts) return;
  ts.status = 'approved';
  ts.approved_at = new Date().toISOString();
  await dbSaveTimesheet(ts);
  renderTimesheets();
  toast('Timesheet approved ✓');
}

async function rejectTimesheet(id) {
  const ts = timesheets.find(t => t.id === id);
  if (!ts) return;
  ts.status = 'rejected';
  await dbSaveTimesheet(ts);
  renderTimesheets();
  toast('Timesheet rejected');
}

async function createTimesheetFromShift(employeeId, date) {
  const shift = shifts.find(s => s.employee_id === employeeId && s.date === date);
  const ts = {
    id:          uid(),
    employee_id: employeeId,
    date,
    start_time:  shift?.start_time || '',
    end_time:    shift?.end_time   || '',
    break_mins:  shift?.break_mins || null,
    status:      'pending',
    created_at:  new Date().toISOString(),
  };
  await dbSaveTimesheet(ts);
  renderTimesheets();
  toast('Timesheet entry created');
}

async function approveAllPending() {
  const weekDates = getWeekDates(_tsWeekStart);
  const pending = timesheets.filter(t => weekDates.includes(t.date) && t.status === 'pending');
  for (const ts of pending) {
    ts.status = 'approved';
    ts.approved_at = new Date().toISOString();
    await dbSaveTimesheet(ts);
  }
  renderTimesheets();
  toast(`✓ Approved ${pending.length} timesheets`);
}
