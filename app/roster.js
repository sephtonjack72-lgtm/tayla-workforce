/* ══════════════════════════════════════════════════════
   Tayla Workforce — Roster (Tanda-style Gantt)
   roster.js
══════════════════════════════════════════════════════ */

let shifts = JSON.parse(localStorage.getItem('wf_shifts') || '[]');
let _currentWeekStart = getWeekStart(new Date().toISOString().split('T')[0]);
let _expandedDay = new Date().toISOString().split('T')[0]; // default today open

// Timeline config
const TIMELINE_START = 6;  // 6am
const TIMELINE_END   = 26; // 2am next day (26h)
const TIMELINE_HOURS = TIMELINE_END - TIMELINE_START;

// ══════════════════════════════════════════════════════
//  SUPABASE
// ══════════════════════════════════════════════════════

async function dbLoadShifts(weekStart, weekEnd) {
  if (!_businessId) return;
  const { data, error } = await _supabase
    .from('shifts').select('*')
    .eq('business_id', _businessId)
    .gte('date', weekStart).lte('date', weekEnd);
  if (error) { console.error('Load shifts failed:', error); return; }
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
  if (error) { console.error('Save shift failed:', error); toast('⚠ Sync failed: ' + error.message); }
}

async function dbDeleteShift(id) {
  shifts = shifts.filter(s => s.id !== id);
  localStorage.setItem('wf_shifts', JSON.stringify(shifts));
  if (!_businessId) return;
  await _supabase.from('shifts').delete().eq('id', id);
}

// ══════════════════════════════════════════════════════
//  WEEK NAV
// ══════════════════════════════════════════════════════

function getWeekStart(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().split('T')[0];
}

function weekNav(dir) {
  const d = new Date(_currentWeekStart);
  d.setDate(d.getDate() + dir * 7);
  _currentWeekStart = d.toISOString().split('T')[0];
  _expandedDay = _currentWeekStart; // open first day of new week
  renderRoster();
}

function goToCurrentWeek() {
  _currentWeekStart = getWeekStart(new Date().toISOString().split('T')[0]);
  _expandedDay = new Date().toISOString().split('T')[0];
  renderRoster();
}

function toggleDay(date) {
  _expandedDay = _expandedDay === date ? null : date;
  renderRosterAccordion(getWeekDates(_currentWeekStart));
}

// ══════════════════════════════════════════════════════
//  MAIN RENDER
// ══════════════════════════════════════════════════════

function renderRoster() {
  const weekDates = getWeekDates(_currentWeekStart);
  const weekEnd   = weekDates[6];
  const label = document.getElementById('roster-week-label');
  if (label) {
    const s = new Date(_currentWeekStart), e = new Date(weekEnd);
    label.textContent = `${s.toLocaleDateString('en-AU',{day:'numeric',month:'short'})} — ${e.toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'})}`;
  }
  dbLoadShifts(_currentWeekStart, weekEnd).then(() => {
    renderRosterKPIs(weekDates);
    renderRosterAccordion(weekDates);
  });
}

function renderRosterKPIs(weekDates) {
  const el = document.getElementById('roster-kpis');
  if (!el) return;
  const weekShifts = shifts.filter(s => weekDates.includes(s.date) && s.status !== 'cancelled');
  const activeEmps = employees.filter(e => e.active !== false);
  let totalHours = 0, totalCost = 0;
  activeEmps.forEach(emp => {
    const empShifts = weekShifts.filter(s => s.employee_id === emp.id);
    const pay = calcWeeklyPay(empShifts, emp);
    totalHours += pay.totalHours;
    totalCost  += pay.totalPay;
  });
  const staffed = new Set(weekShifts.map(s => s.employee_id)).size;
  // Week SPCH from sales
  let weekProj = 0;
  weekDates.forEach(d => { const s = getSalesSummary(d); if (s.proj) weekProj += s.proj; });
  const weekSpch = weekProj && totalHours ? (weekProj / totalHours).toFixed(2) : null;

  el.innerHTML = `
    <div class="kpi"><div class="kpi-label">Shifts This Week</div><div class="kpi-value">${weekShifts.length}</div></div>
    <div class="kpi"><div class="kpi-label">Staff Rostered</div><div class="kpi-value">${staffed} / ${activeEmps.length}</div></div>
    <div class="kpi"><div class="kpi-label">Total Hours</div><div class="kpi-value">${totalHours.toFixed(1)}h</div></div>
    <div class="kpi"><div class="kpi-label">Est. Labour Cost</div><div class="kpi-value negative">${fmt(totalCost)}</div></div>
    ${weekSpch ? `<div class="kpi"><div class="kpi-label">Week SPCH</div><div class="kpi-value" style="color:var(--success);">$${weekSpch}</div></div>` : ''}
  `;
}

