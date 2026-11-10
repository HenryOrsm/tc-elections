/*
  Nation names, parties and senate rules. Loaded after config.js and wins over it,
  so you can change these without ever touching your Supabase keys.
  Change only the names/short names/colours/numbers on the right. Do NOT change the ids on the left.
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
    "blue": { name: "The Toner Campaign", short: "Toner", color: "#1063DF" },
    "gold": { name: "Og for Aljanna", short: "Og", color: "#DDAA22" },
    "red":  { name: "Literal Russian Communism", short: "Communism",  color: "#D32F2F" },
    "green": { name: "MAGA (Make Aljanna Great Again)", short: "MAGA", color: "#2E9E4F" }
  };
  // Senate seats each nation elects. The top candidates in that nation win.
  c.senateSeatsPerNation = 2;
  // Seats per nation. Any nation not listed here gets senateSeatsPerNation. 0 = no senators for now.
  c.senateSeats = {
    "maradon": 2, "cecilia": 2, "narellan": 2,
    "goldleaf": 0, "dyonisia": 0, "island-a": 0, "eldonia": 0, "island-b": 0,
    "seafaria": 0
  };
  // Greyed out on the senate map like IGT Town: no seats, no voting, no candidates.
  c.senateExcluded = ["seafaria"];
})();
