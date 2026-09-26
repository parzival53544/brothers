# Brothers — sistema completo (nuvem + desktop)

## Novidades da v5 — WhatsApp automático (experimental)

Nova aba **WhatsApp** (só admin), usando a biblioteca Baileys (WhatsApp Web não-oficial):

- **Como ligar**: entre na aba WhatsApp, escaneie o QR Code com o celular do restaurante
  (WhatsApp → Aparelhos conectados → Conectar aparelho). Assim que conectar, o sistema
  passa a enviar automaticamente uma mensagem pro cliente sempre que o pedido muda de
  status (aceito, pronto, saiu para entrega, finalizado) — sem precisar clicar em nada.
- **Botão "Saiu para entrega"**: aparece nos pedidos de delivery que estão prontos.
- **Bot de respostas automáticas**: quando o cliente manda mensagem, o sistema responde
  sozinho um menu simples (ver cardápio / status do pedido / falar com atendente) e, se
  ele perguntar sobre o pedido, busca automaticamente pelo número de telefone e responde
  o status atual. Dá pra desligar esse bot a qualquer momento (deixa só o botão de
  aviso automático de status funcionando) no toggle da própria aba.
- **Conversa e envio manual**: a aba mostra as últimas mensagens indo e vindo, e tem um
  campo pra você mandar uma mensagem manual pra qualquer número, sem precisar abrir o
  WhatsApp de verdade.

**Avisos importantes, sério mesmo:**

1. **Isso não é a API oficial do WhatsApp** — é engenharia reversa do WhatsApp Web. O
   WhatsApp pode banir o número se detectar muita automação ou se clientes denunciarem
   como spam. **Teste com um número secundário/chip reserva antes de usar o número
   principal do restaurante.**
2. **O plano do Render precisa ficar sempre ativo.** O plano free hiberna depois de um
   tempo sem uso, e isso derruba a conexão do WhatsApp toda hora (ela reconecta sozinha,
   mas fica instável). Use pelo menos o plano pago mais básico.
3. **A sessão (QR escaneado) precisa do mesmo disco persistente** que já era recomendado
   pro `data.json` — sem isso, todo redeploy pede escanear o QR de novo. Configure
   `DATA_DIR=/data` com um volume persistente montado ali (Railway, Fly.io, ou Render com
   disco pago), do jeito que já está explicado mais abaixo neste README.
4. Se o número ficar muito tempo sem escanear de novo depois de desconectado, o WhatsApp
   pode pedir verificação extra — normal, é só escanear de novo.

## Novidades da v3

- **Link da equipe fixo**: pra ele parar de mudar toda vez que o Render reinicia (disco
  não persistente), defina uma variável de ambiente `STAFF_SLUG` no Render com um valor
  fixo que você escolher (ex: `brothers2024equipe`). O link vira sempre
  `SEU_DOMINIO/?staff=brothers2024equipe`. Sem essa variável, o sistema continua gerando
  um código aleatório — pra descobrir qual é, olhe os "Logs" do serviço no Render logo
  após o deploy (a primeira linha mostra o link) ou abra `SEU_DOMINIO/api/public/config`
  e procure por `staffSlug`.
- **Número do pedido agora é aleatório** (3 dígitos), não mais sequencial.
- **Estoque escondido do cliente**: só admin e garçom veem a quantidade; o cliente só
  vê "Indisponível" quando acabar.
- **Nota impressa detalhada**: mostra preço de cada item, cada complemento separado, taxa
  de entrega, e — se for delivery — um quadro grande no final com endereço, bairro, nome
  e telefone do cliente.
- **Arrastar pra reordenar**: categorias e itens do cardápio agora têm uma alcinha (⠿)
  pra arrastar direto, além das setinhas (que ficaram com mais contraste).
- **Seletor de imagem com biblioteca e corte manual**: ao escolher a foto de um item ou
  do perfil, abre uma janela com as imagens já usadas no cardápio (evita reenviar a
  mesma foto) e um cortador com zoom e arraste — ou um botão "usar sem ajustar" pra
  pular direto pro corte automático.
- **Backup completo**: em Configurações, baixa um `.json` com cardápio, categorias,
  grupos de complementos e todas as fotos. Dá pra restaurar depois pelo mesmo lugar.
- **CSV agora usa ponto e vírgula** (`;`) como separador, não vírgula — isso evita o bug
  de a descrição do item (que geralmente tem vírgula) quebrar a importação, e já é o
  padrão do Excel em português. Se a lista de grupos de complementos aparecer numa
  célula só, os nomes ficam separados por `|` (barra vertical) dentro dela.
- **Grupos de complementos também têm import/export CSV** agora, em Cardápio → Grupos
  de complementos. Colunas: `grupo;tipo;opcao;preco` (uma linha por opção; `tipo` é
  `single` ou `multi`).

## Novidades da v2

- **Link da equipe escondido**: não tem mais link nenhum no cardápio público. Vá em
  Configurações → "Link de acesso da equipe" (depois de entrar pela primeira vez) para
  pegar o link de login. Na primeira instalação, use `SEU_DOMINIO/?staff=` + o código
  que aparece em Configurações assim que você entrar — ou peça pro administrador
  original te passar o link.
- **Grupos de complementos**: cadastre em Cardápio → "Grupos de complementos" (ex:
  "Adicionais" com múltipla escolha, "Sabores de suco" com escolha única), depois
  marque quais grupos cada item usa dentro do próprio item.
- **Fotos dos itens**: qualquer formato de imagem serve (jpg, png, etc.) e qualquer
  tamanho — o sistema recorta pro quadrado (1:1) e redimensiona sozinho na hora do
  upload. Não precisa preparar nada antes.
