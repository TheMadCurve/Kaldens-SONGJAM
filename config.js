// Supabase Configuration
const SUPABASE_CONFIG = {
  url: 'https://vfkalemgmhobyuqvzreh.supabase.co',
  anonKey: 'sb_publishable_maT_I76CIxa4oFTHLEBILQ_lCYeNCX8',
  redirectUrl: 'https://themadcurve.github.io/Kaldens-SONGJAM/'  // Fixed repo name
};

// Application Configuration
const APP_CONFIG = {
  maxVotesPerUser: 10,
  maxVotesPerSong: 3,  // Changed from 5 to 3 to match your preference
  debounceDelay: 300,
  toastDuration: 3000,
  retryAttempts: 3,
  retryDelay: 1000
};