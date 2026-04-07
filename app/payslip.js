/* ══════════════════════════════════════════════════════
   Tayla Workforce — Payslip Generator
   payslip.js
══════════════════════════════════════════════════════ */

let _payslipWeekStart = null;
let _payslipEmployee  = null;
let _payslipData      = null;

// ══════════════════════════════════════════════════════
//  OPEN PAYSLIP MODAL
// ══════════════════════════════════════════════════════

async function openPayslipModal(employeeId, weekStart) {
  const emp = employees.find(e => e.id === employeeId);
  if (!emp) return;

  _payslipEmployee  = emp;
  _payslipWeekStart = weekStart;

  const weekDates = getWeekDates(weekStart);
  const weekEnd   = weekDates[6];

  // Get approved timesheets for this employee this week
  const weekTs = timesheets.filter(t =>
    t.employee_id === employeeId &&
    weekDates.includes(t.date) &&
    t.status === 'approved'
  );

  if (!weekTs.length) {
    toast('No approved timesheets for this employee this week');
    return;
  }

  // Calculate pay for each shift
  const shiftBreakdown = weekTs.map(ts => {
    const pay = calcShiftPay({
      date:       ts.date,
      start_time: ts.start_time,
      end_time:   ts.end_time,
      break_mins: ts.break_mins,
    }, emp);
    return { ts, pay };
  });

  const grossPay       = +shiftBreakdown.reduce((s, r) => s + r.pay.grossPay, 0).toFixed(2);
  const laundryAllow   = +shiftBreakdown.reduce((s, r) => s + r.pay.laundryAllowance, 0).toFixed(2);
  const totalGross     = +(grossPay + laundryAllow).toFixed(2);
  const paygWithheld   = calcPAYG(totalGross, emp.tax_free_threshold !== false, emp.residency_status || 'australian');
  const medicare       = calcMedicare(totalGross, emp.residency_status || 'australian');
  const totalTax       = paygWithheld + medicare;
  const superAmount    = calcSuper(grossPay);
  const netPay         = +(totalGross - totalTax).toFixed(2);

  // Get YTD figures from Supabase
  const ytd = await getYTDFigures(employeeId, weekEnd);

  _payslipData = {
    emp,
    business:       _businessProfile,
    weekStart,
    weekEnd,
    shiftBreakdown,
    grossPay,
    laundryAllow,
    totalGross,
    paygWithheld,
    medicare,
    totalTax,
    superAmount,
    netPay,
    ytd,
    payDate: weekEnd,
  };

  renderPayslipPreview(_payslipData);
  document.getElementById('payslip-modal').classList.add('show');
}

// ══════════════════════════════════════════════════════
//  YTD FIGURES
// ══════════════════════════════════════════════════════

async function getYTDFigures(employeeId, upToDate) {
  // Financial year starts 1 July
  const fyStart = upToDate >= `${upToDate.slice(0,4)}-07-01`
    ? `${upToDate.slice(0,4)}-07-01`
    : `${parseInt(upToDate.slice(0,4))-1}-07-01`;

  if (!_businessId) return { gross: 0, tax: 0, super: 0 };

  const { data } = await _supabase
    .from('payslips')
    .select('gross_pay, tax_withheld, super_amount')
    .eq('employee_id', employeeId)
    .eq('business_id', _businessId)
    .gte('pay_period_end', fyStart)
    .lte('pay_period_end', upToDate);

  if (!data) return { gross: 0, tax: 0, super: 0 };

  return {
    gross: +data.reduce((s, r) => s + (r.gross_pay || 0), 0).toFixed(2),
    tax:   +data.reduce((s, r) => s + (r.tax_withheld || 0), 0).toFixed(2),
    super: +data.reduce((s, r) => s + (r.super_amount || 0), 0).toFixed(2),
  };
}

// ══════════════════════════════════════════════════════
//  RENDER PREVIEW
// ══════════════════════════════════════════════════════

