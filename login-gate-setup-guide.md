# Putting housinganalytics.org behind an email login

**Goal:** Keep the site exactly where it is (GitHub Pages), and add a login screen in front of it using Cloudflare Access. Visitors must enter their email and a one-time code before the site loads. Free for up to 50 people. No coding.

**How long:** About 45 minutes of clicking, plus up to a few hours of waiting for the internet to catch up on one DNS change (you don't have to sit and watch it).

**What you'll end up with:** Anyone going to housinganalytics.org sees a Cloudflare login page. Only the email addresses you approve can get in. You add or remove people any time by editing a list.

---

## Before you start: two things to know

**1. Where is the domain registered?** This is the company you bought `housinganalytics.org` from and pay the yearly renewal to — likely GoDaddy, Namecheap, Google Domains/Squarespace, or similar. You'll need to log in there once to change one setting. If you're not sure, check your email for a renewal receipt, or tell me and I'll help you figure it out.

**2. The repository stays public — and that's fine.** Cloudflare Access locks the *website*, not your GitHub repository. The repo `gteconomist/housinganalytics` is public and does contain the two source data spreadsheets (`Full Housing Data Table.xlsx` and `... - Places.xlsx`), which anyone can download directly from github.com regardless of the gate. We've decided that's acceptable: it's public ACS data that anyone could recompile, so there's nothing to protect there. You do **not** need to make the repo private, and you do **not** need a paid GitHub plan. The login gate is purely about keeping the *site itself* from being publicly browsable.

---

## Part 1 — Create a Cloudflare account and add your domain

1. Go to **https://dash.cloudflare.com/sign-up**.
2. Enter your work email and a password, click **Sign Up**, then confirm the verification email Cloudflare sends you.
3. After logging in, look for **Add a domain** (sometimes shown as "Add a site" or "Connect a domain"). Click it.
4. Type `housinganalytics.org` (no "www", no "https"). Click **Continue**.
5. When asked to choose a plan, select **Free** ($0). Click **Continue**.
6. Cloudflare scans your existing DNS records and shows you a list. Don't worry about understanding all of them — just click **Continue**. (We'll fix the important records in Part 3.)
7. Cloudflare now shows you **two nameservers** — they look like `xena.ns.cloudflare.com` and `rick.ns.cloudflare.com` (your two names will differ). **Keep this browser tab open** — you need these in the next step.

---

## Part 2 — Point your domain at Cloudflare (the one registrar step)

This is the only step you do at your domain registrar (Epik), and it's the one that takes time to take effect.

1. In a new tab, log in to **Epik** at https://www.epik.com.
2. Open your domain list (**My Account → Domains**, or the domain management area), and find `housinganalytics.org`.
3. Open its nameserver settings. On Epik you reach this either by clicking the **square options menu (⊞)** next to the domain and choosing **Set Name Servers**, or via the **DNS & WHOIS** option in the top navigation bar. The page shows your current nameservers.
4. **Delete** the existing nameservers and **enter the two Cloudflare nameservers** from Part 1, step 7. Click **Save Changes**.
   - Note: ignore Epik's pre-filled presets (Epik Default DNS, BlueHost, Wix) — you want the two custom Cloudflare names instead.
5. If Epik shows a **DNSSEC** setting as enabled, turn it **off** for now — leaving it on while changing nameservers can briefly knock the domain offline. You can re-enable it through Cloudflare later.

That's it for the registrar. Cloudflare will email you (subject line like "housinganalytics.org is now active on Cloudflare") once the change goes through — **anywhere from a few minutes to 24 hours**, though it's usually under an hour. You can move on to Part 3 while you wait; just don't switch on the proxy (Part 5) until the records are in.

---

## Part 3 — Set up the DNS records that point to GitHub Pages

Do this in the Cloudflare dashboard once you're in. (You can enter the records before activation finishes.)

1. In Cloudflare, click your domain, then **DNS** in the left menu, then **Records**.
2. Delete any old `A`, `AAAA`, or `CNAME` records for the root domain (`housinganalytics.org`) and for `www` that point somewhere other than GitHub. (Leave MX/email records alone if you have them.)
3. Add these **four A records**. For each: click **Add record**, Type = **A**, Name = **@** (this means the root domain), IPv4 address = one of the four below, and — important — set the **Proxy status to DNS only (grey cloud), not Proxied (orange cloud)** for now.

   | Type | Name | IPv4 address      | Proxy status   |
   |------|------|-------------------|----------------|
   | A    | @    | 185.199.108.153   | DNS only (grey)|
   | A    | @    | 185.199.109.153   | DNS only (grey)|
   | A    | @    | 185.199.110.153   | DNS only (grey)|
   | A    | @    | 185.199.111.153   | DNS only (grey)|

4. Add one **CNAME record** so `www` works too: Type = **CNAME**, Name = **www**, Target = `gteconomist.github.io`, Proxy status = **DNS only (grey)** for now.

> Why grey/DNS-only for now: GitHub needs to see the real records to issue the site's HTTPS security certificate. If we hide them behind Cloudflare's proxy too early, that fails. We flip them to orange in Part 5.

---

## Part 4 — Confirm GitHub Pages is happy with the domain

1. Go to your repo on GitHub: **github.com/gteconomist/housinganalytics**.
2. Click **Settings** (top of the repo), then **Pages** in the left menu.
3. Under **Custom domain**, make sure it says `housinganalytics.org`. If it's blank, type it in and click **Save**. GitHub runs a DNS check — wait for the green checkmark (can take a few minutes).
4. Once verified, tick the **Enforce HTTPS** box. If it's greyed out, wait 15–30 minutes for GitHub to issue the certificate, then come back and tick it.

