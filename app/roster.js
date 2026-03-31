/* ══════════════════════════════════════════════════════
   Tayla Workforce — Roster
   roster.js
══════════════════════════════════════════════════════ */

let shifts = JSON.parse(localStorage.getItem('wf_shifts') || '[]');
let _currentWeekStart = getWeekStart(new Date().toISOString().split('T')[0]);

// ══════════════════════════════════════════════════════
//  SUPABASE
// ══════════════════════════════════════════════════════

async function dbLoadShifts(weekStart, weekEnd) {
  if (!_businessId) return;
  const { data, error } = await _supabase
    .from('shifts').select('*')
    .eq('business_id', _businessId)
    .gte('date', weekStart)
    .lte('date', weekEnd);
  if (error) { console.error('Load shifts failed:', error); return; }
  // Merge with existing (keep other weeks)
  const other = shifts.filter(s => s.date < weekStart || s.date > weekEnd);
  shifts = [...other, ...(data || [])];
  localStorage.setItem('wf_shifts', JSON.stringify(shifts));
}

async function dbSaveShift(shift) {
  const idx = shifts.findIndex(s => s.id === shift.id);
  if (idx >= 0) shifts[idx] = shift; else shifts.push(shift);
  localStorage.setItem('wf_shifts', JSON.stringify(shifts));
  if (!_businessId) return;
  const { error } = await _supabase
    .from('shifts').upsert({ ...shift, business_id: _businessId }, { onConflict: 'id' });
  if (error) { console.error('Save shift failed:', error); toast('⚠ Failed to sync: ' + error.message); }
}

async function dbDeleteShift(id) {
  shifts = shifts.filter(s => s.id !== id);
  localStorage.setItem('wf_shifts', JSON.stringify(shifts));
  if (!_businessId) return;
  await _supabase.from('shifts').delete().eq('id', id);
}

// ══════════════════════════════════════════════════════
//  WEEK NAVIGATION
// ══════════════════════════════════════════════════════

function getWeekStart(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}

function weekNav(direction) {
  const d = new Date(_currentWeekStart);
  d.setDate(d.getDate() + direction * 7);
  _currentWeekStart = d.toISOString().split('T')[0];
  renderRoster();
}

function goToCurrentWeek() {
  _currentWeekStart = getWeekStart(new Date().toISOString().split('T')[0]);
  renderRoster();
}

// ══════════════════════════════════════════════════════
//  ROSTER RENDER
// ══════════════════════════════════════════════════════