// ══════════════════════════════════════════════════════
//  ACCORDION (day-by-day)
// ══════════════════════════════════════════════════════

const DAY_NAMES_LONG = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

function renderRosterAccordion(weekDates) {
  const container = document.getElementById('roster-accordion');
  if (!container) return;
  const today = new Date().toISOString().split('T')[0];

  container.innerHTML = weekDates.map((date, i) => {
    const isOpen    = _expandedDay === date;
    const isToday   = date === today;
    const isPH      = isPublicHoliday(date);
    const dayShifts = shifts.filter(s => s.date === date && s.status !== 'cancelled');
    const activeEmps = employees.filter(e => e.active !== false);

    // Day totals
    let dayHours = 0, dayCost = 0;
    activeEmps.forEach(emp => {
      const empShifts = dayShifts.filter(s => s.employee_id === emp.id);
      empShifts.forEach(s => {
        const p = calcShiftPay(s, emp);
        dayHours += p.workedHours;
        dayCost  += p.totalPay;
      });
    });

    // SPCH
    const { proj, target, trend } = getSalesSummary(date);
    const displaySales = proj || trend;
    const spch = displaySales && dayHours ? (displaySales / dayHours).toFixed(2) : null;
    const spchCol = spch && target ? spchColour(parseFloat(spch), target) :
                    spch ? 'var(--text2)' : 'var(--text3)';
    const staffedToday = new Set(dayShifts.map(s => s.employee_id)).size;

    return `
      <div class="day-accordion ${isOpen ? 'open' : ''} ${isToday ? 'today' : ''}" data-date="${date}">

        <!-- Day header — always visible -->
        <div class="day-accordion-header" onclick="toggleDay('${date}')">
          <div style="display:flex;align-items:center;gap:14px;">
            <div class="day-chevron">${isOpen ? '▾' : '▸'}</div>
            <div>
              <div style="font-weight:700;font-size:14px;">
                ${DAY_NAMES_LONG[i]}
                ${isToday ? '<span style="font-size:10px;background:var(--accent2);color:var(--accent);padding:2px 7px;border-radius:99px;margin-left:6px;font-weight:700;">TODAY</span>' : ''}
                ${isPH ? '<span style="font-size:10px;background:#fde2e2;color:var(--danger);padding:2px 7px;border-radius:99px;margin-left:4px;">PH 250%</span>' : ''}
              </div>
              <div style="font-size:11px;color:var(--text3);">${new Date(date).toLocaleDateString('en-AU',{day:'numeric',month:'long'})}</div>
            </div>
          </div>

          <div style="display:flex;align-items:center;gap:24px;">
            <!-- Shift count chip -->
            <div style="text-align:center;">
              <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;">Shifts</div>
              <div style="font-weight:700;font-size:16px;">${dayShifts.length}</div>
            </div>
            <!-- Hours chip -->
            <div style="text-align:center;">
              <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;">Hours</div>
              <div style="font-weight:700;font-size:16px;">${dayHours.toFixed(1)}h</div>
            </div>
            <!-- Labour cost chip -->
            <div style="text-align:center;">
              <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;">Labour</div>
              <div style="font-weight:700;font-size:16px;color:var(--danger);">${fmt(dayCost)}</div>
            </div>
            <!-- SPCH chip -->
            <div style="text-align:center;min-width:64px;">
              <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;">SPCH</div>
              <div style="font-weight:700;font-size:16px;color:${spchCol};">${spch ? '$'+spch : '—'}</div>
              ${displaySales ? `<div style="font-size:10px;color:var(--text3);">$${(displaySales/1000).toFixed(1)}k ${proj ? '' : '(trend)'}</div>` : ''}
            </div>
            <!-- Add shift button -->
            <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();openAddShift('','${date}')" style="white-space:nowrap;">+ Add Shift</button>
          </div>
        </div>

        <!-- Day body — Gantt timeline -->
        <div class="day-accordion-body" id="day-body-${date}">
          ${isOpen ? buildGanttDay(date, dayShifts, activeEmps) : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ══════════════════════════════════════════════════════
//  GANTT TIMELINE
// ══════════════════════════════════════════════════════

function timeToX(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  let hours = h + m / 60;
  if (hours < TIMELINE_START) hours += 24; // overnight
  return Math.max(0, Math.min(100, ((hours - TIMELINE_START) / TIMELINE_HOURS) * 100));
}

function xToTime(pct) {
  const totalHours = TIMELINE_START + (pct / 100) * TIMELINE_HOURS;
  const h = Math.floor(totalHours) % 24;
  const m = Math.round((totalHours % 1) * 60 / 15) * 15 % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function buildGanttDay(date, dayShifts, activeEmps) {
  const hourLabels = [];
  for (let h = TIMELINE_START; h <= TIMELINE_END; h++) {
    const label = h >= 24 ? `${h-24}am` : h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h-12}pm`;
    const pct = ((h - TIMELINE_START) / TIMELINE_HOURS) * 100;
    hourLabels.push({ label, pct });
  }

  // Employees with shifts first, then rest
  const empWithShifts = activeEmps.filter(e => dayShifts.some(s => s.employee_id === e.id));
  const empWithout    = activeEmps.filter(e => !dayShifts.some(s => s.employee_id === e.id));
  const orderedEmps   = [...empWithShifts, ...empWithout];

  // Now line
  const nowPct = (() => {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    if (date !== todayStr) return null;
    const h = now.getHours() + now.getMinutes() / 60;
    if (h < TIMELINE_START || h > TIMELINE_END) return null;
    return ((h - TIMELINE_START) / TIMELINE_HOURS) * 100;
  })();

  return `
    <div class="gantt-wrap">
      <!-- Hour header -->
      <div class="gantt-header">
        <div class="gantt-emp-col"></div>
        <div class="gantt-timeline-col" style="position:relative;">
          ${hourLabels.map(({label, pct}) => `
            <div style="position:absolute;left:${pct}%;transform:translateX(-50%);font-size:10px;color:var(--text3);white-space:nowrap;">${label}</div>
          `).join('')}
        </div>
      </div>

      <!-- Grid lines + now line overlay -->
      <div class="gantt-body" id="gantt-body-${date}">
        <!-- Hour grid lines -->
        ${hourLabels.map(({pct}) => `
          <div class="gantt-gridline" style="left:calc(160px + (100% - 160px) * ${pct/100});"></div>
        `).join('')}
        ${nowPct !== null ? `<div class="gantt-now-line" style="left:calc(160px + (100% - 160px) * ${nowPct/100});"></div>` : ''}

        <!-- Employee rows -->
        ${orderedEmps.map(emp => buildGanttRow(emp, date, dayShifts.filter(s => s.employee_id === emp.id))).join('')}
      </div>
    </div>
  `;
}

function buildGanttRow(emp, date, empShifts) {
  const initials = ((emp.first_name?.[0]||'')+(emp.last_name?.[0]||'')).toUpperCase();
  const weekPay  = calcWeeklyPay(
    shifts.filter(s => s.employee_id === emp.id && s.date === date && s.status !== 'cancelled'), emp
  );

  return `
    <div class="gantt-row" id="gantt-row-${emp.id}-${date}">
      <!-- Employee label -->
      <div class="gantt-emp-col">
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="avatar" style="width:26px;height:26px;font-size:9px;flex-shrink:0;">${initials}</div>
          <div style="min-width:0;">
            <div style="font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${emp.first_name} ${emp.last_name}</div>
            <div style="font-size:10px;color:var(--text3);">${emp.employment_type||'casual'} · ${weekPay.totalHours}h · ${fmt(weekPay.totalPay)}</div>
          </div>
        </div>
      </div>

      <!-- Timeline track -->
      <div class="gantt-track" onclick="handleTrackClick(event,'${emp.id}','${date}')">
        ${empShifts.map(shift => buildShiftBar(shift, emp)).join('')}
      </div>
    </div>
  `;
}

function buildShiftBar(shift, emp) {
  const left  = timeToX(shift.start_time);
  const right = timeToX(shift.end_time);
  const width = Math.max(right - left, 1.5);
  const pay   = calcShiftPay(shift, emp);
  const type  = emp.employment_type || 'casual';
  const colours = { permanent:'var(--accent)', casual:'#4f8ef7', parttime:'#805ad5' };
  const bg = colours[type] || colours.casual;

  return `
    <div class="shift-bar"
      id="bar-${shift.id}"
      style="left:${left}%;width:${width}%;background:${bg};"
      title="${fmtTime(shift.start_time)}–${fmtTime(shift.end_time)} · ${pay.workedHours}h · ${fmt(pay.totalPay)}"
      onclick="event.stopPropagation();openEditShift('${shift.id}')"
      onmousedown="startDragShift(event,'${shift.id}')"
    >
      <div class="shift-bar-resize-left"  onmousedown="event.stopPropagation();startResizeShift(event,'${shift.id}','start')"></div>
      <div class="shift-bar-label">
        <span>${fmtTime(shift.start_time)}–${fmtTime(shift.end_time)}</span>
        <span style="opacity:.75;">${pay.workedHours}h · ${fmt(pay.totalPay)}</span>
      </div>
      <div class="shift-bar-resize-right" onmousedown="event.stopPropagation();startResizeShift(event,'${shift.id}','end')"></div>
    </div>
  `;
}

// ── Refresh just one Gantt row (after drag/resize) ─────
function refreshGanttRow(shiftId) {
  const shift = shifts.find(s => s.id === shiftId);
  if (!shift) return;
  const emp = employees.find(e => e.id === shift.employee_id);
  if (!emp) return;
  const rowEl = document.getElementById(`gantt-row-${emp.id}-${shift.date}`);
  if (!rowEl) return;
  const empShifts = shifts.filter(s => s.employee_id === emp.id && s.date === shift.date && s.status !== 'cancelled');
  rowEl.outerHTML = buildGanttRow(emp, shift.date, empShifts);
  // re-attach drag listeners — they're inline so nothing extra needed
  refreshDayHeader(shift.date);
}

function refreshDayHeader(date) {
  // Recompute hours/cost/SPCH for the collapsed header without full re-render
  const dayShifts  = shifts.filter(s => s.date === date && s.status !== 'cancelled');
  const activeEmps = employees.filter(e => e.active !== false);
  let dayHours=0, dayCost=0;
  activeEmps.forEach(emp => {
    dayShifts.filter(s=>s.employee_id===emp.id).forEach(s => {
      const p = calcShiftPay(s, emp);
      dayHours += p.workedHours;
      dayCost  += p.totalPay;
    });
  });
  const { proj, target, trend } = getSalesSummary(date);
  const displaySales = proj || trend;
  const spch = displaySales && dayHours ? (displaySales / dayHours).toFixed(2) : null;
  const spchCol = spch && target ? spchColour(parseFloat(spch), target) : 'var(--text2)';

  const header = document.querySelector(`.day-accordion[data-date="${date}"] .day-accordion-header`);
  if (!header) return;
  const chips = header.querySelectorAll('.day-accordion-header > div:last-child > div');
  if (chips[1]) chips[1].querySelector('div:last-child').textContent = `${dayHours.toFixed(1)}h`;
  if (chips[2]) chips[2].querySelector('div:last-child').textContent = fmt(dayCost);
  if (chips[3]) {
    chips[3].querySelector('div:nth-child(2)').textContent = spch ? `$${spch}` : '—';
    chips[3].querySelector('div:nth-child(2)').style.color = spchCol;
  }
}

// Called from sales.js when sales data changes
function refreshRosterDaySpch(date) {
  refreshDayHeader(date);
}

// ══════════════════════════════════════════════════════
//  DRAG + RESIZE
// ══════════════════════════════════════════════════════

let _drag = null;

function getTrackRect(shiftId) {
  const bar = document.getElementById(`bar-${shiftId}`);
  return bar?.closest('.gantt-track')?.getBoundingClientRect() || null;
}

function startDragShift(e, shiftId) {
  if (e.target.classList.contains('shift-bar-resize-left') || e.target.classList.contains('shift-bar-resize-right')) return;
  e.preventDefault();
  const shift = shifts.find(s => s.id === shiftId);
  if (!shift) return;
  const rect = getTrackRect(shiftId);
  if (!rect) return;
  const startPct = timeToX(shift.start_time);
  const endPct   = timeToX(shift.end_time);
  const width    = endPct - startPct;
  const clickPct = ((e.clientX - rect.left) / rect.width) * 100;
  _drag = { type:'move', shiftId, rect, width, offset: clickPct - startPct };
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);
  document.body.style.cursor = 'grabbing';
  document.body.style.userSelect = 'none';
}

