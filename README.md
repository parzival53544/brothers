# Brothers — sistema completo (nuvem + desktop)

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
