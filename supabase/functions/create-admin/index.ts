import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { email, password, full_name, username, role } = await req.json();

    // 1. Verify the request is coming from an already-authenticated user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
        status: 401 
      });
    }
    
    // Create a Supabase client with the user's token
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user: callingUser }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !callingUser) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
        status: 401 
      });
    }

    // 2. Verify that this calling user's row in the `users` table has role = 'admin'
    const { data: callingUserRow, error: callingUserError } = await supabaseClient
      .from('users')
      .select('role')
      .eq('user_id', callingUser.id)
      .single();

    if (callingUserError || !callingUserRow || callingUserRow.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden: only admins can create new users' }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
        status: 403 
      });
    }

    // 3. Use the service_role key to call supabase.auth.admin.createUser()
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: authData, error: authCreateError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authCreateError || !authData.user) {
      return new Response(JSON.stringify({ error: authCreateError?.message || 'Failed to create auth user' }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
        status: 400 
      });
    }

    const newUserId = authData.user.id;

    // 4. On success, insert a matching row into the `users` table
    const { error: insertError } = await supabaseAdmin.from('users').insert({
      user_id: newUserId,
      email,
      full_name,
      username,
      role,
      status: 'active'
    });

    // 5. If the users table insert fails after the auth user was already created, delete the just-created auth user
    if (insertError) {
      await supabaseAdmin.auth.admin.deleteUser(newUserId);
      return new Response(JSON.stringify({ error: insertError.message || 'Failed to insert user profile' }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
        status: 400 
      });
    }

    // 6. Return the created user's info on success
    return new Response(JSON.stringify({ success: true, user: { id: newUserId, email, full_name, username, role } }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
      status: 200 
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
      status: 400 
    });
  }
});