function startResizeShift(e, shiftId, side) {
  e.preventDefault();
  const rect = getTrackRect(shiftId);
  if (!rect) return;
  _drag = { type:'resize', shiftId, rect, side };
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);
  document.body.style.cursor = 'ew-resize';
  document.body.style.userSelect = 'none';
}

function onDragMove(e) {
  if (!_drag) return;
  const { type, shiftId, rect, width, offset, side } = _drag;
  const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
  const bar = document.getElementById(`bar-${shiftId}`);
  if (!bar) return;

  if (type === 'move') {
    const newLeft = Math.max(0, Math.min(100 - width, pct - offset));
    bar.style.left  = newLeft + '%';
    bar.style.width = width + '%';
    // Live label update
    const newStart = xToTime(newLeft);
    const newEnd   = xToTime(newLeft + width);
    const labelEl  = bar.querySelector('.shift-bar-label span');
    if (labelEl) labelEl.textContent = `${fmtTime(newStart)}–${fmtTime(newEnd)}`;
  } else {
    const shift = shifts.find(s => s.id === shiftId);
    if (!shift) return;
    if (side === 'start') {
      const curEnd = timeToX(shift.end_time);
      const newLeft = Math.min(pct, curEnd - 1.5);
      bar.style.left  = Math.max(0,newLeft) + '%';
      bar.style.width = (curEnd - Math.max(0,newLeft)) + '%';
    } else {
      const curLeft = timeToX(shift.start_time);
      bar.style.width = Math.max(1.5, pct - curLeft) + '%';
    }
  }
}

