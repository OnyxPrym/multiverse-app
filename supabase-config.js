// ============================================================
// KARANKA MULTIVERSE - SUPABASE CONFIGURATION
// ============================================================

const SUPABASE_URL = "https://nebzukqsvlenxqzrmaog.supabase.co";
const SUPABASE_KEY = "sb_publishable_iVPtIKxRvsVyGRyKfMTIow_HL1gyKox";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
});
