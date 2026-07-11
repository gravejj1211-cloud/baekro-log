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
    const authorization = request.headers.get("Authorization") || "";
    const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!accessToken) return json({ error: "로그인 세션이 없습니다." }, 401);

    const { target_user_id, new_password } = await request.json();
    if (typeof target_user_id !== "string" || typeof new_password !== "string" || new_password.length < 6) {
      return json({ error: "대상 회원과 6자 이상의 새 비밀번호를 입력하세요." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SCHOOLFOREST_SERVICE_ROLE_KEY")
      || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) {
      console.error("service role key is not available in Edge Function secrets");
      return json({ error: "서버 인증 설정이 완료되지 않았습니다." }, 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { data: callerData, error: callerError } = await admin.auth.getUser(accessToken);
    if (callerError || !callerData.user) return json({ error: "로그인 세션을 확인하지 못했습니다." }, 401);

    const { data: callerProfile, error: callerProfileError } = await admin
      .from("profiles")
      .select("id, role, approval_status")
      .eq("id", callerData.user.id)
      .maybeSingle();
    if (callerProfileError || callerProfile?.role !== "owner_teacher" || callerProfile.approval_status !== "approved") {
      console.error("owner teacher authorization failed", callerProfileError?.message || "not an approved owner teacher");
      return json({ error: "주 교사 권한이 필요합니다." }, 403);
    }

    const { data: targetProfile, error: targetProfileError } = await admin
      .from("profiles")
      .select("id, role")
      .eq("id", target_user_id)
      .maybeSingle();
    if (targetProfileError || !targetProfile) return json({ error: "변경할 회원을 찾지 못했습니다." }, 404);
    if (targetProfile.role === "owner_teacher") return json({ error: "주 교사 비밀번호는 회원 관리에서 변경할 수 없습니다." }, 403);

    const { error: updateError } = await admin.auth.admin.updateUserById(target_user_id, {
      password: new_password
    });
    if (updateError) {
      console.error("member password update failed", updateError.message);
      return json({ error: "비밀번호 변경에 실패했습니다." }, 500);
    }

    return json({ ok: true });
  } catch (error) {
    console.error("set-member-password failed", error);
    return json({ error: "비밀번호 변경 중 오류가 발생했습니다." }, 500);
  }
});
