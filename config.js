// Public settings for the assessment centre. The anon key is designed to be public:
// every rule is enforced by row level security and the exam_* functions in Supabase.
window.EXAM_CONFIG = Object.freeze({
  supabaseUrl: 'https://vcxdkacxbjsgaoxbhsip.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjeGRrYWN4YmpzZ2FveGJoc2lwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI5MDQ5ODMsImV4cCI6MjA2ODQ4MDk4M30.T9KhHWzHZWyaZvyeFXtBu8tPLY9JOn6_wCHcH8B46FU',
  studentEmailDomain: 'baobabonlineacademy.com',
  photoBucket: 'exam-working',
  yearGroups: ['Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6', 'Year 7', 'Year 8', 'Year 9', 'Year 10', 'Year 11'],
  // Exam boards for mock exams. Regular assessments have no board.
  boards: ['Pearson Edexcel', 'AQA', 'OCR', 'WJEC Eduqas', 'Cambridge (CAIE)', 'Pearson Edexcel International', 'Oxford AQA'],
  qualifications: ['GCSE', 'IGCSE', 'KS3', 'KS2', 'KS1', '11+'],
  // Subject colours on the student dashboard; anything else uses the default.
  subjectColours: {
    'Mathematics': '#EEAC44', 'English Language': '#2E7D5B', 'English Literature': '#1B543B', 'Biology': '#6BA368',
    'Chemistry': '#4E8FA8', 'Physics': '#7A5DA8', 'Science': '#4E8FA8', 'Elementary Science': '#4E8FA8',
    'Computing': '#3E5C76', 'Geography': '#A86B3C', 'History': '#8E4B3A', 'Verbal Reasoning (VR)': '#C27C2C',
    "Arabic Studies & Qur'an": '#47705A', 'Non-Verbal Reasoning (NVR)': '#9C6A2E'
  },
  defaultColour: '#472D1A'
});
