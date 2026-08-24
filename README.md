# HealthConnect — Real-time Family & Care Video Rooms

A real-time video conferencing and live monitoring web app to connect patients with relatives and healthcare providers. Built with a Material Design 3 visual system, reactive data (Convex), and Convex Auth (Google, email OTP, or guest).

Demo-ready overview:
- Create and join video rooms
- Sign in with Google, an emailed 6-digit code, or as a guest
- Invite family with shareable links, or email them a direct join link
- In-room chat
- Patient–Relative connections
- Appointments scheduling and instant room creation
- Clean, responsive MD3 UI with shadows, ripples, and Roboto

---

## 1) Quickstart (Local Setup)

Prerequisites:
- Node.js ≥ 18
- pnpm ≥ 8
- A Convex project (auto-provisioned on `npx convex dev`)
- Modern browser (with camera/mic permissions enabled)

Install:
- pnpm install

Set up authentication (one time):
- Start the backend first: `npx convex dev` (leave it running)
- In a second terminal: `pnpm setup:auth`

This generates the RSA keypair Convex Auth signs session JWTs with and installs
`JWT_PRIVATE_KEY`, `JWKS` and `SITE_URL` on the deployment. **Sign-in fails for
every method — including guest — until these exist.** Re-running is safe; it
won't overwrite existing keys unless you pass `--force` (which signs everyone
out). If your app isn't on port 5173, pass `pnpm setup:auth --site-url=http://localhost:3000`.

Run (two terminals):
- Terminal A: npx convex dev
- Terminal B: pnpm dev
- App runs on Vite's dev server (default: http://localhost:5173)

If you see compile errors:
- The dev server is always running. Fix code issues until "Convex functions ready!" and no TypeScript errors remain.

Notes:
- After `pnpm setup:auth`, **email OTP and guest sign-in work with no further
  configuration.** With no email provider configured, `setup:auth` sets
  `EMAIL_DEV_LOG=true` on a localhost deployment, and the sign-in code is printed
  in the `npx convex dev` terminal instead of being emailed — so you can sign in
  locally without any third-party account.
- **To email real addresses you need a verified sender**, not just an API key.
  See [Authentication setup](#11-authentication-setup); this is the one part that
  can't be worked around in code.
- Google sign-in is optional. The Google button stays hidden until credentials
  are configured, so there are no dead controls.
- If clipboard permissions are blocked, share-link copying falls back automatically.

---

## 2) Tech Stack

- Frontend: React + Vite + Tailwind + shadcn/ui, Framer Motion (animations)
- Backend: Convex (database + server functions), Convex Auth (Google, email OTP, anonymous guest)
- Email: Resend or Brevo over plain HTTP (sign-in codes and call invitations)
- Styling: Material Design 3 palette, elevation shadows, 8dp grid, ripple, Roboto
- Realtime: Convex queries (auto-updating subscriptions)

---

## 3) App Structure (Key Screens)

- Landing (/) — simple entry with CTA
- Auth (/auth) — Google, Email OTP, and Guest sign-in
- Join Invite (/join/:token) — landing page for an emailed call invitation.
  Works while signed out: shows who invited you and to which call, then lets you
  sign in (or continue as a guest) and drops you straight into the room.
- Dashboard (/dashboard)
  - Quick Actions: Create Room, Connect Family, Schedule Visit
  - Tabs: Overview, Rooms, Connections, Appointments, Monitoring
- Video Room (/room/:roomId)
  - Camera/mic controls, screen share, participants, in-room chat
  - "Connect Family" share link button (responsive)
  - "Add Member" — emails a direct join link to any address

---

## 4) How to Demo (Judge-Friendly Script — ~5 minutes)

1) Sign In
- Navigate to /auth
- Option 1: "Continue with Google" (only shown once Google credentials are set)
- Option 2: Enter your email → submit → enter the 6-digit code
  (with no email provider configured, the code is printed in the
  `npx convex dev` terminal — see [§11](#optional-real-email-delivery))
- Option 3: "Continue as guest" (quickest for demo, needs no setup)

2) Create a Room
- Go to Dashboard → Start Video Call → Create Room
- Provide name, type, optional description, and max participants
- After creation, you're routed to /room/:roomId

3) Invite Family
- Copy a link: in the Video Room header, click "Connect Family" (or the user icon
  on smaller screens) — a shareable link goes to the clipboard
