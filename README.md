# Baobab Digital Academy — GCSE Mock Exam Centre

Timed, online GCSE mock exams in the style of Pearson Edexcel, for Baobab Digital Academy students.
Static site (plain HTML + JavaScript, no build step) on Vercel, backed by the academy's live Supabase project.

## How it works

| Who | Signs in with | Can |
| --- | --- | --- |
| Students (Years 10–11) | Google, using their `@baobabonlineacademy.com` account (the child's `meet_email`) | Sit open papers they are entered for, upload photos of working, see their own attempts |
| Tutors | Email + password (tutor portal login) | Open and close papers, watch and unlock **their own students**, mark their scripts |
| Admins | Email + password (admin portal login) | Everything tutors can, for all students, plus enter candidates, set extra time and change settings |

Every rule is enforced in the database, not the browser:

- Students only see a paper's questions while it is open **and** they are entered for its subject and tier.
- Mark schemes are readable by staff only.
- The server sets the deadline at start (with any extra time) and refuses saves after it. A cron job auto-submits papers whose time ran out while the student was away.
- Strict mode is counted on the server: exits are logged, and the paper locks after the set number. Only a teacher of that student, or an admin, can unlock.
- Photos of working go to the private `exam-working` bucket, under `<child_id>/<attempt_id>/`. Uploads are accepted only while sitting and for a set number of minutes after submitting.

## Files

| Path | What it is |
| --- | --- |
| `index.html`, `app.js`, `styles.css`, `config.js` | The app |
| `assets/` | Baobab logo files |
| `supabase/migrations/20261101170000_exam_centre.sql` | All `exam_*` tables, policies, functions, the storage bucket and the cron job (already applied to the live project) |
| `supabase/seed_1MA1-1H.sql` | Loads Maths Paper 1H and its mark scheme (already applied) |
| `papers/` | Paper and mark-scheme source files (JSON) |

## One-time setup

1. **Turn on Google sign-in in Supabase.** In Google Cloud, create an OAuth client (type Web application) with this authorised redirect URI: `https://vcxdkacxbjsgaoxbhsip.supabase.co/auth/v1/callback`. In Supabase, open Authentication → Sign In / Providers → Google, turn it on, and paste the client ID and secret.
2. **Deploy on Vercel.** Import this repository as a new project. Framework preset: Other. No build command, output directory `.`.
3. **Allow the site's address in Supabase.** In Authentication → URL Configuration, add the Vercel address (for example `https://bba-exams.vercel.app`, plus your custom domain if you add one) to Redirect URLs.
4. **Enter candidates.** Sign in as an admin, open Candidates, press "Enter for mocks" for each student, then choose their subjects and tiers.

## Adding a paper

Add `papers/<id>.paper.json` and `papers/<id>.scheme.json`, then insert them into `exam_papers` and `exam_schemes` as `supabase/seed_1MA1-1H.sql` does. Question part types are `maths` (working + answer), `short` (answer only) and `long` (essay box with word count).
