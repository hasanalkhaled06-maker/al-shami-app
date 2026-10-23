/*
  Supabase configuration.
  Never put the service_role key here.
*/
window.AL_SHAMI_CONFIG = {
  SUPABASE_URL: "https://rxjfvuxzseuybfmfyjvs.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_K35OkhWCjj8nq4wnjfzdMw_Et77U1n7",
  // OpenStreetMap map tiles. Keep this configurable so the source can be changed if needed.
  MAP_TILE_URL: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  // Public Nominatim is used only for explicit searches, not autocomplete. Observe its usage policy.
  GEOCODING_SEARCH_URL: "https://nominatim.openstreetmap.org/search"
};