import { spawn } from 'node:child_process';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

async function run() {
  console.log('Opening Google Chrome normally...');
  await execAsync('open -a "Google Chrome"');
  await new Promise(resolve => setTimeout(resolve, 3000));

  console.log('Spawning chrome-devtools-mcp with --autoConnect...');
  const mcpProcess = spawn('npx', [
    '-y', 'chrome-devtools-mcp@latest',
    '--autoConnect',
    '--no-usage-statistics',
    '--no-performance-crux'
  ]);

  mcpProcess.stdout.on('data', (data) => {
    console.log('Received from MCP:', data.toString('utf8'));
  });

  mcpProcess.stderr.on('data', (data) => {
    console.error('MCP Error:', data.toString('utf8'));
  });

  // Wait for MCP server to start
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Send tools/call request for list_pages
  const request = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'list_pages',
      arguments: {}
    },
    id: 1
  };
  console.log('Sending tools/call list_pages request...');
  mcpProcess.stdin.write(JSON.stringify(request) + '\n');

  // Wait 5 seconds
  await new Promise(resolve => setTimeout(resolve, 5000));
  mcpProcess.kill();
}

run().catch(console.error);
