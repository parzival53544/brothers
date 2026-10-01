# Brothers — sistema completo (nuvem + desktop)

## Novidades da v8 — telefone/nome inteligentes, clientes, acompanhamento em tempo real, atendimento humano

**Telefone**: agora aceita qualquer forma de digitar (com ou sem DDD, com ou sem o 9º
dígito, com ou sem +55) e sempre normaliza pro padrão certo (55 + DDD 92 por padrão +
9 dígitos). Resolve de vez o problema de mensagens que não chegavam por número mal
formatado.

**Nome sempre com inicial maiúscula**, tanto no que o cliente digita no link público
quanto no que a equipe digita no balcão — automático, sem precisar lembrar.

**Aba Clientes** (novo): toda vez que alguém pede, o sistema guarda nome, telefone e
endereço automaticamente. Dá pra buscar, editar, e tem um atalho "💬 Conversar" que já
abre a conversa dessa pessoa na aba WhatsApp.

**"Pedir novamente"**: depois que o cliente finaliza um pedido no link público, da
próxima vez que ele entrar aparece um aviso no topo oferecendo repetir o mesmo pedido —
um toque e o carrinho enche sozinho.

**Busca e categorias no cardápio público**: barra de busca no topo (procura em nome e
descrição) e uma faixa com as categorias pra arrastar e pular direto pra uma delas.

**Página de acompanhamento em tempo real** (a parte mais trabalhosa desta leva): assim
que o cliente faz o pedido, ele é levado direto pra uma página só dele
(`seulink.com/pedido/CODIGO`), que mostra a linha do tempo completa — hora do pedido,
hora que foi pra produção, hora que ficou pronto, saiu pra entrega (se for o caso) e
finalizado — junto com os itens, endereço se tiver, nome e telefone. Atualiza sozinha a
cada 5 segundos, sem precisar logar em nada. O link já vem junto na mensagem de
confirmação do WhatsApp também.

**Corrigi o "Novo Pedido" no admin**: agora, ao marcar "Delivery", aparecem os campos de
endereço e bairro certinho, igual no link público — antes isso realmente não existia aí
e travava quem precisava lançar um pedido de telefone manualmente. Pagamento no admin
ficou só com Dinheiro, Cartão e Pix (sem as variações de Pix só feitas sentido pro
cliente público). Nome e telefone continuam opcionais pros pedidos feitos no balcão; já
no link público, nome e WhatsApp válido são obrigatórios pra qualquer pedido.

**Listas de transmissão com modelos salvos**: Configurações → aba WhatsApp → "🗂️ Modelos
salvos" — salva uma combinação de foto + texto com um nome (ex: "Promo de segunda"), e
na hora de montar uma transmissão nova é só escolher o modelo no lugar de escrever tudo
de novo. As mensagens automáticas de pedido também ficaram mais pessoais, citando o
primeiro nome do cliente em cada etapa.

**Atendimento humano**: se o cliente mandar "atendente" ou pedir pra falar com uma
pessoa no WhatsApp, o robô para de responder automaticamente pra esse número, ele sobe
pro topo da lista de conversas com um ícone 🙋 e fundo destacado, e toca um som
diferente do bipe normal — repetindo a cada 20 segundos até alguém responder (a
primeira resposta de um atendente já resolve o alerta sozinho).

**Corrigi também o campo de resposta da aba WhatsApp**, que estava com o botão gigante
e a caixa de digitar pequena — era um conflito de estilo, já ajustado.



## Novidades da v7 — correção de mensagens "enviadas" que não chegavam

**O que descobri:** existe um bug conhecido e ainda sem correção definitiva na própria
biblioteca do WhatsApp que usamos (Baileys): às vezes ela diz que enviou a mensagem
(sem dar erro nenhum) mas o WhatsApp nunca entrega — a mensagem fica só com um tique
cinza. Tem dezenas de relatos abertos no GitHub deles, em várias versões (inclusive a
mais nova, que é a que usamos). Não é um problema só do seu sistema.

**O que fiz pra reduzir o problema e, principalmente, parar de te enganar:**

1. **Confirmação de entrega de verdade**: antes o painel marcava "enviado" assim que a
   biblioteca não dava erro. Agora cada mensagem passa por 3 estados honestos:
   "☑️ enviado, aguardando confirmação" → "✅ entregue" (quando o WhatsApp confirma
   mesmo) ou "⚠️ sem confirmação de entrega" (se em 20s o WhatsApp não confirmar).
