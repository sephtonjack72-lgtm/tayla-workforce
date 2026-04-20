/* ══════════════════════════════════════════════════════
   Tayla Workforce — STP Phase 2 Generator
   stp2.js

   Generates ATO-compliant STP2 JSON payloads for
   submission via ATO Business Portal or tax agent.

   Reference: ATO STP Phase 2 Employer Reporting Guidelines
   https://www.ato.gov.au/businesses-and-organisations/hiring-and-paying-your-workers/single-touch-payroll
══════════════════════════════════════════════════════ */

// ── Period date resolver
// Uses push payslips picker if set, otherwise falls back to
// currently viewed timesheet week, otherwise uses last 7 days
function resolvePeriodDates(weekStart, weekEnd) {
  const endInput = document.getElementById('push-period-end-date');
  if (endInput?.value) {
    const end   = endInput.value;
    const start = typeof getPeriodStartFromEnd === 'function'
      ? getPeriodStartFromEnd(end)
      : (() => { const d = new Date(end); d.setDate(d.getDate() - 6); return d.toISOString().slice(0,10); })();
    return { start, end };
  }
  if (weekStart && weekEnd) return { start: weekStart, end: weekEnd };
  // Fallback: last full week ending yesterday
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const end   = yesterday.toISOString().slice(0, 10);
  const start = new Date(yesterday); start.setDate(start.getDate() - 6);
  return { start: start.toISOString().slice(0, 10), end };
}

// ── Income type codes (ATO STP2)
const STP2_INCOME_TYPES = {
  SAL: 'SAL', // Salary and wages
  CHP: 'CHP', // Closely held payees
  LAB: 'LAB', // Labour hire
  VOL: 'VOL', // Voluntary agreement
  OSP: 'OSP', // Other specified payment
};

// ── Employment basis codes
const STP2_EMP_BASIS = {
  permanent: 'F', // Full-time
  parttime:  'P', // Part-time
  casual:    'C', // Casual
  labour:    'L', // Labour hire
};

// ── Tax scale codes
function getSTP2TaxScale(emp) {
  const residency = emp.residency_status || 'australian';
  if (residency === 'foreign')          return '3'; // Foreign resident
  if (residency === 'working_holiday')  return '7'; // Working holiday maker
  if (!emp.tfn || emp.tfn === '000000000') return '4'; // No TFN
  if (emp.tax_free_threshold !== false) return '2'; // Tax free threshold claimed
  return '1'; // No tax free threshold
}

// ── Get income type from employment type
function getSTP2IncomeType(emp) {
  return STP2_INCOME_TYPES.SAL; // Default — salary and wages for employed workers
}

// ── Build STP2 employee income statement
function buildSTP2EmployeeRecord(emp, payslipData, periodStart, periodEnd, paymentDate) {
  const empBasis   = STP2_EMP_BASIS[emp.employment_type] || 'C';
  const taxScale   = getSTP2TaxScale(emp);
  const incomeType = getSTP2IncomeType(emp);
  const isTerminated = !!emp.termination_date;

  // Income components
  const grossPay    = payslipData.grossPay    || 0;
  const allowances  = payslipData.allowances  || 0;
  const totalGross  = payslipData.totalGross  || grossPay;
  const salarySac   = payslipData.salarySacrifice || emp.salary_sacrifice || 0;

  // Separate ordinary from overtime using line_items
  let overtimePay = 0;
  let ordinaryPay = grossPay;
  if (payslipData.shiftBreakdown?.length) {
    overtimePay = +payslipData.shiftBreakdown
      .filter(s => s.type === 'overtime')
      .reduce((sum, s) => sum + (s.amount || 0), 0)
      .toFixed(2);
    ordinaryPay = +(grossPay - overtimePay).toFixed(2);
  }

  return {
    // Employee identification
    payeeId:    emp.id,
    familyName: emp.last_name  || '',
    givenName:  emp.first_name || '',
    tfn:        emp.tfn        || '000000000',
    dateOfBirth: emp.date_of_birth || null,
    gender:      emp.gender        || null,

    // Employment details
    employmentBasis: empBasis,
    incomeType:      incomeType,
    taxScale:        taxScale,
    startDate:       emp.start_date      || null,
    endDate:         emp.termination_date || null,
    isTerminated,

    // Income for this period
    income: {
      periodStart,
      periodEnd,
      paymentDate,

      salaryAndWages: {
        ordinary:   +ordinaryPay.toFixed(2),
        overtime:   +overtimePay.toFixed(2),
        bonuses:    0,
        commission: 0,
        directors:  0,
        total:      +grossPay.toFixed(2),
      },

      allowances: allowances > 0 ? [
        { type: 'LD', description: 'Laundry allowance', amount: +allowances.toFixed(2) }
      ] : [],

      salarySacrifice: salarySac > 0 ? {
        type:   'S', // Superannuation
        amount: +salarySac.toFixed(2),
      } : null,

      totalGross:   +totalGross.toFixed(2),
      taxWithheld:  +(payslipData.paygWithheld || 0).toFixed(2),
      medicareLevy: +(payslipData.medicareLevy || 0).toFixed(2),
      hecsRepayment: +(payslipData.hecsRepayment || 0).toFixed(2),
      hoursWorked:  +(payslipData.hoursWorked  || 0).toFixed(2),
    },

    // Superannuation
    superannuation: {
      fundName:     emp.super_fund          || '',
      usi:          emp.super_fund_usi      || '',
      memberNumber: emp.super_member_number || '',
      amount:       +(payslipData.superAmount || 0).toFixed(2),
      type:         'OTE',
    },

    // YTD totals — cumulative from 1 July (now calculated from DB)
    ytdTotals: {
      grossIncome: +(payslipData.ytd?.gross || 0).toFixed(2),
      taxWithheld: +(payslipData.ytd?.tax   || 0).toFixed(2),
      super:       +(payslipData.ytd?.super  || 0).toFixed(2),
      allowances:  +(payslipData.ytd?.allow  || 0).toFixed(2),
    },
  };
}

