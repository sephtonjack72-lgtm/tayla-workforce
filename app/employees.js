/* ══════════════════════════════════════════════════════
   Tayla Workforce — Employees
   employees.js
══════════════════════════════════════════════════════ */

let employees = JSON.parse(localStorage.getItem('wf_employees') || '[]');

// ══════════════════════════════════════════════════════
//  SUPABASE
// ══════════════════════════════════════════════════════

async function dbLoadEmployees() {
  if (!_businessId) return;
  const { data, error } = await _supabase
    .from('employees').select('*')
    .eq('business_id', _businessId)
    .order('last_name');
  if (error) { console.error('Load employees failed:', error); return; }
  employees = data || [];
  localStorage.setItem('wf_employees', JSON.stringify(employees));
}

async function dbSaveEmployee(emp) {
  const idx = employees.findIndex(e => e.id === emp.id);
  if (idx >= 0) employees[idx] = emp; else employees.push(emp);
  localStorage.setItem('wf_employees', JSON.stringify(employees));
  if (!_businessId) return;
  const { error } = await _supabase
    .from('employees').upsert({ ...emp, business_id: _businessId }, { onConflict: 'id' });
  if (error) { console.error('Save employee failed:', error); toast('⚠ Failed to sync: ' + error.message); }
}

async function dbDeleteEmployee(id) {
  employees = employees.filter(e => e.id !== id);
  localStorage.setItem('wf_employees', JSON.stringify(employees));
  if (!_businessId) return;
  await _supabase.from('employees').delete().eq('id', id);
}

// ══════════════════════════════════════════════════════
//  UI
// ══════════════════════════════════════════════════════