function renderPayslipPreview(d) {
  const { emp, business, weekStart, weekEnd, shiftBreakdown,
          grossPay, laundryAllow, totalGross, paygWithheld,
          medicare, totalTax, superAmount, netPay, ytd, payDate } = d;

  const periodLabel = `${fmtDate(weekStart)} — ${fmtDate(weekEnd)}`;
  const empType     = { permanent: 'Permanent', parttime: 'Part-time', casual: 'Casual' }[emp.employment_type] || 'Casual';

  const html = `
    <div class="payslip" id="payslip-content">

      <!-- Header -->
      <div class="payslip-header">
        <div>
          <div class="payslip-biz-name">${business.biz_name || 'Business Name'}</div>
          ${business.abn ? `<div class="payslip-meta">ABN: ${business.abn}</div>` : ''}
          ${business.address ? `<div class="payslip-meta">${business.address}</div>` : ''}
          ${business.phone ? `<div class="payslip-meta">${business.phone}</div>` : ''}
        </div>
        <div style="text-align:right;">
          <div class="payslip-title">PAYSLIP</div>
          <div class="payslip-meta">Pay Period: ${periodLabel}</div>
          <div class="payslip-meta">Pay Date: ${fmtDate(payDate)}</div>
        </div>
      </div>

      <!-- Employee -->
      <div class="payslip-section payslip-emp-row">
        <div>
          <div class="payslip-label">Employee</div>
          <div class="payslip-value">${emp.first_name} ${emp.last_name}</div>
        </div>
        <div>
          <div class="payslip-label">Employment Type</div>
          <div class="payslip-value">${empType}</div>
        </div>
        <div>
          <div class="payslip-label">Role</div>
          <div class="payslip-value">${emp.role || '—'}</div>
        </div>
        <div>
          <div class="payslip-label">Base Rate</div>
          <div class="payslip-value">${fmt(getBaseRate(emp))}/hr</div>
        </div>
      </div>

      <!-- Earnings -->
      <div class="payslip-section">
        <div class="payslip-section-title">Earnings</div>
        <table class="payslip-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Hours</th>
              <th>Rate</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            ${shiftBreakdown.map(({ ts, pay }) => `
              <tr>
                <td>${fmtDate(ts.date)}</td>
                <td>${penaltyLabel(pay.penaltyKey)} ${pay.multiplier !== 1 ? `(${pay.multiplier}x)` : ''}</td>
                <td>${pay.billableHours}h</td>
                <td>${fmt(pay.hourlyRate)}/hr</td>
                <td>${fmt(pay.grossPay)}</td>
              </tr>
              ${pay.isMinimumEngagement ? `
              <tr style="font-size:10px;color:#888;">
                <td colspan="5">* Minimum engagement of 3 hours applied</td>
              </tr>` : ''}
            `).join('')}
            ${laundryAllow ? `
            <tr>
              <td>—</td>
              <td>Laundry Allowance</td>
              <td>—</td>
              <td>—</td>
              <td>${fmt(laundryAllow)}</td>
            </tr>` : ''}
          </tbody>
          <tfoot>
            <tr class="payslip-total-row">
              <td colspan="4">Gross Earnings</td>
              <td>${fmt(totalGross)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <!-- Deductions -->
      <div class="payslip-section">
        <div class="payslip-section-title">Deductions</div>
        <table class="payslip-table">
          <tbody>
            <tr>
              <td>PAYG Withholding</td>
              <td style="text-align:right;">${fmt(paygWithheld)}</td>
            </tr>
            <tr>
              <td>Medicare Levy (2%)</td>
              <td style="text-align:right;">${fmt(medicare)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="payslip-total-row">
              <td>Total Deductions</td>
              <td style="text-align:right;">${fmt(totalTax)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <!-- Net Pay -->
      <div class="payslip-net-pay">
        <div>NET PAY</div>
        <div class="payslip-net-amount">${fmt(netPay)}</div>
      </div>

      <!-- Super -->
      <div class="payslip-section">
        <div class="payslip-section-title">Employer Superannuation</div>
        <table class="payslip-table">
          <tbody>
            <tr>
              <td>Superannuation Guarantee (12%)</td>
              <td style="text-align:right;">${fmt(superAmount)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- YTD -->
      <div class="payslip-section">
        <div class="payslip-section-title">Year to Date</div>
        <table class="payslip-table">
          <tbody>
            <tr><td>YTD Gross</td><td style="text-align:right;">${fmt(ytd.gross + totalGross)}</td></tr>
            <tr><td>YTD Tax Withheld</td><td style="text-align:right;">${fmt(ytd.tax + totalTax)}</td></tr>
            <tr><td>YTD Superannuation</td><td style="text-align:right;">${fmt(ytd.super + superAmount)}</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Footer -->
      <div class="payslip-footer">
        This payslip is a confidential document. Generated by Tayla Workforce · usetayla.com.au
      </div>

    </div>
  `;

  document.getElementById('payslip-preview').innerHTML = html;

  // Set PAYG override field
  document.getElementById('payg-override').value = paygWithheld;
}