function renderRoster() {
  const weekDates = getWeekDates(_currentWeekStart);
  const weekEnd   = weekDates[6];

  // Load shifts for this week from Supabase
  dbLoadShifts(_currentWeekStart, weekEnd).then(() => renderRosterGrid(weekDates));

  // Update week label
  const label = document.getElementById('roster-week-label');
  if (label) {
    const start = new Date(_currentWeekStart);
    const end   = new Date(weekEnd);
    label.textContent = `${start.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} — ${end.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }

  renderRosterKPIs(weekDates);
}

function renderRosterGrid(weekDates) {
  const grid = document.getElementById('roster-grid');
  if (!grid) return;

  const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const today = new Date().toISOString().split('T')[0];

  // Header row
  let html = `<div class="roster-header" style="grid-column:1;">Employee</div>`;
  weekDates.forEach((date, i) => {
    const isToday = date === today;
    const isPH    = isPublicHoliday(date);
    const d       = new Date(date);
    html += `
      <div class="roster-header" style="
        ${isToday ? 'background:rgba(232,197,71,.15);color:var(--accent);' : ''}
        ${isPH ? 'background:rgba(229,62,62,.08);' : ''}
      ">
        <div>${DAY_NAMES[i]}</div>
        <div style="font-size:10px;font-weight:400;color:var(--text3);">${d.getDate()}/${d.getMonth()+1}${isPH ? ' 🎉' : ''}</div>
      </div>
    `;
  });

  // Employee rows
  const activeEmps = employees.filter(e => e.active !== false);
  if (!activeEmps.length) {
    grid.innerHTML = html + `<div style="grid-column:1/-1;padding:32px;text-align:center;color:var(--text3);font-size:13px;">No active employees. Add employees first.</div>`;
    return;
  }

  activeEmps.forEach(emp => {
    const initials = ((emp.first_name?.[0] || '') + (emp.last_name?.[0] || '')).toUpperCase();
    const weekPay  = calcWeeklyPay(
      shifts.filter(s => s.employee_id === emp.id && weekDates.includes(s.date) && s.status !== 'cancelled'),
      emp
    );

    html += `
      <div class="roster-employee">
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="avatar" style="width:28px;height:28px;font-size:10px;">${initials}</div>
          <div>
            <div style="font-weight:600;font-size:12px;">${emp.first_name} ${emp.last_name}</div>
            <div style="font-size:10px;color:var(--text3);">${emp.employment_type || 'casual'}</div>
          </div>
        </div>
        <div style="font-size:10px;color:var(--text3);margin-top:4px;">${weekPay.totalHours}h · ${fmt(weekPay.totalPay)}</div>
      </div>
    `;

    weekDates.forEach(date => {
      const dayShifts = shifts.filter(s => s.employee_id === emp.id && s.date === date && s.status !== 'cancelled');
      const isWeekend = new Date(date).getDay() === 0 || new Date(date).getDay() === 6;
      const isPH      = isPublicHoliday(date);

      html += `
        <div class="roster-cell ${isWeekend ? 'weekend' : ''}" onclick="openAddShift('${emp.id}','${date}')"
          style="${isPH ? 'background:rgba(229,62,62,.04);' : ''}">
          ${dayShifts.map(s => {
            const pay = calcShiftPay(s, emp);
            const empType = emp.employment_type || 'casual';
            return `
              <div class="shift-block ${empType}" onclick="event.stopPropagation();openEditShift('${s.id}')" title="${fmtTime(s.start_time)}–${fmtTime(s.end_time)} · ${fmt(pay.totalPay)}">
                ${fmtTime(s.start_time)}–${fmtTime(s.end_time)}
                <div style="font-size:9px;opacity:.8;">${pay.billableHours}h · ${fmt(pay.totalPay)}</div>
              </div>
            `;
          }).join('')}
          <div style="font-size:10px;color:rgba(26,26,46,.2);text-align:center;padding-top:${dayShifts.length ? '2px' : '16px'};">+</div>
        </div>
      `;
    });
  });

  grid.innerHTML = html;
}

function renderRosterKPIs(weekDates) {
  const el = document.getElementById('roster-kpis');
  if (!el) return;

  const weekShifts = shifts.filter(s => weekDates.includes(s.date) && s.status !== 'cancelled');
  const activeEmps = employees.filter(e => e.active !== false);

  let totalHours = 0, totalCost = 0, totalShifts = weekShifts.length;
  activeEmps.forEach(emp => {
    const empShifts = weekShifts.filter(s => s.employee_id === emp.id);
    const pay = calcWeeklyPay(empShifts, emp);
    totalHours += pay.totalHours;
    totalCost  += pay.totalPay;
  });

  const staffed = new Set(weekShifts.map(s => s.employee_id)).size;

  el.innerHTML = `
    <div class="kpi"><div class="kpi-label">Shifts This Week</div><div class="kpi-value">${totalShifts}</div></div>
    <div class="kpi"><div class="kpi-label">Staff Rostered</div><div class="kpi-value">${staffed} / ${activeEmps.length}</div></div>
    <div class="kpi"><div class="kpi-label">Total Hours</div><div class="kpi-value">${totalHours.toFixed(1)}h</div></div>
    <div class="kpi"><div class="kpi-label">Est. Labour Cost</div><div class="kpi-value negative">${fmt(totalCost)}</div></div>
  `;
}

// ══════════════════════════════════════════════════════
//  SHIFT MODAL
// ══════════════════════════════════════════════════════

let _editingShiftId = null;

function openAddShift(employeeId, date) {
  _editingShiftId = null;
  document.getElementById('shift-modal-title').textContent = 'Add Shift';
  document.getElementById('shift-edit-id').value  = '';
  document.getElementById('shift-employee').value = employeeId || '';
  document.getElementById('shift-date').value     = date || new Date().toISOString().split('T')[0];
  document.getElementById('shift-start').value    = '09:00';
  document.getElementById('shift-end').value      = '17:00';
  document.getElementById('shift-break').value    = '';
  document.getElementById('shift-notes').value    = '';
  document.getElementById('shift-status').value   = 'draft';
  updateShiftPreview();
  document.getElementById('shift-modal').classList.add('show');
}

function openEditShift(shiftId) {
  const s = shifts.find(s => s.id === shiftId);
  if (!s) return;
  _editingShiftId = shiftId;
  document.getElementById('shift-modal-title').textContent = 'Edit Shift';
  document.getElementById('shift-edit-id').value   = s.id;
  document.getElementById('shift-employee').value  = s.employee_id || '';
  document.getElementById('shift-date').value      = s.date;
  document.getElementById('shift-start').value     = s.start_time;
  document.getElementById('shift-end').value       = s.end_time;
  document.getElementById('shift-break').value     = s.break_mins || '';
  document.getElementById('shift-notes').value     = s.notes || '';
  document.getElementById('shift-status').value    = s.status || 'draft';
  updateShiftPreview();
  document.getElementById('shift-modal').classList.add('show');
}

function updateShiftPreview() {
  const empId   = document.getElementById('shift-employee').value;
  const date    = document.getElementById('shift-date').value;
  const start   = document.getElementById('shift-start').value;
  const end     = document.getElementById('shift-end').value;
  const breakM  = parseInt(document.getElementById('shift-break').value) || null;
  const preview = document.getElementById('shift-pay-preview');
  if (!preview || !empId || !date || !start || !end) return;

  const emp = employees.find(e => e.id === empId);
  if (!emp) { preview.innerHTML = ''; return; }

  const shift = { employee_id: empId, date, start_time: start, end_time: end, break_mins: breakM };
  const pay   = calcShiftPay(shift, emp);

  const autoBreak = calcBreakMins((
    (parseInt(end.split(':')[0]) * 60 + parseInt(end.split(':')[1])) -
    (parseInt(start.split(':')[0]) * 60 + parseInt(start.split(':')[1]))
  ) / 60);

  preview.innerHTML = `
    <div style="background:var(--bg);border-radius:8px;padding:12px 14px;font-size:12px;margin-top:12px;">
      <div style="font-weight:600;margin-bottom:8px;">Pay Preview — ${emp.first_name} ${emp.last_name}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;color:var(--text2);">
        <span>Rate type</span><span style="font-weight:500;color:var(--text);">${penaltyLabel(pay.penaltyKey)} (${(pay.multiplier * 100).toFixed(0)}%)</span>
        <span>Base rate</span><span class="mono">${fmt(pay.baseRate)}/hr</span>
        <span>Hourly rate</span><span class="mono">${fmt(pay.hourlyRate)}/hr</span>
        <span>Hours worked</span><span class="mono">${pay.workedHours}h</span>
        ${pay.isMinimumEngagement ? `<span style="color:var(--warning);">Min engagement</span><span class="mono" style="color:var(--warning);">${MIN_ENGAGEMENT_HOURS}h applied</span>` : ''}
        ${autoBreak > 0 ? `<span>Break</span><span class="mono">${autoBreak} min ${autoBreak === 30 ? '(unpaid)' : '(paid)'}</span>` : ''}
        ${pay.laundryAllowance > 0 ? `<span>Laundry allowance</span><span class="mono">${fmt(pay.laundryAllowance)}</span>` : ''}
        <span style="font-weight:700;color:var(--text);">Estimated pay</span><span class="mono" style="font-weight:700;font-size:14px;">${fmt(pay.totalPay)}</span>
      </div>
      ${isPublicHoliday(date) ? '<div style="color:var(--danger);margin-top:8px;font-size:11px;">🎉 Public holiday — 250% rate applies</div>' : ''}
    </div>
  `;
}

async function saveShift() {
  const editId     = document.getElementById('shift-edit-id').value;
  const employeeId = document.getElementById('shift-employee').value;
  const date       = document.getElementById('shift-date').value;
  const startTime  = document.getElementById('shift-start').value;
  const endTime    = document.getElementById('shift-end').value;
  const breakMins  = parseInt(document.getElementById('shift-break').value) || null;
  const notes      = document.getElementById('shift-notes').value.trim();
  const status     = document.getElementById('shift-status').value;

  if (!employeeId) { toast('Please select an employee'); return; }
  if (!date || !startTime || !endTime) { toast('Date and times are required'); return; }

  const shift = {
    id: editId || uid(),
    employee_id: employeeId,
    date, start_time: startTime, end_time: endTime,
    break_mins: breakMins, notes, status,
    created_at: editId ? undefined : new Date().toISOString(),
  };
  if (!editId) delete shift.created_at;

  await dbSaveShift(shift);
  closeModal('shift-modal');
  renderRoster();
  toast(`Shift ${editId ? 'updated' : 'added'} ✓`);
}

async function deleteShiftConfirm() {
  const id = document.getElementById('shift-edit-id').value;
  if (!id || !confirm('Delete this shift?')) return;
  await dbDeleteShift(id);
  closeModal('shift-modal');
  renderRoster();
  toast('Shift deleted');
}

function populateShiftEmployeeSelect() {
  const sel = document.getElementById('shift-employee');
  if (!sel) return;
  sel.innerHTML = '<option value="">Select employee…</option>' +
    employees.filter(e => e.active !== false).map(e =>
      `<option value="${e.id}">${e.first_name} ${e.last_name} (${e.employment_type || 'casual'})</option>`
    ).join('');
}
