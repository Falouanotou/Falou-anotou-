# Falou, Anotou! na Vercel — ambiente de testes

Preserva interface, comandos, OCR e o projeto Supabase. Importar `Falouanotou/Falou-anotou-`, branch `integracao/infraestrutura`, na conta Vercel escolhida pelo usuário. A conta inicial `linomaiaborges-8746` não recebeu projeto nem variáveis desta aplicação.

Framework: Other; raiz do repositório; Node 22.x; build `npm run build:vercel`; diretório público `public`. `vercel.json` fornece esses valores e a Function `api/app.js`. Somente 12 assets são copiados para `public`, sem HTML privado, configurações ou sessões.

As páginas e APIs usam o backend existente. As sessões são criptografadas em AES-256-GCM, com identificadores opacos em cookies Secure/HttpOnly. Criar um Vercel Blob **PRIVATE**, exclusivo deste projeto, e conectar ao contexto Production do projeto de TESTES. Nunca usar Blob público. O SDK oficial 2.8.1 usa leituras `useCache:false` e escritas condicionais por ETag para manter coordenação entre invocações e revogação de sessões.

O gerador `npm run env:vercel` produz `.env.vercel` privado e ignorado pelo Git. Usa novo SESSION_SECRET, sem reaproveitar o segredo da Netlify. Importar as variáveis somente no servidor Vercel. Preencher APP_ORIGIN com o domínio HTTPS principal reservado ao projeto. O contexto Production da hospedagem é o endereço principal de homologação; APP_ENV permanece development, permitindo somente testes fictícios, com aprovação/publicação jurídica e Google false. Não é uma liberação comercial. Não expor valores em variáveis NEXT_PUBLIC_ ou VITE_.

Depois de reservar o domínio, adicionar seus callbacks EXATOS `/auth/confirm` e `/auth/callback` ao Supabase; preservar localhost. O servidor rejeita outra origem, inclusive domínios de Preview não configurados. Default Site URL local pode permanecer durante os testes enquanto o app fornece redirects explícitos no fluxo PKCE padrão.

A expiração/revogação é verificada em cada acesso. Ainda não existe agendamento automático de limpeza de Blobs na Vercel nesta adaptação: revisar retenção e remover objetos expirados pelo método `prune` em uma tarefa administrativa segura antes de uso prolongado. Marcadores de revogação e locks devem ser preservados. Monitorar operações e quotas do plano gratuito. Não contratar plano pago automaticamente.

Validação local: regressões financeiras e de autenticação mais testes específicos de protocolo Vercel Blob privado, sessões entre workers, locks, revogação por conta, rate limit, rotas protegidas, CSRF, limites de payload e indisponibilidade de armazenamento. O SDK/provedor são fixtures nesses testes; o build hospedado e testes HTTPS reais são etapas separadas.

Antes de compartilhar: confirmar build Ready, login real, persistência, logout e páginas jurídicas; verificar que `/.env`, `/server/config.js` e outros arquivos privados não são acessíveis; testar câmera e microfone no celular físico. Fotos permanecem processadas localmente, sem upload persistente nesta etapa. Produção comercial continua pendente de revisão jurídica, SMTP/Google, exclusão de conta, restauração de backup e avaliação da segurança.

Referências oficiais: [Functions Node.js](https://vercel.com/docs/functions/runtimes/node-js), [SDK Blob e leituras consistentes](https://vercel.com/docs/vercel-blob/using-blob-sdk), [configuração do projeto](https://vercel.com/docs/project-configuration/vercel-json).
