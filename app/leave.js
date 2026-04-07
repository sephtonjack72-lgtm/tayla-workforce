/* ══════════════════════════════════════════════════════
   Tayla Workforce — Leave Management
   leave.js

   Handles leave balances, accrual, requests and payouts
   Fair Work Act 2009 compliant
══════════════════════════════════════════════════════ */

// ── Leave accrual rates (Fair Work)
const LEAVE_ACCRUAL = {
  annual: {
    permanent: 4 / 52,       // 4 weeks per year = 0.07692 weeks per week worked
    parttime:  4 / 52,       // Same rate, pro-rata based on hours
    casual:    0,             // No annual leave for casuals
  },
  sick: {
    permanent: 10 / 52 / 5,  // 10 days per year = 0.03846 days per day worked
    parttime:  10 / 52 / 5,
    casual:    0,
  },
};

const LEAVE_LOADING_RATE = 0.175; // 17.5% annual leave loading

// ── Leave types
const LEAVE_TYPES = {
  annual:   { label: 'Annual Leave',   code: 'A', loading: true  },
  sick:     { label: 'Sick Leave',     code: 'P', loading: false },
  personal: { label: 'Personal Leave', code: 'P', loading: false },
  unpaid:   { label: 'Unpaid Leave',   code: 'U', loading: false },
  long:     { label: 'Long Service',   code: 'L', loading: false },
};

// ── In-memory leave data
let leaveBalances = {};   // keyed by employee_id
let leaveRequests = [];

// ══════════════════════════════════════════════════════
//  SUPABASE
// ══════════════════════════════════════════════════════

async function dbLoadLeaveBalances() {
  if (!_businessId) return;
  const { data, error } = await _supabase
    .from('leave_balances').select('*')
    .eq('business_id', _businessId);
  if (error) { console.error('Load leave balances failed:', error); return; }
  leaveBalances = {};
  (data || []).forEach(r => { leaveBalances[r.employee_id] = r; });
}

async function dbSaveLeaveBalance(empId, updates) {
  const existing = leaveBalances[empId];
  const record = {
    business_id:           _businessId,
    employee_id:           empId,
    annual_leave_hours:    updates.annual_leave_hours  ?? existing?.annual_leave_hours  ?? 0,
    sick_leave_hours:      updates.sick_leave_hours    ?? existing?.sick_leave_hours    ?? 0,
    personal_leave_hours:  updates.personal_leave_hours ?? existing?.personal_leave_hours ?? 0,
    annual_leave_loading:  updates.annual_leave_loading ?? existing?.annual_leave_loading ?? LEAVE_LOADING_RATE,
    updated_at:            new Date().toISOString(),
  };
  const { error } = await _supabase.from('leave_balances').upsert(record, { onConflict: 'business_id,employee_id' });
  if (error) { console.error('Save leave balance failed:', error); return; }
  leaveBalances[empId] = record;
}

async function dbLoadLeaveRequests() {
  if (!_businessId) return;
  const { data, error } = await _supabase
    .from('leave_requests').select('*')
    .eq('business_id', _businessId)
    .order('created_at', { ascending: false });
  if (error) { console.error('Load leave requests failed:', error); return; }
  leaveRequests = data || [];
}

// ══════════════════════════════════════════════════════
//  ACCRUAL ENGINE
// ══════════════════════════════════════════════════════

// Accrue leave for hours worked in a pay period
async function accrueLeaveForPayPeriod(empId, hoursWorked) {
  const emp = employees.find(e => e.id === empId);
  if (!emp || emp.employment_type === 'casual') return;

  const empType = emp.employment_type === 'parttime' ? 'parttime' : 'permanent';
  const existing = leaveBalances[empId] || {};

  // Annual leave: 4 weeks per year, accrues per hour worked
  // 4 weeks / 52 weeks / 38 hrs = 0.002020 weeks per hour
  const annualAccrual = +(hoursWorked * (4 / 52 / 38) * 38).toFixed(4); // in hours

  // Sick/personal leave: 10 days per year = 76 hours
  const sickAccrual = +(hoursWorked * (76 / (52 * 38))).toFixed(4); // in hours

  await dbSaveLeaveBalance(empId, {
    annual_leave_hours:   +((existing.annual_leave_hours  || 0) + annualAccrual).toFixed(4),
    sick_leave_hours:     +((existing.sick_leave_hours    || 0) + sickAccrual).toFixed(4),
    personal_leave_hours: +((existing.personal_leave_hours || 0) + sickAccrual).toFixed(4),
  });
}

