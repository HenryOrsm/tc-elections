/*
  EDIT THIS FILE to set up your election.
  The Supabase anon key is meant to be public. The database rules in
  supabase/setup.sql are what keep people from cheating.
*/
window.ELECTION_CONFIG = {
  // From Supabase: Project Settings > API
  supabaseUrl: "https://zvglggqxbjqjqinmxmgl.supabase.co",
  supabaseAnonKey: "sb_publishable_RiFe36qvAOVDekPVPgmdww_FRzjXWYA",

  siteTitle: "World Election",
  raceTitle: "Leader of the World",

  // Optional. Voting and sign-ups lock after this time, e.g. "2026-12-01T20:00:00+10:00".
  // Leave as "" to keep polls open until you close them.
  pollsCloseAt: "",

  // How often results refresh on their own, in seconds.
  refreshSeconds: 20,

  // Display names. Change the two islands once you know their real names.
  // Do NOT change the ids on the left, only the names on the right.
  nations: {
    "maradon": "Maradon",
    "goldleaf": "Goldleaf",
    "dyonisia": "Dyonisia",
    "seafaria": "Seafaria",
    "narellan": "Narellan",
    "cecilia": "Cecilia",
    "eldonia": "Eldonia",
    "island-a": "Island A",
    "island-b": "Island B",
    "igt-town": "IGT Town"
  }
};
