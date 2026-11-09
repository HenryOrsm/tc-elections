/*
  Nation names, parties and senate rules. Loaded after config.js and wins over it,
  so you can change these without ever touching your Supabase keys.
  Change only the names/colours/numbers on the right. Do NOT change the ids on the left.
*/
(function () {
  var c = window.ELECTION_CONFIG = window.ELECTION_CONFIG || {};
  c.nations = {
    "maradon": "Maradon",
    "goldleaf": "Goldleaf",
    "dyonisia": "Dyonisia",
    "seafaria": "Seafaria",
    "narellan": "Narellan",
    "cecilia": "Cecilia",
    "eldonia": "Eldonia",
    "island-a": "Athens",
    "island-b": "Grassisland",
    "igt-town": "IGT Town"
  };
  c.parties = {
    "blue": { name: "Blue Party", color: "#1063DF" },
    "gold": { name: "Gold Party", color: "#DDAA22" },
    "red":  { name: "Red Party",  color: "#D32F2F" },
    "green": { name: "Green Party", color: "#2E9E4F" }
  };
  // Senate seats each nation elects. The top candidates in that nation win.
  c.senateSeatsPerNation = 2;
})();
