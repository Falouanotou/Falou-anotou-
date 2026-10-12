# Cadastro direto — preparação para distribuição pelo WhatsApp

## Situação desta entrega

Código preparado localmente para cadastro com nome, e-mail e senha, sessão imediata do Supabase e aceite dos documentos na mesma solicitação. Google e convites foram retirados da aplicação. Não existe verificação de pagamento: qualquer pessoa com o link pode se cadastrar quando o cadastro for habilitado.

A migração de segurança foi aplicada, o cadastro imediato foi habilitado e o código foi publicado e validado em `https://falou-anotou-testes.vercel.app`. Publicação autorizada exclusivamente para homologação, com contas fictícias; não é uma liberação comercial. O código funcional validado está no commit `abc0bce`; a atualização posterior desta documentação não altera esse comportamento.

## Configurações já aplicadas no Supabase de testes

1. Authentication → Sign In / Providers: habilitar **Allow new users to sign up**. Já está habilitada para este novo fluxo de homologação.
2. Desabilitar **Confirm email**, mantendo Email habilitado, Google e login anônimo desabilitados. O Supabase passa a confirmar automaticamente a identidade de e-mail: não haverá prova de posse do endereço. Evitar cadastrar endereços pertencentes a terceiros.
3. Já aplicada pelo SQL Editor somente a nova migração `supabase/migrations/20261012175921_manual_access.sql`, após revisão do conteúdo e confirmação da estrutura de `auth.sessions`. Ela reforça suspensão/revogação, sem excluir registros. As três migrações anteriores já existem no projeto hospedado; não reaplicá-las.
4. Conferir que o hook `public.before_user_created` permanece habilitado e que a política interna está em `development`, com documentos em minuta, exclusivamente para testes fictícios. A nova migração não remove o bloqueio jurídico de produção.
5. Site URL deve ser o domínio HTTPS do ambiente. `/auth/confirm` só é necessário para eventual recuperação de senha por e-mail. `/auth/callback` foi removido da lista de redirects. Restam somente `/auth/confirm` no localhost e no domínio de homologação; Google e login anônimo estão desabilitados.

Configurações que alteram a confirmação de identidade devem ser revisadas pelo responsável antes de salvar. Não é necessário adicionar SMTP para o cadastro imediato. Já havia SMTP Gmail no painel; esta entrega não altera nem valida suas credenciais.

## Vercel e publicação de testes

Framework Other, Node 22.x, build `npm run build:vercel`, saída `public`, Function `api/app.js`. Publicar o código pelo repositório; não enviar `public` como site estático, porque autenticação e rotas privadas dependem do backend.

Manter `APP_ENV=development` somente em homologação. Manter Supabase URL e chave publishable no servidor, `APP_ORIGIN` exata, Blob **PRIVATE**, `SESSION_SECRET` base64 de 32 bytes, `SESSION_NAMESPACE=homologacao-vercel`, `SESSION_DAYS=30`, `PASSWORD_MIN_LENGTH=15`, `PASSWORD_RECOVERY_ENABLED=false`, versões atuais dos documentos e `LEGAL_APPROVED=false`, `LEGAL_PUBLISHED=false`. A variável obsoleta `GOOGLE_AUTH_ENABLED` foi excluída com autorização específica. Recuperação desativada é o padrão do código quando a variável correspondente não existe.

Migração aplicada e deploy de homologação verificado como Ready. Não ativar produção comercial usando as minutas. O serviço falha fechado se a nova função de autorização estiver ausente.

## Validação realizada e pendências de hardware

Duas contas fictícias Supabase Auth foram criadas pelo aplicativo sem confirmação de e-mail e com acesso imediato. Na hospedagem real foram validados gravação, isolamento do histórico, tentativa de exclusão cruzada, proprietário forjado, logout e novo login. A API direta do Supabase recusou leitura, alteração e exclusão cruzadas e acesso anônimo. Chrome desktop e viewport mobile passaram em login, histórico isolado, exportação JSON, fechamento completo e reabertura do navegador com sessão persistida e logout. Nenhuma conta existente foi modificada. As duas contas e lançamentos fictícios permanecem identificados para revisão.

`npm test` passou com 25 testes Node, além das regressões financeiras/parser; Chrome local e build Vercel também passaram. Suspensão, revogação, exclusão em cascata e restauração completa foram testadas em PostgreSQL embutido, não em contas reais do projeto hospedado. O Advisor remoto retornou zero erros e cinco avisos: quatro funções SECURITY DEFINER já existentes, com autorização por usuário, e proteção contra senhas vazadas desabilitada. Isso não representa certificação de segurança.

Testar no celular físico, abrindo o link pelo WhatsApp e pelo navegador: teclado, câmera, revisão da nota, OCR, microfone, permissão de áudio, histórico e exportação. Navegadores internos podem limitar o microfone; quando necessário abrir no Chrome/Safari. A câmera pode oferecer captura ou seleção de foto conforme o aparelho. Simulação de tela pequena não equivale a teste de hardware.

PWA existente preservada: manifesto, service worker e atalho. O service worker não armazena páginas privadas nem promete uso offline. A instalação e o ícone devem ser verificados em Android/iOS; o manifesto atual usa SVG, cuja compatibilidade de instalação varia por navegador.

## Recuperação de acesso

