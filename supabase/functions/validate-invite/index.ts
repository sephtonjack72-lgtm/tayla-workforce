// supabase/functions/validate-invite/index.ts
// Workforce Supabase project — validates an invite token
// Called by connect.html before showing the auth form

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { token } = await req.json()
    if (!token) {
      return json({ error: 'Missing token' }, 400)
    }

    // Use service role key — needs to read invites without auth
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Look up the invite
    const { data: invite, error } = await sb
      .from('employee_invites')
      .select(`
        *,
        employees ( first_name, last_name, email ),
        businesses ( biz_name )
      `)
      .eq('token', token)
      .maybeSingle()

    if (error || !invite) {
      return json({ error: 'Invalid invite token' }, 404)
    }

    // Check status
    if (invite.status === 'accepted') {
      return json({ error: 'This invite has already been used' }, 400)
    }
    if (invite.status === 'revoked') {
      return json({ error: 'This invite has been revoked' }, 400)
    }

    // Check expiry
    if (new Date(invite.expires_at) < new Date()) {
      // Mark as expired
      await sb
        .from('employee_invites')
        .update({ status: 'expired' })
        .eq('id', invite.id)
      return json({ error: 'This invite has expired' }, 400)
    }

    // Return safe invite details for the connect page
    return json({
      valid:          true,
      invite_id:      invite.id,
      business_id:    invite.business_id,
      business_name:  invite.businesses?.biz_name || 'Your Employer',
      employee_id:    invite.employee_id,
      employee_name:  `${invite.employees?.first_name} ${invite.employees?.last_name}`.trim(),
      email:          invite.email,
    })

  } catch (err) {
    console.error('validate-invite error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}