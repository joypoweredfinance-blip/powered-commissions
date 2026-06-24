# POWERED Commissions — Setup Guide

## Running it on your own computer (to try it out)

### Step 1 — Install Node.js
Download and install Node.js (LTS version) from https://nodejs.org/en/download
Then in Terminal, check it worked:
```bash
node --version   # should show v18 or higher
```

### Step 2 — Install the app's dependencies
```bash
cd "~/Downloads/POWERED Commissions"
npm install
```

### Step 3 — Run it
```bash
npm start
```
Open http://localhost:3000 in your browser. The very first time it runs, it prints an admin
email/password to the Terminal — use that to log in, then you'll be asked to set your own
password immediately.

---

## Putting it on the internet (so reps can use it on their phones)

You don't need a credit card for either of these — both have a genuinely free tier.

### Step 1 — Create a free database (Turso)
1. Go to https://turso.tech and sign up (just an email, no card).
2. Create a new database (any name, e.g. `powered-commissions`).
3. From the database's page, copy the **Database URL** and create/copy an **Auth Token**.
   Keep these somewhere safe — you'll paste them into Render in Step 3.

### Step 2 — Put the code on GitHub
Render deploys from a GitHub repository. If you don't already have a GitHub account, create
one free at https://github.com. Then, from Terminal in this folder:
```bash
cd "~/Downloads/POWERED Commissions"
git add .
git commit -m "Initial commit"
```
Create a new (private is fine) repository on GitHub called `powered-commissions`, then:
```bash
git remote add origin <the URL GitHub gives you>
git branch -M main
git push -u origin main
```

### Step 3 — Deploy on Render
1. Go to https://render.com and sign up free (no card needed for the free tier).
2. Click **New +** → **Web Service**, and connect the `powered-commissions` GitHub repo.
3. Render will detect `render.yaml` automatically and fill in the build/start commands.
4. Under **Environment**, paste in the values you saved from Turso:
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
5. Click **Create Web Service**. The first deploy takes a couple of minutes.
6. Open the **Logs** tab and look for the admin email/password printed on first boot — that's
   your login. You'll be asked to set your own password the first time you sign in.

Render's free tier "sleeps" the app after 15 minutes of no traffic — the first visit after that
takes a few seconds to wake back up. Everything else works exactly the same.

---

## Day-to-day cheat sheet

- **Add a rep or payroll staff member:** Admin → Sales Reps (or Payroll Staff) → "+ Add" → then
  "Create Login" to get them a temporary password to share.
- **Enter a new deal:** Deals Board → "+ New Deal" → fill in Project Details & System/Finance →
  add cost line items under Adders. The commission calculator updates automatically.
- **Approve a deal for a rep to see:** open the deal → Approval Gate card → "Approve" next to
  Closer and/or Setter. Nothing is visible to a rep until you do this.
- **Override a number:** open the deal → Commission Calculator card → "Manual Override" →
  enter the numbers you want and a reason (required, gets logged).
- **Fix the pay scale, splits, or floor:** Admin → Commission Rules.
- **Everything is logged:** Admin → Audit Log shows every change, who made it, and when.
