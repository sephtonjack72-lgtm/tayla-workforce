// supabase/functions/send-invite/index.ts
// Workforce Supabase project — creates an invite record and sends the email
// Called from the Workforce app when employer clicks "Invite to Tayla"

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Authenticate the calling user (employer must be logged in)
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorised' }, 401)

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Verify JWT and get user
const sbAnon = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_ANON_KEY')!,
)
const { data: { user }, error: authErr } = await sbAnon.auth.getUser(authHeader.replace('Bearer ', ''))
if (authErr || !user) return json({ error: 'Unauthorised' }, 401)

    const { employee_id, business_id } = await req.json()
    if (!employee_id || !business_id) return json({ error: 'Missing employee_id or business_id' }, 400)

    // Verify this business belongs to the calling user
    const { data: business } = await sb
      .from('businesses')
      .select('id, biz_name')
      .eq('id', business_id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!business) return json({ error: 'Business not found or not yours' }, 403)

    // Get employee details
    const { data: employee } = await sb
      .from('employees')
      .select('id, first_name, last_name, email')
      .eq('id', employee_id)
      .eq('business_id', business_id)
      .maybeSingle()

    if (!employee) return json({ error: 'Employee not found' }, 404)
    if (!employee.email) return json({ error: 'Employee has no email address on file' }, 400)

    // Revoke any existing pending invites for this employee
    await sb
      .from('employee_invites')
      .update({ status: 'revoked' })
      .eq('employee_id', employee_id)
      .eq('status', 'pending')

    // Generate a secure random token
    const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)

    // Create invite record
    const { data: invite, error: inviteErr } = await sb
      .from('employee_invites')
      .insert({
        business_id,
        employee_id,
        email:      employee.email,
        token,
        status:     'pending',
        invited_by: user.id,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single()

    if (inviteErr) {
      console.error('Create invite failed:', inviteErr)
      return json({ error: 'Failed to create invite' }, 500)
    }

    // Build invite URL
    const inviteUrl = `https://usetayla.com.au/connect?token=${token}`

    // Send email via Resend
    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) {
      // No Resend key yet — return the URL so it can be shared manually
      return json({
        success:    true,
        invite_id:  invite.id,
        invite_url: inviteUrl,
        email_sent: false,
        message:    'Invite created. Configure RESEND_API_KEY to send emails automatically.',
      })
    }

    const emailRes = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    'Tayla Workforce <admin@usetayla.com.au>',
        to:      [employee.email],
        subject: `${business.biz_name} has invited you to Tayla`,
        html:    buildEmailHtml({
          employeeName: employee.first_name,
          businessName: business.biz_name,
          inviteUrl,
          expiresAt:    expiresAt.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }),
        }),
      }),
    })

    const emailData = await emailRes.json()
    const emailSent = emailRes.ok

    // Store Resend message ID
    if (emailSent && emailData.id) {
      await sb
        .from('employee_invites')
        .update({ resend_id: emailData.id })
        .eq('id', invite.id)
    }

    // Log it
    await sb.from('sync_log').insert({
      business_id,
      employee_id,
      event_type: 'invite_sent',
      direction:  'outbound',
      status:     emailSent ? 'ok' : 'error',
      payload:    { email: employee.email, invite_url: inviteUrl },
      error:      emailSent ? null : JSON.stringify(emailData),
    })

    return json({
      success:    true,
      invite_id:  invite.id,
      invite_url: inviteUrl,
      email_sent: emailSent,
    })

  } catch (err) {
    console.error('send-invite error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})

function buildEmailHtml({ employeeName, businessName, inviteUrl, expiresAt }: {
  employeeName: string
  businessName: string
  inviteUrl:    string
  expiresAt:    string
}) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#111e1e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#111e1e;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;">

        <!-- Header -->
        <tr><td style="background:#111e1e;padding:28px 32px;">
          <div style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">
            Tayla <span style="color:#d4a017;">Workforce</span>
          </div>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:32px;">
          <h1 style="font-size:22px;font-weight:700;color:#111e1e;margin:0 0 12px;">
            You've been invited 👷
          </h1>
          <p style="font-size:15px;color:#4a5568;line-height:1.6;margin:0 0 24px;">
            Hi ${employeeName},<br><br>
            <strong>${businessName}</strong> has invited you to connect your Tayla account.
            Once connected you'll be able to:
          </p>
          <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="padding:6px 0;font-size:14px;color:#4a5568;">📅 &nbsp;View your upcoming shifts</td></tr>
            <tr><td style="padding:6px 0;font-size:14px;color:#4a5568;">💰 &nbsp;Receive and view your payslips</td></tr>
            <tr><td style="padding:6px 0;font-size:14px;color:#4a5568;">🗓 &nbsp;Set your weekly availability</td></tr>
            <tr><td style="padding:6px 0;font-size:14px;color:#4a5568;">🏖 &nbsp;Submit leave requests</td></tr>
          </table>

          <!-- CTA Button -->
          <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="background:#d4a017;border-radius:10px;">
              <a href="${inviteUrl}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#111e1e;text-decoration:none;">
                Connect My Account →
              </a>
            </td></tr>
          </table>

          <p style="font-size:12px;color:#718096;margin:0 0 8px;">
            Or copy this link into your browser:
          </p>
          <p style="font-size:11px;color:#a0aec0;background:#f7f7f7;padding:10px 12px;border-radius:6px;word-break:break-all;margin:0 0 24px;">
            ${inviteUrl}
          </p>

          <p style="font-size:12px;color:#a0aec0;margin:0;">
            This invite expires on <strong>${expiresAt}</strong>. If you didn't expect this email, you can safely ignore it.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f7f5f2;padding:20px 32px;border-top:1px solid #e2ddd6;">
          <p style="font-size:11px;color:#a0aec0;margin:0;text-align:center;">
            Tayla Suite · Australian Personal Finance &amp; Workforce Management<br>
            <a href="https://usetayla.com.au" style="color:#d4a017;">usetayla.com.au</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}