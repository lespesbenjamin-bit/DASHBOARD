// ============================================
// CONFIGURATION SUPABASE
// ============================================
// Colle ici les 2 valeurs récupérées dans
// Supabase → Project Settings → API Keys
//
// SUPABASE_URL   = "Project URL"
// SUPABASE_ANON_KEY = "anon public key"
// ============================================

const SUPABASE_URL = "https://xwbzdtbajcznypubjzll.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3YnpkdGJhamN6bnlwdWJqemxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NjA3NjMsImV4cCI6MjEwNTAzNjc2M30.OqUB5Vrb9ihRP5k6Kf3_IwZ27yHAPSHvu7j8Z_rWpbg";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

