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

async function run() {
  const client = new McpClient();
  await new Promise(resolve => setTimeout(resolve, 5000));

  const listResult = await client.callTool('list_pages');
  console.log('--- RAW LIST_PAGES TEXT ---');
  console.log(listResult.content[0].text);
  console.log('---------------------------');

  client.close();
}

run().catch(console.error);
