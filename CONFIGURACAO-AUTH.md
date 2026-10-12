# Configuração de autenticação — Falou, Anotou!

## Estado desta entrega

A integração foi implementada com **Supabase Auth real**, usando o SDK oficial no servidor. Não existe modo de login fictício. Como ainda não há um projeto Supabase, os fluxos reais permanecem desabilitados e a tela informa a configuração pendente. Nenhuma conta externa foi criada, nenhum e-mail real foi enviado e o projeto não foi publicado. O túnel público anterior foi encerrado.

Esta aplicação agora depende de Node.js 22+ e do backend, não pode ser executada por `python -m http.server` ou `npx serve`. O banco usa PostgreSQL/RLS; não armazena senhas nas tabelas da aplicação. Os recursos de voz, notas, revisão, consultas, histórico e exportação foram preservados e adaptados para gravação assíncrona confirmada pelo servidor.

## 1. Executar localmente

No PowerShell:

```powershell
Set-Location 'C:\Users\Lino\Documents\Codex\2026-10-11\executar-o-aplicativo-conforme-o-readme\outputs\falou_anotou'
npm ci
npm start
```

Abra **http://localhost:8080/**: visitante sem sessão é redirecionado para `/login`. O servidor desta tarefa já está em execução local. Encerre essa instância antes de iniciar outra na mesma porta. Ao iniciar pelo terminal, Ctrl+C encerra o processo.

Para cadastrar contas de teste de verdade, configure as etapas seguintes. Sem isso, a interface pode ser examinada, mas nunca libera o painel como se um login tivesse ocorrido.

## 2. Criar o projeto Supabase e configurar o banco

1. Acesse seu próprio dashboard Supabase e crie um projeto de **desenvolvimento** no plano escolhido por você. Esta entrega não contrata serviços pagos. Registre a região e os provedores que serão usados para completar a política de privacidade.
2. No projeto, obtenha a URL e a chave **publishable**; a chave legada `anon` também é aceita. Não use `service_role` ou `sb_secret_`. A aplicação não precisa dessas chaves administrativas.
3. No SQL Editor, execute, uma única vez e nessa ordem:
   - `supabase/migrations/202610120001_auth_and_ledger.sql`
   - `supabase/migrations/202610120002_private_storage_and_entitlements.sql`
   - `supabase/migrations/202610120003_account_preferences.sql`
4. Não exponha o schema `app_private` na Data API. Deixe apenas os schemas usuais da plataforma.

**O padrão do banco é seguro: produção e cadastro fechado.** Para habilitar testes com contas fictícias somente no seu projeto de desenvolvimento:

```sql
update app_private.security_policy
set environment = 'development',
    legal_ready = false,
    terms_version = 'minuta-2026-10-12',
    privacy_version = 'minuta-2026-10-12'
where singleton = true;
```

Isso permite testar contas reais do provedor usando as minutas, sem afirmar validade jurídica para comercialização. Não reutilize o projeto de desenvolvimento como produção com essa configuração.

## 3. Variáveis de ambiente

Copie `.env.example` para `.env` e preencha somente com valores reais do seu projeto:

```powershell
Copy-Item -LiteralPath '.env.example' -Destination '.env'
```

