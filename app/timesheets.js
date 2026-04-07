/* ══════════════════════════════════════════════════════
   Tayla Workforce — Timesheets
   timesheets.js
══════════════════════════════════════════════════════ */

let timesheets = JSON.parse(localStorage.getItem('wf_timesheets') || '[]');

// ══════════════════════════════════════════════════════
//  SUPABASE
// ══════════════════════════════════════════════════════

async function dbLoadTimesheets(weekStart, weekEnd) {
  await ensureTimesheetsLoaded(weekStart, weekEnd);
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

let _tsWeekStart = null;

function getTsWeekStart() {
  if (!_tsWeekStart) _tsWeekStart = getWeekStart(localDateStr(new Date()));
  return _tsWeekStart;
}

function tsWeekNav(dir) {
  const d = parseLocalDate(getTsWeekStart());
  d.setDate(d.getDate() + dir * 7);
  _tsWeekStart = localDateStr(d);
  renderTimesheets();
}

// Instant render from memory — called on tab switch
function renderTimesheetsFromMemory() {
  _tsWeekStart = getTsWeekStart();
  const weekDates = getWeekDates(_tsWeekStart);
  const weekEnd   = weekDates[6];

  const label = document.getElementById('ts-week-label');
  if (label) {
    const start = parseLocalDate(_tsWeekStart);
    const end   = parseLocalDate(weekEnd);
    label.textContent = `${start.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} — ${end.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }

  renderTimesheetKPIs(weekDates);
  renderTimesheetTable(weekDates);
}

// Full render — fetches from Supabase if week not loaded, then renders
function renderTimesheets() {
  _tsWeekStart = getTsWeekStart();
  const weekDates = getWeekDates(_tsWeekStart);
  const weekEnd   = weekDates[6];

  const label = document.getElementById('ts-week-label');
  if (label) {
    const start = parseLocalDate(_tsWeekStart);
    const end   = parseLocalDate(weekEnd);
    label.textContent = `${start.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} — ${end.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }

  renderTimesheetKPIs(weekDates);

  ensureTimesheetsLoaded(_tsWeekStart, weekEnd).then(() => {
    markTimesheetsLoaded(_tsWeekStart, weekEnd);
    renderTimesheetTable(weekDates);
  });
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
          <div style="font-weight:500;">${parseLocalDate(date).toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short'})}</div>
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

// ══════════════════════════════════════════════════════
//  PUSH PAYSLIPS — PREVIOUS WEEK (BULK)
// ══════════════════════════════════════════════════════

function getPreviousWeekRange() {
  const weekDates = getWeekDates(getTsWeekStart());
  return {
    prevStart: getTsWeekStart(),
    prevEnd:   weekDates[6],
    prevDates: weekDates,
  };
}

async function openPushPayslipsModal() {
  const { prevStart, prevEnd, prevDates } = getPreviousWeekRange();

  // Load timesheets for the previous week fresh
  await dbLoadTimesheets(prevStart, prevEnd);

  const activeEmps = employees.filter(e => e.active !== false);
  const modal = document.getElementById('push-payslips-modal');
  if (!modal) return;

  const periodLabel = `${parseLocalDate(prevStart).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} — ${parseLocalDate(prevEnd).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  // Build preview rows
  const rows = activeEmps.map(emp => {
    const empTs = timesheets.filter(t =>
      t.employee_id === emp.id &&
      prevDates.includes(t.date) &&
      t.status === 'approved'
    );

    let hours = 0, gross = 0;
    empTs.forEach(ts => {
      if (ts.start_time && ts.end_time) {
        const pay = calcShiftPay({ date: ts.date, start_time: ts.start_time, end_time: ts.end_time, break_mins: ts.break_mins }, emp);
        hours += pay.workedHours;
        gross += pay.totalPay;
      }
    });

    const connected = !!emp.tayla_user_id;
    const hasTs     = empTs.length > 0;
    const initials  = ((emp.first_name?.[0] || '') + (emp.last_name?.[0] || '')).toUpperCase();

    let statusBadge;
    if (!hasTs)     statusBadge = '<span class="badge badge-grey">No approved timesheets</span>';
    else if (!connected) statusBadge = '<span class="badge badge-yellow">Not connected</span>';
    else            statusBadge = '<span class="badge badge-green">Ready to push</span>';

    return { emp, hours, gross, hasTs, connected, initials, statusBadge };
  });

  const readyCount = rows.filter(r => r.hasTs && r.connected).length;

  document.getElementById('push-payslips-period').textContent = periodLabel;
  document.getElementById('push-payslips-ready').textContent  = readyCount;
  document.getElementById('push-payslips-list').innerHTML = rows.map(r => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);">
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="avatar" style="width:30px;height:30px;font-size:11px;${!r.hasTs || !r.connected ? 'opacity:.45;' : ''}">${r.initials}</div>
        <div>
          <div style="font-weight:600;font-size:13px;">${r.emp.first_name} ${r.emp.last_name}</div>
          <div style="font-size:11px;color:var(--text3);">${r.hasTs ? r.hours.toFixed(1) + 'h · ' + fmt(r.gross) : 'No data'}</div>
        </div>
      </div>
      <div id="push-row-status-${r.emp.id}">${r.statusBadge}</div>
    </div>
  `).join('');

  document.getElementById('push-payslips-send-btn').disabled  = readyCount === 0;
  document.getElementById('push-payslips-send-btn').textContent = `📲 Push ${readyCount} Payslip${readyCount !== 1 ? 's' : ''}`;
  document.getElementById('push-payslips-result').innerHTML = '';

  modal.classList.add('show');
}

async function executePushPayslips() {
  const { prevStart, prevEnd, prevDates } = getPreviousWeekRange();
  const { data: { session } } = await _supabase.auth.getSession();
  const token = session?.access_token;

  const btn    = document.getElementById('push-payslips-send-btn');
  const result = document.getElementById('push-payslips-result');
  btn.disabled    = true;
  btn.textContent = 'Pushing…';
  result.innerHTML = '';

  const activeEmps = employees.filter(e => e.active !== false);
  let sent = 0, skipped = 0, failed = 0;

  for (const emp of activeEmps) {
    const rowStatus = document.getElementById(`push-row-status-${emp.id}`);

    const empTs = timesheets.filter(t =>
      t.employee_id === emp.id &&
      prevDates.includes(t.date) &&
      t.status === 'approved'
    );

    if (!empTs.length) { skipped++; continue; }

    if (!emp.tayla_user_id) {
      skipped++;
      if (rowStatus) rowStatus.innerHTML = '<span class="badge badge-grey">Not connected</span>';
      continue;
    }

    if (rowStatus) rowStatus.innerHTML = '<span class="badge badge-grey">Sending…</span>';

    try {
      // Calculate payslip
      const shiftBreakdown = empTs.map(ts => ({
        ts,
        pay: calcShiftPay({ date: ts.date, start_time: ts.start_time, end_time: ts.end_time, break_mins: ts.break_mins }, emp),
      }));

      const grossPay     = +shiftBreakdown.reduce((s, r) => s + r.pay.grossPay, 0).toFixed(2);
      const laundryAllow = +shiftBreakdown.reduce((s, r) => s + r.pay.laundryAllowance, 0).toFixed(2);
      const totalGross   = +(grossPay + laundryAllow).toFixed(2);
      const paygWithheld = calcPAYG(totalGross, emp.tax_free_threshold !== false, emp.residency_status || 'australian');
      const medicare     = calcMedicare(totalGross, emp.residency_status || 'australian');
      const totalTax     = paygWithheld + medicare;
      const superAmount  = calcSuper(grossPay);
      const netPay       = +(totalGross - totalTax).toFixed(2);

      // Calculate YTD from prior payslips this financial year
      const fyYear   = new Date(prevEnd).getMonth() >= 6 ? new Date(prevEnd).getFullYear() : new Date(prevEnd).getFullYear() - 1;
      const fyStart  = `${fyYear}-07-01`;
      const { data: priorPayslips } = await _supabase.from('payslips')
        .select('gross_pay, tax_withheld, super_amount, allowances')
        .eq('business_id', _businessId).eq('employee_id', emp.id)
        .gte('pay_period_start', fyStart).lt('pay_period_end', prevEnd);
      const ytdGross = +((priorPayslips||[]).reduce((s,r) => s+(r.gross_pay||0), 0) + totalGross).toFixed(2);
      const ytdTax   = +((priorPayslips||[]).reduce((s,r) => s+(r.tax_withheld||0), 0) + paygWithheld).toFixed(2);
      const ytdSuper = +((priorPayslips||[]).reduce((s,r) => s+(r.super_amount||0), 0) + superAmount).toFixed(2);
      const ytdAllow = +((priorPayslips||[]).reduce((s,r) => s+(r.allowances||0), 0) + laundryAllow).toFixed(2);
      const hoursWorked = +shiftBreakdown.reduce((s,r) => s+(r.pay?.workedHours||0), 0).toFixed(2);

      // Save payslip record with full STP2 fields
      const { error: saveErr } = await _supabase.from('payslips').upsert({
        business_id:      _businessId,
        employee_id:      emp.id,
        pay_period_start: prevStart,
        pay_period_end:   prevEnd,
        gross_pay:        totalGross,
        tax_withheld:     paygWithheld,
        medicare_levy:    medicare,
        super_amount:     superAmount,
        net_pay:          netPay,
        allowances:       laundryAllow,
        hours_worked:     hoursWorked,
        ytd_gross:        ytdGross,
        ytd_tax:          ytdTax,
        ytd_super:        ytdSuper,
        ytd_allowances:   ytdAllow,
        pay_event_type:   'PAYEVNT',
        status:           'draft',
      }, { onConflict: 'business_id,employee_id,pay_period_start' });

      if (saveErr) throw new Error(saveErr.message);

      // Fetch the saved payslip ID
      const { data: saved } = await _supabase
        .from('payslips')
        .select('id')
        .eq('business_id', _businessId)
        .eq('employee_id', emp.id)
        .eq('pay_period_start', prevStart)
        .maybeSingle();

      if (!saved) throw new Error('Could not retrieve saved payslip');

      // Push to Tayla
      const res  = await fetch(
        'https://whedwekxzjfqwjuoarid.supabase.co/functions/v1/push-payslip',
        {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ payslip_id: saved.id }),
        }
      );

      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Push failed');

      sent++;
      if (rowStatus) rowStatus.innerHTML = '<span class="badge badge-green">✓ Sent</span>';

      // Accrue leave for hours worked this pay period
      if (typeof accrueLeaveForPayPeriod === 'function') {
        const hoursWorked = +shiftBreakdown.reduce((s,r) => s+(r.pay?.workedHours||0), 0).toFixed(2);
        await accrueLeaveForPayPeriod(emp.id, hoursWorked);
      }

    } catch (err) {
      failed++;
      if (rowStatus) rowStatus.innerHTML = `<span class="badge badge-red" title="${err.message}">✕ Failed</span>`;
      console.error(`Push payslip failed for ${emp.first_name}:`, err);
    }
  }

  // Summary
  const parts = [];
  if (sent)    parts.push(`<span style="color:var(--success);">✓ ${sent} sent</span>`);
  if (skipped) parts.push(`<span style="color:var(--text3);">${skipped} skipped</span>`);
  if (failed)  parts.push(`<span style="color:var(--danger);">✕ ${failed} failed</span>`);

  result.innerHTML = `
    <div style="margin-top:16px;padding:12px 14px;background:var(--surface2);border-radius:8px;font-size:13px;font-weight:500;">
      ${parts.join(' · ')}
    </div>`;

  btn.textContent = 'Done';
  toast(`Payslips pushed: ${sent} sent${failed ? ', ' + failed + ' failed' : ''}`);
}