2. **Validação do número antes de enviar**: o sistema pergunta pro WhatsApp se aquele
   número realmente existe, e tenta também a variação com/sem o 9º dígito (erro
   comum no Brasil). Se não existir, mostra "número não encontrado no WhatsApp" em vez
   de fingir que enviou.
3. **Reinício preventivo da conexão a cada 6h** (sem precisar escanear o QR de novo),
   que é o paliativo que a comunidade relata funcionar melhor pra esse bug.
4. **Respostas do bot e conversas com contatos "@lid"**: versões novas do WhatsApp às
   vezes identificam o contato por um código interno em vez do número — antes o sistema
   ignorava essas mensagens; agora trata direito.

**Sendo bem direto:** isso melhora bastante a transparência e reduz o problema, mas não
elimina — o bug é da biblioteca não-oficial. Se o restaurante depender 100% dessas
mensagens chegarem, o caminho definitivo é a **API oficial do WhatsApp Business (Meta
Cloud API)**, que confirma entrega de forma garantida. Posso migrar o sistema pra ela
quando você quiser — precisa de CNPJ/verificação de negócio na Meta e tem custo por
conversa, mas é a única solução realmente confiável.

## Novidades da v6 — mensagens automáticas de verdade + conversas

**Por que as mensagens não estavam saindo:** a v5 só mandava mensagem quando o pedido
mudava de status — não quando o cliente fazia o pedido. Isso já está corrigido: agora
manda automaticamente em cada etapa:

1. **Pedido feito** → mensagem de confirmação com o resumo completo (itens, complementos,
   taxa de entrega se tiver, total).
2. **Aceito (foi pra produção)** → "está em preparo".
3. **Pronto** → mensagem diferente pra cada tipo: local, retirada ("pode vir buscar") ou
   delivery ("vai sair pra entrega").
4. **Saiu para entrega** (botão 🛵 nos pedidos de delivery prontos) → avisa que saiu.
5. **Finalizado** → agradecimento.

O código Pix copia-e-cola automático (quando o cliente escolhe "Pix agora") fica pra uma
próxima etapa, como você combinou.

**Se mesmo assim não sair**: toda tentativa de envio agora fica registrada na aba
WhatsApp → Conversas, com "✅ enviado" ou "⚠️ erro" — e o erro mais comum é justamente
"WhatsApp não está conectado", ou seja, a sessão caiu (geralmente por causa do disco não
persistente no Render, como já expliquei antes) e precisa escanear o QR de novo.

**Botões "Avisar cliente" removidos** — não fazem mais sentido já que tudo é automático.
No lugar, tem um botão **🔁 Reenviar mensagem** em cada pedido (solicitação, produção,
pronto), pra quando o envio automático falhar ou você quiser reforçar.

**Aba WhatsApp virou uma tela de conversas de verdade**: lista de contatos à esquerda
(criada automaticamente a partir de quem já fez pedido), conversa completa à direita,
com campo de resposta — bem parecido com o WhatsApp Web mesmo, só que dentro do painel.

**Lista de transmissão** (Configurações → aba WhatsApp → "Nova lista de transmissão"):
manda uma mensagem pra vários contatos de uma vez (promoção do dia, aviso de reabertura
etc.). Segui a recomendação de mercado pra reduzir risco de bloqueio: envio sequencial
com 5-9 segundos de intervalo entre cada mensagem (não é instantâneo pra lista grande,
de propósito), aviso automático de "responda PARAR pra sair" em toda transmissão, e
quem responde PARAR/SAIR entra numa lista de descadastro e não recebe mais transmissões
(mas continua recebendo as mensagens do próprio pedido dele normalmente).

**No link público**: agora dá pra configurar o **nome e uma descrição curta do
restaurante** direto em Configurações (antes estava fixo como "Brothers" no código). A
logo ficou maior, e embaixo dela aparece um selo verde "Aberto agora" ou vermelho
"Fechado no momento", com o horário de hoje logo abaixo.

**Backup agora salva literalmente tudo**: nome e descrição do restaurante, cardápio,
complementos, fotos, bairros de entrega, horário de funcionamento, fuso horário, cor,
WhatsApp/Pix — o arquivo antigo (de v2/v3/v4) ainda é aceito pra restaurar, mas os novos
já saem completos.

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
