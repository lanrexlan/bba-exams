# Baobab Digital Academy — Assessment Centre

Timed online assessments for every year group (six a year, one every two months) and GCSE mocks for each exam board.
Live at https://exams.baobabonlineacademy.com (also https://bba-exams.vercel.app).

Plain HTML and JavaScript with no build step, hosted on Vercel, backed by the academy's live Supabase project (`Baobab_Digital_Academy`).

## Who can do what

| Who | Signs in with | Can |
| --- | --- | --- |
| Students | Google, with their `@baobabonlineacademy.com` account (the child's `meet_email`) | Sit open papers meant for them, add photos of working, see released results |
| Tutors | Portal email and password (plus two-step code if required) | Open and close papers, watch, unlock and add time for **their own students**, mark their scripts |
| Admins | Portal email and password (plus two-step code if required) | Everything tutors can, for all students, plus papers, calendar, entries, extra time, settings and resets |

## Which papers a student sees

A paper has year groups, a subject, and optionally an exam board and tier.

- **Regular assessments** (no board or tier): every student in those year groups who is taught that subject (from `teacher_student_assignments`) sees it while it is open.
- **Mocks** (board and/or tier set): only students entered for that subject with the same board and tier (Students page → Mock entries).

## Security

Enforced in the database:

- Students have **no direct access** to any exam table. They use functions that check who they are on every call.
- Questions are only sent after a student starts a paper, and only while their sitting is in progress. Mark schemes are staff-only.
- The server sets each deadline (with extra time), refuses late saves, and a cron job hands in papers whose time ran out.
- **One device per sitting.** A sitting is tied to the browser session that started it; opening it anywhere else locks it until staff unlock it.
- Exits (tab, app, window, full screen) are counted on the server; the paper locks after the set number.
- Saves are refused once a paper has been locked for 15 seconds.
- Tutors only see their own students; admins see everyone. Optional **two-step sign-in** for all staff (Settings).
- An append-only **activity log** records starts, exits, locks, unlocks, devices, time added, resets, marks and every admin change, with IP address and browser. Nobody can edit or delete it from the app.
- Photos go to a private bucket under `<child_id>/<attempt_id>/`, only while sitting or shortly after, up to a set limit per paper. They are re-encoded in the browser, which strips location and device data.
- Signed-out visitors have no access to anything.

In the browser:

- Strict Content Security Policy: scripts, fonts and styles come only from this site, and connections go only to Supabase. The Supabase library and fonts are hosted here, not loaded from other sites. There are no inline scripts.
- Pages can't be framed by other sites; HSTS, no referrer, locked-down browser permissions.
- Sessions are kept per tab (sessionStorage) and use PKCE for Google sign-in. Staff are signed out after a set idle time, and repeated wrong passwords pause sign-in.
- During a paper: full screen, copy, paste, right-click, drag-and-drop and print are blocked. A watermark with the student's name is shown. Second screens and split screens are detected and reported. A heartbeat every 20 seconds tells staff who is online.
- Question papers, mark schemes and database files are never deployed (`.vercelignore`).

Camera monitoring stays in Google Meet.

## Adding a paper

Admins: Papers → Add a paper. Fill in the details and choose a JSON file with `questions` and `scheme`. See `papers/TEMPLATE-assessment.upload.json` for a small example and `papers/1MA1-1H.upload.json` for a full GCSE paper. Part `type` is `maths` (working and answer boxes), `short` (answer box) or `long` (essay box with word count). Total marks are worked out from the parts.

## Files

| Path | What it is |
| --- | --- |
| `index.html`, `app.js`, `styles.css`, `config.js` | The app |
| `vendor/`, `fonts/`, `assets/` | Supabase library, fonts (SIL Open Font License) and logo, hosted here |
| `vercel.json`, `.vercelignore` | Security headers, caching, and what is never deployed |
| `supabase/migrations/` | Everything in the database that starts with `exam_` (already applied to the live project) |
| `papers/` | Paper and mark-scheme sources (not deployed) |

## Setup already done

Google sign-in is turned on in Supabase. The site address is listed under Authentication → URL Configuration → Redirect URLs. The Site URL stays as the tutor portal, because the tutor app's emails rely on it.
