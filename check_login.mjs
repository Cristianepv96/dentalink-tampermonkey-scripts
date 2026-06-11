import { spawn } from 'node:child_process';

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

  const listResult = await client.callTool('list_pages');
  const pages = parsePages(listResult.content[0].text);
  const dentalinkPage = pages.find(p => p.url.includes('dentalink.cl'));

  if (!dentalinkPage) {
    console.log('No Dentalink page open.');
    client.close();
    return;
  }

  await client.callTool('select_page', { pageId: dentalinkPage.id });

  const info = await client.callTool('evaluate_script', {
    expression: `({
      url: window.location.href,
      title: document.title,
      hasLoginButton: !!document.querySelector('button[type="submit"], input[type="submit"]'),
      bodyText: document.body.innerText.substring(0, 300)
    })`
  });

  console.log('Page state:', JSON.parse(info.content[0].text));
  client.close();
}

run().catch(console.error);