async function onDragEnd(e) {
  if (!_drag) return;
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';

  const { type, shiftId, rect, width, offset, side } = _drag;
  _drag = null;

  const shift = shifts.find(s => s.id === shiftId);
  const bar   = document.getElementById(`bar-${shiftId}`);
  if (!shift || !bar) return;

  const leftPct  = parseFloat(bar.style.left);
  const widthPct = parseFloat(bar.style.width);

  let newStart = shift.start_time;
  let newEnd   = shift.end_time;

  if (type === 'move') {
    newStart = xToTime(leftPct);
    newEnd   = xToTime(leftPct + widthPct);
  } else if (side === 'start') {
    newStart = xToTime(leftPct);
  } else {
    newEnd = xToTime(leftPct + widthPct);
  }

  shift.start_time = newStart;
  shift.end_time   = newEnd;
  shift.break_mins = null; // recalc on next render

  await dbSaveShift(shift);
  refreshGanttRow(shiftId);
  toast(`Shift updated: ${fmtTime(newStart)}–${fmtTime(newEnd)}`);
}

// Click on empty track area → add shift
function handleTrackClick(e, empId, date) {
  if (e.target.classList.contains('shift-bar') || e.target.closest('.shift-bar')) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const pct  = ((e.clientX - rect.left) / rect.width) * 100;
  const clickedTime = xToTime(pct);
  // round to nearest hour for start, add 4h for end
  const [ch, cm] = clickedTime.split(':').map(Number);
  const startH = String(ch).padStart(2,'0');
  const endH   = String((ch + 4) % 24).padStart(2,'0');
  openAddShift(empId, date, `${startH}:00`, `${endH}:00`);
}

