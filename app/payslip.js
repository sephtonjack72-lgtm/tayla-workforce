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
    .gte('week_end', fyStart)
    .lte('week_end', upToDate);

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

async function savePayslipRecord() {
  if (!_payslipData || !_businessId) return;
  const { emp, weekStart, weekEnd, totalGross, totalTax, superAmount, netPay } = _payslipData;

  const { error } = await _supabase.from('payslips').upsert({
    business_id:  _businessId,
    employee_id:  emp.id,
    week_start:   weekStart,
    week_end:     weekEnd,
    gross_pay:    totalGross,
    tax_withheld: totalTax,
    super_amount: superAmount,
    net_pay:      netPay,
    created_at:   new Date().toISOString(),
  }, { onConflict: 'business_id,employee_id,week_start' });

  if (error) console.error('Save payslip failed:', error);
}

// ══════════════════════════════════════════════════════
//  DOWNLOAD PDF
// ══════════════════════════════════════════════════════

async function downloadPayslipPDF() {
  await savePayslipRecord();
  const content = document.getElementById('payslip-content');
  if (!content) return;

  const opt = {
    margin:     [10, 10, 10, 10],
    filename:   `payslip-${_payslipEmployee.last_name}-${_payslipData.weekEnd}.pdf`,
    image:      { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2 },
    jsPDF:      { unit: 'mm', format: 'a4', orientation: 'portrait' },
  };

  html2pdf().set(opt).from(content).save();
  toast('Pay