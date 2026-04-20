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

// Returns the number of days in the current pay period
function getPeriodDays() {
  if (_payFrequency === 'fortnightly') return 14;
  if (_payFrequency === 'monthly')     return null; // handled separately
  return 7; // weekly default
}

// Returns the period start date string for display/navigation
function getTsWeekStart() {
  if (!_tsWeekStart) _tsWeekStart = getWeekStart(localDateStr(new Date()));
  return _tsWeekStart;
}

// Navigate forward/back by one pay period
function tsWeekNav(dir) {
  const d = parseLocalDate(getTsWeekStart());
  if (_payFrequency === 'monthly') {
    d.setMonth(d.getMonth() + dir);
  } else {
    d.setDate(d.getDate() + dir * getPeriodDays());
  }
  _tsWeekStart = localDateStr(d);
  renderTimesheets();
}

// Returns array of date strings for the current pay period
function getPeriodDates(periodStart) {
  if (_payFrequency === 'fortnightly') {
    return Array.from({ length: 14 }, (_, i) => {
      const d = parseLocalDate(periodStart);
      d.setDate(d.getDate() + i);
      return localDateStr(d);
    });
  }
  if (_payFrequency === 'monthly') {
    const start = parseLocalDate(periodStart);
    const year  = start.getFullYear();
    const month = start.getMonth();
    const days  = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: days }, (_, i) => {
      const d = new Date(year, month, i + 1);
      return localDateStr(d);
    });
  }
  // Weekly default
  return getWeekDates(periodStart);
}

// Returns period start/end/dates for the previous (or current) pay period
function getPreviousPeriodRange() {
  const periodStart = getTsWeekStart();
  const dates       = getPeriodDates(periodStart);
  return {
    prevStart: periodStart,
    prevEnd:   dates[dates.length - 1],
    prevDates: dates,
  };
}