// ══════════════════════════════════════════════════════
//  SHIFT MODAL
// ══════════════════════════════════════════════════════

function openAddShift(employeeId, date, startTime, endTime) {
  document.getElementById('shift-modal-title').textContent = 'Add Shift';
  document.getElementById('shift-edit-id').value  = '';
  document.getElementById('shift-employee').value = employeeId || '';
  document.getElementById('shift-date').value     = date || new Date().toISOString().split('T')[0];
  document.getElementById('shift-start').value    = startTime || '09:00';
  document.getElementById('shift-end').value      = endTime   || '17:00';
  document.getElementById('shift-break').value    = '';
  document.getElementById('shift-notes').value    = '';
  document.getElementById('shift-status').value   = 'published';
  populateShiftEmployeeSelect();
  updateShiftPreview();
  document.getElementById('shift-modal').classList.add('show');
}

function openEditShift(shiftId) {
  const s = shifts.find(s => s.id === shiftId);
  if (!s) return;
  document.getElementById('shift-modal-title').textContent = 'Edit Shift';
  document.getElementById('shift-edit-id').value   = s.id;
  document.getElementById('shift-employee').value  = s.employee_id || '';
  document.getElementById('shift-date').value      = s.date;
  document.getElementById('shift-start').value     = s.start_time;
  document.getElementById('shift-end').value       = s.end_time;
  document.getElementById('shift-break').value     = s.break_mins || '';
  document.getElementById('shift-notes').value     = s.notes || '';
  document.getElementById('shift-status').value    = s.status || 'published';
  populateShiftEmployeeSelect();
  updateShiftPreview();
  document.getElementById('shift-modal').classList.add('show');
}

