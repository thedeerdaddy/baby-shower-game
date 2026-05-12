# Cooper & Michelle's Baby Shower Games 🍼

Real-time multiplayer party game with 3 games:
- **Quiplash** — funny prompt answers, host reveals on the big screen
- **Who Knows Who Better?** — guests guess how Cooper & Michelle answer questions they submitted during cocktail hour
- **Cooper & Michelle Trivia** — guests guess the couple's real answers

---

## Deploy in 4 steps

### Step 1 — Supabase table

Open your Supabase project, go to SQL Editor, run this:

```sql
create table if not exists game_state (
  key text primary key,
  value text not null,
  updated_at timestamptz default now()
);
alter table game_state enable row level security;
create policy "public read" on game_state for select using (true);
create policy "public write" on game_state for insert with check (true);
create policy "public update" on game_state for update using (true);
```

Then go to Settings → API and grab your Project URL and anon key.

### Step 2 — Environment variables

Create `.env.local`:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_HOST_PIN=yourpin
```

Change `VITE_HOST_PIN` to whatever PIN you want.

### Step 3 — Push to GitHub

```bash
git init
git add .
git commit -m "baby shower games"
git remote add origin https://github.com/thedeerdaddy/baby-shower-game.git
git push -u origin main
```

### Step 4 — Vercel

Import the repo on vercel.com. Add the 3 env vars. Deploy.

---

## QR Code

Open the deployed URL, click the QR tab, hit Print. One sheet per table.

---

## Running the games

Before guests arrive: go to Host tab, enter PIN, add Trivia Q&As and custom Quiplash prompts.

During cocktail hour: guests submit Who Knows Who Better questions from the Join tab.

To run a round: Host tab → pick a game → Start Round → Reveal Answers → Next Round.

---

## Local dev

```bash
npm install
npm run dev
```

Without Supabase vars, falls back to localStorage (one device only).
