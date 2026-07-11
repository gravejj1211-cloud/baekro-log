import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { login_id, password } = await request.json();
    if (typeof login_id !== "string" || typeof password !== "string" || !login_id.trim() || !password) {
      return json({ error: "아이디와 비밀번호를 입력하세요." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY")!;
    const publicKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, login_id, approval_status")
      .eq("login_id", login_id.trim())
      .maybeSingle();
    if (profileError) {
      console.error("profile lookup failed", profileError.message);
      return json({ error: "회원 정보를 조회하지 못했습니다." }, 500);
    }
    if (!profile || profile.approval_status !== "approved") {
      return json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." }, 401);
    }

    const { data: userData, error: userError } = await admin.auth.admin.getUserById(profile.id);
    const email = userData.user?.email;
    if (userError || !email) {
      console.error("auth user lookup failed", userError?.message || "email not found");
      return json({ error: "회원 인증 정보를 조회하지 못했습니다." }, 500);
    }

    const publicClient = createClient(supabaseUrl, publicKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { data: authData, error: authError } = await publicClient.auth.signInWithPassword({
      email,
      password
    });
    if (authError || !authData.session) {
      console.warn("password authentication rejected", authError?.message || "session not returned");
      return json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." }, 401);
    }

    return json({ session: authData.session });
  } catch (_error) {
    return json({ error: "로그인 처리 중 오류가 발생했습니다." }, 500);
  }
});
