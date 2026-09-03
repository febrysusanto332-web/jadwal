// runner.js - Eksekutor otomatis untuk GitHub Actions
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
      params: {
        name: toolName,
        arguments: args
      }
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
        if (json.error) {
          throw new Error(json.error.message || JSON.stringify(json.error));
        }
        if (json.result && json.result.content && json.result.content[0]) {
          return json.result.content[0].text;
        }
        return json.result;
      } catch (err) {
        if (err.message.includes("HTTP Error") || err.message.includes("jsonrpc")) {
          throw err;
        }
      }
    }
  }
  return rawText;
}

function parseWIBDateTime(dtStr) {
  // Format: 'YYYY-MM-DD HH:mm' diasumsikan WIB (UTC+7)
  const cleanStr = dtStr.replace(' ', 'T');
  if (!cleanStr.includes('+')) {
    return new Date(cleanStr + ':00+07:00');
  }
  return new Date(cleanStr);
}

async function main() {
  if (!fs.existsSync(QUEUE_FILE)) {
    console.log("File queue.json tidak ditemukan.");
    return;
  }

  const queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8'));
  const now = new Date();
  
  // Tampilkan waktu sekarang dalam WIB
  const wibTime = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'full',
    timeStyle: 'long'
  }).format(now);

  console.log(`⏰ Waktu Server Saat Ini (WIB): ${wibTime}`);
  console.log(`📋 Total antrean di queue.json: ${queue.length}`);

  let changed = false;

  for (const item of queue) {
    if (item.status === 'pending') {
      const scheduledTime = parseWIBDateTime(item.scheduled_time);

      if (now >= scheduledTime) {
        console.log(`\n🚀 Waktunya posting! [ID: ${item.id}] [Akun: ${item.account}]`);
        console.log(`📝 Konten: "${item.text.slice(0, 70)}..."`);

        try {
          const result = await callTool('post_thread', {
            account: item.account,
            text: item.text
          });

          console.log(`✅ Sukses dipublikasikan: ${result}`);
          item.status = 'success';
          item.posted_at = new Date().toISOString();
          item.result = result;
          changed = true;
        } catch (err) {
          console.error(`❌ Gagal memposting ID ${item.id}:`, err.message);
          item.status = 'failed';
          item.last_error = err.message;
          item.attempted_at = new Date().toISOString();
          changed = true;
        }
      } else {
        console.log(`⏳ [ID ${item.id}] Belum waktunya. Jadwal: ${item.scheduled_time} WIB`);
      }
    }
  }

  if (changed) {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2), 'utf-8');
    console.log(`\n💾 queue.json berhasil diperbarui dengan status terbaru.`);
  } else {
    console.log(`\nℹ️ Tidak ada postingan yang dieksekusi pada giliran ini.`);
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
