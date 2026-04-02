// supabase/functions/accept-invite/index.ts
// Workforce Supabase project — accepts an invite and creates the connection
// Called by connect.html after the user authenticates in Tayla

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
    const { token, tayla_user_id, tayla_email } = await req.json()

    if (!token || !tayla_user_id || !tayla_email) {
      return json({ error: 'Missing required fields' }, 400)
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Re-validate the token (don't trust the client's claim)
    const { data: invite, error: inviteErr } = await sb
      .from('employee_invites')
      .select('*')
      .eq('token', token)
      .eq('status', 'pending')
      .maybeSingle()

    if (inviteErr || !invite) {
      return json({ error: 'Invalid or already used invite' }, 400)
    }

    if (new Date(invite.expires_at) < new Date()) {
      await sb.from('employee_invites').update({ status: 'expired' }).eq('id', invite.id)
      return json({ error: 'Invite has expired' }, 400)
    }

    // Create the connection record in Workforce
    const { error: connErr } = await sb
      .from('workforce_connections')
      .upsert({
        business_id:    invite.business_id,
        employee_id:    invite.employee_id,
        tayla_user_id,
        tayla_email,
        connected_at:   new Date().toISOString(),
        status:         'active',
      }, { onConflict: 'employee_id' })

    if (connErr) {
      console.error('Connection upsert failed:', connErr)
      return json({ error: 'Failed to create connection' }, 500)
    }

    // Mark invite as accepted
    const { error: updateErr } = await sb
      .from('employee_invites')
      .update({
        status:        'accepted',
        accepted_at:   new Date().toISOString(),
        tayla_user_id,
      })
      .eq('id', invite.id)

    if (updateErr) {
      console.error('Invite update failed:', updateErr)
      // Non-fatal — connection was created, just log it
    }

    // Update the employee record with the Tayla user ID for future syncs
    await sb
      .from('employees')
      .update({ tayla_user_id })
      .eq('id', invite.employee_id)

    // Log the sync event
    await sb.from('sync_log').insert({
      business_id: invite.business_id,
      employee_id: invite.employee_id,
      event_type:  'invite_accepted',
      direction:   'inbound',
      status:      'ok',
      payload:     { tayla_user_id, tayla_email },
    })

    return json({
      success:      true,
      employee_id:  invite.employee_id,
      business_id:  invite.business_id,
    })

  } catch (err) {
    console.error('accept-invite error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}