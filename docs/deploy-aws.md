# Deploy em uma única VM (AWS EC2, sem Kubernetes/ECS)

Equivalente ao [`docs/deploy-vm.md`](deploy-vm.md) (Google Cloud), mas para AWS — mesma aplicação,
mesmo `docker-compose.prod.yml`, só muda como você cria a máquina e abre as portas. Para um deploy
enterprise com ECS/EKS, autoscaling e zero-downtime, isso é um projeto maior, à parte deste guia.

## 1. Criar a instância EC2 (console da AWS)

1. No console da AWS, vá em **EC2 → Instâncias → Executar instância**.
2. Nome: `cube-project`.
3. **Imagem (AMI)**: Ubuntu Server 22.04 LTS (deixe a opção padrão sugerida).
4. **Tipo de instância**: `t3.large` (2 vCPUs, 8 GB) — confortável para banco, cache, busca, API,
   worker e frontend juntos. `t3.medium` (4 GB) funciona para uma equipe bem pequena, mas é mais
   apertado. Se a conta tiver um limite de gastos que só libera tipos elegíveis ao nível gratuito
   (mensagem "Apenas é possível escolher tipos de instância elegíveis para o plano gratuito"),
   use `m7i-flex.large` (também 2 vCPUs/8 GB) como alternativa equivalente.
5. **Par de chaves**: pode deixar **"Continuar sem um par de chaves"** — vamos conectar pelo
   navegador (EC2 Instance Connect), sem precisar baixar/gerenciar nenhum arquivo de chave.
