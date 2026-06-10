const express = require('express');
const mysql2 = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const axios = require('axios');
const multer = require('multer');
require('dotenv').config();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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

const db = mysql2.createPool({
  uri: process.env.DATABASE_URL,
  waitForConnections: true,
  connectionLimit: 10,
});

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

// Verifica permissão específica para colaboradores
function perm(permissao) {
  return (req, res, next) => {
    if (req.user.tipo !== 'admin') return res.status(403).json({ error: 'Acesso negado' });
    // admin_master tem tudo
    if (req.user.nivel === 'master') return next();
    // verifica permissão específica
    const perms = req.user.permissoes || [];
    if (!perms.includes(permissao)) return res.status(403).json({ error: 'Sem permissão para esta ação' });
    next();
  };
}

// Middleware flexível — admin master passa sempre, colaborador verifica permissão
function adminOuPerm(permissao) {
  return (req, res, next) => {
    if (req.user.tipo !== 'admin') return res.status(403).json({ error: 'Acesso negado' });
    if (req.user.nivel === 'master') return next();
    const perms = req.user.permissoes || [];
    if (perms.includes(permissao)) return next();
    return res.status(403).json({ error: 'Sem permissão para esta ação' });
  };
}

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
    try { await conn.query("ALTER TABLE documentos ADD COLUMN categoria VARCHAR(50) DEFAULT 'outro'"); } catch(e){}
    try { await conn.query("ALTER TABLE documentos ADD COLUMN arquivo LONGBLOB"); } catch(e){}
    try { await conn.query("ALTER TABLE documentos ADD COLUMN mimetype VARCHAR(100)"); } catch(e){}

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
        nivel VARCHAR(20) DEFAULT 'master',
        permissoes JSON,
        ativo BOOLEAN DEFAULT TRUE,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Adicionar colunas se não existirem (migração)
    try { await conn.query("ALTER TABLE admin_users ADD COLUMN nivel VARCHAR(20) DEFAULT 'master'"); } catch(e){}
    try { await conn.query("ALTER TABLE admin_users ADD COLUMN permissoes JSON"); } catch(e){}
    try { await conn.query("ALTER TABLE admin_users ADD COLUMN ativo BOOLEAN DEFAULT TRUE"); } catch(e){}

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

    await conn.query(`
      CREATE TABLE IF NOT EXISTS despesas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        descricao VARCHAR(300) NOT NULL,
        valor DECIMAL(10,2),
        data_vencimento DATE,
        data_pagamento DATE,
        status VARCHAR(20) DEFAULT 'pendente',
        categoria VARCHAR(100),
        metodo VARCHAR(20) DEFAULT 'pix',
        obs TEXT,
        parcelas INT DEFAULT 1,
        parcela_atual INT DEFAULT 1,
        recorrente TINYINT DEFAULT 0,
        grupo_parcelas VARCHAR(36),
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Migração segura: adiciona colunas se ainda não existirem
    for (const sql of [
      "ALTER TABLE despesas ADD COLUMN parcelas INT DEFAULT 1",
      "ALTER TABLE despesas ADD COLUMN parcela_atual INT DEFAULT 1",
      "ALTER TABLE despesas ADD COLUMN recorrente TINYINT DEFAULT 0",
      "ALTER TABLE despesas ADD COLUMN grupo_parcelas VARCHAR(36)",
    ]) { try { await conn.query(sql); } catch(e) {} }

    await conn.query(`
      CREATE TABLE IF NOT EXISTS estoque (
        id INT AUTO_INCREMENT PRIMARY KEY,
        codigo VARCHAR(50) UNIQUE,
        nome VARCHAR(200) NOT NULL,
        categoria VARCHAR(100),
        quantidade DECIMAL(10,2) DEFAULT 0,
        unidade VARCHAR(20) DEFAULT 'un',
        valor_unitario DECIMAL(10,2),
        fornecedor VARCHAR(200),
        obs TEXT,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS estoque_movimentacoes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        produto_id INT NOT NULL,
        tipo VARCHAR(10) NOT NULL,
        quantidade DECIMAL(10,2) NOT NULL,
        motivo VARCHAR(200),
        data DATE,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (produto_id) REFERENCES estoque(id) ON DELETE CASCADE
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS contratos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        aluno_id INT NOT NULL,
        token VARCHAR(64) UNIQUE NOT NULL,
        plano VARCHAR(200),
        modalidade VARCHAR(50),
        valor DECIMAL(10,2),
        meses INT DEFAULT 1,
        freq VARCHAR(20),
        ip VARCHAR(100),
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        assinado BOOLEAN DEFAULT FALSE,
        assinado_em TIMESTAMP NULL,
        contrato_html LONGTEXT,
        FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE CASCADE
      )
    `);
    try { await conn.query("ALTER TABLE contratos ADD COLUMN assinado BOOLEAN DEFAULT FALSE"); } catch(e){}
    try { await conn.query("ALTER TABLE contratos ADD COLUMN assinado_em TIMESTAMP NULL"); } catch(e){}
    try { await conn.query("ALTER TABLE contratos ADD COLUMN criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP"); } catch(e){}

    const [adminCount] = await conn.query('SELECT COUNT(*) as n FROM admin_users');
    if (adminCount[0].n === 0) {
      const senha = await bcrypt.hash('admin123', 10);
      await conn.query(
        "INSERT INTO admin_users (nome,email,senha,nivel,permissoes,ativo) VALUES (?,?,?,?,?,?)",
        ['Admin PR','admin@punchandroll.com.br',senha,'master',JSON.stringify([]),true]
      );
      console.log('Admin criado: admin@punchandroll.com.br / admin123');
    }

    console.log('✅ Banco configurado!');
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
    if (!rows[0].ativo) return res.status(401).json({ error: 'Usuário desativado' });
    const ok = await bcrypt.compare(senha, rows[0].senha);
    if (!ok) return res.status(401).json({ error: 'Senha incorreta' });
    const permissoes = (() => { try { return JSON.parse(rows[0].permissoes || '[]'); } catch(e) { return []; } })();
    const token = jwt.sign({
      id: rows[0].id,
      tipo: 'admin',
      nome: rows[0].nome,
      nivel: rows[0].nivel || 'master',
      permissoes,
    }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, nome: rows[0].nome, tipo: 'admin', nivel: rows[0].nivel || 'master', permissoes });
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
    if (!rows.length) return res.status(401).json({ error: 'Aluno não encontrado.' });
    const aluno = rows[0];
    if (!aluno.senha) return res.status(401).json({ error: 'Senha não configurada.' });
    const ok = await bcrypt.compare(senha, aluno.senha);
    if (!ok) return res.status(401).json({ error: 'Senha incorreta' });
    const token = jwt.sign({ id: aluno.id, tipo: 'aluno', nome: aluno.nome }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      token, tipo: 'aluno',
      aluno: { id: aluno.id, nome: aluno.nome, modalidade: aluno.modalidade, status: aluno.status, plano: aluno.plano, valor: aluno.valor, vencimento: aluno.vencimento, tel: aluno.tel, email: aluno.email }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
// EQUIPE — Gestão de admins/colaboradores
// ══════════════════════════════════════

// Listar equipe (só master)
app.get('/api/equipe', auth, async (req, res) => {
  try {
    if (req.user.tipo !== 'admin' || req.user.nivel !== 'master') return res.status(403).json({ error: 'Apenas o admin master pode gerenciar a equipe' });
    const [rows] = await db.query('SELECT id, nome, email, nivel, permissoes, ativo, criado_em FROM admin_users ORDER BY criado_em');
    res.json(rows.map(r => ({
      ...r,
      permissoes: (() => { try { return JSON.parse(r.permissoes || '[]'); } catch(e) { return []; } })()
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Criar membro da equipe (só master)
app.post('/api/equipe', auth, async (req, res) => {
  try {
    if (req.user.tipo !== 'admin' || req.user.nivel !== 'master') return res.status(403).json({ error: 'Apenas o admin master pode criar usuários' });
    const { nome, email, senha, nivel, permissoes } = req.body;
    if (!nome || !email || !senha) return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios' });
    const [existe] = await db.query('SELECT id FROM admin_users WHERE email = ?', [email]);
    if (existe.length) return res.status(400).json({ error: 'E-mail já cadastrado' });
    const hash = await bcrypt.hash(senha, 10);
    const perms = nivel === 'master' ? [] : (permissoes || []);
    const [result] = await db.query(
      'INSERT INTO admin_users (nome, email, senha, nivel, permissoes, ativo) VALUES (?,?,?,?,?,?)',
      [nome, email, hash, nivel || 'colaborador', JSON.stringify(perms), true]
    );
    res.json({ id: result.insertId, message: 'Usuário criado!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Editar membro (só master)
app.put('/api/equipe/:id', auth, async (req, res) => {
  try {
    if (req.user.tipo !== 'admin' || req.user.nivel !== 'master') return res.status(403).json({ error: 'Apenas o admin master pode editar usuários' });
    const { nome, email, nivel, permissoes, ativo, senha } = req.body;
    const perms = nivel === 'master' ? [] : (permissoes || []);
    if (senha) {
      const hash = await bcrypt.hash(senha, 10);
      await db.query('UPDATE admin_users SET nome=?, email=?, nivel=?, permissoes=?, ativo=?, senha=? WHERE id=?',
        [nome, email, nivel, JSON.stringify(perms), ativo ? 1 : 0, hash, req.params.id]);
    } else {
      await db.query('UPDATE admin_users SET nome=?, email=?, nivel=?, permissoes=?, ativo=? WHERE id=?',
        [nome, email, nivel, JSON.stringify(perms), ativo ? 1 : 0, req.params.id]);
    }
    res.json({ message: 'Usuário atualizado!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Excluir membro (só master, não pode excluir a si mesmo)
app.delete('/api/equipe/:id', auth, async (req, res) => {
  try {
    if (req.user.tipo !== 'admin' || req.user.nivel !== 'master') return res.status(403).json({ error: 'Apenas o admin master pode excluir usuários' });
    if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Você não pode excluir sua própria conta' });
    await db.query('DELETE FROM admin_users WHERE id=?', [req.params.id]);
    res.json({ message: 'Usuário removido!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    await notificarWA(d.tel, `Olá ${d.nome.split(' ')[0]}! 🥊 Bem-vindo(a) à *Punch and Roll Fight Team*! Seu cadastro foi realizado. Sua senha de acesso ao portal é: *123*`);
    await enviarEmailAdmin('🥊 Novo Aluno', `<h2>${d.nome}</h2><p>Modalidade: ${d.modalidade}</p><p>WhatsApp: ${d.tel}</p>`);
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
  const conn = await db.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.query('DELETE FROM checkins WHERE aluno_id = ?', [req.params.id]);
    await conn.query('DELETE FROM pagamentos WHERE aluno_id = ?', [req.params.id]);
    await conn.query('DELETE FROM alunos WHERE id = ?', [req.params.id]);
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    res.json({ message: 'Aluno removido!' });
  } catch (e) {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1').catch(()=>{});
    console.error('[DELETE aluno] Erro:', e.message, e.sql || '');
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
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
    res.json({ message: 'Senha alterada!' });
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
    await notificarWA(process.env.WA_ADMIN_NUM||'554898463-9257',`🥊 *Nova Matrícula!*\n\n*Aluno:* ${d.nome}\n*Plano:* ${d.plano}\n*Pagamento:* ${d.payMethod}\n*WhatsApp:* ${d.tel}`);
    await notificarWA(d.tel,`Olá ${d.nome.split(' ')[0]}! 🥊 Sua matrícula na *Punch and Roll Fight Team* foi recebida!\n\nPlano: *${d.plano}*\nEntraremos em contato para confirmar o pagamento.\n\nSua senha de acesso ao portal: *123*`);
    await enviarEmailAdmin('🥊 Nova Matrícula Online',`<h2>${d.nome}</h2><p>Plano: ${d.plano}</p><p>Pagamento: ${d.payMethod}</p><p>Tel: ${d.tel}</p>`);
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
    let q = `SELECT c.*, a.nome as aluno_nome, au.nome as aula_nome, au.hora, au.dia FROM checkins c JOIN alunos a ON c.aluno_id = a.id JOIN aulas au ON c.aula_id = au.id WHERE 1=1`;
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
    if (aluno[0]?.status === 'atrasado') return res.status(403).json({ error: 'Mensalidade em atraso.' });
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
    // Tenta com JOIN; se a coluna aluno_id não existir no banco ainda, retorna vazio
    let q = `SELECT p.*, a.nome as aluno_nome FROM pagamentos p LEFT JOIN alunos a ON p.aluno_id=a.id WHERE 1=1`;
    const params = [];
    if (aluno_id) { q += ' AND p.aluno_id=?'; params.push(aluno_id); }
    q += ' ORDER BY p.criado_em DESC LIMIT 500';
    const [rows] = await db.query(q, params);
    res.json(rows);
  } catch (e) {
    console.error('[GET pagamentos]', e.message);
    res.json([]); // retorna vazio em vez de 500 para não quebrar carregarTudo
  }
});

app.post('/api/pagamentos', auth, adminOnly, async (req, res) => {
  try {
    const { aluno_id, descricao, valor, data_pagamento, status, metodo } = req.body;
    const [result] = await db.query('INSERT INTO pagamentos (aluno_id,descricao,valor,data_pagamento,status,metodo) VALUES (?,?,?,?,?,?)',[aluno_id,descricao,valor,data_pagamento,status,metodo]);
    if (status === 'pago') await db.query("UPDATE alunos SET status='ativo' WHERE id=?",[aluno_id]);
    res.json({ id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/pagamentos/:id', auth, adminOnly, async (req, res) => {
  try {
    await db.query('DELETE FROM pagamentos WHERE id = ?', [req.params.id]);
    res.json({ message: 'Pagamento removido!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MERCADO PAGO — PIX ──
app.post('/api/pagamentos/pix', async (req, res) => {
  try {
    const { aluno_id, valor, descricao, email, nome, cpf } = req.body;
    const mpRes = await axios.post('https://api.mercadopago.com/v1/payments', {
      transaction_amount: parseFloat(valor),
      description: descricao || 'Mensalidade Punch and Roll',
      payment_method_id: 'pix',
      payer: {
        email, first_name: nome.split(' ')[0],
        last_name: nome.split(' ').slice(1).join(' ') || nome.split(' ')[0],
        identification: { type: 'CPF', number: cpf.replace(/\D/g,'') }
      },
      notification_url: 'https://punch-and-roll-api-production.up.railway.app/api/webhook/mercadopago'
    }, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': `pix-${aluno_id}-${Date.now()}` }
    });
    const payment = mpRes.data;
    await db.query('INSERT INTO pagamentos (aluno_id,descricao,valor,status,metodo,mp_payment_id) VALUES (?,?,?,?,?,?)',[aluno_id,descricao,valor,'pendente','pix',String(payment.id)]);
    res.json({
      payment_id: payment.id, status: payment.status,
      qr_code: payment.point_of_interaction?.transaction_data?.qr_code,
      qr_code_base64: payment.point_of_interaction?.transaction_data?.qr_code_base64,
      ticket_url: payment.point_of_interaction?.transaction_data?.ticket_url,
      valor
    });
  } catch (e) {
    console.error('MP PIX error:', e.response?.data || e.message);
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

// ── MERCADO PAGO — CARTÃO ──
app.post('/api/pagamentos/cartao', async (req, res) => {
  try {
    const { aluno_id, valor, descricao, token, email, nome, cpf, parcelas, payment_method_id } = req.body;
    const mpRes = await axios.post('https://api.mercadopago.com/v1/payments', {
      transaction_amount: parseFloat(valor), token,
      description: descricao || 'Mensalidade Punch and Roll',
      installments: parseInt(parcelas) || 1,
      payment_method_id,
      payer: {
        email, first_name: nome.split(' ')[0],
        last_name: nome.split(' ').slice(1).join(' ') || nome.split(' ')[0],
        identification: { type: 'CPF', number: cpf.replace(/\D/g,'') }
      },
      notification_url: 'https://punch-and-roll-api-production.up.railway.app/api/webhook/mercadopago'
    }, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': `card-${aluno_id}-${Date.now()}` }
    });
    const payment = mpRes.data;
    await db.query('INSERT INTO pagamentos (aluno_id,descricao,valor,status,metodo,mp_payment_id) VALUES (?,?,?,?,?,?)',[aluno_id,descricao,valor,payment.status==='approved'?'pago':'pendente','cartao',String(payment.id)]);
    if (payment.status === 'approved') {
      await db.query("UPDATE alunos SET status='ativo' WHERE id=?",[aluno_id]);
      const [aluno] = await db.query('SELECT nome,tel FROM alunos WHERE id=?',[aluno_id]);
      if (aluno.length) await notificarWA(aluno[0].tel,`✅ Pagamento aprovado, ${aluno[0].nome.split(' ')[0]}! Seu acesso está ativo. 🥊`);
    }
    res.json({ payment_id: payment.id, status: payment.status, status_detail: payment.status_detail, valor });
  } catch (e) {
    console.error('MP Cartão error:', e.response?.data || e.message);
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

// ── STATUS PAGAMENTO ──
app.get('/api/pagamentos/status/:payment_id', async (req, res) => {
  try {
    const mpRes = await axios.get(`https://api.mercadopago.com/v1/payments/${req.params.payment_id}`,{ headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } });
    const payment = mpRes.data;
    if (payment.status === 'approved') {
      const [pag] = await db.query("SELECT aluno_id FROM pagamentos WHERE mp_payment_id=?",[String(req.params.payment_id)]);
      if (pag.length) {
        await db.query("UPDATE pagamentos SET status='pago' WHERE mp_payment_id=?",[String(req.params.payment_id)]);
        await db.query("UPDATE alunos SET status='ativo' WHERE id=?",[pag[0].aluno_id]);
      }
    }
    res.json({ status: payment.status, status_detail: payment.status_detail });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════
// DOCUMENTOS — substituído abaixo com suporte a upload de arquivo

// ══════════════════════════════════════
// DASHBOARD
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
    if (segmento === 'atrasados') q += " AND status='atrasado'";
    else if (segmento === 'vencendo') q += " AND status='vencendo'";
    else if (segmento === 'ativos') q += " AND status='ativo'";
    const [alvos] = await db.query(q);
    let enviados = 0;
    for (const alvo of alvos) {
      const msg = texto.replace(/{nome}/g, alvo.nome.split(' ')[0]).replace(/{vencimento}/g,'').replace(/{dias}/g,'3');
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
      const mpRes = await axios.get(`https://api.mercadopago.com/v1/payments/${data.id}`,{ headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } });
      const payment = mpRes.data;
      if (payment.status === 'approved') {
        await db.query("UPDATE pagamentos SET status='pago', mp_payment_id=? WHERE mp_payment_id=?",[data.id,data.id]);
        const [pag] = await db.query('SELECT aluno_id FROM pagamentos WHERE mp_payment_id=?',[String(data.id)]);
        if (pag.length) {
          await db.query("UPDATE alunos SET status='ativo' WHERE id=?",[pag[0].aluno_id]);
          const [aluno] = await db.query('SELECT nome,tel FROM alunos WHERE id=?',[pag[0].aluno_id]);
          if (aluno.length) await notificarWA(aluno[0].tel,`✅ Pagamento confirmado, ${aluno[0].nome.split(' ')[0]}! Seu acesso está ativo. 🥊`);
        }
      }
    }
    res.sendStatus(200);
  } catch (e) { console.error('Webhook MP error:', e.message); res.sendStatus(500); }
});