// Formatted label for current period
function getPeriodLabel(periodStart) {
  const dates = getPeriodDates(periodStart);
  const start = parseLocalDate(dates[0]);
  const end   = parseLocalDate(dates[dates.length - 1]);
  if (_payFrequency === 'monthly') {
    return start.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
  }
  return `${start.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} — ${end.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

// Instant render from memory — called on tab switch
function renderTimesheetsFromMemory() {
  _tsWeekStart    = getTsWeekStart();
  const periodDates = getPeriodDates(_tsWeekStart);
  const periodEnd   = periodDates[periodDates.length - 1];

  const label = document.getElementById('ts-week-label');
  if (label) label.textContent = getPeriodLabel(_tsWeekStart);

  renderTimesheetKPIs(periodDates);
  renderTimesheetTable(periodDates);
}

// Full render — fetches from Supabase if period not loaded, then renders
function renderTimesheets() {
  _tsWeekStart      = getTsWeekStart();
  const periodDates = getPeriodDates(_tsWeekStart);
  const periodEnd   = periodDates[periodDates.length - 1];

  const label = document.getElementById('ts-week-label');
  if (label) label.textContent = getPeriodLabel(_tsWeekStart);

  renderTimesheetKPIs(periodDates);

  ensureTimesheetsLoaded(_tsWeekStart, periodEnd).then(() => {
    markTimesheetsLoaded(_tsWeekStart, periodEnd);
    renderTimesheetTable(periodDates);
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

    const fmtTs = (isoStr) => {
      if (!isoStr) return '—';
      return new Date(isoStr).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true });
    };

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

    const entryMethodBadge = ts?.entry_method === 'clock'
      ? '<span style="font-size:10px;background:rgba(56,161,105,.12);color:var(--success);padding:2px 6px;border-radius:4px;font-weight:600;">CLOCKED</span>'
      : ts?.entry_method === 'manual'
      ? '<span style="font-size:10px;background:rgba(237,137,54,.12);color:#c05621;padding:2px 6px;border-radius:4px;font-weight:600;">MANUAL</span>'
      : '';

    const clockInfo = ts?.clock_in
      ? `<div style="font-size:11px;color:var(--text3);white-space:nowrap;">
           In: ${fmtTs(ts.clock_in)}<br>
           ${ts.clock_out ? 'Out: ' + fmtTs(ts.clock_out) : '<span style="color:var(--accent);">Active</span>'}
           ${ts.break_mins ? '<br>Break: ' + ts.break_mins + 'min' : ''}
           ${ts.clock_in_note ? '<br><span style="color:var(--accent2);font-style:italic;">' + ts.clock_in_note + '</span>' : ''}
         </div>`
      : '<span style="color:var(--text3);font-size:11px;">—</span>';

    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <div class="avatar" style="width:28px;height:28px;font-size:10px;">${initials}</div>
            <div>
              <div style="font-weight:500;">${emp.first_name} ${emp.last_name}</div>
              <div style="font-size:11px;color:var(--text3);">${emp.employment_type || 'casual'} ${entryMethodBadge}</div>
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
        <td>${clockInfo}</td>
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
  return getPreviousPeriodRange();
}

async function openPushPayslipsModal() {
  const { prevStart, prevEnd, prevDates } = getPreviousWeekRange();

  // Load timesheets for the previous week fresh
  await dbLoadTimesheets(prevStart, prevEnd);

  const activeEmps = employees.filter(e => e.active !== false);
  const modal = document.getElementById('push-payslips-modal');
  if (!modal) return;

  const periodLabel = getPeriodLabel(prevStart);

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
      const _periods     = getPeriodsPerYear(_payFrequency);
      const paygWithheld = calcPAYG(totalGross, emp.tax_free_threshold !== false, emp.residency_status || 'australian', _periods);
      const medicare     = calcMedicare(totalGross, emp.residency_status || 'australian', _periods);
      const hecsRepay    = emp.hecs_help ? calcHECSRepayment(totalGross, _periods) : 0;
      const totalTax     = paygWithheld + medicare + hecsRepay;
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
      const ytdHecs  = +((priorPayslips||[]).reduce((s,r) => s+(r.hecs_repayment||0), 0) + hecsRepay).toFixed(2);
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
        hecs_repayment:   hecsRepay,
        super_amount:     superAmount,
        net_pay:          netPay,
        allowances:       laundryAllow,
        hours_worked:     hoursWorked,
        ytd_gross:        ytdGross,
        ytd_tax:          ytdTax,
        ytd_super:        ytdSuper,
        ytd_allowances:   ytdAllow,
        ytd_hecs:         ytdHecs,
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

  // Push payroll journal to Tayla Business if linked
  if (sent > 0) {
    await pushPayrollToBusiness(prevStart, prevEnd, activeEmps);
  }
}

// ══════════════════════════════════════════════════════
//  PUSH PAYROLL TO TAYLA BUSINESS
//  Fires after payslips are pushed to create journal entries
// ══════════════════════════════════════════════════════

async function pushPayrollToBusiness(periodStart, periodEnd, activeEmps) {
  const linkedBizId = _businessProfile?.linked_business_id;
  if (!linkedBizId) return; // Not linked — skip silently

  try {
    // Fetch the payslips we just saved for this period
    const { data: payslipRows } = await _supabase
      .from('payslips')
      .select('employee_id, gross_pay, tax_withheld, medicare_levy, hecs_repayment, super_amount, net_pay')
      .eq('business_id', _businessId)
      .gte('pay_period_start', periodStart)
      .lte('pay_period_end', periodEnd);

    if (!payslipRows?.length) return;

    // Build payload with employee names for the narration
    const payslips = payslipRows.map(p => {
      const emp = activeEmps.find(e => e.id === p.employee_id);
      return {
        employee_name:  emp ? `${emp.first_name} ${emp.last_name}` : p.employee_id,
        gross_pay:      p.gross_pay      || 0,
        tax_withheld:   p.tax_withheld   || 0,
        medicare_levy:  p.medicare_levy  || 0,
        hecs_repayment: p.hecs_repayment || 0,
        super_amount:   p.super_amount   || 0,
        net_pay:        p.net_pay        || 0,
      };
    });

    const payDateObj = new Date(periodEnd);
    payDateObj.setDate(payDateObj.getDate() + 1);
    const paymentDate = localDateStr(payDateObj);

    const res = await fetch(
      'https://vyikolyljzygmxiahcul.supabase.co/functions/v1/receive-payroll',
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workforce_business_id: _businessId,
          pay_period_start:      periodStart,
          pay_period_end:        periodEnd,
          payment_date:          paymentDate,
          payslips,
        }),
      }
    );

    const data = await res.json();
    if (data.success && !data.skipped) {
      toast(`Journal entry created in Tayla Business ✓ (${data.ref})`);
    }
  } catch (err) {
    console.error('Business payroll push failed:', err);
    // Non-fatal — don't block payslip push result
  }
}

// ══════════════════════════════════════════════════════
//  CLOCK IN / CLOCK OUT
//  Shared tablet mode — runs under manager's session
//  Employees search their name, clock in/out/break
// ══════════════════════════════════════════════════════

let _clockinPendingEmployee = null; // holds employee while unrostered modal is open
let _clockinSearch = '';

// ── Called when Clock In tab is shown
function renderClockInPage() {
  const container = document.getElementById('clockin-content');
  if (!container) return;

  const today     = localDateStr(new Date());
  const now       = new Date();
  const timeStr   = now.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true });
  const dateLabel = now.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // Get today's active clock-in records from timesheets
  const todayTs = timesheets.filter(t => t.date === today);

  const activeEmps = employees.filter(e => e.active !== false);
  const searchLower = _clockinSearch.toLowerCase();
  const filtered = _clockinSearch.length >= 1
    ? activeEmps.filter(e =>
        `${e.first_name} ${e.last_name}`.toLowerCase().includes(searchLower))
    : [];

  container.innerHTML = `
    <!-- Header -->
    <div style="text-align:center;padding:24px 0 16px;">
      <div style="font-size:13px;color:var(--text3);margin-bottom:4px;">${dateLabel}</div>
      <div style="font-size:36px;font-weight:700;color:var(--accent);font-variant-numeric:tabular-nums;" id="clockin-live-time">${timeStr}</div>
      <div style="font-size:13px;color:var(--text3);margin-top:4px;">${_businessProfile?.biz_name || 'Tayla Workforce'}</div>
    </div>

    <!-- Search -->
    <div style="max-width:480px;margin:0 auto 24px;">
      <div style="position:relative;">
        <input type="text"
          id="clockin-search"
          class="form-input"
          placeholder="Search your name to clock in or out…"
          value="${_clockinSearch}"
          style="font-size:16px;padding:14px 16px;border-radius:12px;"
          oninput="_clockinSearch=this.value;renderClockInPage()"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false">
        ${_clockinSearch ? `<button onclick="_clockinSearch='';renderClockInPage()" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;font-size:18px;color:var(--text3);cursor:pointer;">✕</button>` : ''}
      </div>

      <!-- Search results -->
      ${filtered.length > 0 ? `
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;margin-top:8px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.08);">
          ${filtered.slice(0,8).map(emp => {
            const ts = todayTs.find(t => t.employee_id === emp.id);
            const isClockedIn  = ts?.clock_in && !ts?.clock_out;
            const isOnBreak    = isClockedIn && ts?.break_start && !ts?.break_end;
            const isClockedOut = ts?.clock_out;

            let statusBadge = '';
            if (isClockedOut)  statusBadge = '<span style="font-size:11px;color:var(--success);font-weight:600;">✓ Clocked out</span>';
            else if (isOnBreak) statusBadge = '<span style="font-size:11px;color:var(--accent2);font-weight:600;">☕ On break</span>';
            else if (isClockedIn) statusBadge = '<span style="font-size:11px;color:var(--accent);font-weight:600;">● Clocked in</span>';

            const todayShift = shifts.find(s => s.employee_id === emp.id && s.date === today);
            const shiftLabel = todayShift ? `${fmtTime(todayShift.start_time)} – ${fmtTime(todayShift.end_time)}` : 'No rostered shift';
            const initials   = ((emp.first_name?.[0]||'') + (emp.last_name?.[0]||'')).toUpperCase();

            return `
              <div onclick="selectClockInEmployee('${emp.id}')"
                style="display:flex;align-items:center;gap:14px;padding:14px 16px;cursor:pointer;border-bottom:1px solid var(--border);transition:background .15s;"
                onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
                <div class="avatar" style="width:40px;height:40px;font-size:14px;flex-shrink:0;">${initials}</div>
                <div style="flex:1;min-width:0;">
                  <div style="font-weight:600;font-size:15px;">${emp.first_name} ${emp.last_name}</div>
                  <div style="font-size:12px;color:var(--text3);">${shiftLabel}</div>
                </div>
                <div>${statusBadge}</div>
              </div>`;
          }).join('')}
        </div>` : ''}

      ${_clockinSearch.length >= 1 && filtered.length === 0 ? `
        <div style="text-align:center;padding:20px;color:var(--text3);font-size:13px;">
          No employees found matching "${_clockinSearch}"
        </div>` : ''}
    </div>

    <!-- Active clocked-in employees -->
    ${renderClockedInList(today, todayTs)}
  `;

  // Start live clock
  startLiveClock();
}

function renderClockedInList(today, todayTs) {
  const clockedIn = todayTs.filter(t => t.clock_in && !t.clock_out);
  if (!clockedIn.length) return '';

  return `
    <div style="max-width:480px;margin:0 auto;">
      <div style="font-weight:600;font-size:13px;color:var(--text2);margin-bottom:12px;">Currently on shift</div>
      ${clockedIn.map(ts => {
        const emp = employees.find(e => e.id === ts.employee_id);
        if (!emp) return '';
        const clockInTime = new Date(ts.clock_in);
        const elapsed = Math.floor((Date.now() - clockInTime.getTime()) / 60000);
        const hrs = Math.floor(elapsed / 60);
        const mins = elapsed % 60;
        const elapsedStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
        const isOnBreak = ts.break_start && !ts.break_end;
        const initials = ((emp.first_name?.[0]||'') + (emp.last_name?.[0]||'')).toUpperCase();

        return `
          <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--surface);border:1px solid var(--border);border-radius:10px;margin-bottom:8px;">
            <div class="avatar" style="width:36px;height:36px;font-size:13px;">${initials}</div>
            <div style="flex:1;">
              <div style="font-weight:600;font-size:14px;">${emp.first_name} ${emp.last_name}</div>
              <div style="font-size:11px;color:var(--text3);">
                Clocked in ${clockInTime.toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit',hour12:true})}
                · ${isOnBreak ? '<span style="color:var(--accent2);">On break</span>' : elapsedStr + ' elapsed'}
              </div>
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

let _liveClockInterval = null;
function startLiveClock() {
  clearInterval(_liveClockInterval);
  _liveClockInterval = setInterval(() => {
    const el = document.getElementById('clockin-live-time');
    if (!el) { clearInterval(_liveClockInterval); return; }
    const now = new Date();
    el.textContent = now.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true });
  }, 10000);
}

// ── Employee selected from search results
async function selectClockInEmployee(employeeId) {
  const emp     = employees.find(e => e.id === employeeId);
  if (!emp) return;

  const today   = localDateStr(new Date());
  const ts      = timesheets.find(t => t.employee_id === employeeId && t.date === today);
  const shift   = shifts.find(s => s.employee_id === employeeId && s.date === today);

  _clockinSearch = '';

  // Determine action based on current state
  if (!ts || !ts.clock_in) {
    // Not clocked in yet
    if (!shift) {
      // No rostered shift — show reason modal
      _clockinPendingEmployee = emp;
      document.getElementById('unrostered-modal-name').textContent =
        `${emp.first_name} ${emp.last_name}`;
      document.getElementById('unrostered-modal').classList.add('show');
    } else {
      await executeClockin(emp, null);
    }
  } else if (ts.clock_in && !ts.clock_out) {
    // Clocked in — show break/clock out options
    showClockActionModal(emp, ts);
  } else {
    // Already clocked out
    showAlreadyClockedOut(emp);
  }
}

function showClockActionModal(emp, ts) {
  const isOnBreak  = ts.break_start && !ts.break_end;
  const modalEl    = document.getElementById('break-modal');
  const nameEl     = document.getElementById('break-modal-name');
  const msgEl      = document.getElementById('break-modal-msg');
  const confirmBtn = document.getElementById('break-modal-confirm');

  nameEl.textContent = `${emp.first_name} ${emp.last_name}`;

  if (isOnBreak) {
    const breakStart = new Date(ts.break_start);
    const breakMins  = Math.floor((Date.now() - breakStart.getTime()) / 60000);
    msgEl.textContent = `End break? You've been on break for ${breakMins} minute${breakMins !== 1 ? 's' : ''}.`;
    confirmBtn.textContent = 'End Break';
    confirmBtn.onclick = () => {
      document.getElementById('break-modal').classList.remove('show');
      executeBreakEnd(emp, ts);
    };
  } else {
    const clockInTime = new Date(ts.clock_in);
    const elapsed = Math.floor((Date.now() - clockInTime.getTime()) / 60000);
    const hrs = Math.floor(elapsed / 60);
    const mins = elapsed % 60;
    const elapsedStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;

    msgEl.innerHTML = `You've been clocked in for <strong>${elapsedStr}</strong>.<br>
      <div style="display:flex;gap:8px;margin-top:14px;">
        <button class="btn btn-ghost btn-sm" style="flex:1;" onclick="executeBreakStart(employees.find(e=>e.id==='${emp.id}'),timesheets.find(t=>t.employee_id==='${emp.id}'&&t.date==='${localDateStr(new Date())}'));document.getElementById('break-modal').classList.remove('show')">
          ☕ Start Break
        </button>
      </div>`;
    confirmBtn.textContent = 'Clock Out';
    confirmBtn.onclick = () => {
      document.getElementById('break-modal').classList.remove('show');
      executeClockout(emp, ts);
    };
  }

  modalEl.classList.add('show');
}

function showAlreadyClockedOut(emp) {
  toast(`${emp.first_name} has already clocked out today`);
  renderClockInPage();
}

// ── Unrostered reason confirmed
async function confirmUnrosteredClockin(reason) {
  document.getElementById('unrostered-modal').classList.remove('show');
  const emp = _clockinPendingEmployee;
  _clockinPendingEmployee = null;
  if (!emp) return;
  await executeClockin(emp, reason);
}

// ── Clock In
async function executeClockin(emp, note) {
  const today = localDateStr(new Date());
  const now   = new Date().toISOString();
  const shift = shifts.find(s => s.employee_id === emp.id && s.date === today);

  let ts = timesheets.find(t => t.employee_id === emp.id && t.date === today);
  if (!ts) {
    ts = {
      id:           uid(),
      employee_id:  emp.id,
      date:         today,
      start_time:   shift?.start_time || new Date().toTimeString().slice(0,5),
      end_time:     shift?.end_time   || null,
      break_mins:   null,
      status:       'pending',
      entry_method: 'clock',
      created_at:   now,
    };
  }

  ts.clock_in      = now;
  ts.entry_method  = 'clock';
  ts.clock_in_note = note || null;
  ts.updated_at    = now;

  await dbSaveTimesheet(ts);
  renderClockInPage();
  toast(`${emp.first_name} clocked in ✓`);
}

// ── Break Start
async function executeBreakStart(emp, ts) {
  if (!ts) return;
  ts.break_start = new Date().toISOString();
  ts.updated_at  = new Date().toISOString();
  await dbSaveTimesheet(ts);
  renderClockInPage();
  toast(`${emp.first_name} started break ✓`);
}

// ── Break End
async function executeBreakEnd(emp, ts) {
  if (!ts || !ts.break_start) return;
  const breakStart = new Date(ts.break_start);
  const breakMins  = Math.round((Date.now() - breakStart.getTime()) / 60000);
  ts.break_end   = new Date().toISOString();
  ts.break_mins  = (ts.break_mins || 0) + breakMins;
  ts.updated_at  = new Date().toISOString();
  await dbSaveTimesheet(ts);
  renderClockInPage();
  toast(`${emp.first_name} break ended · ${breakMins}min ✓`);
}

// ── Clock Out
async function executeClockout(emp, ts) {
  if (!ts) return;
  const now    = new Date();
  const endTime = now.toTimeString().slice(0, 5);

  // If still on break, end it first
  if (ts.break_start && !ts.break_end) {
    const breakMins = Math.round((now - new Date(ts.break_start)) / 60000);
    ts.break_end  = now.toISOString();
    ts.break_mins = (ts.break_mins || 0) + breakMins;
  }

  ts.clock_out  = now.toISOString();
  ts.end_time   = endTime;
  ts.updated_at = now.toISOString();

  await dbSaveTimesheet(ts);
  renderClockInPage();
  toast(`${emp.first_name} clocked out ✓`);
}

// ══════════════════════════════════════════════════════
//  MANUAL TIMESHEET ENTRY (manager use — forgot to clock in)
// ══════════════════════════════════════════════════════

function openManualTimesheetModal() {
  // Populate employee dropdown
  const sel = document.getElementById('manual-ts-employee');
  if (sel) {
    sel.innerHTML = employees
      .filter(e => e.active !== false)
      .sort((a, b) => a.first_name.localeCompare(b.first_name))
      .map(e => `<option value="${e.id}">${e.first_name} ${e.last_name}</option>`)
      .join('');
  }

  // Default date to today
  const dateEl = document.getElementById('manual-ts-date');
  if (dateEl) dateEl.value = localDateStr(new Date());

  // Clear fields
  document.getElementById('manual-ts-start').value = '';
  document.getElementById('manual-ts-end').value   = '';
  document.getElementById('manual-ts-break').value = '';
  document.getElementById('manual-ts-note').value  = '';
  document.getElementById('manual-ts-msg').textContent = '';

  document.getElementById('manual-ts-modal').classList.add('show');
}

async function saveManualTimesheet() {
  const empId    = document.getElementById('manual-ts-employee').value;
  const date     = document.getElementById('manual-ts-date').value;
  const start    = document.getElementById('manual-ts-start').value;
  const end      = document.getElementById('manual-ts-end').value;
  const breakMin = parseInt(document.getElementById('manual-ts-break').value) || null;
  const note     = document.getElementById('manual-ts-note').value.trim();
  const msgEl    = document.getElementById('manual-ts-msg');

  if (!empId || !date || !start || !end) {
    msgEl.textContent = 'Employee, date, start and end time are all required.';
    return;
  }

  // Check for duplicate
  const existing = timesheets.find(t => t.employee_id === empId && t.date === date);
  if (existing) {
    msgEl.textContent = 'A timesheet entry already exists for this employee on this date.';
    return;
  }

  const ts = {
    id:           uid(),
    employee_id:  empId,
    date,
    start_time:   start,
    end_time:     end,
    break_mins:   breakMin != null ? breakMin : (calcBreakMins(
      (parseInt(end.split(':')[0]) * 60 + parseInt(end.split(':')[1]) -
       parseInt(start.split(':')[0]) * 60 - parseInt(start.split(':')[1])) / 60
    ) || null),
    status:       'pending',
    entry_method: 'manual',
    clock_in_note: note || 'Manual entry by manager',
    created_at:   new Date().toISOString(),
  };

  await dbSaveTimesheet(ts);
  document.getElementById('manual-ts-modal').classList.remove('show');
  renderTimesheets();
  toast('Timesheet entry added ✓');
}
