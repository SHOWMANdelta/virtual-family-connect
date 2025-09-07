# HealthConnect — Real-time Family & Care Video Rooms

A real-time video conferencing and live monitoring web app to connect patients with relatives and healthcare providers. Built with a Material Design 3 visual system, reactive data (Convex), and OTP-based auth.

Demo-ready overview:
- Create and join video rooms
- Invite family with shareable links
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

Run (two terminals recommended):
- Terminal A: npx convex dev
- Terminal B: pnpm dev
  - App runs on Vite's dev server (default: http://localhost:5173)

If you see compile errors:
- The dev server is always running. Fix code issues until "Convex functions ready!" and no TypeScript errors remain.

Notes:
- Authentication uses Email OTP and Guest login. No environment variables required for basic usage.
- If clipboard permissions are blocked, share-link copying falls back automatically.

---

## 2) Tech Stack

- Frontend: React + Vite + Tailwind + shadcn/ui, Framer Motion (animations)
- Backend: Convex (database + server functions), Convex Auth (email OTP and anonymous)
- Styling: Material Design 3 palette, elevation shadows, 8dp grid, ripple, Roboto
- Realtime: Convex queries (auto-updating subscriptions)

---

## 3) App Structure (Key Screens)

- Landing (/) — simple entry with CTA
- Auth (/auth) — Email OTP and Guest login
- Dashboard (/dashboard)
  - Quick Actions: Create Room, Connect Family, Schedule Visit
  - Tabs: Overview, Rooms, Connections, Appointments, Monitoring
- Video Room (/room/:roomId)
  - Camera/mic controls, screen share, participants, in-room chat
  - "Connect Family" share link button (responsive)

---

## 4) How to Demo (Judge-Friendly Script — ~5 minutes)

1) Sign In
- Navigate to /auth
- Option 1: Enter your email → submit → enter 6-digit OTP
- Option 2: "Continue as Guest" (quickest for demo)

2) Create a Room
- Go to Dashboard → Start Video Call → Create Room
- Provide name, type, optional description, and max participants
- After creation, you're routed to /room/:roomId

3) Invite Family
- In the Video Room header, click "Connect Family" or the user icon on smaller screens
- A shareable link is copied to the clipboard
- Open link in another browser or incognito window → they auto-join

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
- Use your email (check inbox for OTP) or "Continue as Guest"

Create a Room:
- Dashboard → Start Video Call → Create Room
- You'll be taken to the Video Room automatically

Invite Family:
- In the room header, "Connect Family" → copies an invite link
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
- Share link not copying
  - Clipboard API may be blocked → fallback used, else copy manually from address bar
- "Room not found" or blocked
  - Ensure the room is active; navigate from Dashboard → Active Rooms
- OTP not received
  - Check spam; retry; or use Guest login for demos
- "Did you forget to run npx convex dev?"
  - This means there are compile errors. Fix errors and re-run the command until ready.

---

## 8) Security & Privacy

- Room links are sensitive; share only with trusted people
- OTP verifies email ownership; guest login for demo only
- No media stored by default; chat messages stored as text in Convex
- Follow HIPAA/PII rules when deploying beyond a demo

---

## 9) Future Enhancements (Optional for Hackathon)

- Role-based room permissions (mute others, remove participant, host control)
- Recording and file attachments (Convex storage)
- Email/SMS notifications (Resend/Twilio)
- More robust monitoring (data ingestion, alerts, charts)
- Fine-grained access control to rooms via invitations/whitelists

---

## 10) Judge Checklist

- [ ] Auth (Email OTP or Guest)
- [ ] Create Room → Auto navigation to room
- [ ] Invite via share link → second user auto-joins
- [ ] Toggle mic/camera/screen share
- [ ] In-room chat working
- [ ] Patient–Relative connection request + approval
- [ ] Appointment creation and start → room created and joinable
- [ ] Responsive header + invite button
- [ ] Monitoring visuals display