const fs = require('fs');
const path = require('path');

const QUEUE_FILE = path.join(__dirname, 'queue.json');
const MCP_SERVER_URL = "https://shopee-w41g.onrender.com/mcp";

async function callTool(toolName, args = {}) {
  const response = await fetch(MCP_SERVER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name: toolName, arguments: args }
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
  }

  const rawText = await response.text();
  const lines = rawText.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      try {
        const json = JSON.parse(line.slice(6));
        if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
        if (json.result && json.result.content && json.result.content[0]) return json.result.content[0].text;
        return json.result;
      } catch (err) {
        if (err.message.includes("HTTP Error") || err.message.includes("jsonrpc")) throw err;
      }
    }
  }
  return rawText;
}

function parseWIBDateTime(dtStr) {
  const cleanStr = dtStr.replace(' ', 'T');
  if (!cleanStr.includes('+')) return new Date(cleanStr + ':00+07:00');
  return new Date(cleanStr);
}

async function main() {
  if (!fs.existsSync(QUEUE_FILE)) return;
  const queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8'));
  const now = new Date();
  let changed = false;

  for (const item of queue) {
    if (item.status === 'pending') {
      const scheduledTime = parseWIBDateTime(item.scheduled_time);
      if (now >= scheduledTime) {
        try {
          const result = await callTool('post_thread', { account: item.account, text: item.text });
          console.log(`✅ Sukses [ID ${item.id}]: ${result}`);
          item.status = 'success';
          item.posted_at = new Date().toISOString();
          item.result = result;
          changed = true;
        } catch (err) {
          console.error(`❌ Gagal [ID ${item.id}]:`, err.message);
          item.status = 'failed';
          item.last_error = err.message;
          changed = true;
        }
      }
    }
  }

  if (changed) {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2), 'utf-8');
  }
}

main().catch(console.error);