| Variável | Finalidade |
|---|---|
| `NODE_ENV` | `development` local; `production` exige HTTPS e configuração real |
| `PORT` | Porta local, padrão 8080 |
| `APP_ORIGIN` | Origem canônica, local `http://localhost:8080`; sem caminho/query |
| `SUPABASE_URL` | URL real do projeto |
| `SUPABASE_PUBLISHABLE_KEY` | Chave pública; alternativa legada `SUPABASE_ANON_KEY` |
| `SESSION_SECRET` | Segredo base64 de 32 bytes, obrigatório em produção |
| `SESSION_DAYS` | Prazo máximo da sessão BFF, 1 a 30 dias |
| `PASSWORD_MIN_LENGTH` | Mínimo 15 caracteres; alinhar com Supabase |
| `GOOGLE_AUTH_ENABLED` | `true` somente após configurar o provider Google |
| `TERMS_PATH`, `PRIVACY_PATH` | Rotas locais configuráveis; padrões solicitados |
| `TERMS_VERSION`, `PRIVACY_VERSION` | Versões que devem coincidir com o banco |
| `LEGAL_APPROVED`, `LEGAL_PUBLISHED` | Liberação administrativa depois de concluir/revisar/publicar os textos |
| `COMPANY_NAME`, `COMPANY_DOCUMENT`, `COMPANY_ADDRESS` | Dados reais do responsável, sem exemplos de produção |
| `PRIVACY_CONTACT_EMAIL` | Canal oficial para dados e direitos |
| `AUTH_RUNTIME_DIR` | Opcional: volume persistente protegido para sessões criptografadas |

Gere a chave de sessão apenas no seu ambiente e guarde-a em gerenciador de segredos:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Em desenvolvimento, sem `SESSION_SECRET`, o servidor gera uma chave em `.runtime/development.key`. `.runtime` e `.env` nunca são servidos por HTTP ou incluídos no build. Proteja a pasta pelas permissões do sistema operacional; em produção use segredo externo, disco protegido e armazenamento persistente. A chave de desenvolvimento não deve ser distribuída.

Reinicie `npm start` após mudar `.env`. Use sempre a origem definida em `APP_ORIGIN`; `localhost` e `127.0.0.1` não são intercambiáveis para callbacks/CSRF. O servidor não confia em `X-Forwarded-Host` ou em identificadores enviados para escolher o dono dos dados.

## 4. E-mail, confirmação e recuperação

Em **Authentication → Sign In / Providers → Email**, habilite e-mail/senha e **Confirm email**. Configure o mínimo de senha em **15** ou no mesmo valor escolhido no servidor. Regras adicionais do provedor também se aplicam. Não habilitamos recursos pagos de proteção contra senhas vazadas sem autorização.

Em **Authentication → URL Configuration**:

- Site URL: `http://localhost:8080` no desenvolvimento.
- Redirect URLs: `http://localhost:8080/auth/confirm` e `http://localhost:8080/auth/callback`.
- Não use wildcard de host/path nem permita destinos externos arbitrários. O identificador de fluxo e o verificador PKCE ficam no servidor; o exchange utiliza esse fluxo específico. Não ativamos a opção experimental de adicionar `sb_flow_id` à URL. Os redirects são fixos e a identidade é validada após o exchange.

Em **Authentication → Email Templates**, use os modelos abaixo. Isso é necessário para o fluxo de confirmação no servidor, que valida `token_hash` oficialmente com `verifyOtp` e não aceita tokens no localStorage. Links não são consumidos por um GET de scanner de e-mail: a página exige confirmação do usuário por POST.

**Confirm sign up:**

```html
<h2>Confirme seu e-mail no Falou, Anotou!</h2>
<p>Se você solicitou esta conta, confirme abaixo. Caso contrário, ignore esta mensagem.</p>
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=email">Confirmar meu e-mail</a>
```

**Reset password:**

```html
<h2>Recupere seu acesso ao Falou, Anotou!</h2>
<p>Se você solicitou a recuperação, use o link abaixo. Caso contrário, ignore esta mensagem.</p>
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery">Escolher nova senha</a>
```

Após confirmar cadastro, a sessão temporária de verificação é encerrada e o usuário retorna ao login. Depois de entrar, confirma o aceite das versões atuais; esse aceite é gravado de forma vinculada à conta e com data do banco. O checkbox do cadastro é requisito para solicitar criação; o registro definitivo de aceite ocorre após e-mail confirmado.

Recuperação: solicitação sem revelar se o e-mail existe → link → confirmação oficial → sessão restrita de recuperação → nova senha → logout e novo login. A recuperação tem janela de 15 minutos no BFF, além da validade estabelecida pelo Supabase.

