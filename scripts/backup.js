#!/usr/bin/env node
// Backup semanal Punch and Roll — banco de dados + código
// Roda toda segunda às 10h via agente remoto agendado
'use strict';

const mysql2 = require('mysql2/promise');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DATABASE_URL = process.env.DATABASE_URL;
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@punchandroll.com.br';
const EMAIL_TO = 'asbarcellos31@gmail.com';

if (!DATABASE_URL || !SENDGRID_API_KEY) {
  console.error('Faltam variáveis: DATABASE_URL e/ou SENDGRID_API_KEY');
  process.exit(1);
}

async function dumpDatabase(conn) {
  const [tables] = await conn.query(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`);
  let sql = `-- Backup Punch and Roll\n-- Data: ${new Date().toISOString()}\n-- Banco: railway\n\nSET FOREIGN_KEY_CHECKS=0;\n\n`;

  for (const row of tables) {
    const table = row.TABLE_NAME;
    const [[createRow]] = await conn.query(`SHOW CREATE TABLE \`${table}\``);
    sql += `-- Tabela: ${table}\n`;
    sql += `DROP TABLE IF EXISTS \`${table}\`;\n`;
    sql += createRow['Create Table'] + ';\n\n';

    const [rows] = await conn.query(`SELECT * FROM \`${table}\``);
    if (rows.length > 0) {
      const cols = Object.keys(rows[0]).map(c => `\`${c}\``).join(', ');
      for (const r of rows) {
        const vals = Object.values(r).map(v => {
          if (v === null) return 'NULL';
          if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`;
          if (Buffer.isBuffer(v)) return `'${v.toString('base64')}'`;
          return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
        }).join(', ');
        sql += `INSERT INTO \`${table}\` (${cols}) VALUES (${vals});\n`;
      }
      sql += '\n';
    }
  }

  sql += 'SET FOREIGN_KEY_CHECKS=1;\n';
  return sql;
}

function getCodeInfo() {
  try {
    const lastCommit = execSync('git log -5 --oneline 2>/dev/null || echo "sem git"').toString().trim();
    const branch = execSync('git branch --show-current 2>/dev/null || echo "main"').toString().trim();
    const filesCount = execSync('find . -name "*.js" -o -name "*.html" -o -name "*.css" | grep -v node_modules | wc -l').toString().trim();
    return { branch, lastCommit, filesCount };
  } catch {
    return { branch: 'main', lastCommit: 'indisponível', filesCount: '?' };
  }
}

async function sendEmail(sqlDump, codeInfo, tableCount, rowsTotal) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  const sqlB64 = Buffer.from(sqlDump).toString('base64');
  const manifestB64 = Buffer.from(JSON.stringify({ geradoEm: now.toISOString(), tabelas: tableCount, linhasTotal: rowsTotal, codigo: codeInfo }, null, 2)).toString('base64');
  const nomeArquivo = `punch-and-roll-bkp-${now.toISOString().slice(0,10)}.sql`;

  const payload = {
    personalizations: [{ to: [{ email: EMAIL_TO }] }],
    from: { email: EMAIL_FROM, name: 'Punch and Roll Backup' },
    subject: `🥊 Backup Semanal Punch and Roll — ${dateStr}`,
    content: [{
      type: 'text/html',
      value: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <div style="background:#1a1a2e;padding:24px;text-align:center;border-radius:8px 8px 0 0">
            <h2 style="color:#e94560;margin:0">🥊 Punch and Roll</h2>
            <p style="color:#aaa;margin:8px 0 0">Backup Semanal Automático</p>
          </div>
          <div style="background:#f9f9f9;padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px">
            <p style="color:#333"><strong>Data:</strong> ${dateStr} às ${timeStr}</p>
            <hr style="border:none;border-top:1px solid #eee">
            <h3 style="color:#1a1a2e">📊 Banco de Dados</h3>
            <ul style="color:#555">
              <li><strong>${tableCount}</strong> tabelas exportadas</li>
              <li><strong>${rowsTotal.toLocaleString('pt-BR')}</strong> registros no total</li>
              <li>Arquivo SQL completo em anexo (DROP + CREATE + INSERT)</li>
            </ul>
            <h3 style="color:#1a1a2e">💻 Código</h3>
            <ul style="color:#555">
              <li><strong>Branch:</strong> ${codeInfo.branch}</li>
              <li><strong>${codeInfo.filesCount}</strong> arquivos de código</li>
              <li><strong>Últimos commits:</strong><br><pre style="font-size:12px;background:#eee;padding:8px;border-radius:4px">${codeInfo.lastCommit}</pre></li>
            </ul>
            <p style="color:#888;font-size:12px;margin-top:24px">Este backup foi gerado automaticamente todo segunda-feira às 10h.<br>Guarde o arquivo .sql em local seguro para restaurar se necessário.</p>
          </div>
        </div>
      `
    }],
    attachments: [
      { content: sqlB64, filename: nomeArquivo, type: 'application/sql', disposition: 'attachment' },
      { content: manifestB64, filename: `punch-and-roll-manifest-${now.toISOString().slice(0,10)}.json`, type: 'application/json', disposition: 'attachment' }
    ]
  };

  await axios.post('https://api.sendgrid.com/v3/mail/send', payload, {
    headers: { Authorization: `Bearer ${SENDGRID_API_KEY}`, 'Content-Type': 'application/json' }
  });
}

async function main() {
  console.log(`[${new Date().toISOString()}] Iniciando backup Punch and Roll...`);

  const conn = await mysql2.createConnection(DATABASE_URL);
  console.log('Conectado ao banco MySQL.');

  const sqlDump = await dumpDatabase(conn);

  const [tables] = await conn.query(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`);
  let rowsTotal = 0;
  for (const t of tables) {
    const [[{ total }]] = await conn.query(`SELECT COUNT(*) as total FROM \`${t.TABLE_NAME}\``);
    rowsTotal += Number(total);
  }

  await conn.end();
  console.log(`Dump concluído: ${tables.length} tabelas, ${rowsTotal} registros.`);

  const codeInfo = getCodeInfo();
  await sendEmail(sqlDump, codeInfo, tables.length, rowsTotal);
  console.log(`Email enviado para ${EMAIL_TO}. Backup concluído com sucesso.`);
}

main().catch(err => {
  console.error('Erro no backup:', err.message);
  process.exit(1);
});