- **Horário de funcionamento**: Configurações → escolha o fuso horário e o horário de
  cada dia da semana. Fora do horário, o link público mostra "fechado" e bloqueia
  novos pedidos automaticamente. O botão vermelho "Fechar agora" é só para emergências
  (ignora o horário configurado até você reabrir manualmente).
- **Som de notificação**: Configurações → envie um .mp3 se quiser um som personalizado.
  Sem enviar nada, o sistema já toca um bipe padrão sozinho quando cai uma solicitação.
- **Importar/exportar cardápio**: Cardápio → botões "Exportar CSV" / "Importar CSV".
  Escolhi CSV (não .xlsx) porque abre direto no Excel sem precisar de nenhuma
  biblioteca extra no servidor — é só abrir o arquivo baixado normalmente no Excel,
  editar as colunas e importar de volta. Colunas: categoria, nome, descrição, preço,
  ativo (sim/nao), estoque_ativo (sim/nao), estoque_qtd, grupos_complementos (nomes
  separados por `;`, precisam já existir no sistema). A importação atualiza itens que
  já existem (por nome + categoria) e cria os que não existem — nunca apaga itens que
  não estiverem na planilha. Fotos não entram no CSV; adicione depois pelo item.



Este pacote tem três partes:

```
server/     -> backend (API + salva os dados em disco) — é o "cérebro" do sistema
public/     -> a tela que todo mundo usa (cliente e equipe), servida pelo backend
electron/   -> gera o instalador .exe do Windows, que só abre o link do sistema
```

O backend serve tanto a API quanto a própria tela (front e back juntos, uma coisa só).
Ou seja: você hospeda **uma única coisa** (a pasta `server/`, que já inclui `public/`
dentro dela na hora de rodar) e isso vira o seu link público.

## 1. Testar no seu computador antes de hospedar

```
cd server
npm install
npm start
```

Abre em `http://localhost:3000`. Login de teste: `admin` / `admin` e `garcom` / `garcom`.
Os dados ficam salvos em `server/data/data.json`.

## 2. Colocar na nuvem (link público, salvo em nuvem de verdade)

Recomendo **Railway** (railway.app) porque tem plano gratuito com **volume persistente**
(sem isso, os pedidos e o cardápio somem toda vez que o servidor reinicia). Passo a passo:

1. Crie uma conta em railway.app e clique em **New Project → Deploy from GitHub repo**
   (suba essa pasta pro GitHub primeiro — ou use "Empty Project" e depois "Deploy from
   local directory" com o CLI da Railway).
2. Aponte o **Root Directory** para `server`.
3. Em **Variables**, adicione:
   - `JWT_SECRET` = qualquer texto longo e aleatório (ex: gere em https://randomkeygen.com)
   - `DATA_DIR` = `/data`
   - `TZ` = `America/Manaus` (pra o número do pedido resetar à meia-noite daqui)
4. Em **Volumes**, crie um volume e monte em `/data` (isso é o que garante que os
   pedidos não somem quando o serviço reiniciar).
5. Deploy. A Railway te dá um link tipo `https://brothers-production.up.railway.app` —
   **esse é o seu link público**, tanto pro cliente pedir quanto pra equipe entrar.

Alternativas que também funcionam do mesmo jeito (mesma pasta `server`, mesmas
variáveis): **Render.com** (Web Service + Disk persistente, precisa de plano pago pra
disco) ou **Fly.io** (tem volumes no plano gratuito).

**Depois de publicado**, troque a senha do `admin` em Configurações → Usuários assim
que entrar pela primeira vez.

## 3. Gerar o instalador do Windows (.exe)

O app desktop é só uma janelinha que abre o link do passo 2 — ou seja, os dados
continuam salvos na nuvem, o .exe é só conveniência pra abrir sem precisar do
navegador.

**Opção mais fácil — deixa o GitHub gerar pra você:**

1. Suba essa pasta inteira num repositório no GitHub.
2. Vá na aba **Actions** do repositório e rode o workflow **"Build Brothers Desktop
   (.exe)"** (ou apenas dê um push — ele roda sozinho quando algo em `electron/` muda).
3. Quando terminar, baixe o arquivo em **Artifacts → Brothers-Windows-Installer**.
4. É o instalador `.exe`. Na primeira vez que abrir, ele pede o link do sistema
   (o da Railway/Render) — cola uma vez e pronto, ele lembra depois.

**Opção manual (se você tiver um Windows à mão):**

```
cd electron
npm install
npm run dist
```

O instalador aparece em `electron/dist/`.

## 4. O toggle de pagamento online

Em **Configurações → "Permitir pagamento online (Pix agora)"**: enquanto ele estiver
desligado, o cliente só vê Dinheiro / Cartão / Pix na entrega. Quando ligado, aparece
"Pix agora" mostrando a chave Pix configurada, e o pedido fica em Solicitações
esperando a equipe confirmar manualmente o recebimento (hoje isso é manual porque não
há gateway de pagamento real conectado — é o próximo passo, quando você quiser integrar
Mercado Pago, PagBank, Efí etc. pra confirmação automática).

## 5. Sobre o número do pedido, WhatsApp etc.

Tudo funciona igual ao sistema anterior (Solicitações, Produção, Pronto, Histórico,
Relatórios, colar pedido do WhatsApp, avisar cliente por WhatsApp) — só que agora os
dados moram no servidor, então **abrir o link em qualquer computador ou celular mostra
os mesmos pedidos**, em tempo real (a tela atualiza sozinha a cada poucos segundos).