O e-mail padrão da plataforma tem limitações de teste e envio; configure e valide um SMTP adequado antes de comercializar. Não foi contratado um SMTP nesta entrega. [Referências: passwords](https://supabase.com/docs/guides/auth/passwords), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates).

## 5. Google OAuth

No **Google Auth Platform**, dentro do seu projeto Google Cloud:

1. Configure Branding, Audience (incluindo usuários de teste quando em Testing) e somente os scopes de identidade: `openid`, e-mail e perfil.
2. Em Clients, crie um OAuth Client do tipo **Web application**.
3. Authorized JavaScript origins: `http://localhost:8080` no desenvolvimento; depois a origem HTTPS autorizada.
4. Authorized redirect URIs: copie a callback exibida em **Supabase → Authentication → Providers → Google**. Para um projeto hospedado, será a callback do próprio projeto em `/auth/v1/callback`, não a rota `/auth/callback` da aplicação.
5. Cole Client ID e Client Secret **somente no provider Google do Supabase** e habilite-o. O segredo Google não entra em `.env`, HTML, JS público ou backup deste aplicativo.
6. Defina `GOOGLE_AUTH_ENABLED=true` no BFF e reinicie.

O código usa `signInWithOAuth`/`exchangeCodeForSession` do SDK, PKCE por fluxo e binding à sessão. Não cria conta por e-mail recebido do navegador, não faz vinculação manual e não solicita acesso a Gmail/Drive. O reconhecimento de contas/identidades existentes permanece a cargo do fluxo oficial Supabase. Perfil da aplicação é criado pelo trigger do banco. Cancelamento/falha retorna ao login.

Antes do uso público, complete as verificações de marca/domínio exigidas pelo Google e remova configurações exclusivas de desenvolvimento. [Guia oficial de Google no Supabase](https://supabase.com/docs/guides/auth/social-login/auth-google).

## 6. Bloqueio de cadastro no provedor

Em **Authentication → Hooks → Before User Created**, habilite o hook PostgreSQL `public.before_user_created`. Ele já vem com permissões restritas a `supabase_auth_admin`; usuários públicos não podem chamá-lo diretamente. O hook bloqueia novos usuários, inclusive criação por Google, quando o banco está em produção e os documentos não foram liberados.

Esse passo é obrigatório: ocultar o botão ou bloquear só o BFF não impede chamadas diretas à API Auth pública. [Guia do hook](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook).

## 7. Preparação de produção — não executada nesta entrega

Não publique até concluir os documentos, identificação, contato, região do banco, retenções, backups, procedimento de exclusão de conta, suporte e avaliação jurídica. Os textos estão em `server/pages.js`; as rotas são `/termos-de-uso` e `/politica-de-privacidade`. O cadastro de produção só é liberado por configuração administrativa do servidor **e** do banco. Flags não substituem corrigir o conteúdo das minutas.

1. Complete/revise os textos e publique-os apenas quando houver autorização para publicação.
2. Preencha dados empresariais reais, contato e versões definitivas (sem “minuta”/“draft”). Defina `LEGAL_APPROVED=true` e `LEGAL_PUBLISHED=true` somente depois da revisão/publicação.
3. No banco, defina `environment='production'`, `legal_ready=true` e as mesmas versões definitivas. Sem isso, o banco continua negando acesso financeiro/aceite.
4. Use `NODE_ENV=production`, origem HTTPS fixa, segredo de sessão próprio, provider/hook e SMTP configurados. Restrinja os redirects à origem oficial.
5. O Node escuta em loopback: coloque um proxy TLS confiável à frente, mantendo o `Host` canônico. Configure rate limiting no perímetro, monitoramento sem conteúdo financeiro/senhas/tokens e políticas de backup. O limitador interno usa IP do socket, sem confiar em headers de proxy.
6. Use uma única instância/processo com volume persistente de sessões nesta etapa. Antes de múltiplas instâncias, substitua o store por um serviço compartilhado com locks, proteção de segredo, expiração e rotação de refresh. Não compartilhe `.runtime` entre processos independentes.
7. Verifique RLS, armazenamento privado, renovação, revogação, logout e fluxos reais num ambiente de testes antes da liberação.

Por segurança, o PWA não cacheia HTML privado, dados ou APIs. O service worker apaga somente caches antigos do aplicativo; **não remove localStorage**. Nesta etapa o painel autenticado requer conexão com o backend. A antiga interface offline não foi mantida como um modo que contorna autenticação.

## 8. Registros antigos e isolamento

Depois de autenticar, o histórico carregado é exclusivamente o da conta. Se existir `falou-anotou-ledger-v1` no mesmo navegador/origem, aparece um aviso com exportação do original e importação explícita. Nada é enviado automaticamente. IDs/chaves repetidos são deduplicados; conflitos invalidam a transação inteira. Dados sem ID recebem ID estável no servidor.

Somente depois do resultado confirmado pelo banco pode ser oferecida a remoção da cópia antiga, com nova confirmação e checagem de que a cópia/conta não mudou. Faça backup antes de mudar de origem; dados do antigo domínio HTTPS continuam nesse domínio, mesmo com o túnel encerrado. A aplicação não consegue ler o localStorage de outro domínio.

O proprietário é obtido de `auth.uid()`/JWT verificado. `user_id`, plano ou premium enviados num lançamento são rejeitados. O header de contexto da conta apenas detecta guias desatualizadas; não determina o proprietário. RLS protege leitura; gravações usam RPCs transacionais que verificam identidade, e-mail e aceite e recebem **nenhum** parâmetro de dono. Escritas diretas no ledger/itens são negadas. Itens possuem FK composta por conta e compra; exclusão de compra remove seus itens.

O bucket `receipt-private` é privado e tem políticas por identidade para uso futuro. Nenhuma imagem é enviada para esse bucket pela aplicação atual. Categorias, lojas, preferências e perfis são isolados. `entitlements` é somente leitura para o usuário; mudanças futuras precisam de backend administrativo confiável/webhook verificado. Sem cobrança, concessão premium por metadata ou plano escolhido pelo navegador.

## 9. Testes e pendências

```powershell
npm run lint
npm test
npm run build
```

`lint` é uma verificação estática de sintaxe/IDs HTML; não é um relatório ESLint. `build` cria `dist/` sem segredos/sessões. `npm test` testa finanças e revisão com transporte fixture, segurança do BFF/cookies/CSRF e SQL/RLS executados num PostgreSQL embutido (PGlite), com schemas e identidades de teste. Esses fixtures não são mecanismo de autenticação do aplicativo.

Teste de UI neste computador, em perfis descartáveis:

```powershell
$env:PLAYWRIGHT_MODULE='C:\Users\Lino\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright'
$env:BROWSER_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:browser
```

**Executado:** verificações estáticas, regressões, PostgreSQL/RLS (incluindo duas contas, arquivo privado, e-mail não confirmado, plano imutável e rollback), sessões criptografadas/CSRF, expiração/logout por contrato com stub e UI 1280×900 / 390×844. `npm audit --omit=dev` não encontrou vulnerabilidades conhecidas na execução do teste.

**Não executado no provedor real:** criação/confirmar e-mail, entrega de SMTP, login por senha, Google (novo/existente/cancelamento), recuperação, renovação/revogação e persistência via Supabase hospedado. Também faltam testes em celular físico e revisão de infraestrutura/documentos.

Depois de configurar Supabase, crie duas contas fictícias de teste pelo cadastro, confirme seus e-mails e entre. O roteiro detalhado está em `TESTES-AUTH.md`. `tests/supabase-live.js` aceita `TEST_USER_A_EMAIL`, `TEST_USER_A_PASSWORD`, `TEST_USER_B_EMAIL`, `TEST_USER_B_PASSWORD` somente para contas descartáveis já confirmadas. Sem essas variáveis, reporta **PENDENTE**, não sucesso. Não usa chave administrativa ou simulação de login.
