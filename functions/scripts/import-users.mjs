// Carga em massa de usuários em user_profiles (sempre role "user").
//
// Uso (a partir de functions/):
//   node scripts/import-users.mjs <arquivo>           # simulação, não grava nada
//   node scripts/import-users.mjs <arquivo> --apply   # grava no Firestore
//
// Arquivo: uma linha por usuário, "email" ou "email;chaveGroq" (separador , ; ou tab).
// Linhas vazias, começando com "#" e o cabeçalho "email" são ignoradas.
// Chave do Groq compartilhada: defina GROQ_API_KEY; linhas sem chave própria usam ela.
//
// Credencial: GOOGLE_APPLICATION_CREDENTIALS apontando para o JSON de uma service
// account do projeto, ou `gcloud auth application-default login`.
//
// Regras iguais às da function upsertUser (src/adminUsers.ts), exceto: quem já tem
// perfil é PULADO — a role e o bloqueio existentes nunca são alterados.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'reunia-5974f';
const COLLECTION = 'user_profiles';
const EMAIL_PATTERN = /^[a-z0-9._%+-]+@ambiental\.sc$/;
const GROQ_KEY_PATTERN = /^gsk_[\w-]{20,200}$/;
const BATCH_SIZE = 400; // limite do Firestore é 500 escritas por batch

const print = (message) => process.stdout.write(`${message}\n`);
const unquote = (value) => value.trim().replace(/^"|"$/g, '').trim();

/** Lê o arquivo e separa o que é válido do que precisa ser corrigido. */
export function parseInput(text, sharedKey = '') {
  const entries = new Map();
  const problems = [];

  text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .forEach((raw, index) => {
      const line = raw.trim();
      if (line === '' || line.startsWith('#')) return;

      const [rawEmail, rawKey = ''] = line.split(/[;,\t]/).map(unquote);
      const email = rawEmail.toLowerCase();
      if (email === 'email') return;

      const lineNumber = index + 1;
      const groqApiKey = rawKey || sharedKey;
      if (!EMAIL_PATTERN.test(email)) {
        problems.push({ lineNumber, reason: `e-mail inválido: "${rawEmail}"` });
      } else if (groqApiKey !== '' && !GROQ_KEY_PATTERN.test(groqApiKey)) {
        problems.push({ lineNumber, reason: `chave do Groq inválida para ${email}` });
      } else if (entries.has(email)) {
        problems.push({ lineNumber, reason: `e-mail repetido: ${email}` });
      } else {
        entries.set(email, { email, groqApiKey });
      }
    });

  return { entries: [...entries.values()], problems };
}

async function findExisting(db, emails) {
  const existing = new Set();
  for (let start = 0; start < emails.length; start += BATCH_SIZE) {
    const refs = emails.slice(start, start + BATCH_SIZE).map((email) => db.collection(COLLECTION).doc(email));
    const snaps = await db.getAll(...refs);
    snaps.filter((snap) => snap.exists).forEach((snap) => existing.add(snap.id));
  }
  return existing;
}

async function createProfiles(db, entries) {
  for (let start = 0; start < entries.length; start += BATCH_SIZE) {
    const batch = db.batch();
    entries.slice(start, start + BATCH_SIZE).forEach(({ email, groqApiKey }) => {
      // create() falha se o doc já existir, então nada é sobrescrito numa corrida.
      batch.create(db.collection(COLLECTION).doc(email), {
        authorized: true,
        role: 'user',
        ...(groqApiKey ? { groqApiKey } : {}),
      });
    });
    await batch.commit();
    print(`  gravados ${Math.min(start + BATCH_SIZE, entries.length)}/${entries.length}`);
  }
}

async function main(argv) {
  const [file] = argv.filter((arg) => !arg.startsWith('--'));
  const shouldApply = argv.includes('--apply');
  if (!file) {
    print('Uso: node scripts/import-users.mjs <arquivo> [--apply]');
    return 1;
  }

  const { entries, problems } = parseInput(readFileSync(file, 'utf8'), (process.env.GROQ_API_KEY ?? '').trim());
  problems.forEach(({ lineNumber, reason }) => print(`  linha ${lineNumber}: ${reason}`));

  initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() });
  const db = getFirestore();
  const existing = await findExisting(db, entries.map((entry) => entry.email));
  const toCreate = entries.filter((entry) => !existing.has(entry.email));

  print(`Válidos: ${entries.length} | Já cadastrados (pulados): ${existing.size} | A criar: ${toCreate.length}`);
  print(`Com chave do Groq: ${toCreate.filter((entry) => entry.groqApiKey).length} de ${toCreate.length}`);
  print(`Linhas com problema: ${problems.length}`);

  if (!shouldApply) {
    print('Simulação: nada foi gravado. Rode de novo com --apply.');
    return 0;
  }
  if (problems.length > 0) {
    print('Corrija as linhas com problema antes de usar --apply.');
    return 1;
  }
  await createProfiles(db, toCreate);
  print('Concluído.');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`Falha: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
  );
}
