# Publicar o Falou, Anotou! na Netlify

Esta preparação conserva o aplicativo e o Supabase existentes. Ainda não foi feito deploy ou teste na infraestrutura real da Netlify. O primeiro ambiente deve ser de homologação, com contas e dados fictícios.

## Qual opção usar

Use **Import an existing project → GitHub**. A área “Upload your project files” mostrada na captura publica arquivos estáticos; ela não executa este build nem implanta o backend necessário ao login. Não arraste o código-fonte, o pacote antigo `dist`, arquivos de servidor ou `.env` para essa área.

O ZIP desta entrega é código-fonte para Git/CLI. A publicação funcional precisa do build e das Netlify Functions. [Formas oficiais de deploy](https://docs.netlify.com/deploy/create-deploys/).

## Configuração do projeto

Escolha o repositório `Falouanotou/Falou-anotou-` e a branch `integracao/infraestrutura`. Confira se há um site vinculado antes de criar outro. Se já houver um site de produção, não troque sua branch de publicação: use outro contexto de homologação apropriado.

| Campo | Valor |
| --- | --- |
| Base directory | raiz do repositório, deixar vazio |
| Build command | `npm run build:netlify` |
| Publish directory | `public` |
| Functions directory | `netlify/functions` |
| Node do build | 22, definido em `netlify.toml` |

`netlify.toml` já contém essas configurações. O build publica somente 12 assets permitidos. O HTML do painel, o código de servidor, credenciais e sessões ficam fora de `public`. As rotas privadas, APIs e páginas jurídicas são atendidas pela Function `app`, mantendo autenticação e CSRF; não há fallback de rotas privadas para HTML estático.

## Variáveis do servidor

Na Netlify, cadastre/importe as variáveis nas configurações do projeto, com escopo **Functions**. Valores em `netlify.toml` não substituem variáveis privadas de runtime.

| Variável | Homologação |
| --- | --- |
| `APP_ENV` | `development` — mostra minutas e permite somente testes fictícios |
| `SESSION_NAMESPACE` | `homologacao` |
| `APP_ORIGIN` | URL HTTPS real do site, sem caminho ou barra final |
| `SUPABASE_URL` | `https://hlkxgjjspmdrwpkbqwuf.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | chave pública já fornecida; nunca service_role ou sb_secret |
| `SESSION_SECRET` | segredo base64 de 32 bytes, exclusivo desse ambiente |
| `GOOGLE_AUTH_ENABLED` | `false` enquanto o Google OAuth não estiver configurado |
| `LEGAL_APPROVED`, `LEGAL_PUBLISHED` | `false` enquanto forem minutas |
| `TERMS_VERSION`, `PRIVACY_VERSION` | `minuta-2026-10-12` |

No computador desta tarefa, `.env.netlify` já foi gerado dentro da pasta do aplicativo, separado dos ZIPs e ignorado pelo Git. Ele contém um segredo: importe-o somente nas variáveis do servidor. Preencha `APP_ORIGIN` após conhecer a URL real. Não arraste esse arquivo à área de publicação, não compartilhe pelo chat e não o inclua no repositório.

Para gerar esse arquivo em outra instalação, configure o `.env` local e execute `npm run env:netlify`. O gerador preserva um arquivo existente para não trocar inadvertidamente a chave e invalidar sessões.

Se `APP_ORIGIN` estiver vazio, a Function usa a URL principal fornecida pelo contexto confiável da Netlify. Isso permite iniciar a configuração do site; em seguida, defina explicitamente a URL real. A limpeza programada exige `APP_ORIGIN` preenchido. Não é utilizada uma origem arbitrária enviada pelo visitante.

Sem URL/chave Supabase, HTTPS ou segredo de sessão válido, o backend retorna indisponibilidade. Isso é configuração pendente, não login simulado.

## Após obter a URL HTTPS

1. Defina `APP_ORIGIN` na Netlify com a URL exata do ambiente de homologação.
2. No Supabase → Authentication → URL Configuration, **adicione** as URLs exatas dessa origem com os caminhos `/auth/confirm` e `/auth/callback`, preservando os callbacks localhost existentes.
3. Para os templates padrão PKCE, o aplicativo envia o redirect exato. Se usar os templates personalizados baseados em `.SiteURL`, ajuste a Site URL ao ambiente que envia os e-mails. Não use uma Site URL de produção para enviar links de um teste de outro ambiente.
4. Reimplante depois de alterar as variáveis; valide login, confirmação/recuperação e histórico na origem HTTPS.
5. Para um Deploy Preview ou branch deploy com outro domínio, configure a origem exata nesse contexto e adicione os callbacks exatos ao Supabase. O backend rejeita domínios diferentes de `APP_ORIGIN`; não libere wildcards de produção para contornar isso.

Os dados antigos do navegador localhost não aparecem automaticamente em outro domínio. O histórico desta versão fica no Supabase e pode ser acessado depois do login. Copias legadas continuam exigindo exportação/importação explícita.

## Sessões na hospedagem

As Netlify Functions não utilizam `.runtime` ou arquivos locais para persistir sessões. O SDK oficial `@netlify/blobs` 11.1.4 usa um store próprio do site, com consistência forte, tokens/verificadores criptografados em AES-256-GCM e chaves de objetos derivadas por HMAC. O cookie contém um identificador opaco HttpOnly/Secure.

Gravações condicionais e leases de até 90 segundos coordenam requests da mesma sessão entre workers; requests em conflito aguardam por até 8 segundos e depois retornam 503. Rate limits são compartilhados, e o reset de senha altera um marcador de revogação por conta. Falha de armazenamento não cria cookie/sessão incompleta.

A Function agendada remove sessões expiradas e buckets antigos de rate limit. Marcadores de revogação e objetos de locks são preservados para evitar ressuscitar sessões ou apagar um lease concorrente. Seu volume e as cotas/custos de Blobs e Functions devem ser monitorados; nenhum plano pago foi contratado nesta preparação. [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/).

O backend limita o corpo de requests a 4 MB, abaixo do limite da hospedagem. Fotos continuam sendo processadas localmente pelo OCR; não há upload persistente de imagens nesta etapa. Backups financeiros muito grandes podem precisar ser divididos para importação.

## Verificação antes de compartilhar

- Login real, aceite das minutas e conta correta no domínio HTTPS.
- Registro por texto, persistência após recarregar, consulta e exportação.
- Isolamento de duas contas reais descartáveis; logout, recuperação e expiração.
- Câmera e microfone no celular físico; o browser pode solicitar permissão.
- Conferir `/.env`, `/server.js` e `/server/config.js`: devem retornar 404, sem conteúdo de servidor.
- Conferir o bundle publicado: somente assets em `public` e Functions compiladas separadamente.

Executado localmente: build público, regressões financeiras, PostgreSQL/RLS e **17 testes Node**, incluindo dois workers, revogação, locks/CAS, rate limit, cookies, CSRF, origem, falha de armazenamento e adaptador HTTP. O provedor/Blobs são fixtures nos testes Netlify; isso não comprova comportamento na hospedagem real.

Antes de produção comercial: `APP_ENV=production`, namespace/segredo separados, documentos completos/revisados/publicados, identificação empresarial e versões sincronizadas; política do banco em production, hook verificado, SMTP e Google configurados; revisão independente, backup/restauração, exclusão de conta e observabilidade. Não liberar produção apenas porque o build passou.
