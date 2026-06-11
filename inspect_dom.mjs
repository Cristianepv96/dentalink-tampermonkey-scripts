import { spawn } from 'node:child_process';

// Helper class for JSON-RPC communication with the MCP server
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
      this.buffer = lines.pop(); // Keep incomplete line in buffer

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
          // Non-JSON output (errors, startup notices, etc.)
          console.log('[MCP System Log]:', line);
        }
      }
    });

    this.process.stderr.on('data', (data) => {
      console.error('[MCP Stderr]:', data.toString('utf8'));
    });
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
  // Wait for connection
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log('Listing pages...');
  const listResult = await client.callTool('list_pages');
  const pages = JSON.parse(listResult.content[0].text);
  console.log('Pages:', pages);

  const agendaPage = pages.find(p => p.url.includes('agendas/diario'));
  if (!agendaPage) {
    console.error('Could not find agendas/diario page open!');
    client.close();
    return;
  }

  console.log('Selecting agenda page:', agendaPage.id);
  await client.callTool('select_page', { pageId: agendaPage.id });

  // Let's check the Sede dropdown
  console.log('Inspecting Sede dropdown...');
  const sedeSelectInfo = await client.callTool('evaluate_script', {
    expression: `(() => {
      const selects = Array.from(document.querySelectorAll('select'));
      return selects.map(s => ({
        id: s.id,
        className: s.className,
        options: Array.from(s.options).map(o => ({ value: o.value, text: o.text }))
      }));
    })()`
  });
  console.log('Sede selects:', JSON.parse(sedeSelectInfo.content[0].text));

  // Let's check the appointments table structure
  console.log('Inspecting appointments table/DOM...');
  const tableInfo = await client.callTool('evaluate_script', {
    expression: `(() => {
      // Find rows in table
      const rows = Array.from(document.querySelectorAll('tr, .cita-item, .agenda-item'));
      return {
        totalRows: rows.length,
        firstThreeHTML: rows.slice(0, 3).map(r => r.outerHTML.substring(0, 300))
      };
    })()`
  });
  console.log('Table info:', JSON.parse(tableInfo.content[0].text));

  client.close();
}

run().catch(console.error);
