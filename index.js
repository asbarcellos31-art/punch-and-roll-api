const express = require('express');
const mysql2 = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization','Origin','Accept'] }));
app.options('/{*path}', cors());
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  next();
});

// ══════════════════════════════════════
// BANCO DE DADOS
// ══════════════════════════════════════
const db = mysql2.createPool({
  uri: process.env.DATABASE_URL,
  waitForConnections: true,
  connectionLimit: 10,
});

// ══════════════════════════════════════
// HELPERS
// ══════════════════════════════════════
const JWT_SECRET = process.env.JWT_SECRET || 'punchandroll2026secret';

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token necessário' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.tipo !== 'admin') return res.status(403).json({ error: 'Acesso negado' });
  next();
}

// ══════════════════════════════════════
// SETUP — criar tabelas se não existirem
// ══════════════════════════════════════
async function setupDB() {
  const conn = await db.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS alunos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nome VARCHAR(200) NOT NULL,
        cpf VARCHAR(20),
        nasc DATE,
        sexo VARCHAR(20),
        tel VARCHAR(20),
        email VARCHAR(200),
        endereco VARCHAR(300),
        cidade VARCHAR(100) DEFAULT 'São José',
        cep VARCHAR(10),
        emerg_nome VARCHAR(200),
        emerg_tel VARCHAR(20),
        parentesco VARCHAR(50),
        saude TEXT,
        alergia TEXT,
        modalidade VARCHAR(20),
        nivel VARCHAR(20) DEFAULT 'iniciante',
        plano_id VARCHAR(50),
        plano VARCHAR(200),
        valor DECIMAL(10,2),
        inicio DATE,
        vencimento DATE,
        pagto VARCHAR(20) DEFAULT 'pix',
        aulas_liberadas JSON,
        obs TEXT,
        status VARCHAR(20) DEFAULT 'ativo',
        senha VARCHAR(200),
        origem VARCHAR(50) DEFAULT 'admin',
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS checkins (
        id INT AUTO_INCREMENT PRIMARY KEY,
        aluno_id INT NOT NULL,
        aula_id INT NOT NULL,
        data_checkin DATE NOT NULL,
        hora VARCHAR(10),
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (aluno_id) REFERENCES alunos(id)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS aulas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nome VARCHAR(200) NOT NULL,
        hora VARCHAR(10),
        dia VARCHAR(20),
        vagas INT DEFAULT 15,
        modalidade VARCHAR(20),
        status VARCHAR(20) DEFAULT 'ativo',
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS recados (
        id INT AUTO_INCREMENT PRIMARY KEY,
        titulo VARCHAR(300) NOT NULL,
        body TEXT,
        tipo VARCHAR(20) DEFAULT 'info',
        pin BOOLEAN DEFAULT FALSE,
        ativo BOOLEAN DEFAULT TRUE,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS documentos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nome VARCHAR(300) NOT NULL,
        descricao TEXT,
        tipo VARCHAR(50),
        extensao VARCHAR(10),
        tamanho VARCHAR(20),
        url TEXT,
        visivel BOOLEAN DEFAULT TRUE,
        disponivel_para VARCHAR(50) DEFAULT 'todos',
        downloads INT DEFAULT 0,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS pagamentos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        aluno_id INT NOT NULL,
        descricao VARCHAR(300),
        valor DECIMAL(10,2),
        data_pagamento DATE,
        status VARCHAR(20) DEFAULT 'pendente',
        metodo VARCHAR(20),
        mp_payment_id VARCHAR(100),
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (aluno_id) REFERENCES alunos(id)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nome VARCHAR(200),
        email VARCHAR(200) UNIQUE,
        senha VARCHAR(200),
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS marketing_msgs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tipo VARCHAR(20),
        titulo VARCHAR(300),
        texto TEXT,
        segmento VARCHAR(50),
        status VARCHAR(20) DEFAULT 'rascunho',
        qtd_enviados INT DEFAULT 0,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const [aulaCount] = await conn.query('SELECT COUNT(*) as n FROM aulas');
    console.log('Aulas no banco:', aulaCount[0].n);
    if (aulaCount[0].n === 0) {
      const aulasDefault = [
        ['Boxe Iniciante','07:00','Segunda',15,'boxe'],
        ['Sparring','09:00','Segunda',8,'boxe'],
        ['Condicionamento','19:00','Segunda',20,'boxe'],
        ['Boxe Intermediário','07:00','Terça',12,'boxe'],
        ['Jiu-Jitsu','08:00','Terça',12,'jiujitsu'],
        ['Técnica','19:30','Terça',10,'boxe'],
        ['Boxe Iniciante','07:00','Quarta',15,'boxe'],
        ['Jiu-Jitsu','09:00','Quarta',12,'jiujitsu'],
        ['Feminino','10:00','Quarta',10,'boxe'],
        ['Sparring','19:00','Quarta',8,'boxe'],
        ['Boxe Intermediário','07:00','Quinta',12,'boxe'],
        ['Jiu-Jitsu','08:00','Quinta',12,'jiujitsu'],
        ['Condicionamento','19:30','Quinta',20,'boxe'],
        ['Boxe Iniciante','07:00','Sexta',15,'boxe'],
        ['Técnica','09:00','Sexta',10,'boxe'],
        ['Jiu-Jitsu','19:00','Sexta',12,'jiujitsu'],
        ['All Levels','09:00','Sábado',20,'boxe'],
        ['Jiu-Jitsu Open Mat','10:30','Sábado',15,'jiujitsu'],
        ['Kids Boxe','10:30','Sábado',12,'boxe'],
      ];
      for (const [nome,hora,dia,vagas,modalidade] of aulasDefault) {
        await conn.query('INSERT INTO aulas (nome,hora,dia,vagas,modalidade) VALUES (?,?,?,?,?)',[nome,hora,dia,vagas,modalidade]);
      }
    }

    const [adminCount] = await conn.query('SELECT COUNT(*) as n FROM admin_users');
    if (adminCount[0].n === 0) {
      const senha = await bcrypt.hash('admin123', 10);
      await conn.query('INSERT INTO admin_users (nome,email,senha) VALUES (?,?,?)',['Admin PR','admin@punchandroll.com.br',senha]);
      console.log('Admin criado: admin@punchandroll.com.br / admin123');
    }

    console.log('✅ Banco configurado com sucesso!');
  } finally {
    conn.release();
  }
}

// ══════════════════════════════════════
// AUTH
// ══════════════════════════════════════
app.post('/api/auth/admin', async (req, res) => {
  try {
    const { email, senha } = req.body;
    const [rows] = await db.query('SELECT * FROM admin_users WHERE email = ?', [email]);
    if (!rows.length) return res.status(401).json({ error: 'Usuário não encontrado' });
    const ok = await bcrypt.compare(senha, rows[0].senha);
    if (!ok) return res.status(401).json({ error: 'Senha incorreta' });
    const token = jwt.sign({ id: rows[0].id, tipo: 'admin', nome: rows[0].nome }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, nome: rows[0].nome, tipo: 'admin' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/aluno', async (req, res) => {
  try {
    const { login, senha } = req.body;
    const loginLower = (login||'').toLowerCase().trim();
    const [rows] = await db.query(
      `SELECT * FROM alunos WHERE LOWER(email) = ? OR LOWER(SUBSTRING_INDEX(nome,' ',1)) = ? OR LOWER(nome) LIKE ?`,
      [loginLower, loginLower, loginLower+'%']
    );
    if (!rows.length) return res.status(401).json({ error: 'Aluno não encontrado. Use seu e-mail ou primeiro nome.' });
    const aluno = rows[0];
    if (!aluno.senha) return res.status(401).json({ error: 'Senha não configurada. Contate a academia.' });
    const ok = await bcrypt.compare(senha, aluno.senha);
    if (!ok) return res.status(401).json({ error: 'Senha incorreta' });
    const token = jwt.sign({ id: aluno.id, tipo: 'aluno', nome: aluno.nome }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      token, tipo: 'aluno',
      aluno: {
        id: aluno.id, nome: aluno.nome, modalidade: aluno.modalidade,
        status: aluno.status, plano: aluno.plano, valor: aluno.valor,
        vencimento: aluno.vencimento, tel: aluno.tel, email: aluno.email
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
// ALUNOS
// ══════════════════════════════════════
app.get('/api/alunos', auth, adminOnly, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM alunos ORDER BY nome');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/alunos/me', auth, async (req, res) => {
  try {
    if(req.user.tipo !== 'aluno') return res.status(403).json({ error: 'Acesso negado' });
    const [rows] = await db.query('SELECT * FROM alunos WHERE id = ?', [req.user.id]);
    if(!rows.length) return res.status(404).json({ error: 'Aluno não encontrado' });
    const a = rows[0];
    res.json({...a, venc: a.vencimento, aulasLiberadas: (() => { try { return JSON.parse(a.aulas_liberadas||'[]'); } catch(e){ return []; } })()});
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/alunos/:id', auth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM alunos WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Aluno não encontrado' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/alunos', auth, adminOnly, async (req, res) => {
  try {
    const d = req.body;
    const senhaHash = d.senha ? await bcrypt.hash(d.senha, 10) : await bcrypt.hash('123', 10);
    const [result] = await db.query(`
      INSERT INTO alunos (nome,cpf,nasc,sexo,tel,email,endereco,cidade,cep,emerg_nome,emerg_tel,parentesco,saude,alergia,modalidade,nivel,plano_id,plano,valor,inicio,vencimento,pagto,aulas_liberadas,obs,status,senha,origem)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [d.nome,d.cpf,d.nasc,d.sexo,d.tel,d.email,d.end,d.cidade||'São José',d.cep,d.emergNome,d.emergTel,d.parentesco,d.saude,d.alergia,d.modalidade,d.nivel,d.planoId,d.plano,d.valor,d.inicio,d.venc,d.pagto,JSON.stringify(d.aulasLiberadas||[]),d.obs,'ativo',senhaHash,d.origem||'admin']);
    await notificarWA(d.tel, `Olá ${d.nome.split(' ')[0]}! 🥊 Bem-vindo(a) à *Punch and Roll Fight Team*! Seu cadastro foi realizado. Sua senha de acesso ao portal é: *123* (altere após o primeiro acesso). Qualquer dúvida: (48) 98463-9257`);
    await enviarEmailAdmin('🥊 Novo Aluno Cadastrado', `<h2>Novo aluno: ${d.nome}</h2><p>Modalidade: ${d.modalidade}</p><p>Plano: ${d.plano}</p><p>WhatsApp: ${d.tel}</p><p>E-mail: ${d.email}</p>`);
    res.json({ id: result.insertId, message: 'Aluno cadastrado!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/alunos/:id', auth, adminOnly, async (req, res) => {
  try {
    const d = req.body;
    await db.query(`
      UPDATE alunos SET nome=?,cpf=?,nasc=?,sexo=?,tel=?,email=?,endereco=?,cidade=?,cep=?,
      emerg_nome=?,emerg_tel=?,parentesco=?,saude=?,alergia=?,modalidade=?,nivel=?,
      plano_id=?,plano=?,valor=?,inicio=?,vencimento=?,pagto=?,aulas_liberadas=?,obs=?,status=?
      WHERE id=?
    `, [d.nome,d.cpf,d.nasc,d.sexo,d.tel,d.email,d.end,d.cidade,d.cep,d.emergNome,d.emergTel,d.parentesco,d.saude,d.alergia,d.modalidade,d.nivel,d.planoId,d.plano,d.valor,d.inicio,d.venc,d.pagto,JSON.stringify(d.aulasLiberadas||[]),d.obs,d.status,req.params.id]);
    res.json({ message: 'Aluno atualizado!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/alunos/:id', auth, adminOnly, async (req, res) => {
  try {
    await db.query('DELETE FROM alunos WHERE id = ?', [req.params.id]);
    res.json({ message: 'Aluno removido!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/alunos/:id/senha', auth, adminOnly, async (req, res) => {
  try {
    const { senha } = req.body;
    if(!senha || senha.length < 3) return res.status(400).json({ error: 'Senha muito curta!' });
    const hash = await bcrypt.hash(senha, 10);
    await db.query('UPDATE alunos SET senha=? WHERE id=?', [hash, req.params.id]);
    res.json({ message: 'Senha atualizada!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/auth/aluno/senha', auth, async (req, res) => {
  try {
    const { senha_atual, nova_senha } = req.body;
    if(req.user.tipo !== 'aluno') return res.status(403).json({ error: 'Acesso negado' });
    const [rows] = await db.query('SELECT senha FROM alunos WHERE id=?', [req.user.id]);
    if(!rows.length) return res.status(404).json({ error: 'Aluno não encontrado' });
    const ok = await bcrypt.compare(senha_atual, rows[0].senha);
    if(!ok) return res.status(401).json({ error: 'Senha atual incorreta' });
    const hash = await bcrypt.hash(nova_senha, 10);
    await db.query('UPDATE alunos SET senha=? WHERE id=?', [hash, req.user.id]);
    res.json({ message: 'Senha alterada com sucesso!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/alunos/publico', async (req, res) => {
  try {
    const d = req.body;
    const senhaHash = await bcrypt.hash('123', 10);
    const [result] = await db.query(`
      INSERT INTO alunos (nome,cpf,nasc,sexo,tel,email,endereco,cidade,cep,emerg_nome,emerg_tel,parentesco,saude,alergia,modalidade,nivel,plano_id,plano,valor,inicio,vencimento,pagto,obs,status,senha,origem)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [d.nome,d.cpf,d.nasc,d.sexo,d.tel,d.email,d.end,d.cidade||'São José',d.cep,d.emergNome,d.emergTel,d.parentesco,d.saude,d.alergia,d.modalidade,d.nivel,d.planoId,d.plano,d.valor,d.inicio,d.venc,d.payMethod,d.obs,'aguardando_pagamento',senhaHash,'auto-cadastro']);

    await notificarWA(process.env.WA_ADMIN_NUM || '554898463-9257',
      `🥊 *Nova Matrícula!*\n\n*Aluno:* ${d.nome}\n*Modalidade:* ${d.plano}\n*Pagamento:* ${d.payMethod}\n*WhatsApp:* ${d.tel}\n*E-mail:* ${d.email}`);
    await notificarWA(d.tel,
      `Olá ${d.nome.split(' ')[0]}! 🥊 Sua matrícula na *Punch and Roll Fight Team* foi recebida!\n\nPlano: *${d.plano}*\nEntraremos em contato para confirmar o pagamento.\n\nSua senha de acesso ao portal: *123*`);
    await enviarEmailAdmin('🥊 Nova Matrícula Online', `<h2>${d.nome}</h2><p>Plano: ${d.plano}</p><p>Pagamento: ${d.payMethod}</p><p>Tel: ${d.tel}</p><p>Email: ${d.email}</p>`);
    await enviarEmailAluno(d.email, d.nome, 'Matrícula recebida — Punch and Roll',
      `<h2>Olá, ${d.nome.split(' ')[0]}!</h2><p>Sua matrícula foi recebida. Entraremos em contato em breve.</p><p>Plano: <strong>${d.plano}</strong></p>`);

    res.json({ id: result.insertId, message: 'Matrícula recebida!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════
// AULAS
// ══════════════════════════════════════
app.get('/api/aulas', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM aulas ORDER BY FIELD(dia,"Segunda","Terça","Quarta","Quinta","Sexta","Sábado"), hora');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/aulas', auth, adminOnly, async (req, res) => {
  try {
    const { nome, hora, dia, vagas, modalidade } = req.body;
    const [result] = await db.query('INSERT INTO aulas (nome,hora,dia,vagas,modalidade) VALUES (?,?,?,?,?)', [nome,hora,dia,vagas,modalidade]);
    res.json({ id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/aulas/:id', auth, adminOnly, async (req, res) => {
  try {
    const { nome, hora, dia, vagas, modalidade, status } = req.body;
    await db.query('UPDATE aulas SET nome=?,hora=?,dia=?,vagas=?,modalidade=?,status=? WHERE id=?',[nome,hora,dia,vagas,modalidade,status||'ativo',req.params.id]);
    res.json({ message: 'Aula atualizada!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/aulas/:id', auth, adminOnly, async (req, res) => {
  try {
    await db.query('DELETE FROM checkins WHERE aula_id=?',[req.params.id]);
    await db.query('DELETE FROM aulas WHERE id=?',[req.params.id]);
    res.json({ message: 'Aula removida!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════
// CHECK-INS
// ══════════════════════════════════════
app.get('/api/checkins', auth, async (req, res) => {
  try {
    const { aula_id, data, aluno_id } = req.query;
    let q = `SELECT c.*, a.nome as aluno_nome, au.nome as aula_nome, au.hora, au.dia
             FROM checkins c
             JOIN alunos a ON c.aluno_id = a.id
             JOIN aulas au ON c.aula_id = au.id WHERE 1=1`;
    const params = [];
    if (aula_id) { q += ' AND c.aula_id = ?'; params.push(aula_id); }
    if (data) { q += ' AND c.data_checkin = ?'; params.push(data); }
    if (aluno_id) { q += ' AND c.aluno_id = ?'; params.push(aluno_id); }
    q += ' ORDER BY c.criado_em DESC';
    const [rows] = await db.query(q, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/checkins', auth, async (req, res) => {
  try {
    const { aula_id } = req.body;
    const aluno_id = req.user.tipo === 'aluno' ? req.user.id : req.body.aluno_id;
    const hoje = new Date().toISOString().slice(0,10);
    const hora = new Date().toTimeString().slice(0,5);
    const [exists] = await db.query('SELECT id FROM checkins WHERE aluno_id=? AND aula_id=? AND data_checkin=?',[aluno_id,aula_id,hoje]);
    if (exists.length) return res.status(400).json({ error: 'Check-in já realizado!' });
    const [aluno] = await db.query('SELECT status FROM alunos WHERE id=?',[aluno_id]);
    if (aluno[0]?.status === 'atrasado') return res.status(403).json({ error: 'Mensalidade em atraso. Regularize para fazer check-in.' });
    const [aula] = await db.query('SELECT vagas FROM aulas WHERE id=?',[aula_id]);
    const [ckCount] = await db.query('SELECT COUNT(*) as n FROM checkins WHERE aula_id=? AND data_checkin=?',[aula_id,hoje]);
    if (ckCount[0].n >= aula[0]?.vagas) return res.status(400).json({ error: 'Turma lotada!' });
    await db.query('INSERT INTO checkins (aluno_id,aula_id,data_checkin,hora) VALUES (?,?,?,?)',[aluno_id,aula_id,hoje,hora]);
    res.json({ message: 'Check-in confirmado! 🥊' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/checkins/:id', auth, adminOnly, async (req, res) => {
  try {
    await db.query('DELETE FROM checkins WHERE id=?',[req.params.id]);
    res.json({ message: 'Check-in removido!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════
// RECADOS
// ══════════════════════════════════════
app.get('/api/recados', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM recados WHERE ativo=1 ORDER BY pin DESC, criado_em DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/recados', auth, adminOnly, async (req, res) => {
  try {
    const { titulo, body, tipo, pin } = req.body;
    const [result] = await db.query('INSERT INTO recados (titulo,body,tipo,pin) VALUES (?,?,?,?)',[titulo,body,tipo,pin?1:0]);
    res.json({ id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/recados/:id', auth, adminOnly, async (req, res) => {
  try {
    const { titulo, body, tipo, pin, ativo } = req.body;
    await db.query('UPDATE recados SET titulo=?,body=?,tipo=?,pin=?,ativo=? WHERE id=?',[titulo,body,tipo,pin?1:0,ativo?1:0,req.params.id]);
    res.json({ message: 'Recado atualizado!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/recados/:id', auth, adminOnly, async (req, res) => {
  try {
    await db.query('UPDATE recados SET ativo=0 WHERE id=?',[req.params.id]);
    res.json({ message: 'Recado removido!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════
// PAGAMENTOS
// ══════════════════════════════════════
app.get('/api/pagamentos', auth, async (req, res) => {
  try {
    const aluno_id = req.user.tipo === 'aluno' ? req.user.id : req.query.aluno_id;
    let q = `SELECT p.*, a.nome as aluno_nome FROM pagamentos p JOIN alunos a ON p.aluno_id=a.id WHERE 1=1`;
    const params = [];
    if (aluno_id) { q += ' AND p.aluno_id=?'; params.push(aluno_id); }
    q += ' ORDER BY p.criado_em DESC';
    const [rows] = await db.query(q, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/pagamentos', auth, adminOnly, async (req, res) => {
  try {
    const { aluno_id, descricao, valor, data_pagamento, status, metodo } = req.body;
    const [result] = await db.query('INSERT INTO pagamentos (aluno_id,descricao,valor,data_pagamento,status,metodo) VALUES (?,?,?,?,?,?)',[aluno_id,descricao,valor,data_pagamento,status,metodo]);
    if (status === 'pago') {
      await db.query("UPDATE alunos SET status='ativo' WHERE id=?",[aluno_id]);
    }
    res.json({ id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MERCADO PAGO — PIX ───────────────
app.post('/api/pagamentos/pix', async (req, res) => {
  try {
    const { aluno_id, valor, descricao, email, nome, cpf } = req.body;
    const idempotencyKey = `pix-${aluno_id}-${Date.now()}`;
    const mpRes = await axios.post('https://api.mercadopago.com/v1/payments', {
      transaction_amount: parseFloat(valor),
      description: descricao || 'Mensalidade Punch and Roll Fight Team',
      payment_method_id: 'pix',
      payer: {
        email: email,
        first_name: nome.split(' ')[0],
        last_name: nome.split(' ').slice(1).join(' ') || nome.split(' ')[0],
        identification: { type: 'CPF', number: cpf.replace(/\D/g, '') }
      },
      notification_url: 'https://punch-and-roll-api-production.up.railway.app/api/webhook/mercadopago'
    }, {
      headers: {
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idempotencyKey
      }
    });
    const payment = mpRes.data;
    await db.query(
      'INSERT INTO pagamentos (aluno_id, descricao, valor, status, metodo, mp_payment_id) VALUES (?,?,?,?,?,?)',
      [aluno_id, descricao, valor, 'pendente', 'pix', String(payment.id)]
    );
    res.json({
      payment_id: payment.id,
      status: payment.status,
      qr_code: payment.point_of_interaction?.transaction_data?.qr_code,
      qr_code_base64: payment.point_of_interaction?.transaction_data?.qr_code_base64,
      ticket_url: payment.point_of_interaction?.transaction_data?.ticket_url,
      valor: valor
    });
  } catch (e) {
    console.error('MP PIX error:', e.response?.data || e.message);
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

// ── MERCADO PAGO — CARTÃO ────────────
app.post('/api/pagamentos/cartao', async (req, res) => {
  try {
    const { aluno_id, valor, descricao, token, email, nome, cpf, parcelas, payment_method_id } = req.body;
    const idempotencyKey = `card-${aluno_id}-${Date.now()}`;
    const mpRes = await axios.post('https://api.mercadopago.com/v1/payments', {
      transaction_amount: parseFloat(valor),
      token: token,
      description: descricao || 'Mensalidade Punch and Roll Fight Team',
      installments: parseInt(parcelas) || 1,
      payment_method_id: payment_method_id,
      payer: {
        email: email,
        first_name: nome.split(' ')[0],
        last_name: nome.split(' ').slice(1).join(' ') || nome.split(' ')[0],
        identification: { type: 'CPF', number: cpf.replace(/\D/g, '') }
      },
      notification_url: 'https://punch-and-roll-api-production.up.railway.app/api/webhook/mercadopago'
    }, {
      headers: {
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idempotencyKey
      }
    });
    const payment = mpRes.data;
    await db.query(
      'INSERT INTO pagamentos (aluno_id, descricao, valor, status, metodo, mp_payment_id) VALUES (?,?,?,?,?,?)',
      [aluno_id, descricao, valor, payment.status === 'approved' ? 'pago' : 'pendente', 'cartao', String(payment.id)]
    );
    if (payment.status === 'approved') {
      await db.query("UPDATE alunos SET status='ativo' WHERE id=?", [aluno_id]);
      const [aluno] = await db.query('SELECT nome, tel FROM alunos WHERE id=?', [aluno_id]);
      if (aluno.length) {
        await notificarWA(aluno[0].tel, `✅ Pagamento aprovado, ${aluno[0].nome.split(' ')[0]}! Seu acesso à Punch and Roll está ativo. 🥊`);
      }
    }
    res.json({ payment_id: payment.id, status: payment.status, status_detail: payment.status_detail, valor: valor });
  } catch (e) {
    console.error('MP Cartão error:', e.response?.data || e.message);
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

// ── MERCADO PAGO — CONSULTAR STATUS ──
app.get('/api/pagamentos/status/:payment_id', async (req, res) => {
  try {
    const mpRes = await axios.get(
      `https://api.mercadopago.com/v1/payments/${req.params.payment_id}`,
      { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } }
    );
    const payment = mpRes.data;
    if (payment.status === 'approved') {
      const [pag] = await db.query("SELECT aluno_id FROM pagamentos WHERE mp_payment_id=?", [String(req.params.payment_id)]);
      if (pag.length) {
        await db.query("UPDATE pagamentos SET status='pago' WHERE mp_payment_id=?", [String(req.params.payment_id)]);
        await db.query("UPDATE alunos SET status='ativo' WHERE id=?", [pag[0].aluno_id]);
      }
    }
    res.json({ status: payment.status, status_detail: payment.status_detail });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
// DOCUMENTOS
// ══════════════════════════════════════
app.get('/api/documentos', auth, async (req, res) => {
  try {
    const isAdmin = req.user.tipo === 'admin';
    let q = 'SELECT * FROM documentos';
    if (!isAdmin) q += " WHERE visivel=1 AND (disponivel_para='todos' OR disponivel_para=?)";
    const [aluno] = isAdmin ? [[]] : await db.query('SELECT modalidade FROM alunos WHERE id=?',[req.user.id]);
    const params = isAdmin ? [] : [aluno[0]?.modalidade || 'todos'];
    const [rows] = await db.query(q + ' ORDER BY criado_em DESC', params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/documentos', auth, adminOnly, async (req, res) => {
  try {
    const { nome, descricao, tipo, extensao, tamanho, url, visivel, disponivel_para } = req.body;
    const [result] = await db.query('INSERT INTO documentos (nome,descricao,tipo,extensao,tamanho,url,visivel,disponivel_para) VALUES (?,?,?,?,?,?,?,?)',[nome,descricao,tipo,extensao,tamanho,url,visivel?1:0,disponivel_para]);
    res.json({ id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/documentos/:id', auth, adminOnly, async (req, res) => {
  try {
    const { nome, descricao, tipo, visivel, disponivel_para } = req.body;
    await db.query('UPDATE documentos SET nome=?,descricao=?,tipo=?,visivel=?,disponivel_para=? WHERE id=?',[nome,descricao,tipo,visivel?1:0,disponivel_para,req.params.id]);
    res.json({ message: 'Documento atualizado!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/documentos/:id/download', auth, async (req, res) => {
  try {
    await db.query('UPDATE documentos SET downloads=downloads+1 WHERE id=?',[req.params.id]);
    const [rows] = await db.query('SELECT url FROM documentos WHERE id=?',[req.params.id]);
    res.json({ url: rows[0]?.url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/documentos/:id', auth, adminOnly, async (req, res) => {
  try {
    await db.query('DELETE FROM documentos WHERE id=?',[req.params.id]);
    res.json({ message: 'Documento removido!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════
// DASHBOARD / STATS
// ══════════════════════════════════════
app.get('/api/dashboard', auth, adminOnly, async (req, res) => {
  try {
    const [[ativos]] = await db.query("SELECT COUNT(*) as n FROM alunos WHERE status='ativo'");
    const [[atrasados]] = await db.query("SELECT COUNT(*) as n FROM alunos WHERE status='atrasado'");
    const [[vencendo]] = await db.query("SELECT COUNT(*) as n FROM alunos WHERE status='vencendo'");
    const [[receitaMes]] = await db.query("SELECT COALESCE(SUM(valor),0) as total FROM pagamentos WHERE status='pago' AND MONTH(data_pagamento)=MONTH(NOW()) AND YEAR(data_pagamento)=YEAR(NOW())");
    const [[checkinsHoje]] = await db.query("SELECT COUNT(*) as n FROM checkins WHERE data_checkin=CURDATE()");
    res.json({
      alunos: { ativos: ativos.n, atrasados: atrasados.n, vencendo: vencendo.n, total: ativos.n+atrasados.n+vencendo.n },
      receita_mes: receitaMes.total,
      checkins_hoje: checkinsHoje.n,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════
// MARKETING
// ══════════════════════════════════════
app.post('/api/marketing/enviar', auth, adminOnly, async (req, res) => {
  try {
    const { tipo, titulo, texto, segmento } = req.body;
    let q = 'SELECT nome, tel, email, modalidade FROM alunos WHERE 1=1';
    const params = [];
    if (segmento === 'atrasados') { q += " AND status='atrasado'"; }
    else if (segmento === 'vencendo') { q += " AND status='vencendo'"; }
    else if (segmento === 'ativos') { q += " AND status='ativo'"; }
    const [alvos] = await db.query(q, params);
    let enviados = 0;
    for (const alvo of alvos) {
      const msg = texto.replace(/{nome}/g, alvo.nome.split(' ')[0]).replace(/{vencimento}/g, '').replace(/{dias}/g, '3');
      if (tipo === 'wa') await notificarWA(alvo.tel, msg);
      if (tipo === 'email') await enviarEmailAluno(alvo.email, alvo.nome, titulo, '<p>'+msg+'</p>');
      enviados++;
    }
    await db.query('INSERT INTO marketing_msgs (tipo,titulo,texto,segmento,status,qtd_enviados) VALUES (?,?,?,?,?,?)',[tipo,titulo,texto,segmento,'enviado',enviados]);
    res.json({ enviados, message: `Enviado para ${enviados} aluno(s)!` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════
// WEBHOOK MERCADO PAGO
// ══════════════════════════════════════
app.post('/api/webhook/mercadopago', async (req, res) => {
  try {
    const { type, data } = req.body;
    if (type === 'payment') {
      const mpRes = await axios.get(`https://api.mercadopago.com/v1/payments/${data.id}`, {
        headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` }
      });
      const payment = mpRes.data;
      if (payment.status === 'approved') {
        await db.query("UPDATE pagamentos SET status='pago', mp_payment_id=? WHERE mp_payment_id=?",[data.id, data.id]);
        const [pag] = await db.query('SELECT aluno_id FROM pagamentos WHERE mp_payment_id=?',[String(data.id)]);
        if (pag.length) {
          await db.query("UPDATE alunos SET status='ativo' WHERE id=?",[pag[0].aluno_id]);
          const [aluno] = await db.query('SELECT nome,tel FROM alunos WHERE id=?',[pag[0].aluno_id]);
          if (aluno.length) {
            await notificarWA(aluno[0].tel, `✅ Pagamento confirmado, ${aluno[0].nome.split(' ')[0]}! Seu acesso à Punch and Roll está ativo. 🥊`);
          }
        }
      }
    }
    res.sendStatus(200);
  } catch (e) {
    console.error('Webhook MP error:', e.message);
    res.sendStatus(500);
  }
});

// ══════════════════════════════════════
// NOTIFICAÇÕES
// ══════════════════════════════════════
async function notificarWA(tel, msg) {
  if (!process.env.WA_API_URL || !process.env.WA_API_KEY) return;
  try {
    const num = '55' + tel.replace(/\D/g,'');
    await axios.post(process.env.WA_API_URL, { number: num, text: msg }, {
      headers: { 'apikey': process.env.WA_API_KEY, 'Content-Type': 'application/json' }
    });
  } catch (e) { console.log('WA error:', e.message); }
}

async function enviarEmailAdmin(assunto, html) {
  if (!process.env.SENDGRID_API_KEY) return;
  try {
    await axios.post('https://api.sendgrid.com/v3/mail/send', {
      personalizations: [{ to: [{ email: process.env.EMAIL_ADMIN }] }],
      from: { email: process.env.EMAIL_FROM || 'noreply@punchandroll.com.br', name: 'Punch and Roll Sistema' },
      subject: assunto,
      content: [{ type: 'text/html', value: html }],
    }, { headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' } });
  } catch (e) { console.log('Email admin error:', e.message); }
}

async function enviarEmailAluno(email, nome, assunto, html) {
  if (!process.env.SENDGRID_API_KEY || !email) return;
  try {
    await axios.post('https://api.sendgrid.com/v3/mail/send', {
      personalizations: [{ to: [{ email, name: nome }] }],
      from: { email: process.env.EMAIL_FROM || 'noreply@punchandroll.com.br', name: 'Punch and Roll Fight Team' },
      subject: assunto,
      content: [{ type: 'text/html', value: html }],
    }, { headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' } });
  } catch (e) { console.log('Email aluno error:', e.message); }
}

// ══════════════════════════════════════
// HEALTH CHECK
// ══════════════════════════════════════
app.get('/api/health', async (req, res) => {
  try {
    const [aulas] = await db.query('SELECT COUNT(*) as n FROM aulas');
    const [alunos] = await db.query('SELECT COUNT(*) as n FROM alunos');
    res.json({ status: 'ok', app: 'Punch and Roll API', version: '1.0.0', aulas: aulas[0].n, alunos: alunos[0].n });
  } catch(e) {
    res.json({ status: 'ok', app: 'Punch and Roll API', version: '1.1.0'});
  }
});

// ══════════════════════════════════════
// START
// ══════════════════════════════════════
const PORT = process.env.PORT || 3000;
setupDB().then(() => {
  app.listen(PORT, () => console.log(`🥊 Punch and Roll API rodando na porta ${PORT}`));
}).catch(e => {
  console.error('Erro ao configurar banco:', e.message);
  process.exit(1);
});
