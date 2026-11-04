# World Election site

Live voting site for your Minecraft nations: a popular vote with no electoral college, results on a map shaded by each nation's vote share, open candidate sign-up with admin approval. It is plain HTML/CSS/JS, so it hosts free on GitHub Pages. Votes live in a free Supabase database.

Until you add your Supabase keys, the site runs in **demo mode** with fake data so you can see how it looks.

## Setup (about 15 minutes)

### 1. Create the database
1. Make a free project at supabase.com.
2. Open **SQL Editor > New query**, paste all of `supabase/setup.sql`, and **change `CHANGE-ME@example.com` to your own email first**. Press Run.
3. Open **Authentication > Users > Add user**, create a user with that same email and a password. This is your admin login.

### 2. Connect the site
1. In Supabase open **Project Settings > API**.
2. Copy the **Project URL** and the **anon public** key into `js/config.js`. The anon key is meant to be public. The rules in `setup.sql` stop people from cheating with it. Never put the `service_role` key anywhere in this site.

### 3. Put it on GitHub Pages
1. Create a repo and upload everything in this folder.
2. **Settings > Pages**, choose your main branch and the root folder, save.
3. Your site is live at `https://YOURNAME.github.io/REPONAME/`. Your admin page is `/admin.html` on the same address.

### 4. Run the election
- People sign up under **Run for leader**. They stay hidden until you open `/admin.html`, sign in, and press **Approve**. Approving gives them their colour.
- In the admin page you can also remove a candidate, or remove a single vote (for example a fake one, or to let someone vote again).

## Settings in `js/config.js`
- `pollsCloseAt`: lock voting and sign-ups at a set time, for example `"2026-12-01T20:00:00+10:00"`. This is enforced in the browser only. To close polls properly, run this in the SQL editor: `drop policy "anyone can vote for an approved candidate" on public.votes;`
- `nations`: rename **Island A** and **Island B** once you know their real names. Change only the names, not the ids.
- `refreshSeconds`: how often results update by themselves.

## Things you should know
- **Minecraft usernames are not verified.** Anyone can type any name, so a determined person could make many votes under different names. The site stops the same name voting twice (capitals ignored), and you can delete suspicious votes in the admin page. If it gets abused, the next step up is a Discord login, which I can add.
- Voters' usernames are never shown publicly. The public page only gets totals.
- Spawn island (IGT Town) is drawn on the map but cannot be voted from.
- The map was traced from your image: each territory is cut to the real landmass and none overlap. The south end of Seafaria, which was mostly open ocean in your drawing, is trimmed off.

## Files
- `index.html`, `css/style.css`, `js/app.js`: the public site
- `admin.html`, `js/admin.js`: approvals and vote moderation
- `js/map-data.js`: the traced map shapes
- `js/config.js`: your settings
- `supabase/setup.sql`: the database and its security rules
