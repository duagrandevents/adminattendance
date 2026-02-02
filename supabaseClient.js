
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://vttebwaiipmhbtrukveka.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0dGVid2FpaXBtaGJ0cmt2ZWthIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwNTYyMTUsImV4cCI6MjA4NTYzMjIxNX0.Qj3M9FCnm9HRxkxZ779i64yPjnxDXXqyRN-2htyHdv4'

export const supabase = createClient(supabaseUrl, supabaseKey)