function updateShiftPreview() {
  const empId  = document.getElementById('shift-employee').value;
  const date   = document.getElementById('shift-date').value;
  const start  = document.getElementById('shift-start').value;
  const end    = document.getElementById('shift-end').value;
  const breakM = parseInt(document.getElementById('shift-break').value) || null;
  const preview = document.getElementById('shift-pay-preview');
  if (!preview || !empId || !date || !start || !end) return;
  const emp = employees.find(e => e.id === empId);
  if (!emp) { preview.innerHTML = ''; return; }
  const shift = { employee_id: empId, date, start_time: start, end_time: end, break_mins: breakM };
  const pay   = calcShiftPay(shift, emp);
  const autoBreak = calcBreakMins(
    ((parseInt(end.split(':')[0])*60+parseInt(end.split(':')[1])) -
     (parseInt(start.split(':')[0])*60+parseInt(start.split(':')[1]))) / 60
  );
  preview.innerHTML = `
    <div style="background:var(--bg);border-radius:8px;padding:12px 14px;font-size:12px;margin-top:12px;">
      <div style="font-weight:600;margin-bottom:8px;">Pay Preview — ${emp.first_name} ${emp.last_name}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;color:var(--text2);">
        <span>Rate type</span><span style="font-weight:500;color:var(--text);">${penaltyLabel(pay.penaltyKey)} (${(pay.multiplier*100).toFixed(0)}%)</span>
        <span>Base rate</span><span class="mono">${fmt(pay.baseRate)}/hr</span>
        <span>Hourly rate</span><span class="mono">${fmt(pay.hourlyRate)}/hr</span>
        <span>Hours worked</span><span class="mono">${pay.workedHours}h</span>
        ${pay.isMinimumEngagement ? `<span style="color:var(--warning);">Min engagement</span><span class="mono" style="color:var(--warning);">${MIN_ENGAGEMENT_HOURS}h applied</span>` : ''}
        ${autoBreak > 0 ? `<span>Break</span><span class="mono">${autoBreak}min unpaid</span>` : ''}
        ${pay.laundryAllowance > 0 ? `<span>Laundry</span><span class="mono">${fmt(pay.laundryAllowance)}</span>` : ''}
        <span style="font-weight:700;color:var(--text);">Estimated pay</span><span class="mono" style="font-weight:700;font-size:14px;">${fmt(pay.totalPay)}</span>
      </div>
      ${isPublicHoliday(date) ? '<div style="color:var(--danger);margin-top:8px;font-size:11px;">🎉 Public holiday — 250% rate applies</div>' : ''}
    </div>
  `;
}

