import fs from 'node:fs/promises';

async function run() {
  const html = await fs.readFile('agenda_body.html', 'utf8');
  console.log('HTML loaded. Size:', html.length, 'bytes');

  // Let's search for table or calendar elements
  console.log('--- Divs with class agenda/calendar/diario/cita ---');
  const classMatches = [...html.matchAll(/class="([^"]*(?:agenda|calendar|diario|cita|table)[^"]*)"/g)].map(m => m[1]);
  console.log('Unique class names found:', [...new Set(classMatches)].slice(0, 30));

  // Let's search for patient URLs
  const patientUrls = [...html.matchAll(/\/pacientes\/(\d+)\/tratamiento\/(\d+)/g)];
  console.log('\n--- Patient URLs found:', patientUrls.length, '---');
  for (const match of patientUrls.slice(0, 15)) {
    console.log(`URL: /pacientes/${match[1]}/tratamiento/${match[2]} | Patient ID: ${match[1]} | Plan ID: ${match[2]}`);
  }

  // Let's find table row elements containing "pacientes"
  console.log('\n--- Searching for rows containing patient links ---');
  const trMatches = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => m[1]);
  console.log('Total table rows (tr):', trMatches.length);
  
  let rowsWithPatients = 0;
  for (const trContent of trMatches) {
    if (trContent.includes('/pacientes/')) {
      rowsWithPatients++;
      if (rowsWithPatients <= 5) {
        console.log(`\nRow ${rowsWithPatients} content (truncated):`);
        console.log(trContent.trim().replace(/\s+/g, ' ').substring(0, 500));
      }
    }
  }
  console.log('Total rows containing patient links:', rowsWithPatients);
}

run().catch(console.error);
