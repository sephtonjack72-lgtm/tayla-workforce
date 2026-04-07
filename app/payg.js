/* ══════════════════════════════════════════════════════
   Tayla Workforce — PAYG Withholding Calculator
   ATO Tax Tables 2025-26
   payg.js
══════════════════════════════════════════════════════ */

function calcPAYG(weeklyGross, taxFreeThreshold = true, residency = 'australian') {
  if (residency === 'foreign')          return calcPAYGForeign(weeklyGross);
  if (residency === 'working_holiday')  return calcPAYGWorkingHoliday(weeklyGross);
  return calcPAYGResident(weeklyGross, taxFreeThreshold);
}

// Australian resident (tax-free threshold applies when claimed)
function calcPAYGResident(weekly, taxFreeThreshold) {
  const annual = weekly * 52;
  let tax = 0;

  if (taxFreeThreshold) {
    // Scale 1 — with tax-free threshold
    if (annual <= 18200)        tax = 0;
    else if (annual <= 45000)   tax = (annual - 18200) * 0.16;
    else if (annual <= 135000)  tax = 4288 + (annual - 45000) * 0.30;
    else if (annual <= 190000)  tax = 31288 + (annual - 135000) * 0.37;
    else                        tax = 51638 + (annual - 190000) * 0.45;
  } else {
    // Scale 2 — no tax-free threshold
    if (annual <= 45000)        tax = annual * 0.16;
    else if (annual <= 135000)  tax = 7200 + (annual - 45000) * 0.30;
    else if (annual <= 190000)  tax = 34200 + (annual - 135000) * 0.37;
    else                        tax = 54550 + (annual - 190000) * 0.45;
  }

  // Low Income Tax Offset (LITO)
  let lito = 0;
  if (annual <= 37500)          lito = 700;
  else if (annual <= 45000)     lito = 700 - (annual - 37500) * 0.05;
  else if (annual <= 66667)     lito = 325 - (annual - 45000) * 0.015;

  tax = Math.max(0, tax - lito);
  return Math.round(tax / 52);
}

// Foreign resident
function calcPAYGForeign(weekly) {
  const annual = weekly * 52;
  let tax = 0;
  if (annual <= 135000)         tax = annual * 0.30;
  else if (annual <= 190000)    tax = 40500 + (annual - 135000) * 0.37;
  else                          tax = 60850 + (annual - 190000) * 0.45;
  return Math.round(tax / 52);
}

// Working holiday maker
function calcPAYGWorkingHoliday(weekly) {
  const annual = weekly * 52;
  let tax = 0;
  if (annual <= 45000)          tax = annual * 0.15;
  else if (annual <= 135000)    tax = 6750 + (annual - 45000) * 0.30;
  else if (annual <= 190000)    tax = 33750 + (annual - 135000) * 0.37;
  else                          tax = 54100 + (annual - 190000) * 0.45;
  return Math.round(tax / 52);
}

// Medicare levy — 2% for residents earning above threshold
function calcMedicare(weeklyGross, residency = 'australian') {
  if (residency !== 'australian') return 0;
  const annual = weeklyGross * 52;
  if (annual <= 26000) return 0;
  return Math.round(weeklyGross * 0.02);
}

// HECS/HELP repayment — ATO 2025-26 compulsory repayment thresholds
// Applied on top of PAYG withholding when employee has a study/training loan
// Reference: ato.gov.au/tax-rates-and-codes/tax-rates-study-and-training-loans
function calcHECSRepayment(weeklyGross) {
  const annual = weeklyGross * 52;
  let rate = 0;

  // 2025-26 HECS/HELP repayment rates
  if      (annual < 54435)  rate = 0;
  else if (annual < 62738)  rate = 0.010;
  else if (annual < 66529)  rate = 0.020;
  else if (annual < 70539)  rate = 0.025;
  else if (annual < 74791)  rate = 0.030;
  else if (annual < 79279)  rate = 0.035;
  else if (annual < 84029)  rate = 0.040;
  else if (annual < 89060)  rate = 0.045;
  else if (annual < 94400)  rate = 0.050;
  else if (annual < 100098) rate = 0.055;
  else if (annual < 106168) rate = 0.060;
  else if (annual < 112639) rate = 0.065;
  else if (annual < 119538) rate = 0.070;
  else if (annual < 126900) rate = 0.075;
  else if (annual < 134614) rate = 0.080;
  else if (annual < 142790) rate = 0.085;
  else if (annual < 151479) rate = 0.090;
  else if (annual < 160697) rate = 0.095;
  else                      rate = 0.100;

  if (rate === 0) return 0;
  return Math.round((annual * rate) / 52);
}

// Superannuation — 12% of ordinary time earnings (FY2025-26)
function calcSuper(weeklyGross) {
  return +(weeklyGross * 0.12).toFixed(2);
}