async function saveShift() {
  const editId    = document.getElementById('shift-edit-id').value;
  const empId     = document.getElementById('shift-employee').value;
  const date      = document.getElementById('shift-date').value;
  const startTime = document.getElementById('shift-start').value;
  const endTime   = document.getElementById('shift-end').value;
  const breakMins = parseInt(document.getElementById('shift-break').value) || null;
  const notes     = document.getElementById('shift-notes').value.trim();
  const status    = document.getElementById('shift-status').value;
  if (!empId) { toast('Please select an employee'); return; }
  if (!date || !startTime || !endTime) { toast('Date and times required'); return; }
  const shift = {
    id: editId || uid(),
    employee_id: empId, date,
    start_time: startTime, end_time: endTime,
    break_mins: breakMins, notes, status,
  };
  await dbSaveShift(shift);
  closeModal('shift-modal');
  // Refresh just the affected day
  const dayBody = document.getElementById(`day-body-${date}`);
  if (dayBody && _expandedDay === date) {
    const dayShifts = shifts.filter(s => s.date === date && s.status !== 'cancelled');
    dayBody.innerHTML = buildGanttDay(date, dayShifts, employees.filter(e => e.active !== false));
  }
  refreshDayHeader(date);
  renderRosterKPIs(getWeekDates(_currentWeekStart));
  toast(`Shift ${editId ? 'updated' : 'added'} ✓`);
}

async function deleteShiftConfirm() {
  const id = document.getElementById('shift-edit-id').value;
  if (!id || !confirm('Delete this shift?')) return;
  const shift = shifts.find(s => s.id === id);
  const date  = shift?.date;
  await dbDeleteShift(id);
  closeModal('shift-modal');
  if (date) {
    const dayBody = document.getElementById(`day-body-${date}`);
    if (dayBody && _expandedDay === date) {
      const dayShifts = shifts.filter(s => s.date === date && s.status !== 'cancelled');
      dayBody.innerHTML = buildGanttDay(date, dayShifts, employees.filter(e => e.active !== false));
    }
    refreshDayHeader(date);
    renderRosterKPIs(getWeekDates(_currentWeekStart));
  }
  toast('Shift deleted');
}

function populateShiftEmployeeSelect() {
  const sel = document.getElementById('shift-employee');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Select employee…</option>' +
    employees.filter(e => e.active !== false).map(e =>
      `<option value="${e.id}" ${e.id===cur?'selected':''}>${e.first_name} ${e.last_name} (${e.employment_type||'casual'})</option>`
    ).join('');
}