O cadastro inicial dispensa e-mail. Recuperação por e-mail permanece desativada no aplicativo até validar envio e consumo seguro do link; a tela informa a pendência. Não criar endpoint público de redefinição, não enviar senha pronta pelo WhatsApp e não mudar senha usando apenas o nome ou e-mail informado por quem pede ajuda.

Alternativa administrativa: verificar identidade por evidências previamente combinadas na contratação, sem solicitar senha, documentos excessivos ou informações financeiras desnecessárias. Depois, o responsável pode usar o recurso administrativo oficial do Supabase para gerar um link de recuperação de uso único, entregando-o em canal cuja identidade foi verificada. A geração usa acesso administrativo protegido, nunca uma chave service_role no frontend. Deve ser executada apenas por operador autorizado, com registro mínimo da solicitação e teste prévio em conta fictícia. Se o painel não oferecer geração de link, usar a API administrativa oficial em ferramenta protegida; não improvisar SQL para modificar hashes de senha. Este procedimento ainda não foi validado no ambiente hospedado e é bloqueador de continuidade para clientes que perderem acesso.

## Exclusão e suspensão

Após verificar a identidade e o UUID correto, o responsável pode suspender a conta em Supabase Auth (ban), sem excluir dados. A nova regra bloqueia JWT ainda válido para contas banidas e para sessões revogadas. Testar suspensão de A e manutenção de B antes da liberação comercial.

Para exclusão: confirmar a intenção, oferecer exportação quando cabível, avaliar retenções legais, suspender/revogar sessões e excluir somente o usuário correto pelo Supabase Auth. As tabelas financeiras possuem vínculos com exclusão em cascata; verificar ausência do UUID nas tabelas do aplicativo. Se futuramente houver arquivos Storage, removê-los pela API Storage antes da exclusão da conta; fotos não são persistidas por esta versão. Tratar sessões Blob, logs e backups conforme a política aprovada. Logout não exclui a conta. Não remover contas reais para validar o procedimento.

## Backup, restauração e monitoramento

Exportação JSON/CSV é backup do histórico do cliente, não de toda a aplicação. Definir backup do banco incluindo identidades e tabelas vinculadas, armazenamento criptografado, responsáveis e retenção. Não guardar dumps no Git, em Blob público ou em pasta compartilhada. Segredos de sessão ficam separados do backup de código; sessões antigas devem ser encerradas após restauração.

Restaurar primeiro em ambiente isolado, verificar schema, UUIDs, RLS e registros de duas contas e só depois planejar recuperação de produção. Não restaurar um dump por cima do banco de clientes sem plano e autorização. A restauração executada nesta entrega foi em PostgreSQL embutido com dados fictícios; a restauração do projeto Supabase real ainda não foi testada. O plano Free não fornece a mesma cobertura de backups gerenciados dos planos pagos; verificar a solução escolhida antes do lançamento.

O backend emite para falhas HTTP 5xx somente evento, status e duração, sem corpo, e-mail, valores, token ou query string. Acompanhar Vercel Runtime Logs/erros e uso de Functions/Blob; Supabase Auth logs, erros de banco, Advisors e quotas. Proteger os painéis com MFA. Não há alertas externos automáticos novos nesta entrega. A limpeza periódica de sessões Blob expiradas ainda precisa ser operacionalizada usando `prune`, preservando marcadores de revogação e locks.

## Produção comercial e custos

Criar ambiente separado de homologação, com banco/identidades separados, outro Blob privado, outro namespace e um novo segredo de sessão. Não copiar sessões, contas fictícias nem segredos de testes. Configurar `APP_ENV=production` e a política interna do banco em produção somente com os documentos completos, revisados e aprovados e versões sincronizadas. Preencher nome, identificação, endereço e canal de privacidade reais; definir condições da venda, duração do acesso, cancelamento, reembolso, retenção, exclusão e resposta a incidentes.

Vercel Hobby é restrito a uso pessoal não comercial. Para vender mantendo Vercel é necessário plano compatível, como Pro, anunciado a partir de US$20/mês, mais consumo excedente e impostos quando aplicáveis. Nada foi contratado. Supabase Free pode servir a testes; produção precisa de avaliação de quotas, continuidade e backup. Pro é anunciado a partir de US$25/mês, com cobranças adicionais conforme recursos; não é uma contratação obrigatória automática. GitHub pode permanecer gratuito. Domínio próprio, anúncios, impostos e tarifas de pagamento manual dependem das escolhas do responsável. SMTP não é dependência do primeiro cadastro.

Fontes oficiais: [Supabase Auth por senha](https://supabase.com/docs/guides/auth/passwords), [admin generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink), [backups Supabase](https://supabase.com/docs/guides/platform/backups), [preços Supabase](https://supabase.com/pricing), [Vercel Hobby](https://vercel.com/docs/plans/hobby), [preços Vercel](https://vercel.com/pricing).

## Bloqueadores comerciais

- Documentos, identificação, contato e condições comerciais pendentes de revisão/aprovação.
- Plano Vercel compatível com venda ainda não contratado pelo responsável.
- Recuperação administrativa, suspensão/exclusão remotas em contas fictícias, restauração remota, limpeza de sessões e testes no celular físico pendentes.
- Separação efetiva do ambiente comercial, segredos próprios e revisão dos avisos de segurança pendentes.

Não distribuir este ambiente como produto comercial pronto antes de concluir esses pontos.
