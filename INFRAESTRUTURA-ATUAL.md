# Estado da integração — 12/10/2026

Repositório: https://github.com/Falouanotou/Falou-anotou-

Branch de trabalho: `integracao/infraestrutura`. O repositório estava vazio; o aplicativo existente foi preservado nessa branch. Nenhum merge em main foi feito.

Supabase: `hlkxgjjspmdrwpkbqwuf`, reaproveitado conforme URL fornecida. Região exibida no painel: West US (Oregon), `us-west-2`. A conta foi autenticada no navegador para operar o painel; nenhum segredo administrativo foi copiado para o aplicativo.

## Instalação e verificações

As três migrações em `supabase/migrations/` foram executadas em uma única transação no SQL Editor, após auditoria confirmar ausência de tabelas/funções do aplicativo, políticas Storage, buckets e triggers adicionais em auth.users. Nove tabelas públicas foram criadas com RLS e permissões explícitas; `app_private.security_policy` ficou em `development`, com `legal_ready=false`. Produção continua dependente da revisão/publicação dos documentos e de configurar o ambiente do banco como `production`.

O bucket `receipt-private` é privado. A interface ainda processa fotos localmente e não faz upload para ele. Upload privado persistente permanece pendente.

O hook Before User Created está habilitado na função `public.before_user_created`. E-mail está habilitado com confirmação obrigatória; login anônimo está desabilitado. A senha mínima no provedor foi alinhada aos 15 caracteres da aplicação.

Site URL: `http://localhost:8080`. Callbacks permitidos:

- `http://localhost:8080/auth/confirm`
- `http://localhost:8080/auth/callback`

Nenhum wildcard de produção foi autorizado. Origem HTTPS de homologação deverá ser adicionada somente quando existir e ser verificada.

Consultas públicas `limit=0` passaram de PGRST205 para 42501/401: tabelas reconhecidas, leitura anônima recusada. O OpenAPI também retorna 401 para chave pública, conforme mudança oficial do Supabase de 2026; isso não impede uso normal da Data API. [Referência](https://supabase.com/changelog/42949-breaking-change-removing-access-to-openapi-spec-via-the-anon-key).

`tests/hosted-rls.sql` passou no PostgreSQL hospedado: registros/itens próprios, conflito de revisão, leitura/escrita entre contas, alteração premium, mutações financeiras diretas e acesso anônimo. São identidades SQL sintéticas, sem login, e-mails ou uploads; a transação foi revertida integralmente.

`npm test`: parser/regressões e 12 testes Node aprovados. `npm run lint`: 23 scripts aprovados. `npm run test:browser`: desktop 1280×900 e celular 390×844 aprovados, sem erros JavaScript/transbordamento. O navegador de teste não usa contas reais.

## Avisos de segurança revisados

O Advisor apresentou quatro warnings sobre RPCs SECURITY DEFINER executáveis por `authenticated`: aceite de documentos, leitura/gravação do histórico e atualização de preferências. Esse acesso é intencional para validar no banco operações da própria conta, sem conceder escrita financeira direta. As funções verificam a identidade confirmada, vinculam operações a auth.uid(), restringem permissões e fixam search_path vazio; as operações financeiras exigem aceite/política jurídica. Os warnings não foram ocultados. Permanecem como pontos para revisão independente antes da produção; testes e esta revisão não equivalem a uma certificação de segurança.

O painel exibiu “No backups”; disponibilidade, retenção e restauração dos backups ainda precisam de verificação. A exportação pelo aplicativo existe, mas não substitui um plano operacional de backup/restauração.

SQL Editor não registra automaticamente o histórico da Supabase CLI. As migrações foram aplicadas, mas o registro de versões deve ser reconciliado por `supabase migration repair` após revisar o histórico com uma conexão CLI autenticada. Não executar novamente CREATE TABLE no projeto instalado sem essa conferência.

## E-mail e Google

O plano atual não permite editar templates sem SMTP próprio ou Pro. Não houve alteração de plano. O aplicativo foi adaptado para os links padrão PKCE, com verificadores no servidor e confirmação por POST. Abra o link no navegador em que iniciou a solicitação; cookies perdidos/outro navegador exigem nova solicitação. O fluxo token_hash continua disponível quando templates personalizados puderem ser configurados. O link padrão é verificado primeiro pelo Supabase e pode ser consumido por scanners de e-mail.

O SMTP padrão é limitado a testes. Entrega para clientes depende de SMTP configurado diretamente no painel, sem enviar senhas/segredos pelo chat. Cadastro, confirmação, login e recuperação reais ainda precisam de teste manual com contas descartáveis e e-mails permitidos pelo serviço.

O usuário informou que ainda não criou cliente OAuth Google. No projeto Google Cloud existente, configurar Google Auth Platform (Branding/Audience), manter modo de testes e cadastrar usuários de teste; criar um cliente Web com a callback exata:

`https://hlkxgjjspmdrwpkbqwuf.supabase.co/auth/v1/callback`

Configurar Client ID e Client Secret diretamente no provider Google do Supabase. Somente após habilitar/verificar o provider, ativar `GOOGLE_AUTH_ENABLED=true` no servidor e testar. Não incluir Client Secret no Git, browser bundle ou chat. Usar apenas escopos básicos de identidade. [Procedimento oficial](https://supabase.com/docs/guides/auth/social-login/auth-google).

## Netlify e comercialização

O usuário confirmou que ainda não criou site Netlify. Não houve deploy. O backend Node atual usa sessões em arquivos locais e locks por processo; precisa de armazenamento compartilhado e adaptação antes de Netlify Functions. `dist` é um pacote de servidor, não um diretório estático adequado à publicação direta.

Próximos passos: teste manual de Auth; configuração Google/SMTP; upload privado quando implementado; adaptação Netlify e homologação HTTPS; dois usuários reais descartáveis, voz/foto e exportação; backup/restauração; revisão jurídica, exclusão de conta, observabilidade e rate limiting. Pagamento real permanece fora do escopo e produção não foi liberada.

## Atualização: preparação Netlify

O usuário criou sua conta e acessou o aplicativo. Foram verificados pelo app real: lançamento fictício, persistência após recarga, consulta textual, exportação JSON e remoção autorizada. Os testes de recuperação/Google/duas contas e celular físico continuam pendentes.

A adaptação Netlify foi implementada sem recriar o projeto: Function HTTP aproveita o backend existente; sessões, verificadores, locks condicionais e rate limit passam a Netlify Blobs com consistência forte e criptografia. O banco financeiro continua no mesmo Supabase. A execução local conserva o armazenamento de sessão em arquivos; produção Netlify não depende desse diretório.

`npm run build:netlify` gera apenas 12 assets públicos; as páginas privadas e APIs são servidas pela Function. As duas entradas ES Modules carregam localmente. Os 17 testes Node e as regressões passaram; audit de dependências de runtime não encontrou vulnerabilidades conhecidas. As interações Blobs e Auth no teste Netlify são fixtures, não testes no site hospedado.

Nenhum deploy foi realizado. Use `CONFIGURACAO-NETLIFY.md`: importação GitHub da branch de integração, variáveis privadas, origem HTTPS exata e callbacks Supabase. O ZIP é código-fonte, não um site estático para arrastar e soltar.