// ── Build full STP2 event payload
function buildSTP2Payload(payslips, businessProfile, paymentDate) {
  const now = new Date().toISOString();

  // Financial year
  const pDate = new Date(paymentDate);
  const fyStart = pDate.getMonth() >= 6
    ? `${pDate.getFullYear()}-07-01`
    : `${pDate.getFullYear() - 1}-07-01`;

  return {
    // ATO submission metadata
    metadata: {
      softwareName:    'Tayla Workforce',
      softwareVersion: '1.0',
      softwareId:      'TAYLA-WF-001', // Register with ATO for production
      submissionDate:  now,
      paymentDate,
      financialYearStart: fyStart,
    },

    // Employer (payer) details
    employer: {
      abn:          businessProfile.abn              || '',
      businessName: businessProfile.biz_name         || '',
      addressStreet:  businessProfile.address_street  || businessProfile.address || '',
      addressSuburb:  businessProfile.address_suburb  || '',
      addressState:   businessProfile.address_state   || '',
      addressPostcode: businessProfile.address_postcode || '',
      phone:        businessProfile.phone             || '',
      bms_id:       businessProfile.id,
    },

    // Pay event
    payEvent: {
      type:        'PAYEVNT',
      messageId:   `TAYLA-${Date.now()}`,
      paymentDate,
      payees:      payslips,
    },

    // Summary
    summary: {
      totalPayees:    payslips.length,
      totalGross:     +payslips.reduce((s, p) => s + (p.income?.totalGross || 0), 0).toFixed(2),
      totalTax:       +payslips.reduce((s, p) => s + (p.income?.taxWithheld || 0), 0).toFixed(2),
      totalSuper:     +payslips.reduce((s, p) => s + (p.superannuation?.amount || 0), 0).toFixed(2),
    },
  };
}

