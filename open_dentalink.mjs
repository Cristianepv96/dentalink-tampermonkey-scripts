import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';

class McpClient {
  constructor() {
    this.process = spawn('npx', [
      '-y', 'chrome-devtools-mcp@latest',
      '--autoConnect',
      '--no-usage-statistics',
      '--no-performance-crux'
    ]);
    this.id = 1;
    this.pending = new Map();
    this.buffer = '';

    this.process.stdout.on('data', (data) => {
      this.buffer += data.toString('utf8');
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop();

      for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        try {
          const message = JSON.parse(line);
          if (message.id && this.pending.has(message.id)) {
            const { resolve, reject } = this.pending.get(message.id);
            this.pending.delete(message.id);
            if (message.error) {
              reject(message.error);
            } else {
              resolve(message.result);
            }
          }
        } catch (e) {
          // ignore
        }
      }
    });

    this.process.stderr.on('data', (data) => {});
  }

  async callTool(name, args = {}) {
    const currentId = this.id++;
    const request = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name,
        arguments: args
      },
      id: currentId
    };

    return new Promise((resolve, reject) => {
      this.pending.set(currentId, { resolve, reject });
      this.process.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  async close() {
    this.process.kill();
  }
}

function parsePages(text) {
  text = text.trim();
  if (text.startsWith('[')) {
    return JSON.parse(text);
  }
  const pages = [];
  const lines = text.split('\n');
  const regex = /\d+\.\s+\*\*(.*?)\*\*\s+\((page-[A-Za-z0-9_-]+)\)\s+-\s+(.*)/;
  for (const line of lines) {
    const match = line.trim().match(regex);
    if (match) {
      pages.push({
        title: match[1].trim(),
        id: match[2].trim(),
        url: match[3].trim()
      });
    }
  }
  return pages;
}

async function run() {
  const client = new McpClient();
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log('Listing pages...');
  const listResult = await client.callTool('list_pages');
  const pages = parsePages(listResult.content[0].text);
  console.log('Pages found:', pages);

  let pageId = null;
  const existingPage = pages.find(p => p.url.includes('dentalink.cl'));
  if (existingPage) {
    console.log('Found existing Dentalink page:', existingPage.id);
    pageId = existingPage.id;
    await client.callTool('select_page', { pageId });
  } else {
    console.log('No existing Dentalink page. Opening a new page...');
    const newPageResult = await client.callTool('new_page');
    console.log('New page opened. Listing pages again...');
    const listResult2 = await client.callTool('list_pages');
    const pages2 = parsePages(listResult2.content[0].text);
    console.log('Pages after opening new page:', pages2);
    // Select the new page (usually it is the last one or the one with chrome://new-tab-page/)
    const newPage = pages2.find(p => p.url.startsWith('chrome://newtab') || p.url.startsWith('about:blank') || p.url.startsWith('chrome://new-tab-page/'));
    pageId = newPage ? newPage.id : pages2[pages2.length - 1].id;
    console.log('Selecting new page:', pageId);
    await client.callTool('select_page', { pageId });
  }

  console.log('Navigating to Dentalink daily agenda...');
  await client.callTool('navigate_page', { url: 'https://sanjoseipsodontologica.dentalink.cl/agendas/diario' });
  
  console.log('Waiting for load...');
  await client.callTool('wait_for', { state: 'networkidle', timeout: 15000 });

  console.log('Extracting body HTML...');
  const htmlResult = await client.callTool('evaluate_script', {
    expression: 'document.body.innerHTML'
  });

  const html = htmlResult.content[0].text;
  await fs.writeFile('/Users/mac/Documents/JS/agenda_body.html', html, 'utf8');
  console.log('Saved HTML to /Users/mac/Documents/JS/agenda_body.html');

  client.close();
}

run().catch(console.error);