6. **Configurações de rede**: clique em "Editar" e configure as regras de entrada (Security Group):
   - SSH (porta 22) — origem `0.0.0.0/0` (necessário para o Instance Connect pelo navegador)
   - HTTP (porta 80) — origem `0.0.0.0/0` (usada só pelo desafio automático do Let's Encrypt)
   - HTTPS (porta 443) — origem `0.0.0.0/0` (é por ela que tudo passa, incluindo o tempo real —
     o Caddy do passo 6 cuida do HTTPS e repassa para dentro da rede interna do Docker)
7. **Armazenamento**: 30 GB (gp3) já é suficiente.
8. **Executar instância**.
9. Na lista de instâncias, clique na instância criada e anote o **Endereço IPv4 público**.

## 1.1 Reservar um Elastic IP (IP fixo)

O endereço IPv4 público de uma instância EC2 comum **muda** se a instância for reiniciada ou tiver
o tipo alterado — isso quebraria o domínio (e o certificado HTTPS) do passo 5. Antes de continuar:

1. **EC2 → Elastic IPs → Alocar endereço Elastic IP** → Alocar.
2. Selecione o IP recém-criado → **Ações → Associar endereço Elastic IP** → escolha a instância
   `cube-project` → Associar.
3. Anote esse IP — é ele que você vai usar dali em diante (substitui o "Endereço IPv4 público" do
   passo anterior, que deixa de existir).

## 2. Conectar na instância

Selecione a instância → botão **Conectar** → aba **Conexão do EC2 Instance Connect** → **Conectar**.
Abre um terminal direto no navegador, sem precisar instalar nada no seu computador.

## 3. Instalar Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo apt-get update && sudo apt-get install -y git
```

## 4. Clonar o repositório

Gere um **Personal Access Token** no GitHub (Settings → Developer settings → Personal access
tokens → Fine-grained tokens → acesso só a este repositório, permissão de leitura) e use-o no
lugar de `SEU_TOKEN` abaixo:

```bash
git clone https://SEU_TOKEN@github.com/leandrosilva-ship-it/cube_track.git
cd cube_track
git checkout claude/cube-track-product-vision-0aoxhb
```

## 5. Configurar as variáveis de ambiente

```bash
cp .env.prod.example .env.prod
nano .env.prod
```

Preencha (use o **Elastic IP** anotado no passo 1.1 — troque os pontos por hífens):
- `APP_DOMAIN=app.SEU-IP-COM-HIFENS.nip.io` e `API_DOMAIN=api.SEU-IP-COM-HIFENS.nip.io` — domínio
  de graça que já resolve para o seu IP, sem precisar comprar nada. Tem domínio próprio? Aponte
  dois registros DNS tipo A para o Elastic IP (`app.seudominio.com.br` e
  `api.seudominio.com.br`) e use-os aqui no lugar do nip.io.
- `PUBLIC_WEB_URL=https://app.SEU-IP-COM-HIFENS.nip.io`
- `PUBLIC_API_URL=https://api.SEU-IP-COM-HIFENS.nip.io`
- `BASE_DOMAIN=app.SEU-IP-COM-HIFENS.nip.io`
- Cada segredo (`JWT_SECRET`, `ENCRYPTION_KEY` etc.) — gere com o comando sugerido ao lado de cada
  variável (ex.: `openssl rand -base64 48`), direto neste mesmo terminal, e cole o resultado.

`COOKIE_SECURE=true` já vem assim por padrão no `.env.prod.example` — não precisa mexer, a menos
que esteja de propósito testando em HTTP puro sem domínio nenhum.

Salve com `Ctrl+O`, `Enter`, `Ctrl+X`.

## 6. Subir tudo

```bash
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

A primeira vez demora de 5 a 15 minutos (construindo as 3 imagens da aplicação). Acompanhe com:

```bash
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod ps
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f web api worker
```

## 7. Rodar as migrações do banco

```bash
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod --profile migrate run --rm migrate
```

## 8. Acessar

Abra `https://app.SEU-IP-COM-HIFENS.nip.io` (ou o seu domínio) no navegador — o Caddy emite o
certificado sozinho no primeiro acesso (pode levar alguns segundos a mais na primeira vez). O
cadeado já aparece fechado, sem aviso de "não seguro". O banco começa **vazio** — use a tela de
**Cadastro** para criar sua própria conta e workspace.

## 9. Trocando o nip.io por um domínio próprio depois

Sem downtime: pode usar o **Route 53** da própria AWS ou qualquer registrador. Aponte os
registros DNS do seu domínio para o mesmo Elastic IP, atualize
`APP_DOMAIN`/`API_DOMAIN`/`PUBLIC_WEB_URL`/`PUBLIC_API_URL`/`BASE_DOMAIN` em `.env.prod` para o
domínio novo e rode de novo o comando do passo 6 (`up -d --build`) — o Caddy emite um certificado
novo para o domínio novo automaticamente, na primeira requisição que chegar nele.

## 10. Abrindo para o time (mais de 20 pessoas)

- **Plano/vagas**: o plano Free cobre só 5 vagas (membros + convites pendentes; convidados
  externos não contam). Para liberar mais vagas sem cobrança real (uso interno da própria
  equipe), quem for o `owner` do tenant chama o override administrativo de plano:

  ```bash
  # 1. Login — pega o token de acesso (dura 10 min; repita se expirar)
  TOKEN=$(curl -s -X POST https://app.SEU-IP-COM-HIFENS.nip.io/v1/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"SEU_EMAIL","password":"SUA_SENHA"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")

  # 2. Override para o plano Business (100 vagas) — sem cobrança, é o próprio owner mudando o
  #    plano do seu tenant (ver docs/billing.md §3)
  curl -s -X POST https://app.SEU-IP-COM-HIFENS.nip.io/v1/billing/plan/override \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d '{"plan":"business"}'
  ```

- **Capacidade da instância**: `m7i-flex.large` (2 vCPU/8 GB) aguenta bem um time pequeno/médio
  testando a plataforma. Com mais de ~20-30 pessoas usando ao mesmo tempo, considere uma instância
  maior (pare a instância, "Alterar tipo de instância", inicie de novo — com Elastic IP associado,
  o endereço não muda) e acompanhar `docker stats` por uma semana para ver se sobra CPU/memória.
- **Quando sair da VM única de vez**: se o time crescer bastante, precisar de alta disponibilidade
  (a instância não pode ser um ponto único de falha) ou de atualizações sem indisponibilidade, o
  caminho é migrar para Kubernetes/Helm — ver [`docs/deploy.md`](deploy.md). O código e o banco
  são os mesmos; muda só a forma de rodar os containers.

## Atualizando depois de uma mudança no código

```bash
cd ~/cube_track && git pull
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod --profile migrate run --rm migrate
```

## Limitações conhecidas deste caminho

- Uma única instância: sem redundância/alta disponibilidade — se ela cair, a plataforma cai junto.
- Sem deploy zero-downtime: `up -d --build` reinicia os containers (alguns segundos de
  indisponibilidade a cada atualização).
- Backup: configure separadamente (ex.: snapshot de EBS agendado via **AWS Backup**, ou adapte
  `infra/docker/backup` deste repositório) — não incluído neste guia.
- Custo: a instância ligada 24/7 tem custo mensal (verifique a calculadora de preços da AWS para
  sua região) — pare a instância quando não for usar, se quiser economizar enquanto só está
  testando. Um Elastic IP associado a uma instância em execução não tem custo adicional; associado
  a uma instância **parada**, passa a ser cobrado — se for parar a instância por muito tempo,
  solte o Elastic IP antes.
