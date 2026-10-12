# Falou, Anotou! — autenticação e dados por conta

Projeto existente evoluído para Node.js + Supabase Auth/PostgreSQL, mantendo identidade visual, voz, OCR, revisão, consultas, histórico e exportação. Login obrigatório antes do painel. Nenhum login fictício, serviço pago ou publicação foi realizado.

## Executar

```powershell
Set-Location 'C:\Users\Lino\Documents\Codex\2026-10-11\executar-o-aplicativo-conforme-o-readme\outputs\falou_anotou'
npm ci
npm start
```

Abra **http://localhost:8080/**. O servidor desta entrega já está ativo localmente; a tela de login pode ser examinada. Não inicie uma segunda instância na mesma porta. O túnel público anterior foi encerrado.

**Supabase de desenvolvimento conectado:** projeto `hlkxgjjspmdrwpkbqwuf`, informado pelo responsável. As nove tabelas, RLS, RPCs, bucket privado e hook de cadastro foram instalados e verificados. O `.env` local está configurado, mas não é incluído no Git ou nos pacotes. Em outro computador, configure URL/chave pública conforme o guia. Google, SMTP para clientes e testes completos de cadastro/login continuam pendentes. Sem backend configurado, o painel fica bloqueado; não há acesso demonstrativo que contorne a autenticação.

A versão agora depende deste servidor. Não use `python -m http.server` ou `npx serve` para autenticação.

## Documentação

- [Configuração completa de Supabase, Google OAuth, e-mails, variáveis e produção](CONFIGURACAO-AUTH.md)
- [Roteiro de testes reais e limites do que foi validado](TESTES-AUTH.md)
- [Estado atual da infraestrutura e pendências de homologação](INFRAESTRUTURA-ATUAL.md)
- [Hospedagem Vercel: build, sessões privadas e variáveis](CONFIGURACAO-VERCEL.md)
- [Preparação anterior Netlify, preservada como referência](CONFIGURACAO-NETLIFY.md)
- Minuta de Termos de Uso: **/termos-de-uso**
- Minuta de Política de Privacidade: **/politica-de-privacidade**

Rotas e versões jurídicas são configuráveis em `.env`. As páginas são públicas. Em desenvolvimento, contas fictícias podem ser testadas com Supabase configurado. Em produção, cadastro permanece bloqueado até liberação administrativa no servidor e banco, com o hook oficial ativado. As minutas precisam de dados empresariais, revisão e procedimentos; não há declaração de conformidade integral com a LGPD.

## Dados e segurança

Tokens não ficam no localStorage: o cookie contém apenas um identificador HttpOnly; sessões são criptografadas no servidor. Cada requisição privada verifica a identidade. PostgreSQL/RLS e RPCs transacionais utilizam `auth.uid()`, não um dono escolhido pelo navegador. Planos futuros ficam em tabela somente de leitura para o cliente; nenhuma cobrança foi implementada.

Registros antigos continuam no navegador/origem anterior e não são apagados nem enviados automaticamente. Após autenticar, existe importação explícita, validação, deduplicação e resultado confirmado. A remoção da cópia antiga exige nova confirmação. Exporte o original antes de mudar de domínio. A aplicação não pode ler dados locais de outro domínio.

OCR e voz podem errar: revise sempre. A foto é processada no dispositivo; apenas dados confirmados são gravados na conta. Biblioteca/modelo OCR e fontes são baixados de provedores externos, e a voz pode usar serviço do navegador. Sem promessa de reconhecimento offline. O saldo é o dos registros, não saldo bancário.

Nesta etapa a interface privada não é cacheada offline; o service worker remove caches antigos do app sem remover dados locais. Exclusão automatizada da conta completa, cobranças, SMTP de produção e validação da hospedagem pública continuam pendentes. A hospedagem escolhida agora é Vercel, com Function Node e sessões criptografadas em Blob privado; siga `CONFIGURACAO-VERCEL.md`. O repositório foi desconectado do projeto Netlify de testes.

## Testes e build

```powershell
npm run lint
npm test
npm run build
```

A verificação `lint` cobre sintaxe e referências HTML. Testes incluem regressões financeiras com transporte fixture, servidor/cookies/CSRF, PKCE do SDK oficial e SQL/RLS em PostgreSQL embutido com identidades de teste. `dist/` não contém .env, sessões ou node_modules.

UI em Chromium, conforme disponibilidade de Playwright: `npm run test:browser`. Consulte o guia para os caminhos deste computador. A integração real possui teste separado, `npm run test:integration`; sem projeto/contas ele reporta PENDENTE.

**Testado no PostgreSQL hospedado:** persistência de lançamentos/itens, revisões e isolamento entre identidades sintéticas por SQL, com rollback de todos os dados de teste. Roteiro: `tests/hosted-rls.sql`, somente no desenvolvimento. Isso não constitui login pelo Supabase Auth. Os 12 testes Node e as verificações de interface desktop/celular também passaram.

**Ainda não foram testados de ponta a ponta:** cadastro/confirmar e-mail, login por senha/Google, SMTP, recuperação, renovação/revogação e gravação pelo aplicativo com contas reais descartáveis. Hospedagem Netlify e microfone em celular físico também estão pendentes.