// Calculate leave loading amount for annual leave payout
function calcLeaveLoading(leaveHours, baseRate) {
  const leavePay     = leaveHours * baseRate;
  const loadingRate  = LEAVE_LOADING_RATE;
  const loadingAmt   = leavePay * loadingRate;
  return +loadingAmt.toFixed(2);
}

// ══════════════════════════════════════════════════════
//  TERMINATION PAY
// ══════════════════════════════════════════════════════

function calcTerminationPay(emp, terminationType) {
  const balance    = leaveBalances[emp.id] || {};
  const baseRate   = getBaseRate(emp);
  const yearsService = emp.start_date
    ? (new Date() - new Date(emp.start_date)) / (1000 * 60 * 60 * 24 * 365.25)
    : 0;

  // Unused annual leave payout (always paid regardless of termination reason)
  const annualLeaveHours   = balance.annual_leave_hours || 0;
  const annualLeavePay     = +(annualLeaveHours * baseRate).toFixed(2);
  const annualLeaveLoading = calcLeaveLoading(annualLeaveHours, baseRate);

  // Redundancy pay (NES Schedule) — not payable for resignation or dismissal for cause
  let redundancyPay = 0;
  if (terminationType === 'redundancy') {
    if (yearsService >= 1 && yearsService < 2)       redundancyPay = baseRate * 38 * 4;
    else if (yearsService >= 2 && yearsService < 3)  redundancyPay = baseRate * 38 * 6;
    else if (yearsService >= 3 && yearsService < 4)  redundancyPay = baseRate * 38 * 7;
    else if (yearsService >= 4 && yearsService < 5)  redundancyPay = baseRate * 38 * 8;
    else if (yearsService >= 5 && yearsService < 6)  redundancyPay = baseRate * 38 * 10;
    else if (yearsService >= 6 && yearsService < 7)  redundancyPay = baseRate * 38 * 11;
    else if (yearsService >= 7 && yearsService < 8)  redundancyPay = baseRate * 38 * 13;
    else if (yearsService >= 8 && yearsService < 9)  redundancyPay = baseRate * 38 * 14;
    else if (yearsService >= 9 && yearsService < 10) redundancyPay = baseRate * 38 * 16;
    else if (yearsService >= 10)                     redundancyPay = baseRate * 38 * 12;
    redundancyPay = +redundancyPay.toFixed(2);
  }

  // Notice period pay (NES)
  let noticePay = 0;
  if (terminationType !== 'dismissal_serious') {
    if (yearsService < 1)                             noticePay = baseRate * 38;       // 1 week
    else if (yearsService >= 1 && yearsService < 3)  noticePay = baseRate * 38 * 2;   // 2 weeks
    else if (yearsService >= 3 && yearsService < 5)  noticePay = baseRate * 38 * 3;   // 3 weeks
    else                                              noticePay = baseRate * 38 * 4;   // 4 weeks
    noticePay = +noticePay.toFixed(2);
  }

  const totalTerminationPay = annualLeavePay + annualLeaveLoading + redundancyPay + noticePay;

  return {
    annualLeaveHours,
    annualLeavePay,
    annualLeaveLoading,
    redundancyPay,
    noticePay,
    totalTerminationPay: +totalTerminationPay.toFixed(2),
    yearsService:         +yearsService.toFixed(2),
  };
}

// ══════════════════════════════════════════════════════
//  UI — LEAVE PAGE
// ══════════════════════════════════════════════════════

async function initLeavePage() {
  await Promise.all([dbLoadLeaveBalances(), dbLoadLeaveRequests()]);
  renderLeavePage();
}