// ══════════════════════════════════════
// NOTIFICAÇÕES
// ══════════════════════════════════════
async function notificarWA(tel, msg) {
  if (!process.env.WA_API_URL || !process.env.WA_API_KEY) return;
  try {
    const num = '55' + tel.replace(/\D/g,'');
    await axios.post(process.env.WA_API_URL, { number: num, text: msg }, { headers: { 'apikey': process.env.WA_API_KEY, 'Content-Type': 'application/json' } });
  } catch (e) { console.log('WA error:', e.message); }
}

async function enviarEmailAdmin(assunto, html) {
  if (!process.env.SENDGRID_API_KEY) return;
  try {
    await axios.post('https://api.sendgrid.com/v3/mail/send', {
      personalizations: [{ to: [{ email: process.env.EMAIL_ADMIN }] }],
      from: { email: process.env.EMAIL_FROM || 'noreply@punchandroll.com.br', name: 'Punch and Roll Sistema' },
      subject: assunto, content: [{ type: 'text/html', value: html }],
    }, { headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' } });
  } catch (e) { console.log('Email admin error:', e.message); }
}

async function enviarEmailAluno(email, nome, assunto, html) {
  if (!process.env.SENDGRID_API_KEY) { console.log('Email SKIP: SENDGRID_API_KEY não configurado'); return; }
  if (!email) { console.log('Email SKIP: email destinatário vazio'); return; }
  try {
    const from = process.env.EMAIL_FROM || 'noreply@punchandroll.com.br';
    console.log(`Email SEND → ${email} | from: ${from} | assunto: ${assunto}`);
    const res = await axios.post('https://api.sendgrid.com/v3/mail/send', {
      personalizations: [{ to: [{ email, name: nome }] }],
      from: { email: from, name: 'Punch and Roll Fight Team' },
      subject: assunto, content: [{ type: 'text/html', value: html }],
    }, { headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' } });
    console.log(`Email OK → status ${res.status}`);
  } catch (e) {
    console.log('Email ERRO:', e.response?.data ? JSON.stringify(e.response.data) : e.message);
  }
}

// ══════════════════════════════════════
// TESTE DE EMAIL (debug)
// ══════════════════════════════════════
app.get('/api/teste-email/:destino', async (req, res) => {
  const email = req.params.destino;
  const key = process.env.SENDGRID_API_KEY;
  const from = process.env.EMAIL_FROM || 'noreply@punchandroll.com.br';
  if (!key) return res.json({ ok: false, erro: 'SENDGRID_API_KEY não configurado no Railway' });
  try {
    const r = await axios.post('https://api.sendgrid.com/v3/mail/send', {
      personalizations: [{ to: [{ email }] }],
      from: { email: from, name: 'Punch and Roll Fight Team' },
      subject: '🥊 Teste de email — Punch and Roll',
      content: [{ type: 'text/html', value: '<h2>Funcionou!</h2><p>Email de teste enviado com sucesso.</p>' }],
    }, { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } });
    res.json({ ok: true, status: r.status, from, para: email });
  } catch(e) {
    res.json({ ok: false, status: e.response?.status, erro: e.response?.data || e.message, from, para: email });
  }
});

// ══════════════════════════════════════
// HEALTH CHECK
// ══════════════════════════════════════
app.get('/api/health', async (req, res) => {
  try {
    const [aulas] = await db.query('SELECT COUNT(*) as n FROM aulas');
    const [alunos] = await db.query('SELECT COUNT(*) as n FROM alunos');
    res.json({ status: 'ok', app: 'Punch and Roll API', version: '1.1.0', aulas: aulas[0].n, alunos: alunos[0].n });
  } catch(e) { res.json({ status: 'ok', app: 'Punch and Roll API', version: '1.1.0' }); }
});

// ══════════════════════════════════════
// FINANCEIRO
// ══════════════════════════════════════
app.get('/api/financeiro/resumo', auth, adminOnly, async (req, res) => {
  try {
    const [historicoRec] = await db.query(`
      SELECT DATE_FORMAT(data_pagamento, '%Y-%m') as mes, COALESCE(SUM(valor),0) as total
      FROM pagamentos WHERE status='pago' AND data_pagamento >= DATE_SUB(CURDATE(), INTERVAL 7 MONTH)
      GROUP BY mes ORDER BY mes
    `);
    const [historicoDes] = await db.query(`
      SELECT DATE_FORMAT(data_vencimento, '%Y-%m') as mes, COALESCE(SUM(valor),0) as total
      FROM despesas WHERE data_vencimento >= DATE_SUB(CURDATE(), INTERVAL 7 MONTH)
      GROUP BY mes ORDER BY mes
    `);
    const [despesas] = await db.query(
      `SELECT * FROM despesas ORDER BY FIELD(status,'pendente','pago'), data_vencimento ASC LIMIT 300`
    );
    const [cats] = await db.query(
      `SELECT DISTINCT categoria FROM despesas WHERE categoria IS NOT NULL AND categoria != '' ORDER BY categoria`
    );
    res.json({ historicoRec, historicoDes, despesas, categorias: cats.map(c => c.categoria) });
  } catch (e) { res.json({ historicoRec: [], historicoDes: [], despesas: [], categorias: [] }); }
});

// ── DESPESAS CRUD ──
app.get('/api/despesas', auth, adminOnly, async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT * FROM despesas ORDER BY FIELD(status,'pendente','pago'), data_vencimento ASC`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/despesas', auth, adminOnly, async (req, res) => {
  try {
    const { descricao, valor, data_vencimento, categoria, metodo, obs, parcelas = 1, recorrente = false } = req.body;
    if (!descricao || !valor || !data_vencimento) return res.status(400).json({ error: 'Preencha descrição, valor e vencimento' });
    const n = Math.min(Math.max(parseInt(parcelas) || 1, 1), 60);
    const grupo = n > 1 || recorrente ? require('crypto').randomUUID() : null;
    const ids = [];
    for (let i = 0; i < n; i++) {
      const [y, m, d] = data_vencimento.split('-').map(Number);
      const dt = new Date(y, m - 1 + i, d);
      const venc = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
      const desc = n > 1 ? `${descricao} (${i+1}/${n})` : descricao;
      const [r] = await db.query(
        'INSERT INTO despesas (descricao,valor,data_vencimento,status,categoria,metodo,obs,parcelas,parcela_atual,recorrente,grupo_parcelas) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [desc, valor, venc, 'pendente', categoria||null, metodo||'pix', obs||null, n, i+1, recorrente?1:0, grupo]
      );
      ids.push(r.insertId);
    }
    res.json({ ids, id: ids[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/despesas/:id', auth, adminOnly, async (req, res) => {
  try {
    const { descricao, valor, data_vencimento, data_pagamento, status, categoria, metodo, obs, recorrente } = req.body;
    await db.query(
      'UPDATE despesas SET descricao=?,valor=?,data_vencimento=?,data_pagamento=?,status=?,categoria=?,metodo=?,obs=?,recorrente=? WHERE id=?',
      [descricao, valor, data_vencimento, data_pagamento||null, status||'pendente', categoria||null, metodo||'pix', obs||null, recorrente?1:0, req.params.id]
    );
    // Recorrente: ao pagar, cria automaticamente a próxima mensal
    let recorrente_criado = false;
    if (status === 'pago' && recorrente) {
      const [[atual]] = await db.query('SELECT * FROM despesas WHERE id=?', [req.params.id]);
      if (atual?.data_vencimento) {
        const vencStr = atual.data_vencimento instanceof Date
          ? atual.data_vencimento.toISOString().split('T')[0]
          : String(atual.data_vencimento).split('T')[0];
        const [vy, vm, vd] = vencStr.split('-').map(Number);
        const prox = new Date(vy, vm, vd);
        const proxVenc = `${prox.getFullYear()}-${String(prox.getMonth()+1).padStart(2,'0')}-${String(prox.getDate()).padStart(2,'0')}`;
        const [existente] = await db.query(
          'SELECT id FROM despesas WHERE descricao=? AND data_vencimento=? AND status="pendente" LIMIT 1',
          [atual.descricao, proxVenc]
        );
        if (!existente.length) {
          await db.query(
            'INSERT INTO despesas (descricao,valor,data_vencimento,status,categoria,metodo,recorrente) VALUES (?,?,?,?,?,?,?)',
            [atual.descricao, atual.valor, proxVenc, 'pendente', atual.categoria, atual.metodo, 1]
          );
          recorrente_criado = true;
        }
      }
    }
    res.json({ ok: true, recorrente_criado });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/despesas/:id', auth, adminOnly, async (req, res) => {
  try {
    await db.query('DELETE FROM despesas WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ESTOQUE CRUD ──
app.get('/api/estoque', auth, adminOnly, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM estoque ORDER BY nome');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/estoque', auth, adminOnly, async (req, res) => {
  try {
    const { nome, categoria, quantidade = 0, unidade = 'un', valor_unitario, fornecedor, obs } = req.body;
    if (!nome) return res.status(400).json({ error: 'Nome obrigatório' });
    const [[last]] = await db.query('SELECT codigo FROM estoque ORDER BY id DESC LIMIT 1');
    const num = last?.codigo ? parseInt(last.codigo.replace('EST-',''))||0 : 0;
    const codigo = `EST-${String(num+1).padStart(3,'0')}`;
    const [r] = await db.query(
      'INSERT INTO estoque (codigo,nome,categoria,quantidade,unidade,valor_unitario,fornecedor,obs) VALUES (?,?,?,?,?,?,?,?)',
      [codigo, nome, categoria||null, quantidade, unidade, valor_unitario||null, fornecedor||null, obs||null]
    );
    res.json({ id: r.insertId, codigo });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/estoque/:id', auth, adminOnly, async (req, res) => {
  try {
    const { nome, categoria, unidade, valor_unitario, fornecedor, obs } = req.body;
    await db.query(
      'UPDATE estoque SET nome=?,categoria=?,unidade=?,valor_unitario=?,fornecedor=?,obs=? WHERE id=?',
      [nome, categoria||null, unidade||'un', valor_unitario||null, fornecedor||null, obs||null, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/estoque/:id', auth, adminOnly, async (req, res) => {
  try {
    await db.query('DELETE FROM estoque WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/estoque/:id/movimentar', auth, adminOnly, async (req, res) => {
  try {
    const { tipo, quantidade, motivo } = req.body;
    if (!tipo || !quantidade) return res.status(400).json({ error: 'tipo e quantidade obrigatórios' });
    const [[prod]] = await db.query('SELECT * FROM estoque WHERE id=?', [req.params.id]);
    if (!prod) return res.status(404).json({ error: 'Produto não encontrado' });
    const novaQtd = tipo === 'entrada'
      ? parseFloat(prod.quantidade) + parseFloat(quantidade)
      : parseFloat(prod.quantidade) - parseFloat(quantidade);
    if (novaQtd < 0) return res.status(400).json({ error: 'Quantidade insuficiente em estoque' });
    await db.query('UPDATE estoque SET quantidade=? WHERE id=?', [novaQtd, req.params.id]);
    await db.query(
      'INSERT INTO estoque_movimentacoes (produto_id,tipo,quantidade,motivo,data) VALUES (?,?,?,?,CURDATE())',
      [req.params.id, tipo, quantidade, motivo||null]
    );
    res.json({ ok: true, quantidade: novaQtd });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/estoque/:id/movimentacoes', auth, adminOnly, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM estoque_movimentacoes WHERE produto_id=? ORDER BY criado_em DESC LIMIT 50',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════
// CONTRATOS
// ══════════════════════════════════════
app.post('/api/contratos', async (req, res) => {
  try {
    const { aluno_id, plano, modalidade, valor, meses, freq, contrato_html, nome, email } = req.body;
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'desconhecido';
    const token = require('crypto').randomBytes(32).toString('hex');
    await db.query(
      'INSERT INTO contratos (aluno_id, token, plano, modalidade, valor, meses, freq, ip, contrato_html) VALUES (?,?,?,?,?,?,?,?,?)',
      [aluno_id, token, plano, modalidade, valor || 0, meses || 1, freq, ip, contrato_html || '']
    );
    const link = `https://punchandroll.com.br/assinar-contrato.html?token=${token}`;
    const nomeFirst = (nome || 'aluno').split(' ')[0];
    const modLabel = modalidade === 'boxe' ? 'Boxe' : modalidade === 'jiujitsu' ? 'Jiu-Jitsu' : 'Boxe + Jiu-Jitsu';
    const freqLabel = freq === 'livre' ? 'Frequência Livre' : '3x por semana';
    enviarEmailAluno(email, nome, `🥊 Bem-vindo à Punch and Roll, ${nomeFirst}!`,
      `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif">
      <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;margin-top:24px;margin-bottom:24px">

        <!-- HEADER -->
        <div style="background:#d4111c;padding:32px 24px;text-align:center">
          <div style="font-size:40px;margin-bottom:8px">🥊</div>
          <h1 style="color:#ffffff;font-size:28px;letter-spacing:3px;margin:0;font-family:Arial,sans-serif">PUNCH AND ROLL</h1>
          <p style="color:rgba(255,255,255,.8);font-size:13px;margin:6px 0 0;letter-spacing:1px">FIGHT TEAM · SÃO JOSÉ, SC</p>
        </div>

        <!-- BOAS-VINDAS -->
        <div style="padding:32px 28px">
          <h2 style="color:#111;font-size:22px;margin:0 0 12px">Bem-vindo, ${nomeFirst}! 🎉</h2>
          <p style="color:#444;font-size:15px;line-height:1.7;margin:0 0 24px">
            Sua matrícula na <strong>Punch and Roll Fight Team</strong> foi recebida com sucesso! Estamos muito felizes em ter você na nossa equipe.
          </p>

          <!-- CARD DO PLANO -->
          <div style="background:#f9f9f9;border:1px solid #e5e5e5;border-radius:10px;padding:20px;margin-bottom:28px">
            <p style="color:#888;font-size:11px;letter-spacing:1px;text-transform:uppercase;margin:0 0 12px">SEU PLANO</p>
            <table style="width:100%;border-collapse:collapse">
              <tr>
                <td style="color:#555;font-size:13px;padding:6px 0;border-bottom:1px solid #eee">Modalidade</td>
                <td style="color:#111;font-size:13px;font-weight:bold;text-align:right;padding:6px 0;border-bottom:1px solid #eee">${modLabel}</td>
              </tr>
              <tr>
                <td style="color:#555;font-size:13px;padding:6px 0;border-bottom:1px solid #eee">Frequência</td>
                <td style="color:#111;font-size:13px;font-weight:bold;text-align:right;padding:6px 0;border-bottom:1px solid #eee">${freqLabel}</td>
              </tr>
              <tr>
                <td style="color:#555;font-size:13px;padding:6px 0;border-bottom:1px solid #eee">Plano</td>
                <td style="color:#111;font-size:13px;font-weight:bold;text-align:right;padding:6px 0;border-bottom:1px solid #eee">${plano || modalidade}</td>
              </tr>
              <tr>
                <td style="color:#555;font-size:13px;padding:8px 0 0">Mensalidade</td>
                <td style="color:#d4111c;font-size:16px;font-weight:bold;text-align:right;padding:8px 0 0">R$ ${Number(valor||0).toFixed(0)}/mês</td>
              </tr>
            </table>
          </div>

          <!-- CONTRATO -->
          <div style="background:#fff8f8;border:1px solid #ffd0d0;border-radius:10px;padding:20px;margin-bottom:28px">
            <p style="color:#111;font-size:15px;font-weight:bold;margin:0 0 8px">📋 Assine seu contrato</p>
            <p style="color:#555;font-size:13px;line-height:1.6;margin:0 0 20px">Para formalizar sua matrícula, assine digitalmente o contrato clicando no botão abaixo. Leva menos de 1 minuto.</p>
            <div style="text-align:center">
              <a href="${link}" style="background:#d4111c;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:15px;font-weight:bold;letter-spacing:1px;display:inline-block">ASSINAR CONTRATO</a>
            </div>
            <p style="color:#aaa;font-size:11px;text-align:center;margin:14px 0 0">Ou acesse: <a href="${link}" style="color:#d4111c">${link}</a></p>
          </div>

          <!-- ENDEREÇO -->
          <div style="border-top:1px solid #eee;padding-top:20px">
            <p style="color:#888;font-size:11px;letter-spacing:1px;text-transform:uppercase;margin:0 0 10px">ONDE NOS ENCONTRAR</p>
            <p style="color:#444;font-size:13px;line-height:1.6;margin:0">📍 R. Cel. Américo, 1157 · Sala 5 · Barreiros · São José, SC<br>💬 (48) 98463-9257<br>🌐 punchandroll.com.br</p>
          </div>
        </div>

        <!-- FOOTER -->
        <div style="background:#111;padding:20px 24px;text-align:center">
          <p style="color:#888;font-size:11px;margin:0">© 2026 Punch and Roll Fight Team · São José, SC</p>
        </div>

      </div>
      </body></html>`
    ).catch(() => {});
    res.json({ token });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/contratos/assinar/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'desconhecido';
    const [rows] = await db.query('SELECT id, assinado FROM contratos WHERE token=?', [token]);
    if (!rows.length) return res.status(404).json({ error: 'Contrato não encontrado' });
    if (rows[0].assinado) return res.json({ ok: true, already: true });
    await db.query('UPDATE contratos SET assinado=TRUE, assinado_em=NOW(), ip=? WHERE token=?', [ip, token]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/contratos/aluno/:aluno_id', auth, async (req, res) => {
  try {
    const id = req.user.tipo === 'aluno' ? req.user.id : req.params.aluno_id;
    const [rows] = await db.query(
      'SELECT id, token, plano, modalidade, valor, meses, freq, ip, assinado, assinado_em, criado_em FROM contratos WHERE aluno_id=? ORDER BY criado_em DESC',
      [id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/contratos/html/:token', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT contrato_html FROM contratos WHERE token=?', [req.params.token]);
    if (!rows.length) return res.status(404).send('<h1>Contrato não encontrado</h1>');
    res.type('html').send(rows[0].contrato_html);
  } catch (e) { res.status(500).send('<h1>Erro interno</h1>'); }
});

// ══════════════════════════════════════
// DOCUMENTOS
// ══════════════════════════════════════
app.post('/api/documentos', auth, (req, res) => {
  if (req.user.tipo !== 'admin' && req.user.tipo !== 'master') return res.status(403).json({ error: 'Acesso negado' });
  upload.single('arquivo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      const nome = req.body?.nome || req.body?.get?.('nome');
      const categoria = req.body?.categoria || req.body?.get?.('categoria') || 'outro';
      const file = req.file;
      if (!nome) return res.status(400).json({ error: 'Nome obrigatório' });
      if (!file) return res.status(400).json({ error: 'Arquivo obrigatório' });
      await db.query(
        'INSERT INTO documentos (nome, categoria, extensao, tamanho, mimetype, arquivo, visivel) VALUES (?,?,?,?,?,?,1)',
        [nome, categoria, file.originalname.split('.').pop(), file.size, file.mimetype, file.buffer]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
});

app.get('/api/documentos', auth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id, nome, categoria, extensao, tamanho, mimetype, criado_em FROM documentos WHERE visivel=1 ORDER BY criado_em DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/documentos/:id/download', auth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT nome, extensao, mimetype, arquivo FROM documentos WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
    const doc = rows[0];
    await db.query('UPDATE documentos SET downloads=downloads+1 WHERE id=?', [req.params.id]);
    res.setHeader('Content-Type', doc.mimetype || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${doc.nome}.${doc.extensao}"`);
    res.send(doc.arquivo);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/documentos/:id', auth, async (req, res) => {
  try {
    if (req.user.tipo !== 'admin' && req.user.tipo !== 'master') return res.status(403).json({ error: 'Acesso negado' });
    await db.query('UPDATE documentos SET visivel=0 WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/contratos/meta/:token', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT assinado, assinado_em, plano, modalidade, criado_em FROM contratos WHERE token=?', [req.params.token]);
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// START
// ══════════════════════════════════════
const PORT = process.env.PORT || 3000;
setupDB().then(() => {
  app.listen(PORT, () => console.log(`🥊 Punch and Roll API rodando na porta ${PORT}`));
}).catch(e => {
  console.error('Erro ao configurar banco:', e.message);
  process.exit(1);
});