// ══════════════════════════════════════════════════════
//  PAYG OVERRIDE
// ══════════════════════════════════════════════════════

function applyPaygOverride() {
  const override = parseFloat(document.getElementById('payg-override').value) || 0;
  _payslipData.paygWithheld = override;
  _payslipData.totalTax     = override + _payslipData.medicare;
  _payslipData.netPay       = +(_payslipData.totalGross - _payslipData.totalTax).toFixed(2);
  renderPayslipPreview(_payslipData);
  toast('PAYG updated ✓');
}

// ══════════════════════════════════════════════════════
//  SAVE PAYSLIP TO SUPABASE
// ══════════════════════════════════════════════════════

async function calcYTD(empId, currentPeriodEnd) {
  // Get financial year start (1 July)
  const periodDate = new Date(currentPeriodEnd);
  const fyYear     = periodDate.getMonth() >= 6 ? periodDate.getFullYear() : periodDate.getFullYear() - 1;
  const fyStart    = `${fyYear}-07-01`;

  const { data } = await _supabase
    .from('payslips')
    .select('gross_pay, tax_withheld, super_amount, allowances')
    .eq('business_id', _businessId)
    .eq('employee_id', empId)
    .gte('pay_period_start', fyStart)
    .lt('pay_period_end', currentPeriodEnd);

  return {
    gross: +((data || []).reduce((s, r) => s + (r.gross_pay || 0), 0)).toFixed(2),
    tax:   +((data || []).reduce((s, r) => s + (r.tax_withheld || 0), 0)).toFixed(2),
    super: +((data || []).reduce((s, r) => s + (r.super_amount || 0), 0)).toFixed(2),
    allow: +((data || []).reduce((s, r) => s + (r.allowances || 0), 0)).toFixed(2),
  };
}

async function savePayslipRecord() {
  if (!_payslipData || !_businessId) return;
  const { emp, weekStart, weekEnd, grossPay, laundryAllow, totalGross,
          paygWithheld, medicare, totalTax, superAmount, netPay,
          shiftBreakdown } = _payslipData;

  // Calculate YTD figures
  const ytd = await calcYTD(emp.id, weekEnd);

  // Build line items from shift breakdown for STP2 itemisation
  const lineItems = (shiftBreakdown || []).map(s => ({
    date:        s.date,
    start:       s.shift?.start_time,
    end:         s.shift?.end_time,
    hours:       s.pay?.workedHours,
    penaltyKey:  s.pay?.penaltyKey,
    multiplier:  s.pay?.multiplier,
    rate:        s.pay?.hourlyRate,
    amount:      s.pay?.grossPay,
    type:        ['overtime1','overtime2'].includes(s.pay?.penaltyKey) ? 'overtime' : 'ordinary',
  }));

  // Salary sacrifice (if tracked per employee)
  const salarySacrifice = emp.salary_sacrifice || 0;

  const { error } = await _supabase.from('payslips').upsert({
    business_id:       _businessId,
    employee_id:       emp.id,
    pay_period_start:  weekStart,
    pay_period_end:    weekEnd,
    gross_pay:         totalGross,
    tax_withheld:      paygWithheld,
    medicare_levy:     medicare,
    super_amount:      superAmount,
    net_pay:           netPay,
    allowances:        laundryAllow || 0,
    hours_worked:      +(shiftBreakdown || []).reduce((s, r) => s + (r.pay?.workedHours || 0), 0).toFixed(2),
    salary_sacrifice:  salarySacrifice,
    line_items:        lineItems,
    ytd_gross:         +(ytd.gross + totalGross).toFixed(2),
    ytd_tax:           +(ytd.tax   + paygWithheld).toFixed(2),
    ytd_super:         +(ytd.super + superAmount).toFixed(2),
    ytd_allowances:    +(ytd.allow + (laundryAllow || 0)).toFixed(2),
    pay_event_type:    'PAYEVNT',
    status:            'draft',
  }, { onConflict: 'business_id,employee_id,pay_period_start' });

  if (error) console.error('Save payslip failed:', error);
}

