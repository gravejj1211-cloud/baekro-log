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

const firstKeyFromDictionary = (value: string | undefined) => {
  if (!value) return undefined;
  try {
    const dictionary = JSON.parse(value) as Record<string, unknown>;
    const candidate = Object.values(dictionary).find((item) => typeof item === "string");
    return typeof candidate === "string" ? candidate : undefined;
  } catch {
    return undefined;
  }
};

const STORAGE_BUCKET = "observation-photos";
const DATABASE_LIMIT = 500 * 1024 * 1024;
const STORAGE_LIMIT = 1024 * 1024 * 1024;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "로그인 세션이 없습니다." }, 401);

    const serviceRoleKey = firstKeyFromDictionary(Deno.env.get("SUPABASE_SECRET_KEYS"))
      || Deno.env.get("SCHOOLFOREST_SERVICE_ROLE_KEY")
      || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) return json({ error: "서버 인증 설정이 완료되지 않았습니다." }, 500);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "로그인 세션을 확인하지 못했습니다." }, 401);

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role, approval_status")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (profileError) return json({ error: "교사 권한을 확인하지 못했습니다.", detail: profileError.message }, 500);
    if (profile?.role !== "owner_teacher" || profile.approval_status !== "approved") {
      return json({ error: "주 교사만 사용량을 확인할 수 있습니다." }, 403);
    }

    const [{ count: surveyCount }, { count: observationCount }, { count: photoCount }] = await Promise.all([
      admin.from("surveys").select("id", { count: "exact", head: true }),
      admin.from("observations").select("id", { count: "exact", head: true }),
      admin.from("observations").select("id", { count: "exact", head: true }).not("photo_path", "is", null)
    ]);

    const { data: databaseSize, error: databaseError } = await admin.rpc("get_database_size_bytes");
    if (databaseError) {
      console.error("database usage lookup failed", databaseError.message);
    }

    let storageBytes = 0;
    let storageFiles = 0;
    const visit = async (prefix = ""): Promise<void> => {
      const { data: entries, error } = await admin.storage.from(STORAGE_BUCKET).list(prefix, {
        limit: 1000,
        offset: 0,
        sortBy: { column: "name", order: "asc" }
      });
      if (error) throw new Error(error.message);
      for (const entry of entries || []) {
        const entryPath = `${prefix}${entry.name}`;
        if (!entry.id) await visit(`${entryPath}/`);
        else {
          storageFiles += 1;
          storageBytes += Number(entry.metadata?.size || 0);
        }
      }
    };
    await visit();

    return json({
      database: {
        usageBytes: databaseError ? null : Number(databaseSize),
        limitBytes: DATABASE_LIMIT
      },
      storage: {
        usageBytes: storageBytes,
        limitBytes: STORAGE_LIMIT,
        fileCount: storageFiles
      },
      records: {
        surveys: surveyCount || 0,
        observations: observationCount || 0,
        photos: photoCount || 0
      },
      measuredAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("get-data-usage failed", error);
    return json({ error: "사용량을 계산하는 중 오류가 발생했습니다." }, 500);
  }
});
