# Falou, Anotou! — autenticação e dados por conta

Projeto existente evoluído para Node.js + Supabase Auth/PostgreSQL, mantendo identidade visual, voz, OCR, revisão, consultas, histórico e exportação. Login obrigatório antes do painel. Nenhum login fictício, serviço pago ou publicação foi realizado.

## Executar

```powershell
Set-Location 'C:\Users\Lino\Documents\Codex\2026-10-11\executar-o-aplicativo-conforme-o-readme\outputs\falou_anotou'
npm ci
npm start
```

Abra **http://localhost:8080/**. O servidor desta entrega já está ativo localmente; a tela de login pode ser examinada. Não inicie uma segunda instância na mesma porta. O túnel público anterior foi encerrado.

**Supabase ainda não foi criado/configurado.** Cadastro, senha, Google e recuperação usam o provedor real e só podem ser ativados após configuração. Sem backend, o painel fica bloqueado; não há acesso demonstrativo que contorne a autenticação.

A versão agora depende deste servidor. Não use `python -m http.server` ou `npx serve` para autenticação.

## Documentação

- [Configuração completa de Supabase, Google OAuth, e-mails, variáveis e produção](CONFIGURACAO-AUTH.md)
- [Roteiro de testes reais e limites do que foi validado](TESTES-AUTH.md)
- Minuta de Termos de Uso: **/termos-de-uso**
- Minuta de Política de Privacidade: **/politica-de-privacidade**

Rotas e versões jurídicas são configuráveis em `.env`. As páginas são públicas. Em desenvolvimento, contas fictícias podem ser testadas com Supabase configurado. Em produção, cadastro permanece bloqueado até liberação administrativa no servidor e banco, com o hook oficial ativado. As minutas precisam de dados empresariais, revisão e procedimentos; não há declaração de conformidade integral com a LGPD.

## Dados e segurança

Tokens não ficam no localStorage: o cookie contém apenas um identificador HttpOnly; sessões são criptografadas no servidor. Cada requisição privada verifica a identidade. PostgreSQL/RLS e RPCs transacionais utilizam `auth.uid()`, não um dono escolhido pelo navegador. Planos futuros ficam em tabela somente de leitura para o cliente; nenhuma cobrança foi implementada.

Registros antigos continuam no navegador/origem anterior e não são apagados nem enviados automaticamente. Após autenticar, existe importação explícita, validação, deduplicação e resultado confirmado. A remoção da cópia antiga exige nova confirmação. Exporte o original antes de mudar de domínio. A aplicação não pode ler dados locais de outro domínio.

OCR e voz podem errar: revise sempre. A foto é processada no dispositivo; apenas dados confirmados são gravados na conta. Biblioteca/modelo OCR e fontes são baixados de provedores externos, e a voz pode usar serviço do navegador. Sem promessa de reconhecimento offline. O saldo é o dos registros, não saldo bancário.

Nesta etapa a interface privada não é cacheada offline; o service worker remove caches antigos do app sem remover dados locais. Exclusão automatizada da conta completa, cobranças, SMTP de produção, backend distribuído e hospedagem pública continuam pendentes.

## Testes e build

```powershell
npm run lint
npm test
npm run build
```

A verificação `lint` cobre sintaxe e referências HTML. Testes incluem regressões financeiras com transporte fixture, servidor/cookies/CSRF, PKCE do SDK oficial e SQL/RLS em PostgreSQL embutido com identidades de teste. `dist/` não contém .env, sessões ou node_modules.

UI em Chromium, conforme disponibilidade de Playwright: `npm run test:browser`. Consulte o guia para os caminhos deste computador. A integração real possui teste separado, `npm run test:integration`; sem projeto/contas ele reporta PENDENTE.

**Ainda não foram testados no provedor real:** cadastro/confirmar e-mail, login por senha/Google, SMTP, recuperação, renovação/revogação e gravações num Supabase hospedado. O PostgreSQL embutido testa as políticas reais de banco, mas seus schemas de plataforma/identidades são fixtures, não um Supabase operacional.
