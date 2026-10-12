# Roteiro de validação real — pendente de configuração

Use um projeto Supabase de **desenvolvimento**, as migrações, e-mails fictícios controlados por você e registros financeiros de exemplo. Nenhum passo deste roteiro foi declarado concluído no provedor real nesta entrega. Não use dados financeiros reais durante a validação inicial.

## Cadastro e confirmação

1. Abra `/cadastro`, confira os links públicos para `/termos-de-uso` e `/politica-de-privacidade` e a indicação de minuta.
2. Valide nome, e-mail, senha com pelo menos 15 caracteres, confirmação e checkbox obrigatório. Senha não deve aparecer em logs, localStorage, JSON/CSV ou tabelas públicas.
3. Cadastre a conta A. Antes de confirmar o e-mail, tente login e acesso a `/app`/`/api/ledger`: deve ser negado.
4. Abra o e-mail, clique no link e confirme no site. A confirmação retorna ao login, sem abrir automaticamente dados privados. Verifique também link vencido/reutilizado e outro navegador.
5. Entre e aceite as versões atuais. Confirme o perfil automático e o timestamp/versões em `legal_acceptances`.

## Google

1. Com provider/credenciais e URLs configurados, use Continuar com Google com uma conta de teste.
2. Valide PKCE, retorno somente à callback interna e perfil automático, sem token em fragmento/localStorage.
3. Teste usuário novo e usuário já existente, conferindo a identidade gerenciada pelo Supabase; não vincule contas manualmente para “fazer o teste passar”.
4. Cancele no Google, volte, tente novamente e teste um fluxo anterior substituído por um novo. Deve haver retorno amigável, sem conceder acesso com código/verificador errado.

## Recuperação, logout e expiração

1. Solicite recuperação para e-mail existente e inexistente: o texto público deve ser equivalente, sem confirmar cadastro.
2. Abra o link, confira o e-mail exibido, defina nova senha e retorne ao login. O link não pode ser reutilizado; o painel deve continuar indisponível durante a sessão restrita de recuperação.
3. Teste login com senha antiga/nova. Confira logout da sessão atual e invalidação das sessões BFF após recuperação de senha; valide também o comportamento real de revogação do provedor.
4. Abra duas guias. Faça logout numa delas e confirme limpeza/redirecionamento da outra. Teste cookie inválido, sessão vencida e refresh/revogação no Supabase.
5. Após sair, Voltar/Avançar não deve reapresentar dados privados via BFCache/service worker. HTML, APIs e cookies não podem ser cacheados no proxy/CDN.

## Isolamento entre A e B

1. Entre como A e crie despesa, receita e nota com itens. Recarregue; verifique valores e consulta sem dupla contagem.
2. Exporte JSON/CSV e confirme ausência de segredos de sessão.
3. Saia e entre como B: dados de A não devem aparecer. Categorias, lojas e preferências também devem ser diferentes.
4. Com tokens legítimos de teste, use a Data API/RPC para tentar consultar A a partir de B. A leitura deve retornar vazio/erro, não registros de A. Tente escrever `user_id` de A, alterar `entitlements` e arquivos fora da pasta de B: deve ser negado.
5. Tente IDs de A em operações da conta B: não devem afetar A. Duplicidade e conflitos numa importação devem ser transacionais.
6. Mude a conta numa guia enquanto a outra mantém formulário aberto. A solicitação desatualizada deve falhar, sem gravar o formulário na nova conta.

## Migração local explícita

1. No mesmo navegador/origem com dados antigos, entre e confira que o histórico da conta não inclui a cópia local automaticamente.
2. Exporte o original, confirme que os dados são seus e importe para a conta exibida.
3. Repita a importação: IDs/chaves idênticos não devem duplicar. Modifique um registro com o mesmo ID: o lote inteiro deve ser recusado.
4. Simule falha de rede, conflito de revisão ou campo inválido. Nenhuma remoção local deve ser oferecida antes de confirmação de sucesso. Em resultado de gravação incerto, recarregue e confira o histórico antes de repetir.
5. Remova somente a cópia antiga após importação e confirmação explícita. Não limpe cookies/localStorage indiscriminadamente para testar.

Cópias legadas não possuem dono verificável, pois o protótipo original não tinha contas. Em navegador compartilhado, a confirmação de que os registros pertencem a você é necessária; o backend não pode inferir essa propriedade. O isolamento RLS se aplica aos dados que já estão associados às contas.

## Documentos e bloqueio de produção

1. Confirme que as duas páginas são públicas e legíveis em desktop/celular, com contato/pendências honestamente identificados.
2. Altere `TERMS_PATH`/`PRIVACY_PATH` para rotas locais de teste; os links de login/cadastro/conta devem acompanhar a configuração.
3. No ambiente de produção de teste, mantenha `LEGAL_APPROVED=false`/`LEGAL_PUBLISHED=false`: cadastro deve permanecer bloqueado.
4. Habilite o hook Before User Created e política do banco em `production, legal_ready=false`; chamadas diretas ao Auth, inclusive Google para novos usuários, também devem ser bloqueadas.
5. Só libere depois de concluir, revisar e publicar o conteúdo real. A exclusão automatizada da conta inteira não está implementada; defina o procedimento/canal antes da comercialização.

## Testes disponíveis

`npm test` executa regressões e testes de unidade/SQL. `npm run test:browser` testa UI sem backend configurado; não usa login fake. `npm run test:integration` só executa contra Supabase com variáveis reais e duas contas descartáveis confirmadas. Sem configuração, imprime PENDENTE.