// ══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
//  DOWNLOAD PDF
// ══════════════════════════════════════════════════════

async function downloadPayslipPDF() {
  await savePayslipRecord();
  const content = document.getElementById('payslip-content');
  if (!content) return;

  const opt = {
    margin:      [10, 10, 10, 10],
    filename:    `payslip-${_payslipEmployee.last_name}-${_payslipData.weekEnd}.pdf`,
    image:       { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2 },
    jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' },
  };

  html2pdf().set(opt).from(content).save();
  toast('Payslip downloaded ✓');
}

// ══════════════════════════════════════════════════════
//  PUSH TO TAYLA
// ══════════════════════════════════════════════════════

async function pushPayslipToTayla() {
  if (!_payslipData || !_businessId) return;

  const btn    = document.getElementById('payslip-push-btn');
  const status = document.getElementById('payslip-push-status');
  if (btn) { btn.textContent = 'Sending…'; btn.disabled = true; }
  if (status) status.innerHTML = '';

  try {
    // 1. Save/update the record in Workforce first
    await savePayslipRecord();

    // 2. Get the saved payslip ID
    const { emp, weekStart } = _payslipData;
    const { data: saved } = await _supabase
      .from('payslips')
      .select('id, employee_id')
      .eq('business_id', _businessId)
      .eq('employee_id', emp.id)
      .eq('pay_period_start', weekStart)
      .maybeSingle();

    if (!saved) throw new Error('Could not find saved payslip record');

    // Check if employee is connected to Tayla
    if (!emp.tayla_user_id) {
      if (status) status.innerHTML = `
        <div style="padding:10px 14px;background:#fff3cd;border-radius:8px;font-size:12px;color:#856404;">
          ⚠ ${emp.first_name} hasn't connected their Tayla account yet.
          <br>Go to Employees → click 📲 Invite to send them a link.
        </div>`;
      if (btn) { btn.textContent = '📲 Send to Tayla'; btn.disabled = false; }
      return;
    }

    // 3. Call Edge Function to push to Tayla
    const { data: { session } } = await _supabase.auth.getSession();
    const token = session?.access_token;

    const res = await fetch(
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

    if (status) status.innerHTML = `
      <div style="padding:10px 14px;background:rgba(56,161,105,.08);border-radius:8px;font-size:12px;color:var(--success);border:1px solid rgba(56,161,105,.2);">
        ✓ Payslip sent to ${emp.first_name}'s Tayla account
      </div>`;
    if (btn) { btn.textContent = '✓ Sent'; btn.disabled = true; }
    toast(`Payslip sent to ${emp.first_name} ✓`);

  } catch (err) {
    if (status) status.innerHTML = `
      <div style="padding:10px 14px;background:#fde2e2;border-radius:8px;font-size:12px;color:var(--danger);">
        ⚠ ${err.message}
      </div>`;
    if (btn) { btn.textContent = '📲 Send to Tayla'; btn.disabled = false; }
  }
}
