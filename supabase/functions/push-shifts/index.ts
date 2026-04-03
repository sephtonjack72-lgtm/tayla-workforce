// supabase/functions/push-shifts/index.ts
// Workforce Supabase project
// Called when employer publishes a week — pushes shifts to connected employees' Tayla accounts

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
    // Auth
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorised' }, 401)

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Verify caller
    const sbAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: authErr } = await sbAuth.auth.getUser()
    if (authErr || !user) return json({ error: 'Unauthorised' }, 401)

    const { business_id, week_start, week_end } = await req.json()
    if (!business_id || !week_start || !week_end) {
      return json({ error: 'Missing required fields' }, 400)
    }

    // Verify business belongs to caller
    const { data: business } = await sb
      .from('businesses')
      .select('id, biz_name')
      .eq('id', business_id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!business) return json({ error: 'Business not found' }, 403)

    // Get all published shifts for this week
    const { data: weekShifts } = await sb
      .from('shifts')
      .select('*')
      .eq('business_id', business_id)
      .gte('date', week_start)
      .lte('date', week_end)
      .neq('status', 'cancelled')
      .not('employee_id', 'is', null)

    if (!weekShifts?.length) {
      return json({ success: true, employees_notified: 0, message: 'No assigned shifts this week' })
    }

    // Get connected employees for this business
    const { data: connections } = await sb
      .from('workforce_connections')
      .select('employee_id, tayla_user_id')
      .eq('business_id', business_id)
      .eq('status', 'active')

    if (!connections?.length) {
      return json({ success: true, employees_notified: 0, message: 'No employees connected to Tayla' })
    }

    // Build lookup: employee_id → tayla_user_id
    const taylaMap: Record<string, string> = {}
    connections.forEach(c => { taylaMap[c.employee_id] = c.tayla_user_id })

    // Connect to Tayla project
    const taylaSb = createClient(
      Deno.env.get('TAYLA_SUPABASE_URL')!,
      Deno.env.get('TAYLA_SERVICE_ROLE_KEY')!
    )

    // Push shifts to Tayla — upsert by workforce_shift_id
    const notifiedUsers = new Set<string>()
    const shiftRows = []

    for (const shift of weekShifts) {
      const taylaUserId = taylaMap[shift.employee_id]
      if (!taylaUserId) continue

      notifiedUsers.add(taylaUserId)
      shiftRows.push({
        user_id:            taylaUserId,
        workforce_shift_id: shift.id,
        shift_date:         shift.date,
        start_time:         shift.start_time,
        end_time:           shift.end_time,
        business_name:      business.biz_name,
        notes:              shift.notes || null,
        status:             'upcoming',
        received_at:        new Date().toISOString(),
      })
    }

    if (shiftRows.length) {
      const { error: pushErr } = await taylaSb
        .from('shift_notifications')
        .upsert(shiftRows, { onConflict: 'workforce_shift_id' })

      if (pushErr) {
        console.error('Push shifts to Tayla failed:', pushErr)
        return json({ error: 'Failed to push to Tayla: ' + pushErr.message }, 500)
      }
    }

    // Log sync event
    await sb.from('sync_log').insert({
      business_id,
      event_type: 'shifts_published',
      direction:  'outbound',
      status:     'ok',
      payload:    {
        week_start,
        week_end,
        shifts_pushed:      shiftRows.length,
        employees_notified: notifiedUsers.size,
      },
    })

    return json({
      success:            true,
      shifts_pushed:      shiftRows.length,
      employees_notified: notifiedUsers.size,
    })

  } catch (err) {
    console.error('push-shifts error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