function renderLeavePage() {
  const container = document.getElementById('leave-page-content');
  if (!container) return;

  const activeEmps = employees.filter(e => e.active !== false && e.employment_type !== 'casual');

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
      <div>
        <h2 style="margin:0;font-size:18px;">Leave Management</h2>
        <div style="font-size:12px;color:var(--text3);margin-top:4px;">Fair Work Act compliant leave balances and requests</div>
      </div>
      <button class="btn btn-primary" onclick="openLeaveRequestModal()">+ Leave Request</button>
    </div>

    <!-- Leave balances table -->
    <div class="card" style="margin-bottom:24px;">
      <div class="card-header flex-between">
        <span class="card-title">Leave Balances</span>
        <span style="font-size:11px;color:var(--text3);">Casual employees are not entitled to leave</span>
      </div>
      <div class="card-body" style="padding:0;">
        ${!activeEmps.length ? '<div style="padding:32px;text-align:center;color:var(--text3);">No permanent or part-time employees found.</div>' : `
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th style="text-align:right;">Annual Leave</th>
              <th style="text-align:right;">Sick Leave</th>
              <th style="text-align:right;">Personal Leave</th>
              <th style="text-align:right;">Annual Value</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${activeEmps.map(emp => {
              const bal      = leaveBalances[emp.id] || {};
              const baseRate = getBaseRate(emp);
              const annHrs   = +(bal.annual_leave_hours   || 0).toFixed(2);
              const sickHrs  = +(bal.sick_leave_hours     || 0).toFixed(2);
              const persHrs  = +(bal.personal_leave_hours || 0).toFixed(2);
              const annVal   = +(annHrs * baseRate * (1 + LEAVE_LOADING_RATE)).toFixed(2);
              return `
                <tr>
                  <td>
                    <div style="font-weight:600;">${emp.first_name} ${emp.last_name}</div>
                    <div style="font-size:11px;color:var(--text3);">${emp.employment_type}</div>
                  </td>
                  <td style="text-align:right;" class="mono">${annHrs}h</td>
                  <td style="text-align:right;" class="mono">${sickHrs}h</td>
                  <td style="text-align:right;" class="mono">${persHrs}h</td>
                  <td style="text-align:right;" class="mono">${fmt(annVal)}</td>
                  <td>
                    <div class="flex-gap" style="justify-content:flex-end;">
                      <button class="btn btn-ghost btn-sm" onclick="openAdjustLeaveModal('${emp.id}')">Adjust</button>
                      <button class="btn btn-ghost btn-sm" onclick="openTerminationModal('${emp.id}')">Terminate</button>
                    </div>
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>`}
      </div>
    </div>

    <!-- Leave requests -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">Leave Requests</span>
      </div>
      <div class="card-body" style="padding:0;">
        ${!leaveRequests.length ? '<div style="padding:32px;text-align:center;color:var(--text3);">No leave requests yet.</div>' : `
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Type</th>
              <th>From</th>
              <th>To</th>
              <th style="text-align:right;">Hours</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${leaveRequests.map(req => {
              const emp = employees.find(e => e.id === req.employee_id);
              const statusBadge = {
                pending:  '<span class="badge badge-yellow">Pending</span>',
                approved: '<span class="badge badge-green">Approved</span>',
                rejected: '<span class="badge badge-red">Rejected</span>',
              }[req.status] || '';
              return `
                <tr>
                  <td>${emp ? `${emp.first_name} ${emp.last_name}` : '—'}</td>
                  <td>${LEAVE_TYPES[req.leave_type]?.label || req.leave_type || '—'}</td>
                  <td>${req.start_date ? fmtDate(req.start_date) : '—'}</td>
                  <td>${req.end_date   ? fmtDate(req.end_date)   : '—'}</td>
                  <td style="text-align:right;" class="mono">${req.hours || '—'}h</td>
                  <td>${statusBadge}</td>
                  <td>
                    ${req.status === 'pending' ? `
                      <div class="flex-gap" style="justify-content:flex-end;">
                        <button class="btn btn-success btn-sm" onclick="approveLeaveRequest('${req.id}')">Approve</button>
                        <button class="btn btn-ghost btn-sm" style="color:var(--danger);" onclick="rejectLeaveRequest('${req.id}')">Reject</button>
                      </div>` : ''}
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>`}
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════
//  LEAVE REQUEST MODAL
// ══════════════════════════════════════════════════════

function openLeaveRequestModal(empId = '') {
  const modal = document.getElementById('leave-request-modal');
  if (!modal) return;
  document.getElementById('leave-emp-select').value  = empId;
  document.getElementById('leave-type-select').value = 'annual';
  document.getElementById('leave-start').value       = '';
  document.getElementById('leave-end').value         = '';
  document.getElementById('leave-hours').value       = '';
  document.getElementById('leave-notes').value       = '';
  modal.classList.add('show');
}

async function saveLeaveRequest() {
  const empId    = document.getElementById('leave-emp-select').value;
  const type     = document.getElementById('leave-type-select').value;
  const start    = document.getElementById('leave-start').value;
  const end      = document.getElementById('leave-end').value;
  const hours    = parseFloat(document.getElementById('leave-hours').value) || 0;
  const notes    = document.getElementById('leave-notes').value.trim();

  if (!empId || !start || !end || !hours) { toast('Please fill in all required fields'); return; }

  const { error } = await _supabase.from('leave_requests').insert({
    business_id:  _businessId,
    employee_id:  empId,
    leave_type:   type,
    start_date:   start,
    end_date:     end,
    hours,
    notes,
    status:       'pending',
    created_at:   new Date().toISOString(),
  });

  if (error) { toast('Error: ' + error.message); return; }

  document.getElementById('leave-request-modal').classList.remove('show');
  toast('Leave request submitted ✓');
  await dbLoadLeaveRequests();
  renderLeavePage();
}

async function approveLeaveRequest(reqId) {
  const req = leaveRequests.find(r => r.id === reqId);
  if (!req) return;

  // Deduct from balance
  const bal = leaveBalances[req.employee_id] || {};
  const updates = {};
  if (req.leave_type === 'annual') {
    updates.annual_leave_hours   = Math.max(0, (bal.annual_leave_hours   || 0) - (req.hours || 0));
  } else if (req.leave_type === 'sick') {
    updates.sick_leave_hours     = Math.max(0, (bal.sick_leave_hours     || 0) - (req.hours || 0));
  } else if (req.leave_type === 'personal') {
    updates.personal_leave_hours = Math.max(0, (bal.personal_leave_hours || 0) - (req.hours || 0));
  }

  await Promise.all([
    _supabase.from('leave_requests').update({ status: 'approved' }).eq('id', reqId),
    Object.keys(updates).length ? dbSaveLeaveBalance(req.employee_id, updates) : Promise.resolve(),
  ]);

  toast('Leave request approved ✓');
  await Promise.all([dbLoadLeaveBalances(), dbLoadLeaveRequests()]);
  renderLeavePage();
}

async function rejectLeaveRequest(reqId) {
  await _supabase.from('leave_requests').update({ status: 'rejected' }).eq('id', reqId);
  toast('Leave request rejected');
  await dbLoadLeaveRequests();
  renderLeavePage();
}

// ══════════════════════════════════════════════════════
//  ADJUST LEAVE MODAL
// ══════════════════════════════════════════════════════

function openAdjustLeaveModal(empId) {
  const emp = employees.find(e => e.id === empId);
  const bal = leaveBalances[empId] || {};
  const modal = document.getElementById('leave-adjust-modal');
  if (!modal) return;

  document.getElementById('adjust-leave-emp-id').value   = empId;
  document.getElementById('adjust-leave-emp-name').textContent = emp ? `${emp.first_name} ${emp.last_name}` : '';
  document.getElementById('adjust-annual-hours').value   = bal.annual_leave_hours   || 0;
  document.getElementById('adjust-sick-hours').value     = bal.sick_leave_hours     || 0;
  document.getElementById('adjust-personal-hours').value = bal.personal_leave_hours || 0;
  modal.classList.add('show');
}

async function saveLeaveAdjustment() {
  const empId = document.getElementById('adjust-leave-emp-id').value;
  await dbSaveLeaveBalance(empId, {
    annual_leave_hours:   parseFloat(document.getElementById('adjust-annual-hours').value)   || 0,
    sick_leave_hours:     parseFloat(document.getElementById('adjust-sick-hours').value)     || 0,
    personal_leave_hours: parseFloat(document.getElementById('adjust-personal-hours').value) || 0,
  });
  document.getElementById('leave-adjust-modal').classList.remove('show');
  toast('Leave balances updated ✓');
  renderLeavePage();
}

// ══════════════════════════════════════════════════════
//  TERMINATION MODAL
// ══════════════════════════════════════════════════════

function openTerminationModal(empId) {
  const emp   = employees.find(e => e.id === empId);
  const modal = document.getElementById('termination-modal');
  if (!modal || !emp) return;

  document.getElementById('term-emp-id').value        = empId;
  document.getElementById('term-emp-name').textContent = `${emp.first_name} ${emp.last_name}`;
  document.getElementById('term-type').value           = 'resignation';
  document.getElementById('term-date').value           = localDateStr(new Date());
  updateTerminationCalc();
  modal.classList.add('show');
}

function updateTerminationCalc() {
  const empId = document.getElementById('term-emp-id').value;
  const type  = document.getElementById('term-type').value;
  const emp   = employees.find(e => e.id === empId);
  if (!emp) return;

  const calc   = calcTerminationPay(emp, type);
  const calcEl = document.getElementById('term-calc');
  if (!calcEl) return;

  calcEl.innerHTML = `
    <div style="background:var(--surface2);border-radius:10px;padding:16px;margin-top:16px;">
      <div style="font-weight:700;font-size:13px;margin-bottom:12px;">Termination Pay Summary</div>
      <div style="display:flex;flex-direction:column;gap:8px;font-size:13px;">
        <div style="display:flex;justify-content:space-between;">
          <span>Years of service</span><span class="mono">${calc.yearsService} yrs</span>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span>Unused annual leave (${calc.annualLeaveHours}h)</span><span class="mono">${fmt(calc.annualLeavePay)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span>Annual leave loading (17.5%)</span><span class="mono">${fmt(calc.annualLeaveLoading)}</span>
        </div>
        ${calc.noticePay > 0 ? `<div style="display:flex;justify-content:space-between;">
          <span>Notice period pay</span><span class="mono">${fmt(calc.noticePay)}</span>
        </div>` : ''}
        ${calc.redundancyPay > 0 ? `<div style="display:flex;justify-content:space-between;">
          <span>Redundancy pay</span><span class="mono">${fmt(calc.redundancyPay)}</span>
        </div>` : ''}
        <div style="display:flex;justify-content:space-between;font-weight:700;border-top:1px solid var(--border);padding-top:8px;margin-top:4px;">
          <span>Total termination pay</span><span class="mono">${fmt(calc.totalTerminationPay)}</span>
        </div>
      </div>
    </div>`;
}

async function processTermination() {
  const empId = document.getElementById('term-emp-id').value;
  const type  = document.getElementById('term-type').value;
  const date  = document.getElementById('term-date').value;
  const emp   = employees.find(e => e.id === empId);
  if (!emp) return;

  const calc = calcTerminationPay(emp, type);

  // Update employee termination date and status
  emp.termination_date = date;
  emp.active           = false;
  await dbSaveEmployee(emp);

  // Create termination payslip record
  await _supabase.from('payslips').insert({
    business_id:          _businessId,
    employee_id:          empId,
    pay_period_start:     date,
    pay_period_end:       date,
    gross_pay:            calc.totalTerminationPay,
    tax_withheld:         0, // Tax on termination pay is complex — flag for accountant
    super_amount:         0, // Super not payable on most termination components
    net_pay:              calc.totalTerminationPay,
    unused_leave_payout:  calc.annualLeavePay,
    leave_loading:        calc.annualLeaveLoading,
    termination_type:     type,
    payment_date:         date,
    pay_event_type:       'PAYEVNTEMP',
    status:               'draft',
  });

  // Clear leave balance
  await dbSaveLeaveBalance(empId, {
    annual_leave_hours: 0, sick_leave_hours: 0, personal_leave_hours: 0,
  });

  document.getElementById('termination-modal').classList.remove('show');
  toast(`${emp.first_name} ${emp.last_name} terminated — final pay ${fmt(calc.totalTerminationPay)} ✓`);
  await dbLoadLeaveBalances();
  renderLeavePage();
  renderEmployees();
}
