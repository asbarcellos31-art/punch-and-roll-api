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
app.use(express.json({ limit: '20mb' }));
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
    try { await conn.query("ALTER TABLE alunos ADD COLUMN cortesia TINYINT DEFAULT 0"); } catch(e){}
    try { await conn.query("ALTER TABLE alunos ADD COLUMN cortesia_motivo VARCHAR(300)"); } catch(e){}
    try { await conn.query("ALTER TABLE documentos ADD COLUMN categoria VARCHAR(50) DEFAULT 'outro'"); } catch(e){}
    try { await conn.query("ALTER TABLE documentos ADD COLUMN arquivo LONGBLOB"); } catch(e){}
    try { await conn.query("ALTER TABLE documentos ADD COLUMN mimetype VARCHAR(100)"); } catch(e){}
    try { await conn.query("ALTER TABLE documentos ADD COLUMN aluno_id INT NULL"); } catch(e){}

    await conn.query(`
      CREATE TABLE IF NOT EXISTS lista_espera (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nome VARCHAR(120) NOT NULL,
        tel VARCHAR(30),
        modalidade VARCHAR(30),
        dia_sugerido VARCHAR(20),
        hora_sugerida VARCHAR(10),
        obs TEXT,
        status VARCHAR(20) DEFAULT 'pendente',
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS avisos_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        aluno_id INT NOT NULL,
        tipo VARCHAR(20),
        dias INT,
        enviado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX (aluno_id, dias, enviado_em)
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

    // ── SHOP ──────────────────────────────────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS shop_produtos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nome VARCHAR(200) NOT NULL,
        descricao TEXT,
        preco DECIMAL(10,2) NOT NULL DEFAULT 0,
        categoria VARCHAR(50) DEFAULT 'outro',
        imagem_url TEXT,
        estoque INT DEFAULT 0,
        ativo TINYINT DEFAULT 1,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS shop_pedidos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        aluno_id INT NULL,
        nome_comprador VARCHAR(200),
        tel VARCHAR(30),
        status VARCHAR(30) DEFAULT 'novo',
        total DECIMAL(10,2) DEFAULT 0,
        obs TEXT,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS shop_pedido_itens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        pedido_id INT NOT NULL,
        produto_id INT NOT NULL,
        nome_produto VARCHAR(200),
        preco_unitario DECIMAL(10,2),
        qtd INT DEFAULT 1,
        FOREIGN KEY (pedido_id) REFERENCES shop_pedidos(id) ON DELETE CASCADE
      )
    `);

    // ── WhatsApp MKT Tables ──
    await conn.query(`
      CREATE TABLE IF NOT EXISTS wa_listas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nome VARCHAR(255) NOT NULL,
        descricao TEXT,
        total_contatos INT DEFAULT 0,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS wa_contatos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        lista_id INT NOT NULL,
        nome VARCHAR(255) NOT NULL,
        telefone VARCHAR(30) NOT NULL,
        cpf VARCHAR(20),
        dados_extras TEXT,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS wa_campanhas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nome VARCHAR(255) NOT NULL,
        mensagem TEXT NOT NULL,
        lista_id INT,
        segmento VARCHAR(50),
        status VARCHAR(30) DEFAULT 'RASCUNHO',
        total_destinatarios INT DEFAULT 0,
        total_enviados INT DEFAULT 0,
        total_erros INT DEFAULT 0,
        intervalo_ms INT DEFAULT 3000,
        media_url VARCHAR(1000),
        media_type VARCHAR(20),
        instancia VARCHAR(50) DEFAULT 'punchandroll',
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS wa_envios (
        id INT AUTO_INCREMENT PRIMARY KEY,
        campanha_id INT,
        nome VARCHAR(255),
        telefone VARCHAR(30) NOT NULL,
        mensagem TEXT NOT NULL,
        tipo VARCHAR(50) DEFAULT 'CAMPANHA',
        status VARCHAR(50) DEFAULT 'PENDENTE',
        erro TEXT,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS wa_config (
        chave VARCHAR(100) PRIMARY KEY,
        valor TEXT,
        atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    // Colunas extras para wa_campanhas (migration compatível MySQL 5.7+)
    const dbName = new URL(process.env.DATABASE_URL).pathname.replace('/','');
    const waCols = [
      ['pausada',           'TINYINT(1) DEFAULT 0'],
      ['data_agendada',     'DATETIME DEFAULT NULL'],
      ['limite_diario',     'INT DEFAULT 0'],
      ['enviados_hoje',     'INT DEFAULT 0'],
      ['data_ultimo_envio', 'DATETIME DEFAULT NULL'],
      ['data_inicio',       'DATETIME DEFAULT NULL'],
      ['data_conclusao',    'DATETIME DEFAULT NULL'],
    ];
    for (const [col, def] of waCols) {
      const [rows] = await conn.query(
        `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='wa_campanhas' AND COLUMN_NAME=?`,
        [dbName, col]
      );
      if (!rows.length) await conn.query(`ALTER TABLE wa_campanhas ADD COLUMN ${col} ${def}`);
    }
    // Garante que media_url suporte base64 (MEDIUMTEXT)
    await conn.query(`ALTER TABLE wa_campanhas MODIFY COLUMN media_url MEDIUMTEXT`).catch(()=>{});

    // Config padrão de aniversário
    await conn.query(`
      INSERT IGNORE INTO wa_config (chave, valor) VALUES
      ('aniversario_ativo', '1'),
      ('aniversario_horario', '08:00'),
      ('aniversario_template', '🥊 Feliz Aniversário, {{nome}}! 🎂\n\nA família Punch and Roll Fight Team deseja um dia muito especial para você!\n\nContinue na luta e nos vemos na academia! 💪\n\n— Punch and Roll Fight Team 🥊'),
      ('atrasados_ativo', '0'),
      ('atrasados_template', 'Olá, {{nome}}! 🥊\n\nIdentificamos que sua mensalidade da *Punch and Roll* está em atraso.\n\nPara manter seu acesso à academia, regularize sua situação:\n📱 (48) 98463-9257\n\nPunch and Roll Fight Team')
    `);


    // ── Email MKT Tables ──────────────────────────────────────────────────────
    await conn.query(`CREATE TABLE IF NOT EXISTS email_templates (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(200) NOT NULL,
      assunto VARCHAR(300) NOT NULL,
      saudacao VARCHAR(200) DEFAULT 'Olá, {{nome}}!',
      corpo MEDIUMTEXT,
      assinatura VARCHAR(500) DEFAULT 'Punch and Roll Fight Team',
      cor_cabecalho VARCHAR(20) DEFAULT '#d4111c',
      ativo TINYINT(1) DEFAULT 1,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    // migrations (MySQL 5.7 compat)
    const [_etchk] = await conn.query(`SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='email_templates' AND COLUMN_NAME='cor_cabecalho'`);
    if(!_etchk.length) await conn.query(`ALTER TABLE email_templates ADD COLUMN cor_cabecalho VARCHAR(20) DEFAULT '#d4111c'`);
    const [_etfk] = await conn.query(`SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='email_templates' AND COLUMN_NAME='cor_fundo_cab'`);
    if(!_etfk.length) await conn.query(`ALTER TABLE email_templates ADD COLUMN cor_fundo_cab VARCHAR(20) DEFAULT '#ffffff'`);
    await conn.query(`CREATE TABLE IF NOT EXISTS email_listas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(200) NOT NULL,
      descricao VARCHAR(500),
      total_contatos INT DEFAULT 0,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS email_contatos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      lista_id INT NOT NULL,
      nome VARCHAR(200),
      email VARCHAR(300) NOT NULL,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lista_id) REFERENCES email_listas(id) ON DELETE CASCADE
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS email_campanhas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(200) NOT NULL,
      template_id INT,
      lista_id INT,
      segmento VARCHAR(50),
      assunto_override VARCHAR(300),
      remetente VARCHAR(200),
      nome_remetente VARCHAR(200),
      status ENUM('RASCUNHO','AGENDADA','ENVIANDO','CONCLUIDA','CANCELADA') DEFAULT 'RASCUNHO',
      total_destinatarios INT DEFAULT 0,
      total_enviados INT DEFAULT 0,
      total_erros INT DEFAULT 0,
      aberturas INT DEFAULT 0,
      data_agendada DATETIME,
      data_inicio DATETIME,
      data_conclusao DATETIME,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (template_id) REFERENCES email_templates(id) ON DELETE SET NULL,
      FOREIGN KEY (lista_id) REFERENCES email_listas(id) ON DELETE SET NULL
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS email_envios (
      id INT AUTO_INCREMENT PRIMARY KEY,
      campanha_id INT,
      contato_nome VARCHAR(200),
      contato_email VARCHAR(300),
      tipo ENUM('CAMPANHA','ANIVERSARIO','VENCENDO','INDIVIDUAL') DEFAULT 'CAMPANHA',
      status ENUM('ENVIADO','ERRO') DEFAULT 'ENVIADO',
      erro_msg TEXT,
      aberturas INT DEFAULT 0,
      aberto_em DATETIME,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (campanha_id) REFERENCES email_campanhas(id) ON DELETE SET NULL
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS email_automacoes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tipo ENUM('ANIVERSARIO','VENCENDO') NOT NULL,
      nome VARCHAR(200),
      template_id INT,
      ativo TINYINT(1) DEFAULT 0,
      horario VARCHAR(5) DEFAULT '08:00',
      ultimo_disparo DATE,
      FOREIGN KEY (template_id) REFERENCES email_templates(id) ON DELETE SET NULL
    )`);
    await conn.query(`INSERT IGNORE INTO email_automacoes (tipo,nome,ativo,horario) VALUES
      ('ANIVERSARIO','Parabéns Aniversariantes',0,'09:00'),
      ('VENCENDO','Alerta Mensalidade Vencendo',0,'09:00')`);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS login_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tipo VARCHAR(20),
        user_id INT,
        nome VARCHAR(200),
        email VARCHAR(200),
        ip VARCHAR(60),
        user_agent TEXT,
        logado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX (logado_em)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS page_views (
        id INT AUTO_INCREMENT PRIMARY KEY,
        pagina VARCHAR(100),
        ip VARCHAR(60),
        user_agent TEXT,
        referrer TEXT,
        visto_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX (visto_em),
        INDEX (pagina)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS welcome_pending (
        id INT AUTO_INCREMENT PRIMARY KEY,
        aluno_id INT NOT NULL,
        token VARCHAR(64) UNIQUE NOT NULL,
        nome VARCHAR(200),
        email VARCHAR(200),
        tel VARCHAR(30),
        plano VARCHAR(200),
        valor DECIMAL(10,2),
        modalidade VARCHAR(30),
        status VARCHAR(20) DEFAULT 'pendente',
        enviado_em DATETIME NULL,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

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
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
    db.query('INSERT INTO login_log (tipo,user_id,nome,email,ip,user_agent) VALUES (?,?,?,?,?,?)',
      ['admin', rows[0].id, rows[0].nome, rows[0].email, ip, req.headers['user-agent'] || '']).catch(()=>{});
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
    const ipA = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
    db.query('INSERT INTO login_log (tipo,user_id,nome,email,ip,user_agent) VALUES (?,?,?,?,?,?)',
      ['aluno', aluno.id, aluno.nome, aluno.email || '', ipA, req.headers['user-agent'] || '']).catch(()=>{});
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

// Aluno solicita mudança de plano
app.post('/api/alunos/me/solicitar-plano', auth, async (req, res) => {
  try {
    if (req.user.tipo !== 'aluno') return res.status(403).json({ error: 'Acesso negado' });
    const { plano_nome, plano_valor } = req.body;
    if (!plano_nome) return res.status(400).json({ error: 'Plano não informado' });
    const [rows] = await db.query('SELECT nome, tel, plano FROM alunos WHERE id=?', [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Aluno não encontrado' });
    const a = rows[0];
    const adminTel = process.env.ADMIN_TEL || '';
    if (adminTel) {
      await notificarWA(adminTel,
        `📋 *Solicitação de Mudança de Plano*\n\n👤 Aluno: ${a.nome}\n📞 Tel: ${a.tel||'—'}\n\n📌 Plano atual: ${a.plano||'—'}\n✅ Plano desejado: ${plano_nome}${plano_valor?' (R$ '+plano_valor+'/mês)':''}\n\nAcesse o admin para aplicar a mudança.`
      ).catch(()=>{});
    }
    res.json({ ok: true });
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
    const cortesia = d.cortesia ? 1 : 0;
    const cortesiaMotivo = d.cortesia_motivo || null;
    const nd = (v) => v || null; // datas/strings vazias viram NULL
    await db.query(`
      UPDATE alunos SET nome=?,cpf=?,nasc=?,sexo=?,tel=?,email=?,endereco=?,cidade=?,cep=?,
      emerg_nome=?,emerg_tel=?,parentesco=?,saude=?,alergia=?,modalidade=?,nivel=?,
      plano_id=?,plano=?,valor=?,inicio=?,vencimento=?,pagto=?,aulas_liberadas=?,obs=?,status=?,
      cortesia=?,cortesia_motivo=?
      WHERE id=?
    `, [d.nome,nd(d.cpf),nd(d.nasc),nd(d.sexo),d.tel,nd(d.email),nd(d.end),d.cidade||'São José',nd(d.cep),nd(d.emergNome),nd(d.emergTel),nd(d.parentesco),nd(d.saude),nd(d.alergia),d.modalidade,d.nivel||'iniciante',nd(d.planoId),nd(d.plano),d.valor||0,nd(d.inicio),nd(d.venc),d.pagto||'pix',JSON.stringify(d.aulasLiberadas||[]),nd(d.obs),d.status||'ativo',cortesia,cortesiaMotivo,req.params.id]);
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
    const alunoId = result.insertId;

    // Notifica admin no WA
    await notificarWA(process.env.WA_ADMIN_NUM||'554898463-9257',`🥊 *Nova Matrícula!*\n\n*Aluno:* ${d.nome}\n*Plano:* ${d.plano}\n*Pagamento:* ${d.payMethod}\n*WhatsApp:* ${d.tel}`);

    // Dispara boas-vindas automaticamente (modelo aprovado)
    const wpToken = require('crypto').randomBytes(24).toString('hex');
    await db.query(
      'INSERT INTO welcome_pending (aluno_id,token,nome,email,tel,plano,valor,modalidade) VALUES (?,?,?,?,?,?,?,?)',
      [alunoId, wpToken, d.nome, d.email, d.tel, d.plano, d.valor||0, d.modalidade]
    );
    dispararBoasVindas(wpToken).catch(e => console.error('Boas-vindas error:', e.message));

    res.json({ id: alunoId, message: 'Matrícula recebida!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════
// AULAS
// ══════════════════════════════════════
// Lista de espera — público
app.post('/api/lista-espera', async (req, res) => {
  try {
    const { nome, tel, modalidade, dia_sugerido, hora_sugerida, obs } = req.body;
    if (!nome) return res.status(400).json({ error: 'Nome obrigatório' });
    await db.query(
      'INSERT INTO lista_espera (nome, tel, modalidade, dia_sugerido, hora_sugerida, obs) VALUES (?,?,?,?,?,?)',
      [nome, tel||null, modalidade||null, dia_sugerido||null, hora_sugerida||null, obs||null]
    );
    // Notifica admin no WhatsApp
    const modLabel = { boxe:'🥊 Boxe', jiujitsu:'🟦 Jiu-Jitsu', ambos:'🥊🟦 Ambos' };
    const msg = `📋 *Nova entrada na Lista de Espera*\n\n👤 ${nome}${tel ? '\n📱 ' + tel : ''}\n${modalidade ? '🏋️ ' + (modLabel[modalidade]||modalidade) : ''}${dia_sugerido ? '\n📅 ' + dia_sugerido + (hora_sugerida ? ' às ' + hora_sugerida : '') : ''}${obs ? '\n💬 ' + obs : ''}\n\nAcesse o admin para gerenciar.`;
    if (process.env.ADMIN_TEL) notificarWA(process.env.ADMIN_TEL, msg).catch(()=>{});
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/lista-espera', auth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM lista_espera ORDER BY criado_em DESC');
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/lista-espera/:id/status', auth, async (req, res) => {
  try {
    await db.query('UPDATE lista_espera SET status=? WHERE id=?', [req.body.status, req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

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

app.delete('/api/checkins/:id', auth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM checkins WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Check-in não encontrado' });
    const ck = rows[0];
    // Aluno só pode cancelar o próprio check-in e apenas no mesmo dia
    if (req.user.tipo === 'aluno') {
      if (Number(ck.aluno_id) !== Number(req.user.id)) return res.status(403).json({ error: 'Acesso negado' });
      const hoje = new Date().toISOString().split('T')[0];
      const dtCk = ck.data_checkin instanceof Date ? ck.data_checkin.toISOString().split('T')[0] : String(ck.data_checkin).split('T')[0];
      if (dtCk !== hoje) return res.status(400).json({ error: 'Só é possível cancelar check-in do dia atual' });
    }
    await db.query('DELETE FROM checkins WHERE id=?', [req.params.id]);
    res.json({ ok: true });
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
    const [[ativos]]    = await db.query("SELECT COUNT(*) as n FROM alunos WHERE status='ativo'    AND (cortesia IS NULL OR cortesia=0)");
    const [[atrasados]] = await db.query("SELECT COUNT(*) as n FROM alunos WHERE status='atrasado' AND (cortesia IS NULL OR cortesia=0)");
    const [[vencendo]]  = await db.query("SELECT COUNT(*) as n FROM alunos WHERE status='vencendo' AND (cortesia IS NULL OR cortesia=0)");
    const [[cortesias]] = await db.query("SELECT COUNT(*) as n FROM alunos WHERE cortesia=1");
    const [[receitaMes]] = await db.query("SELECT COALESCE(SUM(valor),0) as total FROM pagamentos WHERE status='pago' AND MONTH(data_pagamento)=MONTH(NOW()) AND YEAR(data_pagamento)=YEAR(NOW())");
    const [[checkinsHoje]] = await db.query("SELECT COUNT(*) as n FROM checkins WHERE data_checkin=CURDATE()");
    res.json({
      alunos: {
        ativos: ativos.n, atrasados: atrasados.n, vencendo: vencendo.n,
        total: ativos.n + atrasados.n + vencendo.n,
        cortesias: cortesias.n,
        pagantes: ativos.n + atrasados.n + vencendo.n,
      },
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
  const url      = process.env.WA_EVOLUTION_URL || process.env.WA_API_URL;
  const instance = process.env.WA_EVOLUTION_INSTANCE || '';
  const key      = process.env.WA_EVOLUTION_KEY || process.env.WA_API_KEY;
  if (!url || !key) return;
  try {
    const num     = '55' + tel.replace(/\D/g,'');
    const apiUrl  = instance ? `${url}/message/sendText/${instance}` : url;
    await axios.post(apiUrl, { number: num, text: msg }, { headers: { 'apikey': key, 'Content-Type': 'application/json' } });
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
// WHATSAPP MKT — Helper
// ══════════════════════════════════════
function formatarTelWA(tel) {
  let d = String(tel||'').replace(/\D/g,'');
  if (d.startsWith('55') && d.length > 11) d = d.slice(2);
  if (d.length >= 12) { const ddd=d.slice(0,2); const r=d.slice(2); if(r.startsWith(ddd)) d=r; }
  if (d.length === 10) d = d.slice(0,2)+'9'+d.slice(2);
  return '55'+d;
}

async function enviarWA(tel, msg, instancia) {
  const evoUrl = process.env.WA_EVOLUTION_URL;
  const evoKey = process.env.WA_EVOLUTION_KEY;
  const inst = instancia || process.env.WA_EVOLUTION_INSTANCE || 'punchandroll';
  if (!evoUrl || !evoKey) return { sucesso: false, erro: 'Evolution não configurado' };
  const numero = formatarTelWA(tel);
  if (numero.length < 12) return { sucesso: false, erro: `Número inválido: ${tel}` };
  try {
    await axios.post(`${evoUrl}/message/sendText/${inst}`,
      { number: numero, text: msg, delay: 1500 },
      { headers: { apikey: evoKey, 'Content-Type': 'application/json' }, timeout: 30000 }
    );
    return { sucesso: true };
  } catch(e) {
    return { sucesso: false, erro: e.response?.data?.message || e.message };
  }
}

async function enviarMidiaWA(tel, mediaUrl, mediaType, caption, instancia) {
  const evoUrl = process.env.WA_EVOLUTION_URL;
  const evoKey = process.env.WA_EVOLUTION_KEY;
  const inst = instancia || process.env.WA_EVOLUTION_INSTANCE || 'punchandroll';
  if (!evoUrl || !evoKey) return { sucesso: false, erro: 'Evolution não configurado' };
  const numero = formatarTelWA(tel);
  if (numero.length < 12) return { sucesso: false, erro: `Número inválido: ${tel}` };
  try {
    // suporta base64 data URI ou URL externa
    const isBase64 = mediaUrl.startsWith('data:');
    const media = isBase64 ? mediaUrl.replace(/^data:[^;]+;base64,/, '') : mediaUrl;
    const mimeMap = { image: 'image/jpeg', video: 'video/mp4', document: 'application/pdf' };
    const mimetype = isBase64 ? (mediaUrl.match(/^data:([^;]+);/)||[])[1] || mimeMap[mediaType] : mimeMap[mediaType];
    await axios.post(`${evoUrl}/message/sendMedia/${inst}`,
      { number: numero, mediatype: mediaType, mimetype, media, caption: caption||'' },
      { headers: { apikey: evoKey, 'Content-Type': 'application/json' }, timeout: 60000 }
    );
    return { sucesso: true };
  } catch(e) {
    return { sucesso: false, erro: e.response?.data?.message || e.message };
  }
}

// ── Aniversariantes ──────────────────────────────────────────────────────────
app.get('/api/wa/aniversariantes', auth, adminOnly, async (req, res) => {
  try {
    const { mes, dia } = req.query;
    const hoje = new Date();
    const m = mes ? parseInt(mes) : hoje.getMonth()+1;
    const d = dia ? parseInt(dia) : null;
    let q = `SELECT id, nome, tel, nasc, status, modalidade FROM alunos WHERE nasc IS NOT NULL AND MONTH(nasc)=?`;
    const p = [m];
    if (d) { q += ' AND DAY(nasc)=?'; p.push(d); }
    q += ' ORDER BY DAY(nasc), nome';
    const [rows] = await db.query(q, p);
    res.json(rows.map(r => ({...r, dia: new Date(r.nasc).getDate()})));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/wa/aniversariantes/disparar', auth, adminOnly, async (req, res) => {
  try {
    const { ids } = req.body;
    const [[cfgRow]] = await db.query("SELECT valor FROM wa_config WHERE chave='aniversario_template'");
    const template = cfgRow?.valor || '🥊 Feliz Aniversário, {{nome}}! A família Punch and Roll te deseja um dia incrível! 💪';
    const [alunos] = await db.query(ids?.length ? `SELECT id,nome,tel FROM alunos WHERE id IN (${ids.map(()=>'?').join(',')})` : 'SELECT id,nome,tel FROM alunos WHERE nasc IS NOT NULL AND MONTH(nasc)=MONTH(CURDATE()) AND DAY(nasc)=DAY(CURDATE())', ids?.length ? ids : []);
    let enviados=0, erros=0;
    for (const a of alunos) {
      if (!a.tel) { erros++; continue; }
      const msg = template.replace(/\{\{nome\}\}/g, a.nome.split(' ')[0]);
      const r = await enviarWA(a.tel, msg);
      await db.query('INSERT INTO wa_envios (nome,telefone,mensagem,tipo,status,erro) VALUES (?,?,?,?,?,?)',
        [a.nome, a.tel, msg, 'ANIVERSARIO', r.sucesso?'ENVIADO':'ERRO', r.erro||null]);
      if (r.sucesso) enviados++; else erros++;
      await new Promise(x=>setTimeout(x,2000));
    }
    res.json({ enviados, erros });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Listas ───────────────────────────────────────────────────────────────────
app.get('/api/wa/listas', auth, adminOnly, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM wa_listas ORDER BY criado_em DESC');
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/wa/listas', auth, adminOnly, async (req, res) => {
  try {
    const { nome, descricao } = req.body;
    const [r] = await db.query('INSERT INTO wa_listas (nome,descricao) VALUES (?,?)',[nome,descricao||null]);
    res.json({ id: r.insertId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/wa/listas/:id', auth, adminOnly, async (req, res) => {
  try {
    await db.query('DELETE FROM wa_contatos WHERE lista_id=?',[req.params.id]);
    await db.query('DELETE FROM wa_listas WHERE id=?',[req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/wa/listas/:id/contatos', auth, adminOnly, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM wa_contatos WHERE lista_id=? ORDER BY nome',[req.params.id]);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/wa/listas/:id/contatos', auth, adminOnly, async (req, res) => {
  try {
    const { nome, telefone, cpf } = req.body;
    const [r] = await db.query('INSERT INTO wa_contatos (lista_id,nome,telefone,cpf) VALUES (?,?,?,?)',[req.params.id,nome,telefone,cpf||null]);
    await db.query('UPDATE wa_listas SET total_contatos=(SELECT COUNT(*) FROM wa_contatos WHERE lista_id=?) WHERE id=?',[req.params.id,req.params.id]);
    res.json({ id: r.insertId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/wa/contatos/:id', auth, adminOnly, async (req, res) => {
  try {
    const [[c]] = await db.query('SELECT lista_id FROM wa_contatos WHERE id=?',[req.params.id]);
    await db.query('DELETE FROM wa_contatos WHERE id=?',[req.params.id]);
    if (c) await db.query('UPDATE wa_listas SET total_contatos=(SELECT COUNT(*) FROM wa_contatos WHERE lista_id=?) WHERE id=?',[c.lista_id,c.lista_id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Upload CSV/XLSX para lista
app.post('/api/wa/listas/:id/upload', auth, adminOnly, upload.single('arquivo'), async (req, res) => {
  try {
    const listaId = req.params.id;
    const XLSX = require('xlsx');
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    let inseridos = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const nome = String(row[0]||'').trim();
      const tel = String(row[1]||'').trim();
      const cpf = String(row[2]||'').trim();
      if (!nome || !tel) continue;
      await db.query('INSERT IGNORE INTO wa_contatos (lista_id,nome,telefone,cpf) VALUES (?,?,?,?)',[listaId,nome,tel,cpf||null]);
      inseridos++;
    }
    await db.query('UPDATE wa_listas SET total_contatos=(SELECT COUNT(*) FROM wa_contatos WHERE lista_id=?) WHERE id=?',[listaId,listaId]);
    res.json({ inseridos });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Campanhas ────────────────────────────────────────────────────────────────
app.get('/api/wa/campanhas', auth, adminOnly, async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT c.*, l.nome as lista_nome FROM wa_campanhas c LEFT JOIN wa_listas l ON c.lista_id=l.id ORDER BY c.criado_em DESC`);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/wa/campanhas', auth, adminOnly, async (req, res) => {
  try {
    const { nome, mensagem, lista_id, segmento, intervalo_ms, media_url, media_type, data_agendada, limite_diario, instancia } = req.body;
    const status = data_agendada ? 'AGENDADA' : 'RASCUNHO';
    const [r] = await db.query(
      'INSERT INTO wa_campanhas (nome,mensagem,lista_id,segmento,intervalo_ms,media_url,media_type,data_agendada,limite_diario,instancia,status) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [nome,mensagem,lista_id||null,segmento||null,intervalo_ms||3000,media_url||null,media_type||null,data_agendada||null,limite_diario||0,instancia||'punchandroll',status]);
    res.json({ id: r.insertId, status });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/wa/campanhas/:id', auth, adminOnly, async (req, res) => {
  try {
    const { nome, mensagem, lista_id, segmento, intervalo_ms, media_url, media_type, data_agendada, limite_diario, instancia } = req.body;
    const status = data_agendada ? 'AGENDADA' : 'RASCUNHO';
    await db.query(
      'UPDATE wa_campanhas SET nome=?,mensagem=?,lista_id=?,segmento=?,intervalo_ms=?,media_url=?,media_type=?,data_agendada=?,limite_diario=?,instancia=?,status=? WHERE id=?',
      [nome,mensagem,lista_id||null,segmento||null,intervalo_ms||3000,media_url||null,media_type||null,data_agendada||null,limite_diario||0,instancia||'punchandroll',status,req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/wa/campanhas/:id', auth, adminOnly, async (req, res) => {
  try {
    await db.query('DELETE FROM wa_envios WHERE campanha_id=?',[req.params.id]);
    await db.query('DELETE FROM wa_campanhas WHERE id=?',[req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Disparar campanha
const campanhasEmExecucao = new Set();
app.post('/api/wa/campanhas/:id/disparar', auth, adminOnly, async (req, res) => {
  const id = parseInt(req.params.id);
  if (campanhasEmExecucao.has(id)) return res.status(400).json({ error: 'Campanha já em execução' });
  try {
    const [[camp]] = await db.query('SELECT * FROM wa_campanhas WHERE id=?',[id]);
    if (!camp) return res.status(404).json({ error: 'Campanha não encontrada' });

    let destinatarios = [];
    if (camp.lista_id) {
      const [rows] = await db.query('SELECT nome,telefone FROM wa_contatos WHERE lista_id=?',[camp.lista_id]);
      destinatarios = rows;
    } else if (camp.segmento) {
      let q = 'SELECT nome,tel as telefone FROM alunos WHERE tel IS NOT NULL AND tel != ""';
      if (camp.segmento==='atrasados') q+=" AND status='atrasado'";
      else if (camp.segmento==='vencendo') q+=" AND status='vencendo'";
      else if (camp.segmento==='ativos') q+=" AND status='ativo'";
      const [rows] = await db.query(q);
      destinatarios = rows;
    }

    if (destinatarios.length === 0) return res.status(400).json({ error: 'Nenhum destinatário encontrado.' });

    await db.query('UPDATE wa_campanhas SET status=?,total_destinatarios=?,total_enviados=0,total_erros=0,data_inicio=NOW(),pausada=0 WHERE id=?',['ENVIANDO',destinatarios.length,id]);
    res.json({ ok: true, total: destinatarios.length });

    campanhasEmExecucao.add(id);
    (async () => {
      let enviados=0, erros=0, enviados_hoje=0;
      const hoje = new Date();
      for (const d of destinatarios) {
        const [[c]] = await db.query('SELECT * FROM wa_campanhas WHERE id=?',[id]);
        if (!c || c.status==='CANCELADA') break;
        if (c.pausada) {
          await db.query("UPDATE wa_campanhas SET status='AGENDADA' WHERE id=?",[id]);
          break;
        }
        // Limite diário
        if (c.limite_diario && c.limite_diario > 0) {
          const isMesmaData = c.data_ultimo_envio && new Date(c.data_ultimo_envio).toDateString() === hoje.toDateString();
          enviados_hoje = isMesmaData ? (c.enviados_hoje || 0) : 0;
          if (enviados_hoje >= c.limite_diario) {
            const amanha = new Date(); amanha.setDate(amanha.getDate()+1); amanha.setHours(8,0,0,0);
            await db.query('UPDATE wa_campanhas SET status=?,data_agendada=?,total_enviados=?,total_erros=? WHERE id=?',['AGENDADA',amanha,enviados,erros,id]);
            break;
          }
        }
        const msg = camp.mensagem.replace(/\{\{nome\}\}/gi, d.nome?.split(' ')[0]||d.nome||'');
        let resultado;
        if (camp.media_url && camp.media_type) {
          resultado = await enviarMidiaWA(d.telefone, camp.media_url, camp.media_type, msg, camp.instancia||'punchandroll');
        } else {
          resultado = await enviarWA(d.telefone, msg, camp.instancia||'punchandroll');
        }
        await db.query('INSERT INTO wa_envios (campanha_id,nome,telefone,mensagem,tipo,status,erro) VALUES (?,?,?,?,?,?,?)',
          [id,d.nome,d.telefone,msg,'CAMPANHA',resultado.sucesso?'ENVIADO':'ERRO',resultado.erro||null]);
        if (resultado.sucesso) { enviados++; enviados_hoje++; }
        else erros++;
        await db.query('UPDATE wa_campanhas SET total_enviados=?,total_erros=?,enviados_hoje=?,data_ultimo_envio=NOW() WHERE id=?',[enviados,erros,enviados_hoje,id]);
        await new Promise(x=>setTimeout(x,c.intervalo_ms||3000));
      }
      const [[final]] = await db.query('SELECT status FROM wa_campanhas WHERE id=?',[id]);
      if (final && final.status==='ENVIANDO') await db.query('UPDATE wa_campanhas SET status=?,data_conclusao=NOW() WHERE id=?',['CONCLUIDA',id]);
      campanhasEmExecucao.delete(id);
    })().catch(e=>{ console.error('Campanha erro:',e.message); campanhasEmExecucao.delete(id); });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/wa/campanhas/:id/pausar', auth, adminOnly, async (req, res) => {
  try {
    await db.query('UPDATE wa_campanhas SET pausada=1 WHERE id=?',[req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/wa/campanhas/:id/retomar', auth, adminOnly, async (req, res) => {
  try {
    await db.query('UPDATE wa_campanhas SET pausada=0 WHERE id=?',[req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/wa/campanhas/:id/cancelar', auth, adminOnly, async (req, res) => {
  try {
    await db.query("UPDATE wa_campanhas SET status='CANCELADA' WHERE id=?",[req.params.id]);
    campanhasEmExecucao.delete(parseInt(req.params.id));
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Importar alunos para lista ────────────────────────────────────────────────
app.post('/api/wa/listas/:id/importar-base', auth, adminOnly, async (req, res) => {
  try {
    const listaId = req.params.id;
    const { modalidade, status_aluno } = req.body;
    let q = 'SELECT nome,tel,cpf FROM alunos WHERE tel IS NOT NULL AND tel != ""';
    if (modalidade && modalidade !== 'todos') { q += ' AND modalidade=?'; }
    if (status_aluno && status_aluno !== 'todos') { q += ` AND status='${status_aluno}'`; }
    const params = [];
    if (modalidade && modalidade !== 'todos') params.push(modalidade);
    const [alunos] = await db.query(q, params);
    let importados = 0;
    for (const a of alunos) {
      if (!a.tel) continue;
      try {
        await db.query('INSERT IGNORE INTO wa_contatos (lista_id,nome,telefone,cpf) VALUES (?,?,?,?)',
          [listaId, a.nome, formatarTelWA(a.tel), a.cpf||null]);
        importados++;
      } catch(_) {}
    }
    await db.query('UPDATE wa_listas SET total_contatos=(SELECT COUNT(*) FROM wa_contatos WHERE lista_id=?) WHERE id=?',[listaId,listaId]);
    res.json({ importados });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Preview count alunos para importar
app.get('/api/wa/listas/preview-base', auth, adminOnly, async (req, res) => {
  try {
    const { modalidade, status_aluno } = req.query;
    let q = 'SELECT COUNT(*) as total FROM alunos WHERE tel IS NOT NULL AND tel != ""';
    const params = [];
    if (modalidade && modalidade !== 'todos') { q += ' AND modalidade=?'; params.push(modalidade); }
    if (status_aluno && status_aluno !== 'todos') { q += ` AND status='${status_aluno}'`; }
    const [[row]] = await db.query(q, params);
    res.json({ total: row.total });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Envio individual ──────────────────────────────────────────────────────────
app.post('/api/wa/enviar-individual', auth, adminOnly, async (req, res) => {
  try {
    const { nome, telefone, mensagem, instancia } = req.body;
    if (!telefone || !mensagem) return res.status(400).json({ error: 'telefone e mensagem obrigatórios' });
    const resultado = await enviarWA(telefone, mensagem, instancia||'punchandroll');
    await db.query('INSERT INTO wa_envios (nome,telefone,mensagem,tipo,status,erro) VALUES (?,?,?,?,?,?)',
      [nome||null, formatarTelWA(telefone), mensagem, 'INDIVIDUAL', resultado.sucesso?'ENVIADO':'ERRO', resultado.erro||null]);
    if (!resultado.sucesso) return res.status(500).json({ error: resultado.erro });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Histórico de envios ───────────────────────────────────────────────────────
app.get('/api/wa/envios', auth, adminOnly, async (req, res) => {
  try {
    const { campanha_id, tipo, status, data_inicio, data_fim, busca, limit: lim = 300 } = req.query;
    let q = 'SELECT e.*, c.nome as campanha_nome FROM wa_envios e LEFT JOIN wa_campanhas c ON e.campanha_id=c.id WHERE 1=1';
    const p = [];
    if (campanha_id) { q+=' AND e.campanha_id=?'; p.push(campanha_id); }
    if (tipo && tipo!=='TODOS') { q+=' AND e.tipo=?'; p.push(tipo); }
    if (status && status!=='TODOS') { q+=' AND e.status=?'; p.push(status); }
    if (data_inicio) { q+=' AND e.criado_em >= ?'; p.push(data_inicio+' 00:00:00'); }
    if (data_fim) { q+=' AND e.criado_em <= ?'; p.push(data_fim+' 23:59:59'); }
    if (busca) { q+=' AND (e.nome LIKE ? OR e.telefone LIKE ?)'; p.push('%'+busca+'%','%'+busca+'%'); }
    const limitVal = Math.min(1000, parseInt(lim)||300);
    q+=` ORDER BY e.criado_em DESC LIMIT ${limitVal}`;
    const [rows] = await db.query(q, p);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Config WhatsApp ───────────────────────────────────────────────────────────
app.get('/api/wa/config', auth, adminOnly, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT chave,valor FROM wa_config');
    const cfg = {};
    rows.forEach(r => cfg[r.chave]=r.valor);
    res.json(cfg);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/wa/config', auth, adminOnly, async (req, res) => {
  try {
    const entries = Object.entries(req.body);
    for (const [chave, valor] of entries) {
      await db.query('INSERT INTO wa_config (chave,valor) VALUES (?,?) ON DUPLICATE KEY UPDATE valor=?',[chave,valor,valor]);
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Cron: aniversariantes + atrasados automáticos (verificação a cada hora) ───
let ultimoDiaAniversario = -1;
let ultimoDiaAtrasados = -1;
setInterval(async () => {
  const agora = new Date();
  const hora = agora.getHours();
  const dia = agora.getDate();
  const mes = agora.getMonth()+1;

  // Aniversariantes
  try {
    const [[cfgAniv]] = await db.query("SELECT valor FROM wa_config WHERE chave='aniversario_ativo'");
    if (cfgAniv && cfgAniv.valor === '1') {
      const [[cfgHor]] = await db.query("SELECT valor FROM wa_config WHERE chave='aniversario_horario'");
      const horaAlvo = parseInt((cfgHor?.valor || '08:00').split(':')[0]);
      if (hora === horaAlvo && dia !== ultimoDiaAniversario) {
        ultimoDiaAniversario = dia;
        const [[tmpl]] = await db.query("SELECT valor FROM wa_config WHERE chave='aniversario_template'");
        const template = tmpl?.valor || '🥊 Feliz Aniversário, {{nome}}! Punch and Roll Fight Team te deseja um dia incrível! 💪';
        const [alunos] = await db.query('SELECT nome,tel FROM alunos WHERE nasc IS NOT NULL AND MONTH(nasc)=? AND DAY(nasc)=? AND status IN (?,?)',[mes,dia,'ativo','vencendo']);
        for (const a of alunos) {
          if (!a.tel) continue;
          const msg = template.replace(/\{\{nome\}\}/gi, a.nome.split(' ')[0]);
          const r = await enviarWA(a.tel, msg);
          await db.query('INSERT INTO wa_envios (nome,telefone,mensagem,tipo,status,erro) VALUES (?,?,?,?,?,?)',
            [a.nome,formatarTelWA(a.tel),msg,'ANIVERSARIO',r.sucesso?'ENVIADO':'ERRO',r.erro||null]);
          await new Promise(x=>setTimeout(x,3000));
        }
        if (alunos.length) console.log(`[Aniversários] ${alunos.length} mensagens enviadas`);
      }
    }
  } catch(e) { console.error('[Cron Aniversário]',e.message); }

  // Atrasados (disparo automático às 9h)
  try {
    const [[cfgAtr]] = await db.query("SELECT valor FROM wa_config WHERE chave='atrasados_ativo'");
    if (cfgAtr && cfgAtr.valor === '1' && hora === 9 && dia !== ultimoDiaAtrasados) {
      ultimoDiaAtrasados = dia;
      const [[tmplAtr]] = await db.query("SELECT valor FROM wa_config WHERE chave='atrasados_template'");
      const template = tmplAtr?.valor || 'Olá, {{nome}}! Sua mensalidade da *Punch and Roll* está em atraso. Regularize: 📱 (48) 98463-9257';
      const [alunos] = await db.query("SELECT nome,tel FROM alunos WHERE status='atrasado' AND (cortesia IS NULL OR cortesia=0) AND tel IS NOT NULL AND tel != ''");
      for (const a of alunos) {
        const msg = template.replace(/\{\{nome\}\}/gi, a.nome.split(' ')[0]);
        const r = await enviarWA(a.tel, msg);
        await db.query('INSERT INTO wa_envios (nome,telefone,mensagem,tipo,status,erro) VALUES (?,?,?,?,?,?)',
          [a.nome,formatarTelWA(a.tel),msg,'COBRANCA',r.sucesso?'ENVIADO':'ERRO',r.erro||null]);
        await new Promise(x=>setTimeout(x,3000));
      }
      if (alunos.length) console.log(`[Atrasados] ${alunos.length} mensagens enviadas`);
    }
  } catch(e) { console.error('[Cron Atrasados]',e.message); }

  // Campanhas WA agendadas
  try {
    const [agendadas] = await db.query("SELECT * FROM wa_campanhas WHERE status='AGENDADA' AND data_agendada IS NOT NULL AND data_agendada <= NOW() AND pausada=0");
    for (const camp of agendadas) {
      console.log(`[Cron] Disparando campanha WA agendada: ${camp.nome}`);
      try {
        const res = await axios.post(`http://localhost:${process.env.PORT||3000}/api/wa/campanhas/${camp.id}/disparar`,
          {}, { headers: { Authorization: 'Bearer '+process.env.CRON_TOKEN } });
      } catch(_) {}
    }
  } catch(e) { console.error('[Cron Campanhas WA]',e.message); }

  // Automações de email
  try {
    const [autos] = await db.query("SELECT * FROM email_automacoes WHERE ativo=1");
    for(const auto of autos) {
      const agora = new Date();
      const horaAlvo = parseInt((auto.horario||'09:00').split(':')[0]);
      const hoje = agora.toISOString().split('T')[0];
      if(agora.getHours()===horaAlvo && auto.ultimo_disparo!==hoje) {
        dispararEmailAutomacao(auto).catch(e=>console.error('[Cron Email Auto]',e.message));
      }
    }
  } catch(e) { console.error('[Cron Email Auto]',e.message); }

  // Campanhas email agendadas
  try {
    const [eagendadas] = await db.query("SELECT id,nome FROM email_campanhas WHERE status='AGENDADA' AND data_agendada IS NOT NULL AND data_agendada <= NOW()");
    for(const c of eagendadas) {
      console.log(`[Cron] Disparando campanha email agendada: ${c.nome}`);
      dispararEmailCampanha(c.id).catch(e=>console.error('[Cron Email Campanha]',e.message));
    }
  } catch(e) { console.error('[Cron Email Campanhas]',e.message); }

}, 3600000);

// ══════════════════════════════════════
// WHATSAPP — STATUS E QR CODE
// ══════════════════════════════════════
app.get('/api/whatsapp/status', auth, adminOnly, async (req, res) => {
  const evoUrl = process.env.WA_EVOLUTION_URL;
  const evoKey = process.env.WA_EVOLUTION_KEY;
  const evoInstance = process.env.WA_EVOLUTION_INSTANCE || 'punchandroll';
  if (!evoUrl || !evoKey) return res.json({ ok: false, status: 'not_configured' });
  try {
    const r = await axios.get(`${evoUrl}/instance/fetchInstances`, { headers: { apikey: evoKey } });
    const inst = (r.data || []).find(i => i.name === evoInstance);
    if (!inst) return res.json({ ok: false, status: 'not_found' });
    res.json({ ok: true, status: inst.connectionStatus, numero: inst.ownerJid?.replace('@s.whatsapp.net',''), nome: inst.profileName });
  } catch(e) { res.json({ ok: false, status: 'error', erro: e.message }); }
});

app.get('/api/whatsapp/qr', auth, adminOnly, async (req, res) => {
  const evoUrl = process.env.WA_EVOLUTION_URL;
  const evoKey = process.env.WA_EVOLUTION_KEY;
  const evoInstance = process.env.WA_EVOLUTION_INSTANCE || 'punchandroll';
  if (!evoUrl || !evoKey) return res.json({ ok: false, erro: 'Evolution não configurado' });
  try {
    const r = await axios.get(`${evoUrl}/instance/connect/${evoInstance}`, { headers: { apikey: evoKey } });
    const d = r.data;
    const qr = d.base64 || d.qrcode?.base64 || d.qr?.base64 || null;
    const code = d.code || d.qrcode?.code || d.qr?.code || null;
    if (!qr) return res.json({ ok: false, erro: 'QR não retornado pela Evolution API', raw: d });
    res.json({ ok: true, qr, code });
  } catch(e) { res.json({ ok: false, erro: e.response?.data?.message || e.message }); }
});

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


// ══════════════════════════════════════════════════════════════════════════════
// EMAIL MARKETING
// ══════════════════════════════════════════════════════════════════════════════

const PUBLIC_URL = process.env.PUBLIC_URL || 'https://punch-and-roll-api-production.up.railway.app';

function autoTextColor(hex){try{const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);return(0.299*r+0.587*g+0.114*b)>128?'#111827':'#ffffff';}catch{return'#111827';}}

function gerarHtmlDeBlocosEmail(saudacao, assinatura, blocos, cor='#d4111c') {
  const CC = {
    amarelo:{bg:'#fffbeb',border:'#f59e0b',titulo:'#92400e'},
    azul:{bg:'#eff6ff',border:'#3b82f6',titulo:'#1e40af'},
    verde:{bg:'#f0fdf4',border:'#22c55e',titulo:'#166534'},
    vermelho:{bg:'#fef2f2',border:'#ef4444',titulo:'#991b1b'}
  };
  const rb = (b) => {
    switch(b.tipo) {
      case 'texto': return `<div style="margin:0 0 12px 0;color:#333;font-size:15px;line-height:1.7;">${b.conteudo||''}</div>`;
      case 'callout': {
        const c=CC[b.cor]||CC.amarelo;
        return `<div style="background:${c.bg};border-left:4px solid ${c.border};border-radius:6px;padding:14px 18px;margin:16px 0;">${b.titulo?`<p style="margin:0 0 6px 0;font-weight:bold;color:${c.titulo};font-size:14px;">${b.titulo}</p>`:''}<p style="margin:0;color:#374151;font-size:14px;line-height:1.6;">${(b.conteudo||'').replace(/\n/g,'<br>')}</p></div>`;
      }
      case 'botao': {
        const cp={whatsapp:'#25d366',site:'#d4111c',link:'#6366f1'};
        const bg=b.corFundo||cp[b.tipoBotao]||'#d4111c', ct=b.corTexto||'#fff', al=b.alinhamento||'center';
        const fw=b.larguraTotal?'display:block;width:100%;box-sizing:border-box;':'display:inline-block;';
        const ico=b.mostrarIcone!==false?(b.tipoBotao==='whatsapp'?'💬 ':b.tipoBotao==='site'?'🌐 ':'🔗 '):'';
        return `<div style="text-align:${al};margin:20px 0;"><a href="${b.url||'#'}" style="${fw}background:${bg};color:${ct};text-decoration:none;padding:${b.paddingVertical||'12px'} ${b.paddingHorizontal||'28px'};border-radius:${b.borderRadius||'6px'};font-size:${b.tamanhoFonte||'15px'};font-weight:${b.fontWeight||'600'};font-family:${b.fonte||'Arial,sans-serif'};">${ico}${b.texto||'Botão'}</a></div>`;
      }
      case 'rodape': {
        const su=b.site?(b.site.startsWith('http')?b.site:'https://'+b.site):'';
        const wu=b.telefone?`https://wa.me/55${b.telefone.replace(/\D/g,'')}`:''
        return `<div style="background:#f8faff;padding:28px 24px;text-align:center;border-top:1px solid #e5eaf5;"><div style="font-weight:800;font-size:16px;color:#d4111c;letter-spacing:2px;margin-bottom:4px">${b.empresa||'PUNCH AND ROLL'}</div><div style="display:flex;flex-wrap:wrap;justify-content:center;gap:12px;margin-bottom:8px;">${su?`<a href="${su}" style="font-size:12px;color:#d4111c;text-decoration:none;font-weight:600;">🌐 ${b.site}</a>`:''}${wu?`<a href="${wu}" style="font-size:12px;color:#d4111c;text-decoration:none;font-weight:600;">💬 WhatsApp</a>`:''}${b.email?`<a href="mailto:${b.email}" style="font-size:12px;color:#d4111c;text-decoration:none;font-weight:600;">📧 ${b.email}</a>`:''}</div>${b.endereco?`<p style="font-size:11px;color:#aaa;margin:4px 0 0;">${b.endereco}</p>`:''}<p style="font-size:11px;color:#aaa;margin:8px 0 0;">Para cancelar, responda com "DESCADASTRAR".</p></div>`;
      }
      default: return '';
    }
  };
  const saudHtml = saudacao ? `<p style="font-size:16px;font-weight:600;color:#111827;margin:0 0 16px">${saudacao}</p>` : '';
  const assHtml = assinatura ? `<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"><p style="font-size:13px;color:#6b7280;margin:0;white-space:pre-line">${assinatura}</p>` : '';
  return saudHtml + blocos.map(rb).join('\n') + assHtml;
}

function gerarHtmlEmail(assunto, saudacao, corpo, assinatura, envioId, corFundo='#ffffff', corAnd='#d4111c') {
  const trackUrl = `${PUBLIC_URL}/api/email/track/open/${envioId}`;
  const tc = autoTextColor(corFundo);
  const cabHtml = `<td style="background:${corFundo};padding:20px 32px;border-radius:12px 12px 0 0;text-align:center;border-bottom:4px solid ${corAnd}"><div style="font-size:26px;font-weight:900;letter-spacing:3px;line-height:1"><span style="color:${tc}">PUNCH </span><span style="color:${corAnd}">AND</span><span style="color:${tc}"> ROLL</span></div><div style="color:${tc};opacity:0.5;font-size:10px;letter-spacing:3px;text-transform:uppercase;margin-top:5px">FIGHT TEAM</div></td>`;
  const header = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${assunto}</title></head><body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Arial,sans-serif"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%"><tr>${cabHtml}</tr><tr><td style="background:#fff;padding:32px;border-radius:0 0 12px 12px">`;
  const footer = `<p style="font-size:12px;color:#9ca3af;margin:12px 0 0">São José, SC · <a href="https://punchandroll.com.br" style="color:${corAnd}">punchandroll.com.br</a></p></td></tr></table></td></tr></table><img src="${trackUrl}" width="1" height="1" style="display:none" alt=""></body></html>`;

  if (corpo && corpo.startsWith('BLOCKS:')) {
    try {
      const blocos = JSON.parse(corpo.slice('BLOCKS:'.length));
      return header + gerarHtmlDeBlocosEmail(saudacao, assinatura, blocos, corAnd) + footer;
    } catch(_) {}
  }

  return header +
    `<p style="font-size:16px;font-weight:600;color:#111827;margin:0 0 16px">${saudacao}</p>` +
    `<div style="font-size:14px;color:#374151;line-height:1.7;margin-bottom:24px">${(corpo||'').replace(/\n/g,'<br>')}</div>` +
    `<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">` +
    `<p style="font-size:13px;color:#6b7280;margin:0">${assinatura}</p>` +
    footer;
}

function substituirVars(texto, contato) {
  return (texto||'')
    .replace(/\{\{nome\}\}/gi, (contato.nome||'').split(' ')[0])
    .replace(/\{\{nome_completo\}\}/gi, contato.nome||'')
    .replace(/\{\{email\}\}/gi, contato.email||'')
    .replace(/\{\{modalidade\}\}/gi, contato.modalidade||'')
    .replace(/\{\{status\}\}/gi, contato.status||'');
}

async function dispararEmailCampanha(campanhaId) {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) throw new Error('SENDGRID_API_KEY não configurado');
  const [[camp]] = await db.query(`SELECT c.*, t.assunto, t.saudacao, t.corpo, t.assinatura, t.cor_cabecalho, t.cor_fundo_cab
    FROM email_campanhas c LEFT JOIN email_templates t ON t.id=c.template_id WHERE c.id=?`, [campanhaId]);
  if (!camp) throw new Error('Campanha não encontrada');

  let destinatarios = [];
  if (camp.lista_id) {
    const [rows] = await db.query('SELECT nome,email FROM email_contatos WHERE lista_id=? AND email IS NOT NULL AND email != ""', [camp.lista_id]);
    destinatarios = rows;
  } else if (camp.segmento) {
    const where = camp.segmento === 'todos' ? '' :
      camp.segmento === 'ativos' ? "AND status='ativo'" :
      camp.segmento === 'vencendo' ? "AND status='vencendo'" :
      camp.segmento === 'atrasados' ? "AND status='atrasado'" : '';
    const [rows] = await db.query(`SELECT nome,email,modalidade,status FROM alunos WHERE email IS NOT NULL AND email != '' ${where}`);
    destinatarios = rows;
  }

  await db.query('UPDATE email_campanhas SET status=?,total_destinatarios=?,total_enviados=0,total_erros=0,aberturas=0,data_inicio=NOW() WHERE id=?',
    ['ENVIANDO', destinatarios.length, campanhaId]);

  const from = camp.remetente || process.env.EMAIL_FROM || 'noreply@punchandroll.com.br';
  const fromName = camp.nome_remetente || 'Punch and Roll Fight Team';
  const assunto = camp.assunto_override || camp.assunto || 'Mensagem da Punch and Roll';
  let enviados = 0, erros = 0;

  for (const d of destinatarios) {
    const [[c2]] = await db.query('SELECT status FROM email_campanhas WHERE id=?', [campanhaId]);
    if (!c2 || c2.status === 'CANCELADA') break;

    const saudacao = substituirVars(camp.saudacao || 'Olá, {{nome}}!', d);
    const corpo = substituirVars(camp.corpo || '', d);
    const assuntoFinal = substituirVars(assunto, d);

    const [ins] = await db.query('INSERT INTO email_envios (campanha_id,contato_nome,contato_email,tipo,status) VALUES (?,?,?,?,?)',
      [campanhaId, d.nome, d.email, 'CAMPANHA', 'ENVIADO']);
    const envioId = ins.insertId;

    const html = gerarHtmlEmail(assuntoFinal, saudacao, corpo, camp.assinatura || 'Punch and Roll Fight Team', envioId, camp.cor_fundo_cab||'#ffffff', camp.cor_cabecalho || '#d4111c');
    try {
      await axios.post('https://api.sendgrid.com/v3/mail/send', {
        personalizations: [{ to: [{ email: d.email, name: d.nome||'' }] }],
        from: { email: from, name: fromName },
        subject: assuntoFinal,
        content: [{ type: 'text/html', value: html }],
      }, { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 15000 });
      enviados++;
    } catch(e) {
      await db.query('UPDATE email_envios SET status=?,erro_msg=? WHERE id=?', ['ERRO', e.response?.data?.errors?.[0]?.message || e.message, envioId]);
      erros++;
    }
    await db.query('UPDATE email_campanhas SET total_enviados=?,total_erros=? WHERE id=?', [enviados, erros, campanhaId]);
    await new Promise(x => setTimeout(x, 200));
  }
  await db.query('UPDATE email_campanhas SET status=?,data_conclusao=NOW() WHERE id=?', ['CONCLUIDA', campanhaId]);
}

// Tracking pixel (sem auth)
app.get('/api/email/track/open/:id', async (req, res) => {
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
  res.set({'Content-Type':'image/gif','Cache-Control':'no-store'}).end(gif);
  db.query('UPDATE email_envios SET aberturas=aberturas+1,aberto_em=COALESCE(aberto_em,NOW()) WHERE id=?',[req.params.id]).catch(()=>{});
  db.query('UPDATE email_campanhas SET aberturas=aberturas+1 WHERE id=(SELECT campanha_id FROM email_envios WHERE id=?)',[req.params.id]).catch(()=>{});
});

// Status
app.get('/api/email/status', auth, adminOnly, (req, res) => {
  res.json({ configurado: !!process.env.SENDGRID_API_KEY, from: process.env.EMAIL_FROM||'noreply@punchandroll.com.br' });
});

// Templates CRUD
app.get('/api/email/templates', auth, adminOnly, async (req, res) => {
  const [rows] = await db.query('SELECT id,nome,assunto,saudacao,assinatura,cor_cabecalho,ativo,criado_em FROM email_templates ORDER BY nome');
  res.json(rows);
});
app.get('/api/email/templates/:id', auth, adminOnly, async (req, res) => {
  const [[r]] = await db.query('SELECT * FROM email_templates WHERE id=?',[req.params.id]);
  res.json(r||{});
});
app.post('/api/email/templates', auth, adminOnly, async (req, res) => {
  const {nome,assunto,saudacao,corpo,assinatura,cor_cabecalho} = req.body;
  const [r] = await db.query('INSERT INTO email_templates (nome,assunto,saudacao,corpo,assinatura,cor_cabecalho) VALUES (?,?,?,?,?,?)',
    [nome,assunto,saudacao||'Olá, {{nome}}!',corpo||'',assinatura||'Punch and Roll Fight Team',cor_cabecalho||'#d4111c']);
  res.json({id:r.insertId});
});
app.put('/api/email/templates/:id', auth, adminOnly, async (req, res) => {
  const {nome,assunto,saudacao,corpo,assinatura,cor_cabecalho,ativo} = req.body;
  await db.query('UPDATE email_templates SET nome=?,assunto=?,saudacao=?,corpo=?,assinatura=?,cor_cabecalho=?,ativo=? WHERE id=?',
    [nome,assunto,saudacao,corpo,assinatura,cor_cabecalho||'#d4111c',ativo??1,req.params.id]);
  res.json({ok:true});
});
app.delete('/api/email/templates/:id', auth, adminOnly, async (req, res) => {
  await db.query('DELETE FROM email_templates WHERE id=?',[req.params.id]);
  res.json({ok:true});
});
app.post('/api/email/templates/:id/duplicar', auth, adminOnly, async (req, res) => {
  const [[t]] = await db.query('SELECT * FROM email_templates WHERE id=?',[req.params.id]);
  if(!t) return res.status(404).json({error:'Não encontrado'});
  const [r] = await db.query('INSERT INTO email_templates (nome,assunto,saudacao,corpo,assinatura) VALUES (?,?,?,?,?)',
    [t.nome+' - Cópia',t.assunto,t.saudacao,t.corpo,t.assinatura]);
  res.json({id:r.insertId});
});

// Listas CRUD
app.get('/api/email/listas', auth, adminOnly, async (req, res) => {
  const [rows] = await db.query(`SELECT l.*, (SELECT COUNT(*) FROM email_contatos WHERE lista_id=l.id) as total FROM email_listas l ORDER BY l.nome`);
  res.json(rows);
});
app.post('/api/email/listas', auth, adminOnly, async (req, res) => {
  const [r] = await db.query('INSERT INTO email_listas (nome,descricao) VALUES (?,?)',[req.body.nome,req.body.descricao||null]);
  res.json({id:r.insertId});
});
app.delete('/api/email/listas/:id', auth, adminOnly, async (req, res) => {
  await db.query('DELETE FROM email_listas WHERE id=?',[req.params.id]);
  res.json({ok:true});
});
app.get('/api/email/listas/:id/contatos', auth, adminOnly, async (req, res) => {
  const [rows] = await db.query('SELECT * FROM email_contatos WHERE lista_id=? ORDER BY nome',[req.params.id]);
  res.json(rows);
});
app.post('/api/email/listas/:id/contatos', auth, adminOnly, async (req, res) => {
  const {nome,email} = req.body;
  if(!email) return res.status(400).json({error:'Email obrigatório'});
  const [r] = await db.query('INSERT INTO email_contatos (lista_id,nome,email) VALUES (?,?,?)',[req.params.id,nome||null,email]);
  res.json({id:r.insertId});
});
app.delete('/api/email/contatos/:id', auth, adminOnly, async (req, res) => {
  await db.query('DELETE FROM email_contatos WHERE id=?',[req.params.id]);
  res.json({ok:true});
});
// Upload Excel lista
app.post('/api/email/listas/:id/upload', auth, adminOnly, upload.single('arquivo'), async (req, res) => {
  try {
    const xlsx = require('xlsx');
    const wb = xlsx.read(req.file.buffer, {type:'buffer'});
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(ws);
    let importados = 0;
    for (const row of data) {
      const keys = Object.keys(row).map(k=>k.toLowerCase());
      const emailKey = Object.keys(row).find(k=>k.toLowerCase().includes('email'));
      const nomeKey = Object.keys(row).find(k=>k.toLowerCase().includes('nome'));
      const email = emailKey ? String(row[emailKey]).trim() : null;
      const nome = nomeKey ? String(row[nomeKey]).trim() : null;
      if(!email||!email.includes('@')) continue;
      await db.query('INSERT IGNORE INTO email_contatos (lista_id,nome,email) VALUES (?,?,?)',[req.params.id,nome,email]);
      importados++;
    }
    res.json({ok:true,importados});
  } catch(e) { res.status(500).json({error:e.message}); }
});
// Importar da base de alunos
app.post('/api/email/listas/:id/importar-base', auth, adminOnly, async (req, res) => {
  try {
    const {modalidade,status_aluno} = req.body;
    let where = "email IS NOT NULL AND email != ''";
    if(modalidade && modalidade !== 'todos') where += ` AND modalidade='${modalidade}'`;
    if(status_aluno && status_aluno !== 'todos') where += ` AND status='${status_aluno}'`;
    const [alunos] = await db.query(`SELECT nome,email FROM alunos WHERE ${where}`);
    let importados = 0;
    for (const a of alunos) {
      const [ex] = await db.query('SELECT id FROM email_contatos WHERE lista_id=? AND email=?',[req.params.id,a.email]);
      if(!ex.length){ await db.query('INSERT INTO email_contatos (lista_id,nome,email) VALUES (?,?,?)',[req.params.id,a.nome,a.email]); importados++; }
    }
    res.json({ok:true,importados,total:alunos.length});
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/api/email/listas/preview-base', auth, adminOnly, async (req, res) => {
  const {modalidade,status_aluno} = req.query;
  let where = "email IS NOT NULL AND email != ''";
  if(modalidade && modalidade !== 'todos') where += ` AND modalidade='${modalidade}'`;
  if(status_aluno && status_aluno !== 'todos') where += ` AND status='${status_aluno}'`;
  const [[r]] = await db.query(`SELECT COUNT(*) as n FROM alunos WHERE ${where}`);
  res.json({total:r.n});
});

// Campanhas CRUD
app.get('/api/email/campanhas', auth, adminOnly, async (req, res) => {
  const [rows] = await db.query(`SELECT c.*,t.nome as template_nome,l.nome as lista_nome FROM email_campanhas c LEFT JOIN email_templates t ON t.id=c.template_id LEFT JOIN email_listas l ON l.id=c.lista_id ORDER BY c.criado_em DESC`);
  res.json(rows);
});
app.post('/api/email/campanhas', auth, adminOnly, async (req, res) => {
  const {nome,template_id,lista_id,segmento,assunto_override,remetente,nome_remetente,data_agendada} = req.body;
  const status = data_agendada ? 'AGENDADA' : 'RASCUNHO';
  const [r] = await db.query('INSERT INTO email_campanhas (nome,template_id,lista_id,segmento,assunto_override,remetente,nome_remetente,data_agendada,status) VALUES (?,?,?,?,?,?,?,?,?)',
    [nome,template_id||null,lista_id||null,segmento||null,assunto_override||null,remetente||null,nome_remetente||null,data_agendada||null,status]);
  res.json({id:r.insertId});
});
app.put('/api/email/campanhas/:id', auth, adminOnly, async (req, res) => {
  const {nome,template_id,lista_id,segmento,assunto_override,remetente,nome_remetente,data_agendada} = req.body;
  const status = data_agendada ? 'AGENDADA' : 'RASCUNHO';
  await db.query('UPDATE email_campanhas SET nome=?,template_id=?,lista_id=?,segmento=?,assunto_override=?,remetente=?,nome_remetente=?,data_agendada=?,status=? WHERE id=? AND status IN ("RASCUNHO","AGENDADA")',
    [nome,template_id||null,lista_id||null,segmento||null,assunto_override||null,remetente||null,nome_remetente||null,data_agendada||null,status,req.params.id]);
  res.json({ok:true});
});
app.delete('/api/email/campanhas/:id', auth, adminOnly, async (req, res) => {
  await db.query('DELETE FROM email_campanhas WHERE id=?',[req.params.id]);
  res.json({ok:true});
});
app.post('/api/email/campanhas/:id/duplicar', auth, adminOnly, async (req, res) => {
  const [[c]] = await db.query('SELECT * FROM email_campanhas WHERE id=?',[req.params.id]);
  if(!c) return res.status(404).json({error:'Não encontrado'});
  const [r] = await db.query('INSERT INTO email_campanhas (nome,template_id,lista_id,segmento,assunto_override,remetente,nome_remetente) VALUES (?,?,?,?,?,?,?)',
    [c.nome+' - Cópia',c.template_id,c.lista_id,c.segmento,c.assunto_override,c.remetente,c.nome_remetente]);
  res.json({id:r.insertId});
});
app.get('/api/email/campanhas/:id/preview', auth, adminOnly, async (req, res) => {
  const [[camp]] = await db.query(`SELECT c.*,t.assunto,t.saudacao,t.corpo,t.assinatura,t.cor_cabecalho FROM email_campanhas c LEFT JOIN email_templates t ON t.id=c.template_id WHERE c.id=?`,[req.params.id]);
  if(!camp) return res.status(404).json({error:'Não encontrada'});
  const exemplos = [{nome:'João Silva',email:'joao@exemplo.com',modalidade:'boxe'},{nome:'Maria Costa',email:'maria@exemplo.com',modalidade:'jiujitsu'}];
  const previews = exemplos.map(d => ({
    nome: d.nome, email: d.email,
    html: gerarHtmlEmail(substituirVars(camp.assunto_override||camp.assunto||'',d), substituirVars(camp.saudacao||'Olá, {{nome}}!',d), substituirVars(camp.corpo||'',d), camp.assinatura||'', 0, camp.cor_fundo_cab||'#ffffff', camp.cor_cabecalho||'#d4111c')
  }));
  res.json(previews);
});
app.get('/api/email/campanhas/:id/aberturas', auth, adminOnly, async (req, res) => {
  const [rows] = await db.query('SELECT * FROM email_envios WHERE campanha_id=? ORDER BY criado_em DESC',[req.params.id]);
  res.json(rows);
});
app.post('/api/email/campanhas/:id/disparar', auth, adminOnly, async (req, res) => {
  const id = parseInt(req.params.id);
  res.json({ok:true,msg:'Disparo iniciado em background'});
  dispararEmailCampanha(id).catch(e=>console.error('[Email Campanha]',e.message));
});
app.post('/api/email/campanhas/:id/retomar', auth, adminOnly, async (req, res) => {
  await db.query('UPDATE email_campanhas SET status=? WHERE id=?',['ENVIANDO',req.params.id]);
  res.json({ok:true});
  dispararEmailCampanha(parseInt(req.params.id)).catch(e=>console.error('[Email Retomar]',e.message));
});

// Envio individual
app.post('/api/email/enviar-individual', auth, adminOnly, async (req, res) => {
  const key = process.env.SENDGRID_API_KEY;
  if(!key) return res.status(400).json({error:'SENDGRID_API_KEY não configurado'});
  const {nome,email,assunto,corpo,template_id} = req.body;
  if(!email) return res.status(400).json({error:'Email obrigatório'});
  let assuntoFinal = assunto, corpoFinal = corpo, saudacao = `Olá, ${nome||''}!`, assinatura = 'Punch and Roll Fight Team', corCab = '#d4111c', corFundoCab = '#ffffff';
  if(template_id){
    const [[t]] = await db.query('SELECT * FROM email_templates WHERE id=?',[template_id]);
    if(t){ assuntoFinal=assunto||t.assunto; corpoFinal=corpo||t.corpo; saudacao=substituirVars(t.saudacao||'Olá, {{nome}}!',{nome}); assinatura=t.assinatura||assinatura; corCab=t.cor_cabecalho||'#d4111c'; corFundoCab=t.cor_fundo_cab||'#ffffff'; }
  }
  const [ins] = await db.query('INSERT INTO email_envios (contato_nome,contato_email,tipo,status) VALUES (?,?,?,?)',[nome||email,email,'INDIVIDUAL','ENVIADO']);
  const html = gerarHtmlEmail(assuntoFinal||'Mensagem', saudacao, substituirVars(corpoFinal||'',{nome,email}), assinatura, ins.insertId, corFundoCab, corCab);
  try {
    await axios.post('https://api.sendgrid.com/v3/mail/send',{
      personalizations:[{to:[{email,name:nome||''}]}],
      from:{email:process.env.EMAIL_FROM||'noreply@punchandroll.com.br',name:'Punch and Roll Fight Team'},
      subject:assuntoFinal||'Mensagem Punch and Roll',
      content:[{type:'text/html',value:html}]
    },{headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},timeout:15000});
    res.json({ok:true});
  } catch(e){
    await db.query('UPDATE email_envios SET status=?,erro_msg=? WHERE id=?',['ERRO',e.response?.data?.errors?.[0]?.message||e.message,ins.insertId]);
    res.status(500).json({error:e.response?.data?.errors?.[0]?.message||e.message});
  }
});

// Histórico
app.get('/api/email/historico', auth, adminOnly, async (req, res) => {
  const {tipo,status,data_inicio,data_fim,busca,campanha_id} = req.query;
  let q = 'SELECT e.*,c.nome as campanha_nome FROM email_envios e LEFT JOIN email_campanhas c ON c.id=e.campanha_id WHERE 1=1';
  const p = [];
  if(tipo) { q+=' AND e.tipo=?'; p.push(tipo); }
  if(status) { q+=' AND e.status=?'; p.push(status); }
  if(campanha_id) { q+=' AND e.campanha_id=?'; p.push(campanha_id); }
  if(data_inicio) { q+=' AND e.criado_em>=?'; p.push(data_inicio); }
  if(data_fim) { q+=' AND DATE(e.criado_em)<=?'; p.push(data_fim); }
  if(busca) { q+=' AND (e.contato_nome LIKE ? OR e.contato_email LIKE ?)'; p.push('%'+busca+'%','%'+busca+'%'); }
  q+=' ORDER BY e.criado_em DESC LIMIT 500';
  const [rows] = await db.query(q,p);
  res.json(rows);
});

// Automações
app.get('/api/email/automacoes', auth, adminOnly, async (req, res) => {
  const [rows] = await db.query('SELECT a.*,t.nome as template_nome FROM email_automacoes a LEFT JOIN email_templates t ON t.id=a.template_id ORDER BY a.id');
  res.json(rows);
});
app.put('/api/email/automacoes/:id', auth, adminOnly, async (req, res) => {
  const {ativo,template_id,horario} = req.body;
  await db.query('UPDATE email_automacoes SET ativo=?,template_id=?,horario=? WHERE id=?',[ativo?1:0,template_id||null,horario||'09:00',req.params.id]);
  res.json({ok:true});
});
app.post('/api/email/automacoes/:id/disparar-agora', auth, adminOnly, async (req, res) => {
  const [[auto]] = await db.query('SELECT * FROM email_automacoes WHERE id=?',[req.params.id]);
  if(!auto) return res.status(404).json({error:'Não encontrada'});
  res.json({ok:true,msg:'Disparo em background'});
  dispararEmailAutomacao(auto).catch(e=>console.error('[Email Auto]',e.message));
});

async function dispararEmailAutomacao(auto) {
  const key = process.env.SENDGRID_API_KEY;
  if(!key || !auto.template_id) return;
  const [[tpl]] = await db.query('SELECT * FROM email_templates WHERE id=?',[auto.template_id]);
  if(!tpl) return;
  const hoje = new Date();
  const mes = hoje.getMonth()+1, dia = hoje.getDate();
  let alunos = [];
  if(auto.tipo === 'ANIVERSARIO') {
    [alunos] = await db.query("SELECT nome,email,modalidade,status FROM alunos WHERE nasc IS NOT NULL AND MONTH(nasc)=? AND DAY(nasc)=? AND email IS NOT NULL AND email!='' AND status IN ('ativo','vencendo')",[mes,dia]);
  } else if(auto.tipo === 'VENCENDO') {
    [alunos] = await db.query("SELECT nome,email,modalidade,status FROM alunos WHERE status='vencendo' AND email IS NOT NULL AND email!=''");
  }
  await db.query('UPDATE email_automacoes SET ultimo_disparo=CURDATE() WHERE id=?',[auto.id]);
  for(const a of alunos) {
    const saud = substituirVars(tpl.saudacao||'Olá, {{nome}}!',a);
    const corp = substituirVars(tpl.corpo||'',a);
    const assunto = substituirVars(tpl.assunto,a);
    const [ins] = await db.query('INSERT INTO email_envios (contato_nome,contato_email,tipo,status) VALUES (?,?,?,?)',[a.nome,a.email,auto.tipo,'ENVIADO']);
    const html = gerarHtmlEmail(assunto,saud,corp,tpl.assinatura||'Punch and Roll Fight Team',ins.insertId,tpl.cor_fundo_cab||'#ffffff',tpl.cor_cabecalho||'#d4111c');
    try {
      await axios.post('https://api.sendgrid.com/v3/mail/send',{
        personalizations:[{to:[{email:a.email,name:a.nome}]}],
        from:{email:process.env.EMAIL_FROM||'noreply@punchandroll.com.br',name:'Punch and Roll Fight Team'},
        subject:assunto,content:[{type:'text/html',value:html}]
      },{headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},timeout:15000});
    } catch(e){
      await db.query('UPDATE email_envios SET status=?,erro_msg=? WHERE id=?',['ERRO',e.message,ins.insertId]);
    }
    await new Promise(x=>setTimeout(x,300));
  }
}


// ══════════════════════════════════════
// HEALTH CHECK
// ══════════════════════════════════════
app.get('/api/health', async (req, res) => {
  try {
    const [aulas] = await db.query('SELECT COUNT(*) as n FROM aulas');
    const [alunos] = await db.query('SELECT COUNT(*) as n FROM alunos WHERE (cortesia IS NULL OR cortesia=0)');
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

const normDate = v => v ? String(v).split('T')[0] : null;

app.post('/api/despesas', auth, adminOnly, async (req, res) => {
  try {
    const { descricao, valor, categoria, metodo, obs, parcelas = 1, recorrente = false } = req.body;
    const data_vencimento = normDate(req.body.data_vencimento);
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
    const { descricao, valor, status, categoria, metodo, obs, recorrente } = req.body;
    const data_vencimento = normDate(req.body.data_vencimento);
    const data_pagamento = normDate(req.body.data_pagamento);
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
    const [rows] = await db.query('SELECT id, aluno_id, assinado, plano, modalidade, contrato_html FROM contratos WHERE token=?', [token]);
    if (!rows.length) return res.status(404).json({ error: 'Contrato não encontrado' });
    if (rows[0].assinado) return res.json({ ok: true, already: true });
    await db.query('UPDATE contratos SET assinado=TRUE, assinado_em=NOW(), ip=? WHERE token=?', [ip, token]);

    // Salva o contrato assinado como documento vinculado ao aluno
    const c = rows[0];
    if (c.aluno_id && c.contrato_html) {
      const dataHoje = new Date().toLocaleDateString('pt-BR');
      const nomePlano = c.plano || c.modalidade || 'Contrato';
      const nomeDoc = `Contrato Assinado - ${nomePlano} (${dataHoje})`;
      const buffer = Buffer.from(c.contrato_html, 'utf8');
      await db.query(
        'INSERT INTO documentos (nome, categoria, extensao, tamanho, mimetype, arquivo, visivel, aluno_id) VALUES (?,?,?,?,?,?,1,?)',
        [nomeDoc, 'contrato', 'html', buffer.length, 'text/html', buffer, c.aluno_id]
      );
    }

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
app.post('/api/documentos', auth, async (req, res) => {
  try {
    if (req.user.tipo !== 'admin' && req.user.tipo !== 'master') return res.status(403).json({ error: 'Acesso negado' });
    const { nome, categoria, extensao, mimetype, arquivo_base64, tamanho, aluno_id } = req.body;
    if (!nome || !arquivo_base64) return res.status(400).json({ error: 'nome e arquivo_base64 obrigatórios' });
    const buffer = Buffer.from(arquivo_base64, 'base64');
    await db.query(
      'INSERT INTO documentos (nome, categoria, extensao, tamanho, mimetype, arquivo, visivel, aluno_id) VALUES (?,?,?,?,?,?,1,?)',
      [nome, categoria || 'outro', extensao || 'pdf', tamanho || buffer.length, mimetype || 'application/pdf', buffer, aluno_id || null]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/documentos', auth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id, nome, categoria, extensao, tamanho, mimetype, criado_em FROM documentos WHERE visivel=1 AND aluno_id IS NULL ORDER BY criado_em DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/documentos/aluno/:aluno_id', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, nome, categoria, extensao, tamanho, mimetype, criado_em FROM documentos WHERE visivel=1 AND aluno_id=? ORDER BY criado_em DESC',
      [req.params.aluno_id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/documentos/:id/download', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT nome, extensao, mimetype, arquivo FROM documentos WHERE id=? AND visivel=1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
    const doc = rows[0];
    await db.query('UPDATE documentos SET downloads=downloads+1 WHERE id=?', [req.params.id]);
    res.setHeader('Content-Type', doc.mimetype || 'application/octet-stream');
    const nomeSeguro = doc.nome.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^\w\s\-().]/g,'_').replace(/\s+/g,' ').trim();
    const ext = doc.extensao ? `.${doc.extensao}` : '';
    res.setHeader('Content-Disposition', `inline; filename="${nomeSeguro}${ext}"`);
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

// ══════════════════════════════════════
// AVISOS DE VENCIMENTO
// ══════════════════════════════════════
function gerarMsgVencimento(a, dias) {
  const nome = a.nome.split(' ')[0];
  const dt = a.vencimento ? new Date(a.vencimento).toLocaleDateString('pt-BR') : '—';
  const valor = a.valor ? `R$ ${Number(a.valor).toFixed(2).replace('.', ',')}` : '';
  const plano = a.plano || 'Mensal';
  let wa, assunto, urgencia;

  if (dias === 10) {
    urgencia = '10 dias';
    wa = `Olá, *${nome}*! 🥊\n\nSua mensalidade na *Punch and Roll Fight Team* vence em *10 dias*, no dia *${dt}*.\n\n💳 Plano: ${plano}${valor ? ' | ' + valor + '/mês' : ''}\n\nPara renovar, entre em contato:\n📱 (48) 98463-9257\n\nBora continuar treinando! 💪`;
    assunto = '🥊 Sua mensalidade vence em 10 dias — Punch and Roll';
  } else if (dias === 5) {
    urgencia = '5 dias';
    wa = `Olá, *${nome}*! ⚠️\n\nSua mensalidade na *Punch and Roll* vence em *5 dias* (dia *${dt}*).\n\nNão perca o acesso aos treinos! Renove agora:\n📱 (48) 98463-9257\n\nPunch and Roll Fight Team 🥊`;
    assunto = '⚠️ Sua mensalidade vence em 5 dias — Punch and Roll';
  } else {
    urgencia = 'hoje';
    wa = `Olá, *${nome}*! 🔔\n\nSua mensalidade na *Punch and Roll Fight Team* vence *hoje* (${dt}).\n\nPara manter seu acesso ao check-in e treinos, regularize sua mensalidade:\n📱 (48) 98463-9257\n\nPunch and Roll Fight Team 🥊`;
    assunto = '🔔 Sua mensalidade vence hoje — Punch and Roll';
  }

  const html = `<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#0f0f0f;color:#f2f2f2;border-radius:12px;overflow:hidden">
    <div style="background:#d4111c;padding:20px;text-align:center">
      <div style="font-size:22px;font-weight:900;letter-spacing:3px">PUNCH AND ROLL</div>
      <div style="font-size:12px;opacity:.8;margin-top:4px">FIGHT TEAM</div>
    </div>
    <div style="padding:24px">
      <p style="font-size:16px;margin:0 0 16px">Olá, <strong>${nome}</strong>!</p>
      <div style="background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:16px;margin-bottom:16px;text-align:center">
        <div style="font-size:13px;color:#999;margin-bottom:6px">SUA MENSALIDADE VENCE EM</div>
        <div style="font-size:28px;font-weight:900;color:${dias===0?'#f87171':dias===5?'#facc15':'#d4111c'}">${urgencia.toUpperCase()}</div>
        <div style="font-size:14px;color:#ccc;margin-top:4px">${dt}</div>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
        <tr><td style="padding:7px 0;font-size:13px;color:#999;border-bottom:1px solid #1e1e1e">Plano</td><td style="padding:7px 0;font-size:13px;font-weight:600;text-align:right;border-bottom:1px solid #1e1e1e">${plano}</td></tr>
        ${valor?`<tr><td style="padding:7px 0;font-size:13px;color:#999">Valor</td><td style="padding:7px 0;font-size:13px;font-weight:600;text-align:right;color:#22c55e">${valor}/mês</td></tr>`:''}
      </table>
      <p style="font-size:13px;color:#ccc;line-height:1.6">Para renovar e manter seu acesso aos treinos, entre em contato com a academia:</p>
      <div style="text-align:center;margin:16px 0">
        <a href="https://wa.me/5548984639257" style="display:inline-block;background:#d4111c;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">📱 (48) 98463-9257</a>
      </div>
    </div>
    <div style="background:#080808;padding:12px;text-align:center;font-size:11px;color:#555">Punch and Roll Fight Team · São José, SC</div>
  </div>`;

  return { wa, assunto, html };
}

app.get('/api/avisos/vencimento', auth, async (req, res) => {
  try {
    const grupos = {};
    for (const dias of [10, 5, 0]) {
      const [rows] = await db.query(
        `SELECT id, nome, tel, email, plano, valor, vencimento FROM alunos
         WHERE status IN ('ativo','vencendo','atrasado') AND DATE(vencimento) = DATE_ADD(CURDATE(), INTERVAL ? DAY)`,
        [dias]
      );
      grupos[dias] = rows.map(a => ({ ...a, preview_wa: gerarMsgVencimento(a, dias).wa }));
    }
    res.json(grupos);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/avisos/enviar', auth, async (req, res) => {
  try {
    if (req.user.tipo !== 'admin' && req.user.tipo !== 'master') return res.status(403).json({ error: 'Acesso negado' });
    const { aluno_ids, dias, tipo = 'wa' } = req.body;
    let alunos;
    if (aluno_ids && aluno_ids.length > 0) {
      const ph = aluno_ids.map(() => '?').join(',');
      [alunos] = await db.query(`SELECT id, nome, tel, email, plano, valor, vencimento FROM alunos WHERE id IN (${ph})`, aluno_ids);
    } else {
      [alunos] = await db.query(
        `SELECT id, nome, tel, email, plano, valor, vencimento FROM alunos
         WHERE status IN ('ativo','vencendo','atrasado') AND DATE(vencimento) = DATE_ADD(CURDATE(), INTERVAL ? DAY)`,
        [dias]
      );
    }
    const diasEfetivo = dias !== undefined ? dias : 0;
    let enviados = 0;
    for (const a of alunos) {
      const msg = gerarMsgVencimento(a, diasEfetivo);
      if (tipo === 'wa' || tipo === 'ambos') await notificarWA(a.tel, msg.wa);
      if (tipo === 'email' || tipo === 'ambos') await enviarEmailAluno(a.email, a.nome, msg.assunto, msg.html);
      await db.query('INSERT INTO avisos_log (aluno_id, tipo, dias) VALUES (?,?,?)', [a.id, tipo, diasEfetivo]);
      enviados++;
    }
    res.json({ ok: true, enviados });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/cron/avisos-vencimento', async (req, res) => {
  const secret = (req.headers['authorization'] || '').replace('Bearer ', '');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Não autorizado' });
  try {
    let total = 0;
    for (const dias of [10, 5, 0]) {
      const [alunos] = await db.query(
        `SELECT id, nome, tel, email, plano, valor, vencimento FROM alunos
         WHERE status IN ('ativo','vencendo','atrasado') AND DATE(vencimento) = DATE_ADD(CURDATE(), INTERVAL ? DAY)`,
        [dias]
      );
      for (const a of alunos) {
        const [jaEnviou] = await db.query(
          `SELECT id FROM avisos_log WHERE aluno_id=? AND dias=? AND DATE(enviado_em)=CURDATE()`,
          [a.id, dias]
        );
        if (jaEnviou.length > 0) continue;
        const msg = gerarMsgVencimento(a, dias);
        await notificarWA(a.tel, msg.wa);
        await enviarEmailAluno(a.email, a.nome, msg.assunto, msg.html);
        await db.query('INSERT INTO avisos_log (aluno_id, tipo, dias) VALUES (?,?,?)', [a.id, 'ambos', dias]);
        total++;
      }
    }
    res.json({ ok: true, enviados: total, ts: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/contratos/meta/:token', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT assinado, assinado_em, plano, modalidade, criado_em FROM contratos WHERE token=?', [req.params.token]);
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════
// SHOP
// ══════════════════════════════════════

// Produtos — público
app.get('/api/shop/produtos', async (req, res) => {
  try {
    const admin = req.headers.authorization?.split(' ')[1];
    let isAdmin = false;
    try { const u = jwt.verify(admin, JWT_SECRET); if (u.tipo === 'admin') isAdmin = true; } catch(e){}
    const where = isAdmin ? '' : 'WHERE ativo=1';
    const [rows] = await db.query(`SELECT * FROM shop_produtos ${where} ORDER BY categoria, nome`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shop/produtos', auth, adminOnly, async (req, res) => {
  try {
    const { nome, descricao, preco, categoria, imagem_url, estoque, ativo } = req.body;
    const [r] = await db.query(
      'INSERT INTO shop_produtos (nome,descricao,preco,categoria,imagem_url,estoque,ativo) VALUES (?,?,?,?,?,?,?)',
      [nome, descricao||null, parseFloat(preco)||0, categoria||'outro', imagem_url||null, parseInt(estoque)||0, ativo===false?0:1]
    );
    res.json({ id: r.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/shop/produtos/:id', auth, adminOnly, async (req, res) => {
  try {
    const { nome, descricao, preco, categoria, imagem_url, estoque, ativo } = req.body;
    await db.query(
      'UPDATE shop_produtos SET nome=?,descricao=?,preco=?,categoria=?,imagem_url=?,estoque=?,ativo=? WHERE id=?',
      [nome, descricao||null, parseFloat(preco)||0, categoria||'outro', imagem_url||null, parseInt(estoque)||0, ativo===false?0:1, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/shop/produtos/:id', auth, adminOnly, async (req, res) => {
  try {
    await db.query('DELETE FROM shop_produtos WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Pedidos — criar (público com nome+tel ou aluno logado)
app.post('/api/shop/pedidos', async (req, res) => {
  try {
    let { nome, tel, aluno_id, itens, obs } = req.body;
    if (!itens || !itens.length) return res.status(400).json({ error: 'Carrinho vazio' });

    // Se autenticado como aluno, pegar dados do cadastro
    const tokenHeader = req.headers.authorization?.split(' ')[1];
    if (tokenHeader) {
      try {
        const u = jwt.verify(tokenHeader, JWT_SECRET);
        if (u.tipo === 'aluno') {
          aluno_id = u.id;
          if (!nome || !tel) {
            const [rows] = await db.query('SELECT nome, tel FROM alunos WHERE id=?', [u.id]);
            if (rows[0]) { nome = nome || rows[0].nome; tel = tel || rows[0].tel; }
          }
        }
      } catch(e){}
    }

    if (!nome || !tel) return res.status(400).json({ error: 'Nome e telefone obrigatórios' });

    let total = 0;
    const itensValid = [];
    for (const item of itens) {
      const [p] = await db.query('SELECT * FROM shop_produtos WHERE id=? AND ativo=1', [item.produto_id]);
      if (!p.length) return res.status(400).json({ error: `Produto ${item.produto_id} não encontrado` });
      if (p[0].estoque < item.qtd) return res.status(400).json({ error: `Estoque insuficiente: ${p[0].nome}` });
      itensValid.push({ ...p[0], qtd: item.qtd });
      total += parseFloat(p[0].preco) * item.qtd;
    }

    const [r] = await db.query(
      'INSERT INTO shop_pedidos (aluno_id,nome_comprador,tel,total,obs) VALUES (?,?,?,?,?)',
      [aluno_id || null, nome, tel, total, obs || null]
    );
    const pedidoId = r.insertId;

    for (const item of itensValid) {
      await db.query(
        'INSERT INTO shop_pedido_itens (pedido_id,produto_id,nome_produto,preco_unitario,qtd) VALUES (?,?,?,?,?)',
        [pedidoId, item.id, item.nome, item.preco, item.qtd]
      );
      await db.query('UPDATE shop_produtos SET estoque=estoque-? WHERE id=?', [item.qtd, item.id]);
    }

    // Notifica admin
    const itensTxt = itensValid.map(i => `• ${i.nome} x${i.qtd}`).join('\n');
    const adminTel = process.env.ADMIN_TEL || '';
    if (adminTel) {
      await notificarWA(adminTel,
        `🛒 *Novo Pedido #${pedidoId}*\n👤 ${nome} · ${tel}\n\n${itensTxt}\n\n💰 *Total: R$ ${total.toFixed(2).replace('.',',')}*`
      ).catch(()=>{});
    }

    res.json({ ok: true, pedido_id: pedidoId, total });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Pedidos — listar (admin)
app.get('/api/shop/pedidos', auth, adminOnly, async (req, res) => {
  try {
    const { status } = req.query;
    const where = status && status !== 'todos' ? 'WHERE p.status=?' : '';
    const params = status && status !== 'todos' ? [status] : [];
    const [pedidos] = await db.query(
      `SELECT p.*, GROUP_CONCAT(CONCAT(i.qtd,'x ',i.nome_produto) SEPARATOR ' | ') as resumo_itens
       FROM shop_pedidos p
       LEFT JOIN shop_pedido_itens i ON i.pedido_id=p.id
       ${where}
       GROUP BY p.id
       ORDER BY p.criado_em DESC`,
      params
    );
    res.json(pedidos);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Pedido itens (admin detalhe)
app.get('/api/shop/pedidos/:id/itens', auth, adminOnly, async (req, res) => {
  try {
    const [itens] = await db.query('SELECT * FROM shop_pedido_itens WHERE pedido_id=?', [req.params.id]);
    res.json(itens);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Meus pedidos (aluno)
app.get('/api/shop/pedidos/meus', auth, async (req, res) => {
  try {
    if (req.user.tipo !== 'aluno') return res.status(403).json({ error: 'Acesso negado' });
    const [pedidos] = await db.query(
      `SELECT p.*, GROUP_CONCAT(CONCAT(i.qtd,'x ',i.nome_produto) SEPARATOR ' | ') as resumo_itens
       FROM shop_pedidos p
       LEFT JOIN shop_pedido_itens i ON i.pedido_id=p.id
       WHERE p.aluno_id=?
       GROUP BY p.id
       ORDER BY p.criado_em DESC`,
      [req.user.id]
    );
    res.json(pedidos);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Atualizar status pedido (admin)
app.put('/api/shop/pedidos/:id/status', auth, adminOnly, async (req, res) => {
  try {
    const { status } = req.body;
    await db.query('UPDATE shop_pedidos SET status=? WHERE id=?', [status, req.params.id]);
    // Notifica cliente
    const [p] = await db.query('SELECT * FROM shop_pedidos WHERE id=?', [req.params.id]);
    if (p[0] && p[0].tel) {
      const msgs = {
        confirmado: `✅ Pedido #${req.params.id} confirmado! Estamos preparando seu pedido. 🥊`,
        pronto: `📦 Pedido #${req.params.id} pronto para retirada! Venha buscar na academia. 🥊`,
        entregue: `🎉 Pedido #${req.params.id} entregue. Obrigado pela preferência! Punch and Roll 🥊`,
        cancelado: `❌ Pedido #${req.params.id} foi cancelado. Em caso de dúvidas, entre em contato.`,
      };
      if (msgs[status]) await notificarWA(p[0].tel, msgs[status]).catch(()=>{});
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════
// BOAS-VINDAS — FLUXO DE APROVAÇÃO
// ══════════════════════════════════════

const OWNER_EMAIL      = 'asbarcellos31@gmail.com';
const OWNER_WA_NUM     = '4899225-9899';   // Anderson
const INSTRUTOR_WA_NUM = '4898463-9257';   // Instrutor
const API_BASE         = process.env.API_URL || 'https://punch-and-roll-api-production.up.railway.app';
const SITE_BASE        = 'https://punchandroll.com.br';

async function gerarManualPDF() {
  const PDFDocument = require('pdfkit');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const RED = '#d4111c', DARK = '#111111', GRAY = '#555555';
    const w = doc.page.width - 100;

    // Cabeçalho
    doc.rect(50, 50, w, 60).fill(RED);
    doc.fillColor('#ffffff').fontSize(20).font('Helvetica-Bold').text('PUNCH AND ROLL FIGHT TEAM', 50, 65, { width: w, align: 'center' });
    doc.fontSize(9).font('Helvetica').text('MANUAL DE CONDUTA · 2026', 50, 90, { width: w, align: 'center' });
    doc.moveDown(3);

    const titulo = (n, t) => {
      doc.moveDown(0.5);
      doc.rect(50, doc.y, w, 18).fill(RED);
      doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold').text(`CAPÍTULO ${n}  ·  ${t}`, 56, doc.y - 14, { width: w - 12 });
      doc.moveDown(0.8);
      doc.fillColor(DARK);
    };
    const ok = (label, items) => {
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#16a34a').text(`✓ ${label}`, { indent: 10 });
      items.forEach(i => doc.fontSize(8).font('Helvetica').fillColor(GRAY).text(`    ✓  ${i}`, { indent: 10 }));
      doc.moveDown(0.4);
    };
    const no = (label, items) => {
      doc.fontSize(8).font('Helvetica-Bold').fillColor(RED).text(`✗ ${label}`, { indent: 10 });
      items.forEach(i => doc.fontSize(8).font('Helvetica').fillColor(GRAY).text(`    ✗  ${i}`, { indent: 10 }));
      doc.moveDown(0.4);
    };
    const txt = t => { doc.fontSize(9).font('Helvetica').fillColor(DARK).text(t, { indent: 10 }); doc.moveDown(0.3); };

    doc.fontSize(9).fillColor(DARK).font('Helvetica')
      .text('Punch and Roll Fight Team é uma equipe formada por pessoas que buscam evolução física, técnica e pessoal. Nossa missão não é apenas ensinar Boxe e Jiu-Jitsu — buscamos desenvolver disciplina, respeito, confiança, saúde, espírito esportivo e senso de comunidade. O descumprimento das regras poderá resultar em advertência, suspensão ou desligamento.', { indent: 10 });
    doc.moveDown(0.5);

    titulo('I','VALORES DA EQUIPE');
    txt('Respeito · Disciplina · Humildade · Honestidade · Pontualidade · Organização · Espírito Esportivo · Segurança · Companheirismo · Evolução');

    titulo('II','HIGIENE PESSOAL');
    ok('OBRIGATÓRIO — ALUNOS E PROFESSORES',['Tomar banho regularmente','Escovar os dentes antes das aulas','Utilizar desodorante','Manter unhas cortadas','Roupas, kimono, luvas e bandagens limpas','Protetores devidamente higienizados']);
    no('NÃO SERÁ PERMITIDO TREINAR',['Com uniforme excessivamente sujo','Com odor excessivo','Com lesões infecciosas expostas','Com doenças contagiosas']);

    titulo('III','APRESENTAÇÃO DOS PROFESSORES');
    ok('DEVEM MANTER',['Cabelos limpos e organizados','Barba aparada e higienizada','Uniforme oficial em bom estado','Linguagem respeitosa','Postura profissional']);
    no('É VEDADO',['Ministrar aulas com aparência desleixada','Utilizar linguagem ofensiva','Fazer comentários discriminatórios']);

    titulo('IV','PONTUALIDADE');
    ok('ALUNOS',['Chegar preferencialmente 10 minutos antes','Ingressar na aula já preparado']);
    ok('PROFESSORES',['Estar presentes antes do início','Preparar previamente materiais','Iniciar e encerrar nos horários programados']);

    titulo('V','UTILIZAÇÃO DO TATAME');
    ok('OBRIGATÓRIO',['Entrar descalço no tatame','Manter o tatame limpo','Respeitar os espaços delimitados']);
    no('PROIBIDO',['Entrar com calçados da rua','Comer sobre o tatame','Jogar lixo no chão','Sentar inadequadamente durante instruções']);

    titulo('VI','EQUIPAMENTOS PESSOAIS');
    ok('TRAZER OBRIGATORIAMENTE',['Kimono e faixa','Luvas e bandagens','Protetor bucal','Toalha e garrafa de água','Equipamentos de proteção da modalidade']);
    no('ATENÇÃO',['A academia não se responsabiliza por objetos esquecidos ou perdidos']);

    titulo('VII','ORGANIZAÇÃO DOS EQUIPAMENTOS');
    ok('QUEM UTILIZA: GUARDA, ORGANIZA E CONSERVA',['Luvas de treino e aparadores','Escudos e cones','Cordas e colchonetes','Materiais de preparação física']);
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#d97706').text('⚡  PRINCÍPIO: Usou → Guardou → Organizou', { indent: 10 }); doc.moveDown(0.4);

    titulo('VIII','LIMPEZA DOS AMBIENTES');
    ok('INCLUI TODOS OS AMBIENTES',['Banheiros · Recepção · Tatame · Área de equipamentos','Dar descarga · lavar as mãos · manter banheiro limpo']);
    no('PROIBIDO',['Jogar lixo no chão','Deixar copos ou garrafas espalhados','Deixar toalhas ou equipamentos abandonados']);

    titulo('IX','CONDUTA DURANTE OS TREINOS');
    ok('TODOS DEVEM',['Respeitar professores e colegas','Ouvir as instruções','Manter comportamento adequado']);
    no('PROIBIDO',['Interromper explicações','Brincadeiras perigosas','Provocar colegas','Linguagem ofensiva']);

    titulo('X','SPARRINGS E ROLAS');
    txt('Os combates são ferramentas de aprendizado, não disputas de ego.');
    ok('TODO PARTICIPANTE DEVERÁ',['Controlar força e intensidade','Respeitar iniciantes e diferenças físicas','Priorizar segurança acima de tudo']);
    no('NÃO SERÁ TOLERADO',['Excesso de agressividade','Golpes intencionais para machucar','Atitudes antidesportivas']);

    titulo('XI','SEGURANÇA');
    no('PROIBIDO TREINAR',['Sob efeito de álcool','Sob efeito de drogas ilícitas','Em condições que coloquem terceiros em risco']);
    txt('Professores têm autoridade para impedir alunos que representem risco. Toda lesão deve ser comunicada imediatamente.');

    titulo('XII','CELULARES');
    no('PROIBIDO',['Atender ligações durante instruções','Filmar terceiros sem autorização']);

    titulo('XIII','CRIANÇAS E ADOLESCENTES');
    ok('PAIS E RESPONSÁVEIS DEVERÃO',['Respeitar horários de início e término','Buscar os alunos ao término','Respeitar orientações dos professores']);

    titulo('XIV','REDES SOCIAIS');
    no('NÃO SERÃO TOLERADAS PUBLICAÇÕES QUE',['Ataquem membros da equipe','Difamem a academia','Exponham alunos sem autorização']);

    titulo('XV','PROFESSORES');
    ok('OS PROFESSORES DEVEM',['Dar exemplo dentro e fora da academia','Tratar todos de forma igualitária','Zelar pela segurança dos treinos','Cumprir a metodologia da equipe','Estimular ambiente acolhedor e familiar','Comunicar problemas disciplinares ou estruturais aos sócios']);
    doc.fontSize(8).font('Helvetica').fillColor('#92400e')
      .text('Advertência, suspensão ou desligamento poderão ser aplicados a qualquer integrante que descumprir as normas deste manual, a critério dos sócios.', { indent: 10 });

    // Código de Honra
    doc.addPage();
    doc.rect(50, 50, w, 30).fill(RED);
    doc.fillColor('#ffffff').fontSize(13).font('Helvetica-Bold').text('CÓDIGO DE HONRA — PUNCH AND ROLL', 50, 58, { width: w, align: 'center' });
    doc.moveDown(2);
    const honra = ['Respeito todos os membros da equipe.','Sou pontual.','Cuido do meu corpo e da minha higiene.','Cuido da academia como se fosse minha.','Ajudo os colegas a evoluírem.','Treino com disciplina e humildade.','Escuto meus professores.','Não utilizo minha técnica para intimidar pessoas.','Represento a Punch and Roll com honra.','Busco ser melhor hoje do que fui ontem.'];
    honra.forEach((item, i) => {
      doc.fontSize(11).font('Helvetica-Bold').fillColor(RED).text(`${String(i+1).padStart(2,'0')}`, 50, doc.y, { continued: true, width: 30 });
      doc.font('Helvetica').fillColor(DARK).text(`  ${item}`);
      doc.moveDown(0.4);
    });

    doc.moveDown(1);
    doc.fontSize(10).font('Helvetica-Oblique').fillColor(GRAY)
      .text('"Na Punch and Roll Fight Team, a força vem da técnica.\nA técnica vem da disciplina.\nE a disciplina constrói campeões dentro e fora dos tatames."', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(8).font('Helvetica').fillColor('#aaaaaa').text('SÃO JOSÉ · SANTA CATARINA · 2026', { align: 'center' });

    doc.end();
  });
}

function gerarEmailBoasVindas(d) {
  const nomeFirst = (d.nome||'').split(' ')[0];
  const modLabel  = d.modalidade === 'boxe' ? 'Boxe' : d.modalidade === 'jiujitsu' ? 'Jiu-Jitsu' : 'Boxe + Jiu-Jitsu';
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
  <div style="background:#ffffff;padding:28px 32px 20px;text-align:center;border-bottom:4px solid #d4111c">
    <img src="https://punchandroll.com.br/logo.png" alt="Punch and Roll Fight Team" style="height:130px;width:auto;display:block;margin:0 auto">
  </div>
  <div style="padding:32px 28px">
    <h2 style="color:#111;font-size:22px;margin:0 0 12px">Bem-vindo, ${nomeFirst}! 🎉</h2>
    <p style="color:#444;font-size:15px;line-height:1.7;margin:0 0 24px">
      Sua matrícula na <strong>Punch and Roll Fight Team</strong> foi confirmada. Estamos muito felizes em ter você na equipe!
    </p>

    <!-- PLANO -->
    <div style="background:#f9f9f9;border:1px solid #e5e5e5;border-radius:10px;padding:20px;margin-bottom:24px">
      <p style="color:#888;font-size:11px;letter-spacing:1px;text-transform:uppercase;margin:0 0 12px">SEU PLANO</p>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="color:#555;font-size:13px;padding:6px 0;border-bottom:1px solid #eee">Modalidade</td><td style="color:#111;font-size:13px;font-weight:bold;text-align:right;padding:6px 0;border-bottom:1px solid #eee">${modLabel}</td></tr>
        <tr><td style="color:#555;font-size:13px;padding:6px 0;border-bottom:1px solid #eee">Plano</td><td style="color:#111;font-size:13px;font-weight:bold;text-align:right;padding:6px 0;border-bottom:1px solid #eee">${d.plano||modLabel}</td></tr>
        <tr><td style="color:#555;font-size:13px;padding:8px 0 0">Mensalidade</td><td style="color:#d4111c;font-size:16px;font-weight:bold;text-align:right;padding:8px 0 0">R$ ${Number(d.valor||0).toFixed(0)}/mês</td></tr>
      </table>
    </div>

    <!-- PORTAL -->
    <div style="background:#fff8f8;border:1px solid #ffd0d0;border-radius:10px;padding:20px;margin-bottom:24px">
      <p style="color:#111;font-size:15px;font-weight:bold;margin:0 0 6px">📱 Acesse o Portal do Aluno</p>
      <p style="color:#555;font-size:13px;line-height:1.6;margin:0 0 16px">Pelo portal você acompanha suas aulas, histórico de treinos, mensalidades e recados da equipe.</p>
      <p style="color:#555;font-size:13px;margin:0 0 4px"><strong>Site:</strong> <a href="${SITE_BASE}/punch-and-roll-portal.html" style="color:#d4111c">${SITE_BASE}/punch-and-roll-portal.html</a></p>
      <p style="color:#555;font-size:13px;margin:0 0 16px"><strong>Login:</strong> seu e-mail ou primeiro nome &nbsp;|&nbsp; <strong>Senha inicial:</strong> 123</p>
      <div style="text-align:center">
        <a href="${SITE_BASE}/punch-and-roll-portal.html" style="background:#d4111c;color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-size:14px;font-weight:bold;letter-spacing:1px;display:inline-block">ACESSAR PORTAL</a>
      </div>
    </div>

    <!-- CHECK-IN -->
    <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:20px;margin-bottom:24px">
      <p style="color:#111;font-size:15px;font-weight:bold;margin:0 0 6px">✅ Como fazer Check-in na aula</p>
      <ol style="color:#444;font-size:13px;line-height:1.9;margin:0;padding-left:18px">
        <li>Acesse o Portal do Aluno</li>
        <li>Clique na aba <strong>"Minhas Aulas"</strong></li>
        <li>Selecione a aula do dia</li>
        <li>Clique em <strong>"Fazer Check-in"</strong></li>
      </ol>
      <p style="color:#666;font-size:12px;margin:10px 0 0">⏰ O check-in fica disponível a partir de 30 minutos antes do início da aula.</p>
    </div>

    <!-- MANUAL -->
    <div style="background:#f8f8f8;border:1px solid #e5e5e5;border-radius:10px;padding:20px;margin-bottom:24px">
      <p style="color:#111;font-size:15px;font-weight:bold;margin:0 0 6px">📋 Manual de Conduta</p>
      <p style="color:#555;font-size:13px;line-height:1.6;margin:0">O Manual de Conduta da Punch and Roll está em anexo neste email. Leia com atenção — ele traz nossas regras, valores e tudo que você precisa saber para aproveitar ao máximo seus treinos.</p>
    </div>

    <!-- CONTATO -->
    <div style="border-top:1px solid #eee;padding-top:20px">
      <p style="color:#888;font-size:11px;letter-spacing:1px;text-transform:uppercase;margin:0 0 10px">FALE COM A GENTE</p>
      <p style="color:#444;font-size:13px;line-height:1.8;margin:0">📍 R. Cel. Américo, 1157 · Sala 5 · Barreiros · São José, SC<br>👊 Admin: (48) 99225-9899<br>🥋 Instrutor: (48) 98463-9257<br>📸 <a href="https://instagram.com/punchandrollfight" style="color:#d4111c;text-decoration:none">@punchandrollfight</a><br>🌐 punchandroll.com.br</p>
    </div>
  </div>
  <div style="background:#111;padding:14px 24px;text-align:center">
    <p style="color:#555;font-size:11px;margin:0">Punch and Roll Fight Team · São José, SC · <a href="${SITE_BASE}" style="color:#d4111c">punchandroll.com.br</a></p>
  </div>
</div>
</body></html>`;
}

function gerarMsgWABoasVindas(d) {
  const nomeFirst = (d.nome||'').split(' ')[0];
  return `Olá, *${nomeFirst}*! 🥊\n\nSeja muito bem-vindo(a) à *Punch and Roll Fight Team*! 🎉\n\nSua matrícula foi confirmada:\n📋 *Plano:* ${d.plano||''}\n💰 *Valor:* R$ ${Number(d.valor||0).toFixed(0)}/mês\n\n*📱 Portal do Aluno*\nAcesse: ${SITE_BASE}/punch-and-roll-portal.html\n🔐 Login: seu e-mail ou primeiro nome\n🔑 Senha inicial: *123*\n\n*✅ Como fazer Check-in*\n1. Abra o portal\n2. Vá em "Minhas Aulas"\n3. Selecione a aula\n4. Clique em "Fazer Check-in"\n\nBora treinar! 💪\n\n📍 R. Cel. Américo, 1157 · Sala 5 · Barreiros · São José, SC\n👊 Admin: *(48) 99225-9899*\n🥋 Instrutor: *(48) 98463-9257*\n📸 Instagram: *@punchandrollfight*`;
}

function gerarManualAnexo() {
  const cap = (n, t, sub) => `<div style="margin-bottom:16px"><div style="background:#d4111c;color:#fff;font-size:10px;letter-spacing:2px;padding:3px 8px;display:inline-block;border-radius:3px;margin-bottom:6px">CAPÍTULO ${n}</div><div style="font-size:14px;font-weight:700;letter-spacing:1px;margin-bottom:${sub?'4px':'8px'}">${t}</div>${sub?`<p style="font-size:11px;color:#6b7280;font-style:italic;margin-bottom:8px">${sub}</p>`:''}`;
  const ok = (label, items) => `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:10px;margin-bottom:8px"><div style="font-size:10px;color:#16a34a;letter-spacing:1px;margin-bottom:6px">✓ ${label}</div>${items.map(i=>`<div style="font-size:12px;color:#374151;padding:3px 0;border-bottom:1px solid #bbf7d0">✓ ${i}</div>`).join('')}</div>`;
  const no = (label, items) => `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;padding:10px;margin-bottom:8px"><div style="font-size:10px;color:#dc2626;letter-spacing:1px;margin-bottom:6px">✗ ${label}</div>${items.map(i=>`<div style="font-size:12px;color:#374151;padding:3px 0;border-bottom:1px solid #fecaca">✗ ${i}</div>`).join('')}</div>`;
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Manual de Conduta — Punch and Roll</title></head>
<body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
  <div style="background:#ffffff;padding:22px 32px;text-align:center;border-bottom:4px solid #d4111c">
    <div style="font-size:26px;font-weight:900;letter-spacing:3px;line-height:1"><span style="color:#111">PUNCH </span><span style="color:#d4111c">AND</span><span style="color:#111"> ROLL</span></div>
    <div style="color:#111;opacity:0.5;font-size:10px;letter-spacing:3px;text-transform:uppercase;margin-top:5px">FIGHT TEAM</div>
  </div>
  <div style="padding:28px 32px;color:#333;line-height:1.7;font-size:15px;">
    <div style="text-align:center;margin-bottom:20px">
      <div style="font-size:18px;font-weight:700;letter-spacing:3px">MANUAL DE CONDUTA</div>
      <div style="font-size:12px;color:#d4111c;font-weight:600;margin-top:4px">DISCIPLINA E BOAS PRÁTICAS · PUNCH AND ROLL FIGHT TEAM · 2026</div>
      <div style="font-size:11px;color:#6b7280;margin-top:6px;font-style:italic">"Mais que uma academia. Uma família."</div>
    </div>
    <p style="margin-bottom:20px;line-height:1.7;color:#374151"><strong style="color:#111827">Sobre a Punch and Roll —</strong> Punch and Roll Fight Team é uma equipe formada por pessoas que buscam evolução física, técnica e pessoal. Nossa missão não é apenas ensinar Boxe e Jiu-Jitsu — buscamos desenvolver disciplina, respeito, confiança, saúde, espírito esportivo e senso de comunidade. Todos os alunos, professores, colaboradores e visitantes devem respeitar as regras descritas neste manual. O descumprimento poderá resultar em advertência, suspensão ou desligamento da equipe.</p>

    ${cap('I','VALORES DA EQUIPE','Todo integrante da Punch and Roll deve praticar:')}
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:4px">${['Respeito','Disciplina','Humildade','Honestidade','Pontualidade','Organização','Esp. Esportivo','Segurança','Companheirismo','Evolução'].map(v=>`<span style="background:#f3f4f6;border:1px solid #e5e7eb;border-radius:4px;padding:4px 10px;font-size:11px;letter-spacing:.5px">${v}</span>`).join('')}</div>
    </div>

    ${cap('II','HIGIENE PESSOAL','A higiene é uma demonstração de respeito aos colegas.')}
    ${ok('OBRIGATÓRIO — ALUNOS E PROFESSORES',['Tomar banho regularmente','Escovar os dentes antes das aulas','Utilizar desodorante','Manter unhas das mãos e dos pés cortadas','Utilizar roupas limpas','Utilizar kimonos limpos','Utilizar luvas e bandagens limpas','Utilizar protetores devidamente higienizados'])}
    ${no('NÃO SERÁ PERMITIDO TREINAR',['Com uniforme excessivamente sujo','Com odor excessivo','Com lesões infecciosas expostas','Com doenças contagiosas'])}
    </div>

    ${cap('III','APRESENTAÇÃO DOS PROFESSORES','Os professores representam a imagem da equipe.')}
    ${ok('DEVEM MANTER',['Cabelos limpos e organizados','Barba aparada e higienizada','Uniforme oficial da equipe em bom estado','Linguagem respeitosa','Postura profissional'])}
    ${no('É VEDADO',['Ministrar aulas com aparência desleixada','Utilizar linguagem ofensiva','Fazer comentários discriminatórios ou constrangedores'])}
    </div>

    ${cap('IV','PONTUALIDADE','A pontualidade demonstra respeito pelo tempo dos colegas.')}
    ${ok('ALUNOS',['Chegar preferencialmente 10 minutos antes do horário','Ingressar na aula já preparado para o treino'])}
    ${ok('PROFESSORES',['Estar presentes antes do início das aulas','Preparar previamente materiais e equipamentos','Iniciar e encerrar as aulas nos horários programados'])}
    </div>

    ${cap('V','UTILIZAÇÃO DO TATAME','')}
    ${ok('OBRIGATÓRIO',['Entrar descalço no tatame','Manter o tatame limpo','Respeitar os espaços delimitados'])}
    ${no('PROIBIDO',['Entrar com calçados utilizados na rua','Comer sobre o tatame','Jogar lixo no chão','Sentar-se de forma inadequada durante as instruções'])}
    </div>

    ${cap('VI','EQUIPAMENTOS PESSOAIS','Cada aluno é responsável por seus materiais.')}
    ${ok('TRAZER OBRIGATORIAMENTE QUANDO APLICÁVEL',['Kimono e faixa','Luvas e bandagens','Protetor bucal','Toalha e garrafa de água','Equipamentos de proteção exigidos para cada modalidade'])}
    <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;padding:10px;margin-bottom:8px"><div style="font-size:10px;color:#dc2626;letter-spacing:1px;margin-bottom:6px">✗ ATENÇÃO</div><div style="font-size:12px;color:#374151;padding:3px 0">✗ A academia não se responsabiliza por objetos esquecidos ou perdidos</div></div>
    </div>

    ${cap('VII','ORGANIZAÇÃO DOS EQUIPAMENTOS','Todo equipamento utilizado deve retornar ao local correto. A organização é responsabilidade de todos.')}
    ${ok('QUEM UTILIZA: GUARDA, ORGANIZA E CONSERVA',['Luvas de treino e aparadores','Escudos e cones','Cordas e colchonetes','Materiais de preparação física'])}
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:10px;margin-bottom:8px"><div style="font-size:11px;color:#d97706;font-weight:600">⚡ PRINCÍPIO: Usou → Guardou → Organizou</div></div>
    </div>

    ${cap('VIII','LIMPEZA DOS AMBIENTES','Todos devem colaborar com a limpeza.')}
    ${ok('INCLUI TODOS OS AMBIENTES',['Banheiros','Área de recepção','Tatame','Área de equipamentos','Área externa','Dar descarga · lavar as mãos · manter o banheiro limpo'])}
    ${no('PROIBIDO',['Jogar lixo no chão','Deixar copos descartáveis espalhados','Deixar garrafas vazias','Deixar toalhas ou equipamentos abandonados'])}
    </div>

    ${cap('IX','CONDUTA DURANTE OS TREINOS','')}
    ${ok('TODOS DEVEM',['Respeitar os professores','Respeitar os colegas','Ouvir as instruções','Manter comportamento adequado'])}
    ${no('PROIBIDO',['Interromper explicações','Fazer brincadeiras perigosas','Provocar colegas','Utilizar linguagem ofensiva'])}
    </div>

    ${cap('X','SPARRINGS E ROLAS','Os combates são <strong style="color:#111827">ferramentas de aprendizado</strong>, não disputas de ego. O respeito ao parceiro é inegociável.')}
    ${ok('TODO PARTICIPANTE DEVERÁ',['Controlar força e intensidade','Respeitar iniciantes','Respeitar diferenças físicas','Interromper imediatamente quando solicitado pelo professor','Priorizar segurança acima de tudo'])}
    ${no('NÃO SERÁ TOLERADO',['Excesso de agressividade','Golpes intencionais para machucar','Desrespeito ao parceiro de treino','Atitudes antidesportivas'])}
    </div>

    ${cap('XI','SEGURANÇA','Toda lesão deve ser comunicada imediatamente ao professor.')}
    ${no('PROIBIDO TREINAR',['Sob efeito de álcool','Sob efeito de drogas ilícitas','Em condições físicas que coloquem terceiros em risco'])}
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:10px;margin-bottom:8px"><div style="font-size:10px;color:#d97706;letter-spacing:1px;margin-bottom:6px">⚠ AUTORIDADE DO PROFESSOR</div><div style="font-size:12px;color:#374151">✓ Os professores possuem autoridade para impedir qualquer aluno de participar da aula caso identifiquem riscos à segurança.</div></div>
    </div>

    ${cap('XII','CELULARES','')}
    ${ok('DURANTE OS TREINOS',['Utilizar apenas quando necessário','Manter o foco na atividade'])}
    ${no('PROIBIDO',['Atender ligações durante instruções','Filmar terceiros sem autorização'])}
    </div>

    ${cap('XIII','CRIANÇAS E ADOLESCENTES','A formação do caráter é parte fundamental da metodologia da equipe.')}
    ${ok('PAIS E RESPONSÁVEIS DEVERÃO',['Respeitar os horários de início e término das aulas','Buscar os alunos ao término das aulas','Respeitar as orientações dos professores'])}
    </div>

    ${cap('XIV','REDES SOCIAIS','A imagem da Punch and Roll deve ser preservada por todos.')}
    ${ok('ESPERA-SE DE TODOS',['Respeito à equipe nas publicações','Respeito aos colegas e professores','Representar a academia com orgulho e responsabilidade'])}
    ${no('NÃO SERÃO TOLERADAS PUBLICAÇÕES QUE',['Ataquem membros da equipe','Difamem a academia','Exponham alunos sem autorização'])}
    </div>

    ${cap('XV','PROFESSORES','Além das demais regras, os professores têm responsabilidades adicionais.')}
    ${ok('OS PROFESSORES DEVEM',['Dar exemplo dentro e fora da academia','Tratar todos os alunos de forma igualitária','Zelar pela segurança dos treinos','Cumprir a metodologia definida pela equipe','Estimular um ambiente acolhedor e familiar','Comunicar imediatamente problemas estruturais ou disciplinares aos sócios'])}
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:10px;margin-bottom:8px"><div style="font-size:12px;color:#92400e;line-height:1.6"><strong>Advertência, suspensão ou desligamento</strong> poderão ser aplicados a qualquer integrante — aluno, professor ou colaborador — que descumprir as normas deste manual, a critério dos sócios da Punch and Roll Fight Team.</div></div>
    </div>

    <div style="background:rgba(212,17,28,.08);border:1px solid rgba(212,17,28,.3);border-radius:8px;padding:16px;margin-top:20px">
      <div style="font-size:13px;font-weight:700;color:#d4111c;margin-bottom:12px;letter-spacing:2px;text-align:center">CÓDIGO DE HONRA — PUNCH AND ROLL</div>
      ${['Respeito todos os membros da equipe.','Sou pontual.','Cuido do meu corpo e da minha higiene.','Cuido da academia como se fosse minha.','Ajudo os colegas a evoluírem.','Treino com disciplina e humildade.','Escuto meus professores.','Não utilizo minha técnica para intimidar pessoas.','Represento a Punch and Roll com honra.','Busco ser melhor hoje do que fui ontem.'].map((item,i)=>`<div style="display:flex;align-items:flex-start;gap:10px;padding:7px 0;border-bottom:1px solid rgba(212,17,28,.15)"><span style="font-size:15px;color:#d4111c;font-weight:700;min-width:24px">${String(i+1).padStart(2,'0')}</span><span style="font-size:12px;color:#374151;line-height:1.5">${item}</span></div>`).join('')}
    </div>
    <div style="text-align:center;margin-top:20px;padding-top:16px;border-top:1px solid #e5e5e5;color:#888;font-size:11px;font-style:italic;line-height:1.8">
      "Na Punch and Roll Fight Team, a força vem da técnica.<br>A técnica vem da disciplina.<br>E a disciplina constrói <strong style="color:#d4111c">campeões</strong> dentro e fora dos tatames."<br>
      <span style="font-size:10px;letter-spacing:2px;color:#aaa;font-style:normal">SÃO JOSÉ · SANTA CATARINA · 2026</span>
    </div>
  </div>
</div>
</body></html>`;
}

async function enviarPreviewParaAnderson(wpToken, d) {
  const urlAprovar  = `${API_BASE}/api/welcome/aprovar/${wpToken}`;
  const emailAluno  = gerarEmailBoasVindas(d);
  const waAluno     = gerarMsgWABoasVindas(d);

  // ── WhatsApp para o Anderson ──
  const waAnderson = `🥊 *Nova matrícula — aprovação necessária*\n\n👤 *${d.nome}*\n📋 ${d.plano}\n💰 R$ ${Number(d.valor||0).toFixed(0)}/mês\n📱 ${d.tel}\n\n*Mensagem que será enviada ao aluno:*\n\n${waAluno}\n\n✅ *Para aprovar e disparar (email + WA):*\n${urlAprovar}`;
  await notificarWA(OWNER_WA_NUM, waAnderson).catch(()=>{});

  // ── Email para o Anderson com preview completo ──
  if (!process.env.SENDGRID_API_KEY) return;
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:20px">
<div style="max-width:640px;margin:0 auto">
  <div style="background:#1a1a1a;border-radius:10px 10px 0 0;padding:20px 24px">
    <p style="color:#fff;font-size:16px;font-weight:bold;margin:0">🥊 Nova Matrícula — Aprovação Necessária</p>
    <p style="color:#aaa;font-size:12px;margin:6px 0 0">Aluno: <strong style="color:#fff">${d.nome}</strong> · ${d.plano} · R$ ${Number(d.valor||0).toFixed(0)}/mês · ${d.tel}</p>
  </div>
  <div style="background:#fff;padding:24px;border:1px solid #e5e5e5">
    <p style="color:#333;font-size:14px;margin:0 0 20px">Revise o email e o WhatsApp abaixo. Quando estiver ok, clique em <strong>Aprovar e Enviar</strong>.</p>
    <div style="text-align:center;margin-bottom:24px">
      <a href="${urlAprovar}" style="background:#16a34a;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:15px;font-weight:bold;letter-spacing:1px;display:inline-block">✅ APROVAR E ENVIAR</a>
    </div>
    <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:16px;margin-bottom:20px">
      <p style="color:#16a34a;font-size:10px;font-weight:bold;letter-spacing:1px;margin:0 0 10px">📱 WHATSAPP QUE SERÁ ENVIADO AO ALUNO</p>
      <pre style="font-family:Arial,sans-serif;font-size:13px;color:#333;white-space:pre-wrap;margin:0">${waAluno}</pre>
    </div>
  </div>
  <div style="border:2px dashed #d4111c;border-radius:0 0 10px 10px;padding:4px">
    <p style="text-align:center;color:#d4111c;font-size:10px;font-weight:bold;letter-spacing:1px;margin:8px 0">✉️ EMAIL QUE SERÁ ENVIADO AO ALUNO</p>
    ${emailAluno}
  </div>
</div>
</body></html>`;

  await axios.post('https://api.sendgrid.com/v3/mail/send', {
    personalizations: [{ to: [{ email: OWNER_EMAIL, name: 'Anderson Barcellos' }] }],
    from: { email: process.env.EMAIL_FROM || 'noreply@punchandroll.com.br', name: 'Punch and Roll Sistema' },
    subject: `[APROVAR] Boas-vindas para ${d.nome} — ${d.plano}`,
    content: [{ type: 'text/html', value: html }],
  }, { headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' } });
}

async function dispararBoasVindas(wpToken) {
  const [rows] = await db.query('SELECT * FROM welcome_pending WHERE token=? AND status="pendente"', [wpToken]);
  if (!rows.length) return { ok: false, msg: 'Já enviado ou não encontrado' };
  const p = rows[0];
  const d = { nome: p.nome, email: p.email, tel: p.tel, plano: p.plano, valor: p.valor, modalidade: p.modalidade };

  const emailHtml   = gerarEmailBoasVindas(d);
  const waMensagem  = gerarMsgWABoasVindas(d);

  // Busca manual PDF no banco; gera se não encontrar
  let manualBuf = null;
  try {
    const [mRows] = await db.query(
      "SELECT arquivo, mimetype, extensao FROM documentos WHERE visivel=1 AND (nome LIKE '%anual%' OR nome LIKE '%onduta%') ORDER BY criado_em DESC LIMIT 1"
    );
    if (mRows.length && mRows[0].arquivo) manualBuf = Buffer.from(mRows[0].arquivo);
  } catch(e) {}
  if (!manualBuf) manualBuf = await gerarManualPDF();
  const manualB64 = manualBuf.toString('base64');

  // Email para o aluno com manual em PDF anexo
  let emailOk = false;
  if (p.email && process.env.SENDGRID_API_KEY) {
    try {
      await axios.post('https://api.sendgrid.com/v3/mail/send', {
        personalizations: [{ to: [{ email: p.email, name: p.nome }] }],
        from: { email: process.env.EMAIL_FROM || 'noreply@punchandroll.com.br', name: 'Punch and Roll Fight Team' },
        subject: `🥊 Bem-vindo(a) à Punch and Roll, ${p.nome.split(' ')[0]}!`,
        content: [{ type: 'text/html', value: emailHtml }],
        attachments: [{ content: manualB64, filename: 'Manual-de-Conduta-Punch-and-Roll.pdf', type: 'application/pdf', disposition: 'attachment' }],
      }, { headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' } });
      emailOk = true;
    } catch(e) { console.error('Email bv error:', e.message); }
  }

  // WhatsApp para o aluno
  let waOk = false;
  try {
    await notificarWA(p.tel, waMensagem);
    waOk = true;
  } catch(e) { console.error('WA bv error:', e.message); }

  // Registra no histórico de Email MKT
  try {
    const [camp] = await db.query(
      `INSERT INTO email_campanhas (nome,status,total_enviados) VALUES (?,?,1)`,
      [`Boas-vindas — ${p.nome}`, 'CONCLUIDA']
    );
    await db.query(
      'INSERT INTO email_envios (campanha_id,contato_nome,contato_email,tipo,status) VALUES (?,?,?,?,?)',
      [camp.insertId, p.nome, p.email, 'INDIVIDUAL', emailOk ? 'ENVIADO' : 'ERRO']
    );
  } catch(e) { console.error('Email history error:', e.message); }

  // Registra no histórico de WA MKT
  try {
    const [waCamp] = await db.query(
      `INSERT INTO marketing_msgs (tipo,titulo,texto,segmento,status,qtd_enviados) VALUES (?,?,?,?,?,1)`,
      ['whatsapp', `Boas-vindas — ${p.nome}`, waMensagem, 'individual', 'enviado']
    );
    await db.query(
      'INSERT INTO wa_envios (campanha_id,nome,telefone,mensagem,tipo,status) VALUES (?,?,?,?,?,?)',
      [waCamp.insertId, p.nome, p.tel, waMensagem, 'INDIVIDUAL', waOk ? 'ENVIADO' : 'ERRO']
    );
  } catch(e) { console.error('WA history error:', e.message); }

  // Atualiza status do pending
  await db.query('UPDATE welcome_pending SET status="enviado", enviado_em=NOW() WHERE token=?', [wpToken]);

  // Notifica Anderson + Instrutor que novo aluno entrou
  const avisoEquipe = `✅ *Boas-vindas enviadas!*\n\n👤 *${p.nome}*\n📋 ${p.plano}\n💰 R$ ${Number(p.valor||0).toFixed(0)}/mês\n📱 ${p.tel}\n\n✉️ Email: ${emailOk ? 'enviado ✅' : 'falhou ❌'}\n📱 WhatsApp: ${waOk ? 'enviado ✅' : 'falhou ❌'}`;
  await notificarWA(OWNER_WA_NUM, avisoEquipe).catch(()=>{});
  await notificarWA(INSTRUTOR_WA_NUM, `🥊 *Novo aluno!*\n\n👤 *${p.nome}*\n📋 ${p.plano}\n📱 ${p.tel}`).catch(()=>{});

  // Relatório de entrega + preview para o Anderson
  if (process.env.SENDGRID_API_KEY) {
    const relHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:20px">
<div style="max-width:640px;margin:0 auto">
  <div style="background:#111;border-radius:10px 10px 0 0;padding:18px 24px">
    <p style="color:#fff;font-size:15px;font-weight:bold;margin:0">📊 Boas-Vindas Enviadas — ${p.nome}</p>
    <p style="color:#aaa;font-size:12px;margin:4px 0 0">${p.plano} · R$ ${Number(p.valor||0).toFixed(0)}/mês · ${new Date().toLocaleString('pt-BR')}</p>
  </div>
  <div style="background:#fff;padding:20px 24px;border:1px solid #e5e5e5">
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">
      <tr style="background:#f5f5f5"><th style="padding:8px;text-align:left">Canal</th><th style="padding:8px;text-align:left">Destino</th><th style="padding:8px;text-align:left">Status</th></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #eee">✉️ Email</td><td style="padding:8px;border-bottom:1px solid #eee">${p.email||'—'}</td><td style="padding:8px;border-bottom:1px solid #eee;color:${emailOk?'#16a34a':'#dc2626'};font-weight:bold">${emailOk?'✅ Enviado':'❌ Falhou'}</td></tr>
      <tr><td style="padding:8px">📱 WhatsApp</td><td style="padding:8px">${p.tel||'—'}</td><td style="padding:8px;color:${waOk?'#16a34a':'#dc2626'};font-weight:bold">${waOk?'✅ Enviado':'❌ Falhou'}</td></tr>
    </table>
    <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:14px;margin-bottom:16px">
      <p style="color:#16a34a;font-size:10px;font-weight:bold;letter-spacing:1px;margin:0 0 8px">📱 WHATSAPP ENVIADO</p>
      <pre style="font-family:Arial,sans-serif;font-size:12px;color:#333;white-space:pre-wrap;margin:0">${waMensagem}</pre>
    </div>
    <p style="color:#888;font-size:11px;margin:0">✅ Registrado no histórico de Email MKT e WA MKT</p>
  </div>
  <div style="border:2px dashed #d4111c;border-radius:0 0 10px 10px;padding:4px">
    <p style="text-align:center;color:#d4111c;font-size:10px;font-weight:bold;letter-spacing:1px;margin:6px 0">✉️ EMAIL ENVIADO AO ALUNO</p>
    ${emailHtml}
  </div>
</div>
</body></html>`;
    axios.post('https://api.sendgrid.com/v3/mail/send', {
      personalizations: [{ to: [{ email: OWNER_EMAIL, name: 'Anderson Barcellos' }] }],
      from: { email: process.env.EMAIL_FROM || 'noreply@punchandroll.com.br', name: 'Punch and Roll Sistema' },
      subject: `[P&R] Boas-vindas enviadas — ${p.nome}`,
      content: [{ type: 'text/html', value: relHtml }],
    }, { headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' } }).catch(()=>{});
  }

  return { ok: true, emailOk, waOk };
}


// ══════════════════════════════════════
// RELATÓRIO SEMANAL PRIVADO
// ══════════════════════════════════════

async function enviarRelatorioSemanal() {
  if (!process.env.SENDGRID_API_KEY) return;
  try {
    const agora = new Date();
    const inicio = new Date(agora);
    inicio.setDate(agora.getDate() - 7);
    const fmt = d => d.toISOString().slice(0,19).replace('T',' ');

    const [logins] = await db.query(
      `SELECT tipo, nome, email, ip, logado_em FROM login_log WHERE logado_em >= ? ORDER BY logado_em DESC`,
      [fmt(inicio)]
    );
    const [views] = await db.query(
      `SELECT pagina, COUNT(*) as total FROM page_views WHERE visto_em >= ? GROUP BY pagina ORDER BY total DESC`,
      [fmt(inicio)]
    );
    const [viewsTotal] = await db.query(
      `SELECT COUNT(*) as total FROM page_views WHERE visto_em >= ?`, [fmt(inicio)]
    );

    const admins = logins.filter(l => l.tipo === 'admin');
    const alunos = logins.filter(l => l.tipo === 'aluno');

    const linhasAdmin = admins.length
      ? admins.map(l => `<tr><td>${l.nome}</td><td>${l.email}</td><td>${l.ip}</td><td>${String(l.logado_em).slice(0,16)}</td></tr>`).join('')
      : '<tr><td colspan="4" style="color:#999">Nenhum acesso admin no período</td></tr>';

    const linhasAluno = alunos.length
      ? alunos.map(l => `<tr><td>${l.nome}</td><td>${l.email||'-'}</td><td>${l.ip}</td><td>${String(l.logado_em).slice(0,16)}</td></tr>`).join('')
      : '<tr><td colspan="4" style="color:#999">Nenhum acesso de aluno no período</td></tr>';

    const linhasViews = views.length
      ? views.map(v => `<tr><td>${v.pagina}</td><td style="text-align:center">${v.total}</td></tr>`).join('')
      : '<tr><td colspan="2" style="color:#999">Nenhuma visita registrada</td></tr>';

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1)">
        <div style="background:#1a1a1a;padding:22px 32px;text-align:center">
          <div style="font-size:24px;font-weight:900;letter-spacing:3px;color:#fff">PUNCH <span style="color:#d4111c">AND</span> ROLL</div>
          <div style="color:#aaa;font-size:11px;letter-spacing:3px;margin-top:4px">RELATÓRIO SEMANAL DE ACESSOS</div>
        </div>
        <div style="padding:28px 32px;color:#333">
          <p style="color:#666;font-size:13px">Período: <strong>${fmt(inicio).slice(0,10)}</strong> a <strong>${fmt(agora).slice(0,10)}</strong></p>

          <h3 style="color:#d4111c;border-bottom:2px solid #d4111c;padding-bottom:6px">🔐 Logins Admin (${admins.length})</h3>
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr style="background:#f5f5f5"><th style="padding:8px;text-align:left">Nome</th><th style="padding:8px;text-align:left">Email</th><th style="padding:8px;text-align:left">IP</th><th style="padding:8px;text-align:left">Data/Hora</th></tr></thead>
            <tbody>${linhasAdmin}</tbody>
          </table>

          <h3 style="color:#d4111c;border-bottom:2px solid #d4111c;padding-bottom:6px;margin-top:28px">👤 Logins Alunos (${alunos.length})</h3>
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr style="background:#f5f5f5"><th style="padding:8px;text-align:left">Nome</th><th style="padding:8px;text-align:left">Email</th><th style="padding:8px;text-align:left">IP</th><th style="padding:8px;text-align:left">Data/Hora</th></tr></thead>
            <tbody>${linhasAluno}</tbody>
          </table>

          <h3 style="color:#d4111c;border-bottom:2px solid #d4111c;padding-bottom:6px;margin-top:28px">📊 Visitas por Página (total: ${viewsTotal[0].total})</h3>
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr style="background:#f5f5f5"><th style="padding:8px;text-align:left">Página</th><th style="padding:8px;text-align:center">Visitas</th></tr></thead>
            <tbody>${linhasViews}</tbody>
          </table>
        </div>
        <div style="background:#f5f5f5;padding:14px 32px;font-size:11px;color:#999;text-align:center">Este relatório é privado e enviado automaticamente toda segunda-feira.</div>
      </div>`;

    await axios.post('https://api.sendgrid.com/v3/mail/send', {
      personalizations: [{ to: [{ email: 'asbarcellos31@gmail.com', name: 'Anderson Barcellos' }] }],
      from: { email: process.env.EMAIL_FROM || 'noreply@punchandroll.com.br', name: 'Punch and Roll Sistema' },
      subject: `[P&R] Relatório de Acessos — semana ${fmt(inicio).slice(0,10)} a ${fmt(agora).slice(0,10)}`,
      content: [{ type: 'text/html', value: html }],
    }, { headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' } });

    console.log('✅ Relatório semanal de acessos enviado para asbarcellos31@gmail.com');
  } catch (e) {
    console.error('Erro ao enviar relatório semanal:', e.message);
  }
}

// Cron semanal — toda segunda-feira às 08:00
function agendarRelatorioSemanal() {
  const verificar = () => {
    const agora = new Date();
    // Segunda-feira = 1, às 08:00
    if (agora.getDay() === 1 && agora.getHours() === 8 && agora.getMinutes() === 0) {
      enviarRelatorioSemanal();
    }
  };
  // Verifica a cada minuto
  setInterval(verificar, 60 * 1000);
}

// ══════════════════════════════════════
// TRACKING INTERNO (invisível no painel)
// ══════════════════════════════════════

// Disparo manual do relatório semanal (uso interno)
app.get('/api/_report-now', async (req, res) => {
  if (req.query.k !== 'pr2026priv') return res.sendStatus(403);
  try {
    const hasKey = !!process.env.SENDGRID_API_KEY;
    const from = process.env.EMAIL_FROM || 'noreply@punchandroll.com.br';
    if (!hasKey) return res.json({ ok: false, erro: 'SENDGRID_API_KEY não configurado no Railway' });
    await enviarRelatorioSemanal();
    res.json({ ok: true, from, para: 'asbarcellos31@gmail.com' });
  } catch(e) {
    res.json({ ok: false, erro: e.message });
  }
});

// Aprovação das boas-vindas — Anderson clica no link do WhatsApp/email
app.get('/api/welcome/aprovar/:token', async (req, res) => {
  try {
    const result = await dispararBoasVindas(req.params.token);
    if (!result.ok) return res.send(`<html><body style="font-family:Arial;text-align:center;padding:60px;background:#f4f4f4"><div style="max-width:400px;margin:0 auto;background:#fff;border-radius:12px;padding:40px"><h2 style="color:#888">⚠️ ${result.msg}</h2></div></body></html>`);
    res.send(`<html><body style="font-family:Arial;text-align:center;padding:60px;background:#f4f4f4">
      <div style="max-width:400px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 2px 12px rgba(0,0,0,.1)">
        <div style="font-size:48px;margin-bottom:16px">✅</div>
        <h2 style="color:#16a34a;margin:0 0 12px">Boas-vindas enviadas!</h2>
        <p style="color:#555;font-size:14px">✉️ Email: ${result.emailOk ? 'enviado ✅' : 'falhou ❌'}<br>📱 WhatsApp: ${result.waOk ? 'enviado ✅' : 'falhou ❌'}</p>
        <p style="color:#999;font-size:11px;margin-top:20px">Registrado no histórico de Email MKT e WA MKT.</p>
      </div>
    </body></html>`);
  } catch(e) { res.send(`<html><body style="font-family:Arial;text-align:center;padding:60px"><h2>❌ Erro: ${e.message}</h2></body></html>`); }
});

// Envia preview das boas-vindas para o Anderson (uso interno)
app.get('/api/_welcome-preview', async (req, res) => {
  if (req.query.k !== 'pr2026priv') return res.sendStatus(403);
  const d = { nome: 'NOME DO ALUNO', plano: 'Mensal — Boxe · 3x/sem', valor: 159, modalidade: 'boxe', email: 'email@aluno.com', tel: '(48) 99999-9999' };
  const waMsg = gerarMsgWABoasVindas(d);
  const emailHtml = gerarEmailBoasVindas(d);
  // Busca manual PDF no banco; gera se não encontrar
  let manualBuf = null;
  try {
    const [mRows] = await db.query(
      "SELECT arquivo FROM documentos WHERE visivel=1 AND (nome LIKE '%anual%' OR nome LIKE '%onduta%') ORDER BY criado_em DESC LIMIT 1"
    );
    if (mRows.length && mRows[0].arquivo) manualBuf = Buffer.from(mRows[0].arquivo);
  } catch(e) {}
  if (!manualBuf) manualBuf = await gerarManualPDF();
  const manualB64 = manualBuf.toString('base64');
  let waOk = false, emailOk = false;
  // WA para os dois números do Anderson
  const waMsgPreview = `🥊 *Preview — Boas-vindas dos novos alunos*\n\nEste é o modelo que será enviado automaticamente. Abaixo o texto do WhatsApp:\n\n---\n\n${waMsg}`;
  try { await notificarWA('48991860742', waMsgPreview); waOk = true; } catch(e){}
  try { await notificarWA(OWNER_WA_NUM, waMsgPreview); waOk = true; } catch(e){}
  // Email para o Anderson com manual em PDF anexo
  if (process.env.SENDGRID_API_KEY) {
    try {
      await axios.post('https://api.sendgrid.com/v3/mail/send', {
        personalizations: [{ to: [{ email: 'asbarcellos31@gmail.com', name: 'Anderson' }] }],
        from: { email: process.env.EMAIL_FROM || 'noreply@punchandroll.com.br', name: 'Punch and Roll Sistema' },
        subject: '[PREVIEW] Email de boas-vindas — novos alunos',
        content: [{ type: 'text/html', value: `<p style="font-family:Arial;background:#fffbe6;border:2px dashed #f59e0b;padding:16px;border-radius:8px;margin-bottom:20px"><strong>⚠️ ESTE É UM PREVIEW</strong> — modelo do email que será enviado automaticamente para cada novo aluno. Manual de Conduta em PDF anexo.</p>${emailHtml}` }],
        attachments: [{ content: manualB64, filename: 'Manual-de-Conduta-Punch-and-Roll.pdf', type: 'application/pdf', disposition: 'attachment' }],
      }, { headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' } });
      emailOk = true;
    } catch(e){}
  }
  res.json({ waOk, emailOk });
});

// Disparo manual de boas-vindas por aluno_id (uso interno)
app.get('/api/_welcome-manual/:aluno_id', async (req, res) => {
  if (req.query.k !== 'pr2026priv') return res.sendStatus(403);
  try {
    const [rows] = await db.query('SELECT * FROM alunos WHERE id=?', [req.params.aluno_id]);
    if (!rows.length) return res.json({ ok: false, msg: 'Aluno não encontrado' });
    const a = rows[0];
    const wpToken = require('crypto').randomBytes(24).toString('hex');
    await db.query(
      'INSERT INTO welcome_pending (aluno_id,token,nome,email,tel,plano,valor,modalidade) VALUES (?,?,?,?,?,?,?,?)',
      [a.id, wpToken, a.nome, a.email, a.tel, a.plano, a.valor||0, a.modalidade]
    );
    const result = await dispararBoasVindas(wpToken);
    res.json(result);
  } catch(e) { res.json({ ok: false, erro: e.message }); }
});

// Ping de visualização de página — chamado silenciosamente pelo frontend
app.post('/api/_pv', async (req, res) => {
  try {
    const { pagina } = req.body;
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
    const ua = req.headers['user-agent'] || '';
    const ref = req.headers['referer'] || '';
    await db.query('INSERT INTO page_views (pagina,ip,user_agent,referrer) VALUES (?,?,?,?)', [pagina || 'desconhecida', ip, ua, ref]);
    res.sendStatus(204);
  } catch { res.sendStatus(204); }
});

// START
// ══════════════════════════════════════
const PORT = process.env.PORT || 3000;
setupDB().then(() => {
  app.listen(PORT, () => console.log(`🥊 Punch and Roll API rodando na porta ${PORT}`));
  agendarRelatorioSemanal();
}).catch(e => {
  console.error('Erro ao configurar banco:', e.message);
  process.exit(1);
});