- Email a link: click "Add Member", enter any email address and an optional note.
  The recipient **does not need an account** — they get a message with a direct
  "Join the call" button, and can join as a guest in one click.
- Open the link in another browser or incognito window to see the invite land

4) In-Room Experience
- Toggle mic/camera, try screen share
- Send a chat message; messages appear in realtime

5) Connections (Patient–Relative)
- Back in Dashboard → Connections tab
- Use "Connect Family" (button in Quick Actions) to request connection by email
- As the patient, approve pending requests from Overview → Pending Connection Requests

6) Appointments
- Dashboard → Appointments tab (or Quick Action "Schedule Visit" if implemented)
- Start an appointment; it creates a room and navigates you there
- Rejoin from the Appointments tab while "in_progress"

7) Monitoring (Showcase)
- Dashboard → Monitoring tab: Displays vitals UI blocks (demo visuals)

Tips for smooth demo:
- Allow camera/mic permissions
- Use two separate browsers/users for share link demo
- Resize the window to show responsive header + compact invite button

---

## 5) User Manual (Patients & Relatives)

Sign In:
- Continue with Google, enter your email and the 6-digit code we send, or
  "Continue as guest"

Create a Room:
- Dashboard → Start Video Call → Create Room
- You'll be taken to the Video Room automatically

Invite Family:
- In the room header, "Connect Family" → copies an invite link
- Or "Add Member" → enter their email address and we send them a join link
- Share with trusted users; they join upon visiting the link

Controls in Room:
- Mic, camera, screen share, leave call
- Chat panel toggle to send/receive messages

Connections:
- Dashboard → Connect Family → submit patient email + relationship
- Pending requests show in Overview for patients to approve

Appointments:
- Schedule visits (patient/provider/relatives)
- Start an appointment; a room is created automatically

Security Notes:
- Never share a room link publicly
- Only approve trusted connection requests

---

## 6) Admin / Healthcare Provider Manual

Roles:
- Users may have role "healthcare_provider" (set through seed/admin ops in DB)
- Providers can create rooms, schedule appointments, and join patient sessions

Workflows:
- Create/join rooms with patients and relatives
- Approve and manage patient connections (as patient)
- Schedule Appointments: Specify title, time, duration, type; start when needed
- Monitoring: Review vitals (demo visuals); real-time monitoring sessions may be expanded

Operational Guidance:
- Use Appointments tab to manage session flow
- Prefer scheduled rooms for structured sessions
- Follow organizational privacy policies for sharing and recording

---

## 7) Troubleshooting

- Camera/Mic access denied
  - Grant permissions in browser; refresh the page
- Sign-in fails with "The server is missing its auth keys"
  - Run `pnpm setup:auth` (with `npx convex dev` running), then reload
- Share link not copying
  - Clipboard API may be blocked → fallback used, else copy manually from address bar
- "Room not found" or blocked
  - Ensure the room is active; navigate from Dashboard → Active Rooms
