# Falou, Anotou!

Aplicativo existente preservado: lançamentos, histórico, voz, câmera/OCR, revisão e exportações. Backend Node com Supabase Auth e PostgreSQL por conta; hospedagem Vercel e sessões criptografadas em Blob privado.

## Executar localmente

Node 22.x. Execute `npm ci`, configure `.env` a partir de `.env.example` com URL e chave pública Supabase e use `npm start`. Nunca inclua uma chave administrativa no frontend ou no Git.

## Cadastro direto

Nome, e-mail, senha e confirmação. O provedor precisa estar com cadastro habilitado e confirmação de e-mail desativada para retornar uma sessão imediata. O aceite dos documentos é registrado na mesma solicitação. Em produção, documentos incompletos bloqueiam novos cadastros e o histórico financeiro.

O código não verifica pagamento. Qualquer pessoa com o link poderá se cadastrar quando o acesso público estiver habilitado. Google, convite, checkout e assinaturas não fazem parte do fluxo.

## Publicar e operar

Leia [GUIA-CADASTRO-DIRETO.md](GUIA-CADASTRO-DIRETO.md): ajustes remotos, migração de segurança, variáveis Vercel, testes pendentes, exclusão, recuperação, backup, custos e bloqueadores comerciais.

`npm run build:vercel` prepara somente assets públicos; o HTML privado e as APIs são servidos pela Function. Não publicar apenas a pasta public como site estático.

## Testes

`npm test`: parser/OCR, finanças, sessão, CSRF, cadastro com provedor fixture, PostgreSQL embutido com duas identidades fictícias, suspensão, revogação, exclusão em cascata e restauração local. `npm run test:browser`: Chrome desktop e tela mobile simulada, sem autenticação falsa. Os testes não equivalem a testes remotos nem em celular físico.

Entrega publicada e validada exclusivamente em homologação: https://falou-anotou-testes.vercel.app/login. Testes reais com duas contas fictícias passaram em cadastro imediato, isolamento por usuário, exportação, persistência após fechar/reabrir Chrome e logout. Celular físico e restauração do Supabase hospedado ainda exigem validação. Não está liberada comercialmente.
