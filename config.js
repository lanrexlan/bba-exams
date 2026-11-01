// Public settings for the exam centre. The anon key is meant to be public:
// every rule is enforced by row level security and exam_* functions in Supabase.
window.EXAM_CONFIG = {
  supabaseUrl: 'https://vcxdkacxbjsgaoxbhsip.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjeGRrYWN4YmpzZ2FveGJoc2lwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI5MDQ5ODMsImV4cCI6MjA2ODQ4MDk4M30.T9KhHWzHZWyaZvyeFXtBu8tPLY9JOn6_wCHcH8B46FU',
  studentEmailDomain: 'baobabonlineacademy.com',
  photoBucket: 'exam-working',
  // Subjects a candidate can be entered for, and whether they are tiered.
  subjects: [
    { name: 'Mathematics', tiered: true },
    { name: 'Biology', tiered: true },
    { name: 'Chemistry', tiered: true },
    { name: 'Physics', tiered: true },
    { name: 'English Language', tiered: false },
    { name: 'English Literature', tiered: false }
  ],
  candidateYears: ['Year 10', 'Year 11']
};
