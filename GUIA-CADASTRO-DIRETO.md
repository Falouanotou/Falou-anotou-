# Cadastro direto — preparação para distribuição pelo WhatsApp

## Situação desta entrega

Código preparado localmente para cadastro com nome, e-mail e senha, sessão imediata do Supabase e aceite dos documentos na mesma solicitação. Google e convites foram retirados da aplicação. Não existe verificação de pagamento: qualquer pessoa com o link pode se cadastrar quando o cadastro for habilitado.

As mudanças desta entrega ainda não foram aplicadas ao banco hospedado nem publicadas. O endereço existente `https://falou-anotou-testes.vercel.app` continua sendo homologação. Não é uma liberação comercial.

## Ajustes no Supabase para testes

1. Authentication → Sign In / Providers: habilitar **Allow new users to sign up**. Na etapa anterior essa opção foi desabilitada; precisa ser reaberta para este novo fluxo.
2. Desabilitar **Confirm email**, mantendo Email habilitado, Google e login anônimo desabilitados. O Supabase passa a confirmar automaticamente a identidade de e-mail: não haverá prova de posse do endereço. Evitar cadastrar endereços pertencentes a terceiros.
3. Aplicar pelo SQL Editor somente a nova migração `supabase/migrations/20261012175921_manual_access.sql`, após revisar o conteúdo e confirmar a estrutura de `auth.sessions`. Ela reforça suspensão/revogação, sem excluir registros. As três migrações anteriores já existem no projeto hospedado; não reaplicá-las.
4. Conferir que o hook `public.before_user_created` permanece habilitado e que a política interna está em `development`, com documentos em minuta, exclusivamente para testes fictícios. A nova migração não remove o bloqueio jurídico de produção.
5. Site URL deve ser o domínio HTTPS do ambiente. `/auth/confirm` só é necessário para eventual recuperação de senha por e-mail. `/auth/callback` pode ser removido da lista de redirects: o Google foi removido.

Configurações que alteram a confirmação de identidade devem ser revisadas pelo responsável antes de salvar. Não é necessário adicionar SMTP para o cadastro imediato. Já havia SMTP Gmail no painel; esta entrega não altera nem valida suas credenciais.

## Vercel e publicação de testes

Framework Other, Node 22.x, build `npm run build:vercel`, saída `public`, Function `api/app.js`. Publicar o código pelo repositório; não enviar `public` como site estático, porque autenticação e rotas privadas dependem do backend.

Manter `APP_ENV=development` somente em homologação. Manter Supabase URL e chave publishable no servidor, `APP_ORIGIN` exata, Blob **PRIVATE**, `SESSION_SECRET` base64 de 32 bytes, `SESSION_NAMESPACE=homologacao-vercel`, `SESSION_DAYS=30`, `PASSWORD_MIN_LENGTH=15`, `PASSWORD_RECOVERY_ENABLED=false`, versões atuais dos documentos e `LEGAL_APPROVED=false`, `LEGAL_PUBLISHED=false`. A variável antiga `GOOGLE_AUTH_ENABLED` não é mais utilizada e pode ser removida.

Após aplicar a migração, publicar somente em homologação e validar o build Ready. Não ativar produção comercial usando as minutas. O serviço falha fechado se a nova função de autorização estiver ausente.

## Validação real pendente

Criar duas contas fictícias pela interface, em navegadores/perfis separados. Cada uma deve registrar uma despesa distinta, fechar e reabrir, consultar e exportar o histórico e sair/entrar novamente. Conferir que a conta B não vê, altera ou apaga registros de A, também tentando os endpoints/RPCs com o token da própria B. Não reutilizar contas de clientes nem registrar dados reais nesses testes.

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

- Migração nova e configuração de cadastro imediato ainda não aplicadas no projeto hospedado.
- Código desta entrega ainda não publicado nem validado com duas contas Auth reais.
- Documentos, identificação, contato e condições comerciais pendentes de revisão/aprovação.
- Plano Vercel compatível com venda ainda não contratado pelo responsável.
- Recuperação administrativa, restauração remota, limpeza de sessões e testes no celular físico pendentes.

Não distribuir este ambiente como produto comercial pronto antes de concluir esses pontos.