// ── Generate and download STP2 file
async function generateSTP2Report(weekStart, weekEnd) {
  const _resolved = resolvePeriodDates(weekStart, weekEnd);
  weekStart = _resolved.start;
  weekEnd = _resolved.end;
  if (!_businessId || !_businessProfile) { toast('No business loaded'); return; }

  const btn = document.getElementById('stp2-export-btn');
  if (btn) { btn.textContent = 'Generating…'; btn.disabled = true; }

  try {
    // Load payslips for this pay period from Supabase
    const { data: payslipRows, error } = await _supabase
      .from('payslips')
      .select('*')
      .eq('business_id', _businessId)
      .gte('pay_period_start', weekStart)
      .lte('pay_period_end', weekEnd);

    if (error) { toast('Error loading payslips: ' + error.message); return; }
    if (!payslipRows?.length) {
      toast('No payslips found for this period. Push payslips first from the Timesheets tab.');
      return;
    }

    // Payment date = last day of pay period
    const paymentDate = weekEnd;

    // Build employee records
    const payeeRecords = [];
    for (const row of payslipRows) {
      const emp = employees.find(e => e.id === row.employee_id);
      if (!emp) continue;

      // Extract allowances from line_items
      const lineItems = row.line_items || [];
      const laundryAllow = lineItems
        .filter(l => l.type === 'allowance' || l.description?.toLowerCase().includes('laundry'))
        .reduce((s, l) => s + (l.amount || 0), 0);

      const payslipData = {
        grossPay:        row.gross_pay      || 0,
        allowances:      row.allowances     || laundryAllow || 0,
        totalGross:      row.gross_pay      || 0,
        paygWithheld:    row.tax_withheld   || 0,
        medicareLevy:    row.medicare_levy  || 0,
        superAmount:     row.super_amount   || 0,
        netPay:          row.net_pay        || 0,
        hoursWorked:     row.hours_worked   || 0,
        salarySacrifice: row.salary_sacrifice || 0,
        shiftBreakdown:  lineItems,
        ytd: {
          gross: row.ytd_gross      || 0,
          tax:   row.ytd_tax        || 0,
          super: row.ytd_super      || 0,
          allow: row.ytd_allowances || 0,
        },
      };

      payeeRecords.push(
        buildSTP2EmployeeRecord(emp, payslipData, weekStart, weekEnd, paymentDate)
      );
    }

    if (!payeeRecords.length) {
      toast('No matching employees found for payslips');
      return;
    }

    const payload = buildSTP2Payload(payeeRecords, _businessProfile, paymentDate);

    // Download as JSON file
    const json     = JSON.stringify(payload, null, 2);
    const blob     = new Blob([json], { type: 'application/json' });
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement('a');
    a.href         = url;
    a.download     = `STP2_${_businessProfile.biz_name?.replace(/\s+/g,'_')}_${weekStart}_${weekEnd}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast(`STP2 report generated — ${payeeRecords.length} employee${payeeRecords.length !== 1 ? 's' : ''} ✓`);

    // Also show summary modal
    showSTP2Summary(payload);

  } catch (err) {
    console.error('STP2 generation error:', err);
    toast('Error generating STP2 report: ' + err.message);
  } finally {
    if (btn) { btn.textContent = '📤 Export STP2'; btn.disabled = false; }
  }
}

// ── Show STP2 summary modal after generation
function showSTP2Summary(payload) {
  const modal = document.getElementById('stp2-modal');
  if (!modal) return;

  const s = payload.summary;
  document.getElementById('stp2-summary').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
      <div class="kpi"><div class="kpi-label">Employees</div><div class="kpi-value">${s.totalPayees}</div></div>
      <div class="kpi"><div class="kpi-label">Total Gross</div><div class="kpi-value">${fmt(s.totalGross)}</div></div>
      <div class="kpi"><div class="kpi-label">Tax Withheld</div><div class="kpi-value negative">${fmt(s.totalTax)}</div></div>
      <div class="kpi"><div class="kpi-label">Super</div><div class="kpi-value">${fmt(s.totalSuper)}</div></div>
    </div>
    <div style="padding:14px;background:rgba(56,161,105,.08);border-radius:8px;border:1px solid rgba(56,161,105,.2);font-size:13px;">
      <div style="font-weight:700;color:var(--success);margin-bottom:8px;">✓ STP2 file downloaded</div>
      <div style="color:var(--text2);line-height:1.6;">
        Submit this JSON file to the ATO via:<br>
        • <strong>ATO Business Portal</strong> — business.gov.au<br>
        • <strong>Your registered tax agent</strong><br>
        • <strong>ATO Free Clearing House</strong> — for businesses with ≤19 employees
      </div>
    </div>
    <div style="margin-top:14px;padding:12px 14px;background:rgba(232,197,71,.08);border-radius:8px;border:1px solid var(--accent2);font-size:12px;color:var(--text2);">
      ⚠ Ensure all employees have their <strong>Super Fund USI</strong> entered before submitting.
      Missing USI will cause ATO validation errors.
    </div>
  `;

  modal.classList.add('show');
}

// ── Check STP2 readiness for employees
function checkSTP2Readiness() {
  const issues = [];
  employees.filter(e => e.active !== false).forEach(emp => {
    const empIssues = [];
    if (!emp.tfn)                 empIssues.push('TFN missing');
    if (!emp.super_fund)          empIssues.push('Super fund name missing');
    if (!emp.super_fund_usi)      empIssues.push('Super fund USI missing');
    if (!emp.super_member_number) empIssues.push('Super member number missing');
    if (!emp.date_of_birth)       empIssues.push('Date of birth missing (recommended)');
    if (!emp.start_date)          empIssues.push('Start date missing');
    if (empIssues.length) {
      issues.push({ name: `${emp.first_name} ${emp.last_name}`, issues: empIssues });
    }
  });
  return issues;
}

// ── Show STP2 readiness check
function showSTP2Readiness() {
  const issues = checkSTP2Readiness();
  const modal  = document.getElementById('stp2-modal');
  if (!modal) return;

  if (!issues.length) {
    document.getElementById('stp2-summary').innerHTML = `
      <div style="padding:20px;text-align:center;">
        <div style="font-size:48px;margin-bottom:12px;">✓</div>
        <div style="font-weight:700;font-size:16px;color:var(--success);margin-bottom:8px;">All employees STP2 ready</div>
        <div style="font-size:13px;color:var(--text2);">All active employees have the required TFN, super fund and USI details.</div>
      </div>`;
  } else {
    document.getElementById('stp2-summary').innerHTML = `
      <div style="font-weight:700;font-size:14px;margin-bottom:14px;color:var(--danger);">
        ⚠ ${issues.length} employee${issues.length !== 1 ? 's' : ''} need${issues.length === 1 ? 's' : ''} attention
      </div>
      ${issues.map(i => `
        <div style="padding:12px;background:var(--surface2);border-radius:8px;margin-bottom:8px;border-left:3px solid var(--danger);">
          <div style="font-weight:600;font-size:13px;margin-bottom:4px;">${i.name}</div>
          ${i.issues.map(iss => `<div style="font-size:12px;color:var(--danger);">• ${iss}</div>`).join('')}
        </div>`).join('')}
      <div style="margin-top:14px;font-size:12px;color:var(--text3);">
        Go to Employees → Edit each employee to add missing details.
      </div>`;
  }
  modal.classList.add('show');
}

// ══════════════════════════════════════════════════════
//  XERO PAYROLL CSV EXPORT
//  Format: Xero Payroll Import CSV
//  Xero → Payroll → Pay Runs → Import
// ══════════════════════════════════════════════════════

async function exportXeroCSV(weekStart, weekEnd) {
  const _resolved = resolvePeriodDates(weekStart, weekEnd);
  weekStart = _resolved.start;
  weekEnd = _resolved.end;
  const btn = document.getElementById('xero-export-btn');
  if (btn) { btn.textContent = 'Generating…'; btn.disabled = true; }

  try {
    const { data: payslipRows, error } = await _supabase
      .from('payslips').select('*')
      .eq('business_id', _businessId)
      .gte('pay_period_start', weekStart)
      .lte('pay_period_end', weekEnd);

    if (error) throw new Error(error.message);
    if (!payslipRows?.length) { toast('No payslips found for this period. Push payslips first.'); return; }

    const paymentDate = weekEnd;
    const rows = [];

    // Xero Payroll CSV header
    rows.push([
      'Employee First Name',
      'Employee Last Name',
      'Date',
      'Earnings Rate Name',
      'Units',
      'Amount',
      'PAYG Withholding',
      'Medicare Levy',
      'Super Amount',
      'Super Fund',
      'Pay Period Start',
      'Pay Period End',
    ].join(','));

    for (const row of payslipRows) {
      const emp = employees.find(e => e.id === row.employee_id);
      if (!emp) continue;

      const lineItems = row.line_items || [];

      // Ordinary time
      const ordinaryHours = +(row.hours_worked || 0);
      const overtimePay   = +(lineItems.filter(l => l.type === 'overtime').reduce((s, l) => s + (l.amount || 0), 0)).toFixed(2);
      const ordinaryPay   = +((row.gross_pay || 0) - overtimePay).toFixed(2);

      // Ordinary time row
      rows.push([
        `"${emp.first_name}"`,
        `"${emp.last_name}"`,
        paymentDate,
        '"Ordinary Time"',
        ordinaryHours.toFixed(2),
        ordinaryPay.toFixed(2),
        (row.tax_withheld || 0).toFixed(2),
        (row.medicare_levy || 0).toFixed(2),
        (row.super_amount || 0).toFixed(2),
        `"${emp.super_fund || ''}"`,
        weekStart,
        weekEnd,
      ].join(','));

      // Overtime row (if any)
      if (overtimePay > 0) {
        const overtimeHours = +(lineItems.filter(l => l.type === 'overtime').reduce((s, l) => s + (l.hours || 0), 0)).toFixed(2);
        rows.push([
          `"${emp.first_name}"`,
          `"${emp.last_name}"`,
          paymentDate,
          '"Overtime"',
          overtimeHours.toFixed(2),
          overtimePay.toFixed(2),
          '0.00',
          '0.00',
          '0.00',
          '""',
          weekStart,
          weekEnd,
        ].join(','));
      }

      // Allowances row (if any)
      if (row.allowances > 0) {
        rows.push([
          `"${emp.first_name}"`,
          `"${emp.last_name}"`,
          paymentDate,
          '"Laundry Allowance"',
          '1.00',
          (row.allowances || 0).toFixed(2),
          '0.00',
          '0.00',
          '0.00',
          '""',
          weekStart,
          weekEnd,
        ].join(','));
      }
    }

    downloadCSV(rows.join('\n'), `Xero_Payroll_${_businessProfile?.biz_name?.replace(/\s+/g,'_')}_${weekStart}_${weekEnd}.csv`);
    toast(`Xero CSV exported — ${payslipRows.length} employee${payslipRows.length !== 1 ? 's' : ''} ✓`);

  } catch (err) {
    toast('Error: ' + err.message);
  } finally {
    if (btn) { btn.textContent = '📊 Export for Xero'; btn.disabled = false; }
  }
}

// ══════════════════════════════════════════════════════
//  MYOB PAYROLL CSV EXPORT
//  Format: MYOB AccountRight Payroll Import
//  MYOB → Payroll → Process Payroll → Import
// ══════════════════════════════════════════════════════

async function exportMYOBCSV(weekStart, weekEnd) {
  const _resolved = resolvePeriodDates(weekStart, weekEnd);
  weekStart = _resolved.start;
  weekEnd = _resolved.end;
  const btn = document.getElementById('myob-export-btn');
  if (btn) { btn.textContent = 'Generating…'; btn.disabled = true; }

  try {
    const { data: payslipRows, error } = await _supabase
      .from('payslips').select('*')
      .eq('business_id', _businessId)
      .gte('pay_period_start', weekStart)
      .lte('pay_period_end', weekEnd);

    if (error) throw new Error(error.message);
    if (!payslipRows?.length) { toast('No payslips found for this period. Push payslips first.'); return; }

    const rows = [];

    // MYOB AccountRight Payroll CSV header
    rows.push([
      'Co./Last Name',
      'First Name',
      'Card ID',
      'Pay Period Start Date',
      'Pay Period End Date',
      'Payment Date',
      'Payroll Category',
      'Hours',
      'Amount',
    ].join(','));

    for (const row of payslipRows) {
      const emp = employees.find(e => e.id === row.employee_id);
      if (!emp) continue;

      const cardId      = emp.id.slice(0, 8).toUpperCase();
      const lineItems   = row.line_items || [];
      const overtimePay = +(lineItems.filter(l => l.type === 'overtime').reduce((s, l) => s + (l.amount || 0), 0)).toFixed(2);
      const ordinaryPay = +((row.gross_pay || 0) - overtimePay).toFixed(2);
      const hoursWorked = +(row.hours_worked || 0);

      const addRow = (category, hours, amount) => rows.push([
        `"${emp.last_name}"`,
        `"${emp.first_name}"`,
        cardId,
        weekStart,
        weekEnd,
        weekEnd,
        `"${category}"`,
        hours.toFixed(2),
        amount.toFixed(2),
      ].join(','));

      // Ordinary time
      addRow('Base Hourly', hoursWorked, ordinaryPay);

      // Overtime
      if (overtimePay > 0) {
        const overtimeHours = +(lineItems.filter(l => l.type === 'overtime').reduce((s, l) => s + (l.hours || 0), 0)).toFixed(2);
        addRow('Overtime', overtimeHours, overtimePay);
      }

      // Allowances
      if (row.allowances > 0) {
        addRow('Laundry Allowance', 0, row.allowances);
      }

      // PAYG withholding (negative — deduction)
      if (row.tax_withheld > 0) {
        addRow('PAYG Withholding', 0, -(row.tax_withheld + (row.medicare_levy || 0)));
      }

      // Superannuation
      if (row.super_amount > 0) {
        addRow('Superannuation', 0, row.super_amount);
      }
    }

    downloadCSV(rows.join('\n'), `MYOB_Payroll_${_businessProfile?.biz_name?.replace(/\s+/g,'_')}_${weekStart}_${weekEnd}.csv`);
    toast(`MYOB CSV exported — ${payslipRows.length} employee${payslipRows.length !== 1 ? 's' : ''} ✓`);

  } catch (err) {
    toast('Error: ' + err.message);
  } finally {
    if (btn) { btn.textContent = '📊 Export for MYOB'; btn.disabled = false; }
  }
}

// ── Helper: download CSV file
function downloadCSV(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ══════════════════════════════════════════════════════
//  ABA FILE EXPORT (Australian Banking Association)
//  Used for bulk bank transfers — upload to any Australian bank
//  Format: DE (Direct Entry) file format
// ══════════════════════════════════════════════════════

async function exportABAFile(weekStart, weekEnd) {
  const _resolved = resolvePeriodDates(weekStart, weekEnd);
  weekStart = _resolved.start;
  weekEnd = _resolved.end;
  const btn = document.getElementById('aba-export-btn');
  if (btn) { btn.textContent = 'Generating…'; btn.disabled = true; }

  try {
    const { data: payslipRows, error } = await _supabase
      .from('payslips').select('*')
      .eq('business_id', _businessId)
      .gte('pay_period_start', weekStart)
      .lte('pay_period_end', weekEnd);

    if (error) throw new Error(error.message);
    if (!payslipRows?.length) {
      toast('No payslips found for this period. Push payslips first.');
      return;
    }

    // Check all employees have bank details
    const missing = [];
    for (const row of payslipRows) {
      const emp = employees.find(e => e.id === row.employee_id);
      if (emp && (!emp.bank_bsb || !emp.bank_account)) {
        missing.push(`${emp.first_name} ${emp.last_name}`);
      }
    }
    if (missing.length) {
      toast(`⚠ Missing bank details for: ${missing.join(', ')}. Update employee records first.`);
      if (btn) { btn.textContent = '🏦 Export ABA File'; btn.disabled = false; }
      return;
    }

    // ABA file requires business bank details
    const bizBsb     = _businessProfile?.bank_bsb     || '';
    const bizAccount = _businessProfile?.bank_account  || '';
    const bizName    = (_businessProfile?.biz_name     || 'BUSINESS').substring(0, 26).toUpperCase().padEnd(26);
    const paymentDate = new Date(weekEnd).toLocaleDateString('en-AU', {
      day: '2-digit', month: '2-digit', year: '2-digit'
    }).replace(/\//g, '');

    if (!bizBsb || !bizAccount) {
      toast('⚠ Add your business BSB and account number in Business Settings first.');
      if (btn) { btn.textContent = '🏦 Export ABA File'; btn.disabled = false; }
      return;
    }

    const lines = [];

    // ── Descriptive record (header) — Type 0
    const cleanBsb     = bizBsb.replace(/[^0-9]/g, '').substring(0, 6).padEnd(6);
    const cleanAccount = bizAccount.replace(/[^0-9]/g, '').substring(0, 9).padEnd(9);
    lines.push(
      '0' +                                    // Record type
      ' '.repeat(17) +                         // BSB (blank for header)
      '01' +                                   // Sequence number
      'BNK' +                                  // Bank code (generic)
      ' '.repeat(7) +                          // Filler
      bizName +                                // User preferred specification
      ''.padEnd(6, ' ') +                      // APCA user ID (6 chars)
      `Pay ${weekStart} to ${weekEnd}`.substring(0, 12).padEnd(12) + // Description
      paymentDate +                            // Date DDMMYY
      ' '.repeat(40)                           // Filler
    );

    // ── Detail records (one per employee) — Type 1
    let totalCredit = 0;
    let totalDebit  = 0;
    let recordCount = 0;

    for (const row of payslipRows) {
      const emp = employees.find(e => e.id === row.employee_id);
      if (!emp || !emp.bank_bsb || !emp.bank_account) continue;

      const netPay     = Math.round((row.net_pay || 0) * 100); // in cents
      const empBsb     = emp.bank_bsb.replace(/[^0-9]/g, '').substring(0, 6).padEnd(6);
      const empAccount = emp.bank_account.replace(/[^0-9]/g, '').substring(0, 9).padEnd(9);
      const empName    = `${emp.first_name} ${emp.last_name}`.substring(0, 32).padEnd(32);
      const lodgeName  = bizName.substring(0, 16).padEnd(16);
      const reference  = `PAY ${weekStart}`.substring(0, 18).padEnd(18);

      lines.push(
        '1' +                                  // Record type
        empBsb.substring(0, 3) + '-' + empBsb.substring(3, 6) + // BSB XXX-XXX
        empAccount +                           // Account number (9 chars)
        ' ' +                                  // Indicator (space = normal)
        '50' +                                 // Transaction code (50 = credit)
        String(netPay).padStart(10, '0') +     // Amount in cents (10 chars)
        empName +                              // Account name (32 chars)
        reference +                            // Lodgement reference (18 chars)
        cleanBsb.substring(0, 3) + '-' + cleanBsb.substring(3, 6) + // Trace BSB
        cleanAccount +                         // Trace account (9 chars)
        lodgeName +                            // Remitter name (16 chars)
        '00000000'                             // Withholding tax (8 chars, 0)
      );

      totalCredit += netPay;
      recordCount++;
    }

    // Debit record for business account — Type 1
    const debitAmount = totalCredit;
    lines.push(
      '1' +
      cleanBsb.substring(0, 3) + '-' + cleanBsb.substring(3, 6) +
      cleanAccount +
      ' ' +
      '13' +                                   // Transaction code 13 = debit
      String(debitAmount).padStart(10, '0') +
      bizName.substring(0, 32).padEnd(32) +
      `Payroll ${weekStart}`.substring(0, 18).padEnd(18) +
      cleanBsb.substring(0, 3) + '-' + cleanBsb.substring(3, 6) +
      cleanAccount +
      bizName.substring(0, 16).padEnd(16) +
      '00000000'
    );
    totalDebit += debitAmount;

    // ── File total record (footer) — Type 7
    lines.push(
      '7' +
      '999-999' +                              // BSB filler
      ' '.repeat(12) +                         // Filler
      String(totalDebit).padStart(10, '0') +   // Total debit
      String(totalCredit).padStart(10, '0') +  // Total credit
      String(Math.abs(totalCredit - totalDebit)).padStart(10, '0') + // Net total
      ' '.repeat(24) +                         // Filler
      String(recordCount + 1).padStart(6, '0') + // Record count (including debit)
      ' '.repeat(40)                           // Filler
    );

    const content  = lines.join('\r\n');
    const filename = `ABA_${_businessProfile?.biz_name?.replace(/\s+/g,'_')}_${weekStart}.aba`;
    downloadCSV(content, filename);

    toast(`ABA file exported — ${recordCount} payment${recordCount !== 1 ? 's' : ''}, total ${fmt(totalCredit / 100)} ✓`);

  } catch (err) {
    console.error('ABA export error:', err);
    toast('Error generating ABA file: ' + err.message);
  } finally {
    if (btn) { btn.textContent = '🏦 Export ABA File'; btn.disabled = false; }
  }
}

// ══════════════════════════════════════════════════════
//  SUPERSTREAM SAFF CSV EXPORT
//  SuperStream Alternative File Format (SAFF)
//  Compatible with: SBSCH (ATO), AMP, Rest, Hostplus,
//  and all major clearing houses
//
//  Payday Super (July 2026): super must be paid within
//  7 days of each pay day — export per pay run.
//
//  Reference: ATO SuperStream SAFF specification
//  ato.gov.au/businesses/super-for-employers/superstream
// ══════════════════════════════════════════════════════

async function exportSuperStream(weekStart, weekEnd) {
  const _resolved = resolvePeriodDates(weekStart, weekEnd);
  weekStart = _resolved.start;
  weekEnd = _resolved.end;
  const btn = document.getElementById('superstream-export-btn');
  if (btn) { btn.textContent = 'Generating…'; btn.disabled = true; }

  try {
    const { data: payslipRows, error } = await _supabase
      .from('payslips').select('*')
      .eq('business_id', _businessId)
      .gte('pay_period_start', weekStart)
      .lte('pay_period_end', weekEnd);

    if (error) throw new Error(error.message);
    if (!payslipRows?.length) {
      toast('No payslips found for this period. Push payslips first.');
      return;
    }

    // Validate business details
    const bizAbn  = (_businessProfile?.abn  || '').replace(/\s/g, '');
    const bizName = _businessProfile?.biz_name || '';
    if (!bizAbn) {
      toast('⚠ Add your business ABN in Business Settings before exporting SuperStream.');
      return;
    }

    // Check employees have required super details
    const missing = [];
    for (const row of payslipRows) {
      if (!row.super_amount || row.super_amount <= 0) continue;
      const emp = employees.find(e => e.id === row.employee_id);
      if (!emp) continue;
      const empMissing = [];
      if (!emp.super_fund)          empMissing.push('fund name');
      if (!emp.super_fund_usi)      empMissing.push('USI');
      if (!emp.super_member_number) empMissing.push('member number');
      if (!emp.tfn)                 empMissing.push('TFN');
      if (empMissing.length) missing.push(`${emp.first_name} ${emp.last_name} (missing: ${empMissing.join(', ')})`);
    }
    if (missing.length) {
      toast(`⚠ Missing super details for: ${missing.slice(0, 2).join('; ')}${missing.length > 2 ? ` and ${missing.length - 2} more` : ''}. Fix in Employees first.`);
      return;
    }

    // Payment date — 7 days after pay period end (Payday Super compliance)
    const payDateObj = new Date(weekEnd);
    payDateObj.setDate(payDateObj.getDate() + 7);
    const paymentDate = localDateStr(payDateObj);

    // SAFF CSV header — ATO SuperStream Alternative File Format
    const headers = [
      'YourFileReference',
      'YourEntityIdentifier',
      'TargetProductId',
      'ABN',
      'USI',
      'SPIN',
      'FundName',
      'MemberClientIdentifier',
      'PayrollNumber',
      'TFN',
      'MemberEntityIdentifier',
      'FamilyName',
      'GivenName',
      'OtherGivenName',
      'DateOfBirth',
      'Gender',
      'PhoneNumber',
      'EmailAddress',
      'AddressLine1',
      'AddressLine2',
      'Suburb',
      'State',
      'PostCode',
      'Country',
      'EmployerABN',
      'EmployerName',
      'PayPeriodStartDate',
      'PayPeriodEndDate',
      'PaymentDate',
      'SuperannuationGuaranteeAmount',
      'AwardOrProductivityAmount',
      'PersonalContributionAmount',
      'SalarySacrificeAmount',
      'VoluntaryAfterTaxAmount',
      'DefinedBenefitMemberPre1July1983Component',
      'DefinedBenefitMemberPostJune1983TaxedComponent',
      'DefinedBenefitMemberPostJune1983UntaxedComponent',
      'DefinedBenefitEmployerContribution',
    ];

    const rows = [headers.join(',')];

    // File reference: BizName_WeekStart
    const fileRef = `${bizName.replace(/\s+/g, '_')}_${weekStart}`.substring(0, 50);
    let rowNum = 1;

    for (const payslip of payslipRows) {
      const emp = employees.find(e => e.id === payslip.employee_id);
      if (!emp) continue;
      const superAmount = +(payslip.super_amount || 0);
      if (superAmount <= 0) continue; // skip zero-super rows (casuals with no super etc)

      // Fund ABN — derive from USI if not stored separately
      // USI format is typically: <11-digit-ABN><ProductCode>
      // e.g. "76514770399001" → ABN is "76514770399"
      const rawUsi  = (emp.super_fund_usi || '').replace(/\s/g, '');
      const fundAbn = (emp.super_fund_abn || (rawUsi.length >= 11 ? rawUsi.slice(0, 11) : '')).replace(/\s/g, '');

      // Format DOB: YYYY-MM-DD → DD/MM/YYYY for SAFF
      let dob = '';
      if (emp.date_of_birth) {
        const [y, m, d] = emp.date_of_birth.split('-');
        dob = `${d}/${m}/${y}`;
      }

      // Format payment date: DD/MM/YYYY
      const fmtSaffDate = (dateStr) => {
        if (!dateStr) return '';
        const [y, m, d] = dateStr.split('-');
        return `${d}/${m}/${y}`;
      };

      rows.push([
        `"${fileRef}_${rowNum}"`,          // YourFileReference — unique per row
        `"${bizAbn}"`,                     // YourEntityIdentifier — employer ABN
        '""',                              // TargetProductId — leave blank, clearing house fills
        `"${fundAbn}"`,                    // ABN — super fund ABN
        `"${emp.super_fund_usi || ''}"`,   // USI
        '""',                              // SPIN — legacy, leave blank
        `"${emp.super_fund || ''}"`,       // FundName
        `"${emp.super_member_number || ''}"`, // MemberClientIdentifier
        `"${emp.id.slice(0, 8).toUpperCase()}"`, // PayrollNumber
        `"${emp.tfn || ''}"`,             // TFN
        '""',                              // MemberEntityIdentifier — leave blank
        `"${emp.last_name || ''}"`,        // FamilyName
        `"${emp.first_name || ''}"`,       // GivenName
        '""',                              // OtherGivenName
        `"${dob}"`,                        // DateOfBirth
        '""',                              // Gender — optional
        `"${emp.phone || ''}"`,            // PhoneNumber
        `"${emp.email || ''}"`,            // EmailAddress
        '""',                              // AddressLine1
        '""',                              // AddressLine2
        '""',                              // Suburb
        '""',                              // State
        '""',                              // PostCode
        '"AU"',                            // Country
        `"${bizAbn}"`,                     // EmployerABN
        `"${bizName}"`,                    // EmployerName
        `"${fmtSaffDate(weekStart)}"`,     // PayPeriodStartDate
        `"${fmtSaffDate(weekEnd)}"`,       // PayPeriodEndDate
        `"${fmtSaffDate(paymentDate)}"`,   // PaymentDate
        superAmount.toFixed(2),            // SuperannuationGuaranteeAmount (SGC)
        '0.00',                            // AwardOrProductivityAmount
        '0.00',                            // PersonalContributionAmount
        '0.00',                            // SalarySacrificeAmount
        '0.00',                            // VoluntaryAfterTaxAmount
        '0.00',                            // DefinedBenefit fields — not applicable
        '0.00',
        '0.00',
        '0.00',
      ].join(','));

      rowNum++;
    }

    const totalSuper = payslipRows.reduce((s, r) => s + (r.super_amount || 0), 0);
    const empCount   = rows.length - 1; // exclude header

    if (empCount === 0) {
      toast('No super contributions found for this period.');
      return;
    }

    const filename = `SuperStream_${bizName.replace(/\s+/g, '_')}_${weekStart}_${weekEnd}.csv`;
    downloadCSV(rows.join('\n'), filename);

    // Record audit trail for Payday Super compliance
    await recordSuperPayment(weekStart, weekEnd, totalSuper, empCount);

    // Open SBSCH in new tab for convenience
    window.open('https://www.ato.gov.au/businesses-and-organisations/super-for-employers/paying-super-contributions/how-to-pay-super', '_blank');

    toast(`SuperStream file exported — ${empCount} employee${empCount !== 1 ? 's' : ''}, ${fmt(totalSuper)} total ✓`);

  } catch (err) {
    console.error('SuperStream export error:', err);
    toast('Error generating SuperStream file: ' + err.message);
  } finally {
    if (btn) { btn.textContent = '⚡ Export SuperStream'; btn.disabled = false; }
  }
}

// ── Show SuperStream export modal with summary + instructions
async function showSuperStreamModal(weekStart, weekEnd) {
  const modal = document.getElementById('superstream-modal');
  if (!modal) return;

  // Calculate super total for the period
  const { data: payslipRows } = await _supabase
    .from('payslips').select('employee_id, super_amount')
    .eq('business_id', _businessId)
    .gte('pay_period_start', weekStart)
    .lte('pay_period_end', weekEnd);

  const totalSuper = (payslipRows || []).reduce((s, r) => s + (r.super_amount || 0), 0);
  const empCount   = (payslipRows || []).filter(r => (r.super_amount || 0) > 0).length;

  const payDateObj = new Date(weekEnd);
  payDateObj.setDate(payDateObj.getDate() + 7);
  const dueDate = payDateObj.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

  document.getElementById('superstream-summary').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
      <div class="kpi"><div class="kpi-label">Employees</div><div class="kpi-value">${empCount}</div></div>
      <div class="kpi"><div class="kpi-label">Total Super</div><div class="kpi-value">${fmt(totalSuper)}</div></div>
    </div>
    <div style="padding:14px;background:rgba(56,161,105,.08);border-radius:8px;border:1px solid rgba(56,161,105,.2);font-size:13px;margin-bottom:14px;">
      <div style="font-weight:700;color:var(--success);margin-bottom:8px;">⚡ Payday Super — due ${dueDate}</div>
      <div style="color:var(--text2);line-height:1.7;">
        From <strong>1 July 2026</strong>, super must be paid within <strong>7 days</strong> of each pay day.<br>
        1. Download the SuperStream file below<br>
        2. Upload it to your clearing house (AMP, Rest, Hostplus, Beam, etc.)<br>
        <span style="font-size:11px;color:var(--text3);">Note: The ATO's free SBSCH closes permanently on 1 July 2026 — if you haven't already, switch to a commercial clearing house now.</span>
      </div>
    </div>
    <div style="padding:12px 14px;background:rgba(232,197,71,.08);border-radius:8px;border:1px solid var(--accent2);font-size:12px;color:var(--text2);">
      ⚠ Ensure all employees have <strong>Super Fund USI, member number and TFN</strong> entered. Missing details will be flagged on export.
    </div>
    <div style="margin-top:16px;">
      <button id="superstream-export-btn" class="btn btn-primary" style="width:100%;"
        onclick="exportSuperStream('${weekStart}','${weekEnd}')">
        ⚡ Export SuperStream File
      </button>
    </div>
  `;

  modal.classList.add('show');
}
