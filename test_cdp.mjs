import playwright from 'playwright';
import fs from 'node:fs/promises';

async function run() {
  const activePortContent = await fs.readFile('/Users/mac/Library/Application Support/Google/Chrome/DevToolsActivePort', 'utf8');
  const lines = activePortContent.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    throw new Error('DevToolsActivePort file format is invalid');
  }
  const port = lines[0];
  const path = lines[1];
  const wsEndpoint = `ws://127.0.0.1:${port}${path}`;
  console.log('Connecting Playwright to:', wsEndpoint);

  const browser = await playwright.chromium.connectOverCDP(wsEndpoint);
  console.log('Connected successfully directly to Chrome!');

  const contexts = browser.contexts();
  console.log(`Found ${contexts.length} contexts.`);
  for (let i = 0; i < contexts.length; i++) {
    const pages = contexts[i].pages();
    console.log(`Context ${i} has ${pages.length} pages:`);
    for (const page of pages) {
      console.log(`- URL: ${page.url()}`);
      console.log(`  Title: ${await page.title()}`);
    }
  }

  await browser.disconnect();
  console.log('Disconnected Playwright.');
}

run().catch(console.error);
