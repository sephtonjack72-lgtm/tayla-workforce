// supabase/functions/push-payslip/index.ts
// Workforce Supabase project
// Called after a payslip is saved — pushes it to the employee's Tayla account

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Auth — must be a logged-in employer
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorised' }, 401)

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Verify the calling user
    const sbAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: authErr } = await sbAuth.auth.getUser()
    if (authErr || !user) return json({ error: 'Unauthorised' }, 401)

    const { payslip_id } = await req.json()
    if (!payslip_id) return json({ error: 'Missing payslip_id' }, 400)

    // Load the payslip + verify it belongs to this user's business
    const { data: payslip } = await sb
      .from('payslips')
      .select(`
        *,
        businesses ( biz_name, user_id ),
        employees ( tayla_user_id, first_name, last_name )
      `)
      .eq('id', payslip_id)
      .maybeSingle()

    if (!payslip) return json({ error: 'Payslip not found' }, 404)
    if (payslip.businesses?.user_id !== user.id) return json({ error: 'Forbidden' }, 403)

    const taylaUserId = payslip.employees?.tayla_user_id
    if (!taylaUserId) {
      return json({ error: 'Employee is not connected to Tayla', not_connected: true }, 200)
    }

    // Push to Tayla Supabase using service role of Tayla project
    const taylaUrl      = Deno.env.get('TAYLA_SUPABASE_URL')!
    const taylaSecret   = Deno.env.get('TAYLA_SERVICE_ROLE_KEY')!
    const taylaSb       = createClient(taylaUrl, taylaSecret)

    const { error: pushErr } = await taylaSb.from('payslips').upsert({
      user_id:              taylaUserId,
      workforce_payslip_id: payslip_id,
      business_name:        payslip.businesses?.biz_name || 'Your Employer',
      pay_period_start:     payslip.week_start,
      pay_period_end:       payslip.week_end,
      gross_pay:            payslip.gross_pay,
      tax_withheld:         payslip.tax_withheld,
      super_amount:         payslip.super_amount,
      net_pay:              payslip.net_pay,
      hours_worked:         payslip.hours_worked || null,
      line_items:           payslip.line_items   || null,
      received_at:          new Date().toISOString(),
    }, { onConflict: 'workforce_payslip_id' })

    if (pushErr) {
      console.error('Push to Tayla failed:', pushErr)
      return json({ error: 'Failed to push to Tayla: ' + pushErr.message }, 500)
    }

    // Log sync event
    await sb.from('sync_log').insert({
      business_id: payslip.business_id,
      employee_id: payslip.employee_id,
      event_type:  'payslip_pushed',
      direction:   'outbound',
      status:      'ok',
      payload:     { payslip_id, tayla_user_id: taylaUserId },
    })

    return json({ success: true, pushed_to: taylaUserId })

  } catch (err) {
    console.error('push-payslip error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