- OTP or invitation email not received
  - **Check the `/auth` page notice first.** It reports the deployment's actual
    delivery state — printing to console, not configured, or test-sender-only —
    so you don't have to guess which of the cases below you're in.
  - *"printed in the terminal"* → `EMAIL_DEV_LOG=true` and no provider key. The
    full message, code and join link included, is in the `npx convex dev` output.
    That's the zero-config local default; set a key (see
    [§11](#optional-real-email-delivery)) to deliver for real.
  - *"can't send email yet"* → no key **and** no `EMAIL_DEV_LOG`. Delivery fails
    closed rather than logging codes silently. Guest sign-in still works.
  - *"only delivers to the address that owns the account"* → a Resend key with
    the shared `onboarding@resend.dev` sender. Every other recipient is rejected
    with a 403; set `EMAIL_FROM` to a sender you've verified.
  - Otherwise the send reached the provider — check spam, then the provider's own
    delivery log. `npx convex logs` shows the exact rejection.
  - Too many attempts in a row are throttled (3 codes per address per 15 min).
    The message tells you how long to wait; the wait is real, not cosmetic.
- Invitation link says "expired"
  - Invitations are capped to the end of the call they point at, so a link never
    outlives its room. Start a new call and re-invite.
- "Did you forget to run npx convex dev?"
  - This means there are compile errors. Fix errors and re-run the command until ready.

---

## 8) Security & Privacy

- Room links are sensitive; share only with trusted people
- Emailed invitation links are single-use and time-limited, but treat them as
  sensitive too — anyone holding an unused link can join that call
- Google and OTP verify email ownership; guest login is unverified, so don't
  grant guests anything beyond joining a call
- No media stored by default; chat messages stored as text in Convex
- Server secrets (auth keys, OAuth client secret, email provider key) belong on
  the Convex deployment via `npx convex env set` — not in `.env.local`, which the
  backend never reads, and where a `VITE_`-prefixed name would be compiled into
  the browser bundle
- Follow HIPAA/PII rules when deploying beyond a demo

---

## 9) Future Enhancements (Optional for Hackathon)

- Role-based room permissions (mute others, remove participant, host control)
- Recording and file attachments (Convex storage)
- Email/SMS notifications for appointments (email is already wired for sign-in
  codes and call invitations; Twilio for SMS)
- More robust monitoring (data ingestion, alerts, charts)
- Fine-grained access control to rooms via invitations/whitelists

---

## 10) Judge Checklist

- [ ] Auth (Google, Email OTP, or Guest)
- [ ] Create Room → Auto navigation to room
- [ ] Invite via share link → second user auto-joins
- [ ] Invite by email → recipient opens /join/:token and joins as a guest
- [ ] Toggle mic/camera/screen share
- [ ] In-room chat working
- [ ] Patient–Relative connection request + approval
- [ ] Appointment creation and start → room created and joinable
- [ ] Responsive header + invite button
- [ ] Monitoring visuals display

---

## 11) Authentication setup

All server-side secrets live on the **Convex deployment**, set with
`npx convex env set` — never in `.env.local`. Two reasons: the Convex backend
doesn't read `.env.local` at runtime, so a secret there simply wouldn't reach the
code that needs it; and anything named `VITE_*` is inlined into the browser
bundle by Vite, so a mis-prefixed secret becomes public. `.env.local` should hold
only what the CLI puts there — the deployment name and the two client-side
Convex URLs.

### Required (all sign-in methods)

```bash
pnpm setup:auth
```

Installs `JWT_PRIVATE_KEY`, `JWKS` and `SITE_URL`. Verify with:

```bash
npx convex env list
```

### Optional: Google sign-in

1. In the [Google Cloud console](https://console.cloud.google.com/apis/credentials),
   create an **OAuth 2.0 Client ID** of type *Web application*.
2. Add an **Authorised redirect URI**. This must point at the Convex **HTTP
   actions** URL (port 3211 locally — *not* the app on 5173):
   - Local backend: `http://127.0.0.1:3211/api/auth/callback/google`
   - Cloud deployment: `https://<your-deployment>.convex.site/api/auth/callback/google`
3. Install the credentials:

```bash
npx convex env set AUTH_GOOGLE_ID <client-id>
```

```bash
npx convex env set AUTH_GOOGLE_SECRET <client-secret>
```

The "Continue with Google" button appears on `/auth` as soon as both are set —
no code change and no redeploy needed.

### Optional: real email delivery

Sign-in codes and call invitations go out over plain HTTP to **[Brevo](https://www.brevo.com)**
or **[Resend](https://resend.com)** (no SDK, so this runs in Convex's fast default
runtime). Which one is used is decided by which key is present; if both are,
Brevo wins unless `EMAIL_PROVIDER=resend` says otherwise.

The thing worth knowing before you start: **an API key alone is not enough to
email other people.** Every provider requires you to prove you control the
address you're sending *from*, and that's the step that can't be done in code.

#### Environment variables

| Variable | Purpose |
| --- | --- |
| `BREVO_API_KEY` | Brevo key. Preferred when both providers have a key set. |
| `RESEND_API_KEY` | Resend key. `AUTH_RESEND_KEY` is also accepted. |
| `EMAIL_FROM` | Sender, as `Name <you@example.com>` or a bare address. **Required** for Brevo; for Resend it defaults to the shared test sender. |
| `EMAIL_PROVIDER` | `brevo` or `resend`. Only needed to force Resend when both keys exist. |
| `EMAIL_DEV_LOG` | `true` prints messages to the `npx convex dev` terminal when no provider is configured. Localhost only — see below. |

Without a key **and** without `EMAIL_DEV_LOG`, delivery fails closed — it throws
rather than logging. That's deliberate: a deployment that forgets its key must not
quietly write working sign-in codes into a log stream while telling users a code
is on the way. `pnpm setup:auth` sets `EMAIL_DEV_LOG=true` for you when `SITE_URL`
is on localhost and no key is present, so local development stays zero-config.

**Never set `EMAIL_DEV_LOG` on a deployed environment.** A sign-in code is a
complete credential with no password behind it, so anyone who can read the logs can
sign in as any address they choose to type. `setup:auth` refuses to set it when
`SITE_URL` isn't loopback and warns if it's already there; `check:email` fails
outright. Remove it with:

```bash
npx convex env remove EMAIL_DEV_LOG --prod
```

#### Option A — Brevo (recommended: no domain required)

```bash
npx convex env set BREVO_API_KEY xkeysib-xxxxxxxx
```

```bash
npx convex env set EMAIL_FROM "HealthConnect <you@gmail.com>"
```

Brevo verifies **individual addresses**, so a Gmail or Outlook address you already
own is enough — add it under [*Senders*](https://app.brevo.com/senders/list) and
click the confirmation link Brevo emails you. That single manual step is what makes
sign-in work for **every** user rather than just for you, and it's the reason this
is Option A: it's the only path to working delivery that doesn't require buying a
domain and waiting on DNS.

`EMAIL_FROM` is mandatory here — Brevo has no shared test sender to fall back on.
Until the address is confirmed, every send is rejected and reported as
`EMAIL_SENDER_UNVERIFIED`.

Use a `gmail.com` or `outlook.com` address. Avoid `yahoo.com` and `aol.com` (their
DMARC policy is `p=reject`, so mail sent on their behalf by a third party is
discarded outright) and `icloud.com` (`p=quarantine` — straight to spam).

Free tier is 300 emails/day. Treat a Gmail sender as a stopgap rather than the end
state: sending from a Gmail address through Brevo can never pass DKIM alignment, so
inbox placement will always be worse than a domain of your own. It does, however,
reach arbitrary recipients today, which the alternative below does not.

#### Option B — Resend (better deliverability, needs a domain you control)

```bash
npx convex env set RESEND_API_KEY re_xxxxxxxx
```

```bash
npx convex env set EMAIL_FROM "HealthConnect <auth@mail.yourdomain.com>"
```

```bash
npx convex env set EMAIL_PROVIDER resend
```

The third command is only needed if a Brevo key is also set — Brevo wins a tie,
deliberately, because a leftover Resend key with no verified domain behind it
reaches exactly one inbox.

Resend authorises sending **per domain**. Add a subdomain (`mail.yourdomain.com`
— not the root domain) under *Domains* in the dashboard and publish the records
it generates: a DKIM `TXT`, an SPF `TXT` on the `send` subdomain, and an `MX` for
bounce feedback. Note the SPF value is a `TXT` record, not the `MX` — mixing
those up is the usual reason verification sits at *Pending*. Verification is
often under 15 minutes but can take up to 72 hours. Once the domain reads
**Verified** you can send from any address on it; there is no separate sender
object to create. DMARC is a post-verification deliverability add-on, not a
prerequisite.

Until then, `EMAIL_FROM` falls back to Resend's shared `onboarding@resend.dev`,
which delivers **only to the address that owns the Resend account**. Every other
recipient gets an HTTP 403. This is the single most common way sign-in looks fine
in testing and is broken for real users. `/auth` warns about exactly this state
rather than showing a green light, and the failing send reports
`EMAIL_SENDER_UNVERIFIED` instead of blaming the recipient's address.

Free tier is 100 emails/day and 3,000/month. Inbound mail and each individual
`To`/`CC`/`BCC` recipient count against it, so it drains faster than the number
suggests. Exhaustion returns a 429 that no retry can clear, and the app treats it
as terminal — guest sign-in keeps working, which is why every email error offers
it as the way forward.

#### Confirming it will actually reach users

```bash
pnpm check:email
```

This answers the one question the app itself structurally cannot. At runtime
`resolveEmailConfig()` can only see whether a key is *present*; a key whose sender
was never confirmed looks identical to a working one and fails for every recipient,
with nothing surfacing until real users hit it.

`check:email` asks the provider directly — Brevo's `GET /v3/senders` (where
`active: true` means confirmed) or Resend's `GET /domains` — and distinguishes the
three states that otherwise look the same: **not a sender on the account**,
**exists but unconfirmed**, and **verified, so mail reaches anyone**. It also
reports remaining quota, and fails hard if `EMAIL_DEV_LOG` is left on for a
non-localhost deployment.

It exits non-zero when delivery would not reach arbitrary recipients, so it works
as a pre-deploy gate:

```bash
pnpm check:email --prod
```

Add `--send-to=you@gmail.com` to also send a real test message, using the same
request shape the app uses — so a success there means the app's own send path
works too. Don't test with `@example.com` or `@test.com`: providers block reserved
domains with an error that reads like a sender problem.

### How call invitations work

**Add Member** in a video room writes a `roomInvites` row with a single-use
random token and emails `<SITE_URL>/join/<token>`. Notable behaviour:

- The recipient needs **no account** — `/join/:token` resolves through a public
  query, so a signed-out stranger sees who invited them and to which call, then
  signs in (or continues as a guest) and is dropped straight into the room.
- An invitation expires at the earlier of 24 hours or the end of the call, so a
  link can never outlive the room it points at.
- Tokens are single-use by a single person. The original recipient can reload and
  rejoin freely; anyone else gets "This invitation has already been used."
- Re-inviting the same address revokes the previous pending invitation, so only
  the newest link in someone's inbox works.
- If delivery fails, the invitation still stands — the failure is recorded on the
  row and the link keeps working, so a mail outage doesn't lose the invite.
- The link origin comes from `SITE_URL` on the deployment, never from the calling
  client — otherwise a caller could plant an arbitrary URL in outbound mail.

---

## 12) Deploying to Vercel

### `vercel.json` is load-bearing

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "outputDirectory": "dist",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

This is a client-routed SPA: `dist/` contains exactly one HTML file, and
react-router resolves `/auth`, `/join/:token` and `/room/:roomId` in the browser.
Without the rewrite, Vercel looks for a file at those paths, finds none, and
returns **404 for every URL except `/`** — so a refresh, a bookmark, or a click on
an invite link from an email all dead-end before any React code runs.

The rewrite is safe to make this broad because Vercel runs the filesystem check
*before* rewrites, so hashed assets under `/assets/` and everything in `public/`
still serve normally.

### Two places, two kinds of variable

This is the split that causes the most confusion, and getting it backwards either
breaks the app or leaks a secret:

| Where | What goes there | Why |
| --- | --- | --- |
| **Vercel** → Settings → Environment Variables | `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL` | Vite inlines `VITE_*` into the JS bundle at build time. They're public by design — they're just your backend's addresses. |
| **Convex deployment** → `npx convex env set --prod` | `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`, `BREVO_API_KEY`, `EMAIL_FROM`, `AUTH_GOOGLE_*` | The Convex backend never reads `.env.local` or Vercel's env at runtime. And anything `VITE_`-prefixed ends up in the browser bundle, so a key put there is published to every visitor. |

The two `VITE_*` values must point at the **production** Convex deployment
(`https://<name>.convex.cloud` and `https://<name>.convex.site`), not the `local:`
backend your `.env.local` uses for development. Changing them requires a redeploy,
because they're baked in at build time.

### Cutover checklist

Run these against production once, from the repo root:

```bash
npx convex env list --prod --names-only
```

```bash
node setup-auth.mjs --prod --site-url=https://<your-app>.vercel.app
```

```bash
npx convex env set --prod BREVO_API_KEY xkeysib-xxxxxxxx
```

```bash
npx convex env set --prod EMAIL_FROM "HealthConnect <you@gmail.com>"
```

```bash
pnpm check:email --prod --send-to=<an-address-that-is-not-yours>@gmail.com
```

Then, in the Vercel dashboard, set the two `VITE_*` variables and redeploy.

Notes:

- `SITE_URL` must match the origin users actually visit, with no trailing slash.
  It's the base for every invite link and OAuth redirect, so a stale value sends
  users to the wrong host.
- Send the test message to an address that **isn't** the one you registered with
  the provider. Sending to yourself is precisely the test that passes while
  delivery to everyone else is broken.
- If Google sign-in is enabled, add
  `https://<name>.convex.site/api/auth/callback/google` as an authorised redirect
  URI — the Convex **site** URL, not the Vercel one.
- Rotating `JWT_PRIVATE_KEY` (`--force`) signs out every existing session.