function renderEmployees() {
  const tbody = document.getElementById('emp-tbody');
  const empty = document.getElementById('emp-empty');
  if (!tbody) return;

  if (!employees.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  const empTypeBadge = t => ({
    permanent: '<span class="badge badge-blue">Permanent</span>',
    parttime:  '<span class="badge badge-purple">Part-time</span>',
    casual:    '<span class="badge badge-yellow">Casual</span>',
  })[t] || '<span class="badge badge-grey">—</span>';

  tbody.innerHTML = employees.map(e => {
    const baseRate = getBaseRate(e);
    const initials = ((e.first_name?.[0] || '') + (e.last_name?.[0] || '')).toUpperCase();
    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:10px;">
            <div class="avatar">${initials}</div>
            <div>
              <div style="font-weight:600;">${e.first_name} ${e.last_name}</div>
              <div style="font-size:11px;color:var(--text3);">${e.email || ''}</div>
            </div>
          </div>
        </td>
        <td>${empTypeBadge(e.employment_type)}</td>
        <td style="font-size:12px;color:var(--text2);">${e.role || '—'}</td>
        <td class="mono">${fmt(baseRate)}/hr</td>
        <td>${e.start_date ? fmtDate(e.start_date) : '—'}</td>
        <td>
          <span class="badge ${e.active !== false ? 'badge-green' : 'badge-grey'}">
            ${e.active !== false ? 'Active' : 'Inactive'}
          </span>
        </td>
        <td>
          <div class="flex-gap">
            <button class="btn btn-ghost btn-sm" onclick="openEditEmployee('${e.id}')">Edit</button>
            <button class="btn btn-ghost btn-sm" onclick="openInviteModal('${e.id}')" title="Invite to Tayla Workforce app">
              ${e.tayla_user_id
                ? '<span style="color:var(--success);">✓ Connected</span>'
                : '📲 Invite'}
            </button>
            <button class="btn btn-ghost btn-sm" style="color:var(--danger);" onclick="deleteEmployeeConfirm('${e.id}')">Remove</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Update KPIs
  renderEmployeeKPIs();
}

function renderEmployeeKPIs() {
  const el = document.getElementById('emp-kpis');
  if (!el) return;
  const active    = employees.filter(e => e.active !== false).length;
  const permanent = employees.filter(e => e.employment_type === 'permanent').length;
  const parttime  = employees.filter(e => e.employment_type === 'parttime').length;
  const casual    = employees.filter(e => e.employment_type === 'casual').length;
  el.innerHTML = `
    <div class="kpi"><div class="kpi-label">Total Active</div><div class="kpi-value">${active}</div></div>
    <div class="kpi"><div class="kpi-label">Permanent</div><div class="kpi-value">${permanent}</div></div>
    <div class="kpi"><div class="kpi-label">Part-time</div><div class="kpi-value">${parttime}</div></div>
    <div class="kpi"><div class="kpi-label">Casual</div><div class="kpi-value">${casual}</div></div>
  `;
}

// ── Add / Edit Modal
function openAddEmployee() {
  document.getElementById('emp-modal-title').textContent = 'Add Employee';
  document.getElementById('emp-form').reset();
  document.getElementById('emp-edit-id').value = '';
  document.getElementById('emp-start-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('emp-active').value = 'true';
  document.getElementById('emp-modal').classList.add('show');
}

function openEditEmployee(id) {
  const e = employees.find(e => e.id === id);
  if (!e) return;
  document.getElementById('emp-modal-title').textContent = 'Edit Employee';
  document.getElementById('emp-edit-id').value      = e.id;
  document.getElementById('emp-first-name').value   = e.first_name || '';
  document.getElementById('emp-last-name').value    = e.last_name  || '';
  document.getElementById('emp-email').value        = e.email      || '';
  document.getElementById('emp-phone').value        = e.phone      || '';
  document.getElementById('emp-role').value         = e.role       || '';
  document.getElementById('emp-type').value         = e.employment_type || 'casual';
  document.getElementById('emp-rate').value         = e.hourly_rate || '';
  document.getElementById('emp-age').value          = e.age        || '';
  document.getElementById('emp-tfn').value          = e.tfn        || '';
  document.getElementById('emp-super-fund').value   = e.super_fund || '';
  document.getElementById('emp-super-usi').value    = e.super_fund_usi || '';
  document.getElementById('emp-super-number').value = e.super_member_number || '';
  document.getElementById('emp-bank-bsb').value     = e.bank_bsb   || '';
  document.getElementById('emp-bank-account').value = e.bank_account || '';
  document.getElementById('emp-start-date').value   = e.start_date || '';
  document.getElementById('emp-laundry').checked    = e.laundry_allowance || false;
  document.getElementById('emp-active').value       = String(e.active !== false);
document.getElementById('emp-tax-free').value = String(e.tax_free_threshold !== false);
document.getElementById('emp-residency').value = e.residency_status || 'australian';
  document.getElementById('emp-modal').classList.add('show');
}

async function saveEmployee() {
  const editId = document.getElementById('emp-edit-id').value;
  const firstName = document.getElementById('emp-first-name').value.trim();
  const lastName  = document.getElementById('emp-last-name').value.trim();
  if (!firstName || !lastName) { toast('First and last name are required'); return; }

  const emp = {
    id:                   editId || uid(),
    first_name:           firstName,
    last_name:            lastName,
    email:                document.getElementById('emp-email').value.trim(),
    phone:                document.getElementById('emp-phone').value.trim(),
    role:                 document.getElementById('emp-role').value.trim(),
    employment_type:      document.getElementById('emp-type').value,
    hourly_rate:          parseFloat(document.getElementById('emp-rate').value) || null,
    age:                  parseInt(document.getElementById('emp-age').value) || null,
    tfn:                  document.getElementById('emp-tfn').value.trim(),
    super_fund:           document.getElementById('emp-super-fund').value.trim(),
    super_fund_usi:       document.getElementById('emp-super-usi').value.trim(),
    super_member_number:  document.getElementById('emp-super-number').value.trim(),
    bank_bsb:             document.getElementById('emp-bank-bsb').value.trim(),
    bank_account:         document.getElementById('emp-bank-account').value.trim(),
    start_date:           document.getElementById('emp-start-date').value,
    laundry_allowance:    document.getElementById('emp-laundry').checked,
    active:               document.getElementById('emp-active').value === 'true',
tax_free_threshold: document.getElementById('emp-tax-free').value === 'true',
residency_status:   document.getElementById('emp-residency').value,
    created_at:           editId ? undefined : new Date().toISOString(),
  };
  if (!editId) delete emp.created_at;

  await dbSaveEmployee(emp);
  closeModal('emp-modal');
  renderEmployees();
  toast(`${editId ? 'Updated' : 'Added'} ${firstName} ${lastName} ✓`);
}

async function deleteEmployeeConfirm(id) {
  const e = employees.find(e => e.id === id);
  if (!confirm(`Remove ${e?.first_name} ${e?.last_name}? Their shift history will be kept.`)) return;
  await dbDeleteEmployee(id);
  renderEmployees();
  toast('Employee removed');
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('show');
}

function toast(msg, duration = 3000) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

// ══════════════════════════════════════════════════════
//  TAYLA INVITE
// ══════════════════════════════════════════════════════

let _inviteEmployeeId = null;

function openInviteModal(empId) {
  const emp = employees.find(e => e.id === empId);
  if (!emp) return;
  _inviteEmployeeId = empId;

  const modal = document.getElementById('invite-modal');
  if (!modal) return;

  document.getElementById('invite-emp-name').textContent  = `${emp.first_name} ${emp.last_name}`;
  document.getElementById('invite-emp-email').textContent = emp.email || '(no email on file)';
  document.getElementById('invite-status-area').innerHTML = '';
  document.getElementById('invite-send-btn').style.display = emp.tayla_user_id ? 'none' : 'inline-flex';

  // Show connection status if already connected
  if (emp.tayla_user_id) {
    document.getElementById('invite-status-area').innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:rgba(56,161,105,.08);border-radius:8px;border:1px solid rgba(56,161,105,.2);">
        <span style="font-size:20px;">✓</span>
        <div>
          <div style="font-weight:600;font-size:13px;color:var(--success);">Connected to Tayla</div>
          <div style="font-size:11px;color:var(--text3);">This employee has accepted their invite and connected their Tayla account.</div>
        </div>
      </div>`;
  } else if (!emp.email) {
    document.getElementById('invite-status-area').innerHTML = `
      <div style="padding:10px 14px;background:#fde2e2;border-radius:8px;font-size:12px;color:var(--danger);">
        ⚠ No email address on file. Add one in Edit Employee before sending an invite.
      </div>`;
    document.getElementById('invite-send-btn').style.display = 'none';
  }

  modal.classList.add('show');
}

async function sendTaylaInvite() {
  const emp = employees.find(e => e.id === _inviteEmployeeId);
  if (!emp || !_businessId) return;

  const btn       = document.getElementById('invite-send-btn');
  const statusEl  = document.getElementById('invite-status-area');
  btn.textContent = 'Sending…';
  btn.disabled    = true;

  try {
    const token = _supabase.changedAccessToken;

    const res  = await fetch(
      'https://whedwekxzjfqwjuoarid.supabase.co/functions/v1/send-invite',
      {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          employee_id: emp.id,
          business_id: _businessId,
        }),
      }
    );

    const data = await res.json();

    if (!res.ok || data.error) throw new Error(data.error || 'Failed to send invite');

    if (data.email_sent) {
      statusEl.innerHTML = `
        <div style="padding:12px 14px;background:rgba(56,161,105,.08);border-radius:8px;border:1px solid rgba(56,161,105,.2);font-size:13px;color:var(--success);">
          ✓ Invite sent to <strong>${emp.email}</strong>
          <div style="font-size:11px;color:var(--text3);margin-top:4px;">Link expires in 7 days.</div>
        </div>`;
    } else {
      // No Resend key — show manual URL
      statusEl.innerHTML = `
        <div style="padding:12px 14px;background:rgba(232,197,71,.1);border-radius:8px;border:1px solid var(--accent2);font-size:12px;">
          <div style="font-weight:600;margin-bottom:6px;">⚠ Email not sent — copy this link manually:</div>
          <div style="font-family:'DM Mono',monospace;font-size:11px;word-break:break-all;color:var(--text2);background:var(--bg);padding:8px;border-radius:6px;">
            ${data.invite_url}
          </div>
          <button class="btn btn-ghost btn-sm" style="margin-top:8px;" onclick="navigator.clipboard.writeText('${data.invite_url}').then(()=>toast('Link copied ✓'))">Copy Link</button>
        </div>`;
    }
    btn.style.display = 'none';
    toast(`Invite created for ${emp.first_name} ✓`);

  } catch (err) {
    statusEl.innerHTML = `<div style="padding:10px 14px;background:#fde2e2;border-radius:8px;font-size:12px;color:var(--danger);">⚠ ${err.message}</div>`;
    btn.textContent = '📲 Send Invite';
    btn.disabled    = false;
  }
}
