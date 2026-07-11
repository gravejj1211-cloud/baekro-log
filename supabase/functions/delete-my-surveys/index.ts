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
    const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "로그인 세션이 없습니다." }, 401);

    const body = await request.json();
    const surveyIds = Array.isArray(body?.survey_ids)
      ? [...new Set(body.survey_ids.filter((id: unknown) => typeof id === "string" && id.trim()))]
      : [];
    if (!surveyIds.length) return json({ error: "삭제할 조사 기록이 없습니다." }, 400);
    if (surveyIds.length > 100) return json({ error: "한 번에 100건까지만 삭제할 수 있습니다." }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SCHOOLFOREST_SERVICE_ROLE_KEY")
      || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) return json({ error: "서버 인증 설정이 완료되지 않았습니다." }, 500);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { data: callerData, error: callerError } = await admin.auth.getUser(token);
    if (callerError || !callerData.user) return json({ error: "로그인 세션을 확인하지 못했습니다." }, 401);

    const { data: callerProfile, error: profileError } = await admin
      .from("profiles")
      .select("role, approval_status")
      .eq("id", callerData.user.id)
      .maybeSingle();
    if (profileError) {
      console.error("profile lookup failed", profileError.message);
      return json({ error: "교사 권한을 확인하지 못했습니다.", detail: profileError.message }, 500);
    }
    const isOwner = callerProfile?.role === "owner_teacher" && callerProfile.approval_status === "approved";
    if (!isOwner) return json({ error: "주 교사만 조사 기록을 삭제할 수 있습니다." }, 403);

    let surveyQuery = admin
      .from("surveys")
      .select("id, user_id")
      .in("id", surveyIds);
    const { data: surveys, error:surveyError } = await surveyQuery;
    if (surveyError) return json({ error: "조사 기록을 확인하지 못했습니다." }, 500);
    const allowedIds = (surveys || []).map(survey => survey.id);
    if (!allowedIds.length) return json({ error: "삭제할 수 있는 조사 기록이 없습니다." }, 403);

    const { data: observations, error: observationLookupError } = await admin
      .from("observations")
      .select("id, photo_path")
      .in("survey_id", allowedIds)
      .not("photo_path", "is", null);
    if (observationLookupError) {
      console.error("observation lookup failed", observationLookupError.message);
      return json({ error: "관찰 기록을 확인하지 못했습니다.", detail: observationLookupError.message }, 500);
    }
    const photoPaths = (observations || [])
      .map(observation => observation.photo_path)
      .filter((path): path is string => typeof path === "string" && Boolean(path));
    if (photoPaths.length) await admin.storage.from("observation-photos").remove(photoPaths);

    const { error:observationDeleteError } = await admin.from("observations").delete().in("survey_id", allowedIds);
    if (observationDeleteError) {
      console.error("observation deletion failed", observationDeleteError.message);
      return json({ error: "관찰 기록 삭제에 실패했습니다.", detail: observationDeleteError.message }, 500);
    }

    const { error:deleteError } = await admin.from("surveys").delete().in("id", allowedIds);
    if (deleteError) {
      console.error("survey deletion failed", deleteError.message);
      return json({ error: "조사 기록 삭제에 실패했습니다.", detail: deleteError.message }, 500);
    }
    return json({ ok: true, deleted: allowedIds.length });
  } catch (error) {
    console.error("delete-my-surveys failed", error);
    return json({ error: "조사 기록 삭제 중 오류가 발생했습니다." }, 500);
  }
});