Don't continue to Part 5 until **Enforce HTTPS** is ticked and the site loads fine at `https://housinganalytics.org`.

---

## Part 5 — Turn on Cloudflare's proxy (this is what makes the gate possible)

The login gate only works when traffic flows *through* Cloudflare. Two small changes:

1. In Cloudflare, go to **SSL/TLS** in the left menu, then **Overview**. Set the encryption mode to **Full**. (Not "Flexible" — that causes an endless redirect loop. Not "Full (Strict)" either. Just **Full**.)
2. Go back to **DNS → Records**. For each of the four **A records** and the **www CNAME**, click **Edit** and switch **Proxy status** from grey "DNS only" to **orange "Proxied."** Save each one.
3. Wait a couple of minutes, then visit `https://housinganalytics.org` to confirm it still loads normally. (No login yet — that's next.)

---

## Part 6 — Set up the login gate (Cloudflare Access)

1. In the Cloudflare dashboard left menu, open **Zero Trust**. The first time, it asks you to pick a team name (e.g. `cedr` or `housinganalytics`) — choose anything; it becomes part of your login page address. Choose the **Free** plan if prompted (covers 50 users; you may be asked for a card to verify but the plan is $0).
2. Set up the email-code login method:
   - Go to **Integrations** (left menu) → **Identity providers**. (Note: Cloudflare redesigned this dashboard — it used to be under Settings → Authentication.)
   - New accounts default the login method to **Cloudflare**, which would make every visitor sign in with their own Cloudflare account — not what you want. Instead click **Add new** and choose **One-time PIN**. (This is the "email me a code" method — works for any approved address, no extra accounts needed.) Confirm **One-time PIN** now appears in the list.
3. Create the gated application:
   - Go to **Access controls** (left menu) → **Applications**, click **Add an application**, choose **Self-hosted**. (Formerly under Access → Applications.)
   - **Application name:** `Housing Analytics`
   - **Session duration:** pick something like **1 week** (how long before someone has to log in again).
   - Under **Application domain**, set the domain to `housinganalytics.org`. Add a second entry for `www.housinganalytics.org` if you want both covered.
   - Click **Next**.
4. Create the rule for who's allowed in (closed allow-list — only named people):
   - **Policy name:** `Approved viewers`
   - **Action:** Allow
   - Under **Configure rules → Include**, set the **Selector** to **Emails** (the plural one — it accepts a list). In the **Value** field, type each approved email address, one per person.
   - **Do NOT** use the "Emails ending in" / domain option — that would let anyone at a whole domain in. You want the explicit **Emails** list.
   - Click **Next**, then **Add application** to save.

> How this gives you a closed list: Cloudflare Access denies anyone who doesn't match an Allow rule. With only an Emails list in the Include rule, *only* those exact addresses can request a PIN; everyone else gets a denial screen. To add/remove people later, edit this same Emails list under **Access controls → Applications → [your app] → policy**.

---

## Part 7 — Test it

1. Open a **private/incognito window** (so you're not already logged in).
2. Go to `https://housinganalytics.org`.
3. You should see a Cloudflare login screen asking for your email. Enter an approved one.
4. Cloudflare emails you a 6-digit code (the email is from Cloudflare; the code lasts 10 minutes). Enter it.
5. The site loads. Done — that's exactly what every visitor will now experience.

If you instead land straight on the site with no login, give it 5 minutes (Access rules take a moment to apply) and retry. If you get a redirect-loop error, double-check the SSL mode is **Full** (Part 5, step 1).

---

## Day-to-day: managing who has access

- **Add or remove people:** Cloudflare dashboard → **Zero Trust → Access → Applications → Housing Analytics → edit the "Approved viewers" policy** → update the email list or domain → save. Changes take effect within a minute or two.
- **Cost:** $0 as long as you're under 50 users.
- **Turning the gate off temporarily:** disable or delete the application in the same Access screen; the site goes back to public immediately.

---

## Branding the login page (Economic Impact Group look)

The default Cloudflare login screen can be styled to match Economic Impact Group. On the free tier you can set a background color, a logo, an organization name, and header/footer text (fully custom HTML is Enterprise-only).

**Where:** Zero Trust → **Reusable components → Custom pages → Access login page → Manage**. Live preview on the right; **Save** when done.

**Values (pulled from economicimpact.com):**

- **Organization name:** `Economic Impact Group`
- **Background color:** `#16181c` (EIG charcoal; alt `#1e2025`)
- **Accent / amber (for reference):** `#f19623`
- **Logo:** the **dark** EIG logo, at a public, non-gated URL. Committed in this repo at `public/eig-logo-dark.png`, so point Cloudflare at the raw GitHub URL: `https://raw.githubusercontent.com/gteconomist/housinganalytics/main/public/eig-logo-dark.png`
- **Footer text:** `Economic Impact Group, LLC · Authorized access only`

Use the **dark** logo, not the white one: Cloudflare places the logo *inside the white login card* (not on the dark page background), so a white logo would be invisible on white. The charcoal `#16181c` background only frames the card. The logo URL must be public (raw GitHub works); don't use a `housinganalytics.org/...` path — that's behind the gate, so the login page couldn't load it.

---

## If you get stuck

The two most common snags are (1) the SSL mode not being set to **Full**, which causes a "too many redirects" error, and (2) flipping the proxy to orange before GitHub has issued its HTTPS certificate. Both are fixable by reversing the step. Send me a screenshot of whatever you're seeing and I'll talk you through it.

When you're ready to start, the very first useful thing is knowing your registrar (Part 2) — tell me who it is and I'll give you the exact menu path for that specific company.
