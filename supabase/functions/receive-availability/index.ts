// supabase/functions/receive-availability/index.ts
// Workforce Supabase project
// Called from Tayla when an employee saves their availability

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
    const { tayla_user_id, availability } = await req.json()

    if (!tayla_user_id || !availability?.length) {
      return json({ error: 'Missing tayla_user_id or availability' }, 400)
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Look up the workforce connection for this Tayla user
    const { data: connection } = await sb
      .from('workforce_connections')
      .select('employee_id, business_id')
      .eq('tayla_user_id', tayla_user_id)
      .eq('status', 'active')
      .maybeSingle()

    if (!connection) {
      return json({ error: 'No active connection found for this user' }, 404)
    }

    // Upsert availability rows
    const rows = availability.map((a: {
      day_of_week: number
      available:   boolean
      start_time:  string | null
      end_time:    string | null
      notes:       string | null
    }) => ({
      business_id: connection.business_id,
      employee_id: connection.employee_id,
      day_of_week: a.day_of_week,
      available:   a.available,
      start_time:  a.start_time  || null,
      end_time:    a.end_time    || null,
      notes:       a.notes       || null,
      synced_at:   new Date().toISOString(),
    }))

    const { error } = await sb
      .from('employee_availability')
      .upsert(rows, { onConflict: 'employee_id,day_of_week' })

    if (error) {
      console.error('Upsert availability failed:', error)
      return json({ error: error.message }, 500)
    }

    // Log sync event
    await sb.from('sync_log').insert({
      business_id: connection.business_id,
      employee_id: connection.employee_id,
      event_type:  'availability_received',
      direction:   'inbound',
      status:      'ok',
      payload:     { days_synced: rows.length },
    })

    return json({ success: true, days_synced: rows.length })

  } catch (err) {
    console.error('receive-availability error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
