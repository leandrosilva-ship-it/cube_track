# Deploy em uma única VM (Google Cloud, sem Kubernetes)

Caminho mais simples para colocar a CUBE PROJECT no ar para a própria equipe, numa única máquina
virtual, usando `docker-compose.prod.yml`. Para um deploy enterprise com Kubernetes/Helm,
autoscaling e zero-downtime, ver [`docs/deploy.md`](deploy.md) — este guia é o equivalente
"ponto a ponto" para quem não tem (ou não quer, por ora) um cluster.

## 1. Criar a VM (Google Cloud Console)

1. No [console do Google Cloud](https://console.cloud.google.com), vá em **Compute Engine → Instâncias de VM → Criar instância**.
2. Nome: `cube-track`. Região: `southamerica-east1` (São Paulo) ou a mais perto da sua equipe.
3. Tipo de máquina: **e2-standard-2** (2 vCPUs, 8 GB) é o mínimo confortável para rodar banco,
   cache, busca, API, worker e frontend juntos. Para uma equipe pequena isso é suficiente; para
   mais gente/uso pesado, considere `e2-standard-4`.
4. Disco de inicialização: **Ubuntu 22.04 LTS**, pelo menos 30 GB.
5. Em "Firewall", marque **Permitir tráfego HTTP** e **Permitir tráfego HTTPS** (portas 80 e 443 —
   são as únicas que o deploy expõe; o Caddy do passo 7 cuida do HTTPS automático na frente de
   tudo, inclusive do tempo real).
6. Criar. Anote o **IP externo** que aparece na lista de instâncias.

## 2. Tornar o IP externo fixo (reservar um IP estático)

Por padrão, o IP externo de uma VM do Google Cloud é **efêmero** — muda se a VM for reiniciada.
Isso quebraria o domínio (e o certificado HTTPS) do passo 6. Antes de prosseguir:

1. **VPC de rede → Endereços IP externos**.
2. Encontre o IP efêmero já associado à VM `cube-track` e clique em **Promover para estático**.
3. Dê um nome (ex.: `cube-track-ip`) e confirme. O IP não muda mais, mesmo reiniciando a VM.

## 3. Conectar na VM

Na lista de instâncias, clique em **SSH** ao lado da VM `cube-track` — abre um terminal direto no
navegador, sem precisar instalar nada no seu computador.

## 4. Instalar Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo apt-get update && sudo apt-get install -y git
```

## 5. Clonar o repositório

Gere um **Personal Access Token** no GitHub (Settings → Developer settings → Personal access
tokens → Fine-grained tokens → acesso só a este repositório, permissão de leitura) e use-o no
lugar de `SEU_TOKEN` abaixo:

```bash
git clone https://SEU_TOKEN@github.com/leandrosilva-ship-it/cube_track.git
cd cube_track
git checkout claude/cube-track-product-vision-0aoxhb
```

## 6. Configurar as variáveis de ambiente

```bash
cp .env.prod.example .env.prod
nano .env.prod
```

Preencha (use o **IP estático** anotado no passo 2 — troque os pontos por hífens):
- `APP_DOMAIN=app.SEU-IP-COM-HIFENS.nip.io` e `API_DOMAIN=api.SEU-IP-COM-HIFENS.nip.io` — domínio
  de graça que já resolve para o seu IP, sem precisar comprar nada. Tem domínio próprio? Aponte
  dois registros DNS tipo A para o IP estático (`app.seudominio.com.br` e
  `api.seudominio.com.br`) e use-os aqui no lugar do nip.io.
- `PUBLIC_WEB_URL=https://app.SEU-IP-COM-HIFENS.nip.io`
- `PUBLIC_API_URL=https://api.SEU-IP-COM-HIFENS.nip.io`
- `BASE_DOMAIN=app.SEU-IP-COM-HIFENS.nip.io`
- Cada segredo (`JWT_SECRET`, `ENCRYPTION_KEY` etc.) — gere um valor com o comando sugerido no
  próprio comentário ao lado de cada variável (ex.: `openssl rand -base64 48`), direto no
  terminal SSH, e cole o resultado.

`COOKIE_SECURE=true` já vem assim por padrão no `.env.prod.example` — não precisa mexer, a menos
que esteja de propósito testando em HTTP puro sem domínio nenhum.

Salve com `Ctrl+O`, `Enter`, `Ctrl+X` (editor `nano`).

## 7. Subir tudo

```bash
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

A primeira vez demora (construindo as 3 imagens da aplicação) — normal levar de 5 a 15 minutos
dependendo da máquina. Acompanhe com:

```bash
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod ps
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f web api worker
```

## 8. Rodar as migrações do banco

Só precisa rodar uma vez (e de novo a cada atualização futura que mude o banco):

```bash
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod --profile migrate run --rm migrate
```

## 9. Acessar

Abra `https://app.SEU-IP-COM-HIFENS.nip.io` (ou o seu domínio) no navegador — o Caddy emite o
certificado sozinho no primeiro acesso (pode levar alguns segundos a mais na primeira vez). O
cadeado já aparece fechado, sem aviso de "não seguro". **Diferente da sessão de demonstração**,
este banco começa vazio — use a tela de **Cadastro** para criar sua própria conta e workspace (não
existe o tenant "Empresa Demo" aqui, a menos que você rode `db:seed` deliberadamente, o que não é
recomendado para uso real).

## 10. Trocando o nip.io por um domínio próprio depois

Sem downtime: aponte os registros DNS do seu domínio para o mesmo IP estático, atualize
`APP_DOMAIN`/`API_DOMAIN`/`PUBLIC_WEB_URL`/`PUBLIC_API_URL`/`BASE_DOMAIN` em `.env.prod` para o
domínio novo e rode de novo o comando do passo 7 (`up -d --build`) — o Caddy emite um certificado
novo para o domínio novo automaticamente, na primeira requisição que chegar nele.

## 11. Abrindo para o time (mais de 20 pessoas)

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

- **Capacidade da VM**: `e2-standard-2` aguenta bem um time pequeno/médio testando a plataforma.
  Com mais de ~20-30 pessoas usando ao mesmo tempo, considere subir para `e2-standard-4` (pare a
  VM, mude o tipo de máquina, inicie de novo — o IP estático não muda) e acompanhar `docker stats`
  por uma semana para ver se sobra CPU/memória.
- **Quando sair da VM única de vez**: se o time crescer bastante, precisar de alta disponibilidade
  (a VM não pode ser um ponto único de falha) ou de atualizações sem indisponibilidade, o caminho é
  migrar para Kubernetes/Helm — ver [`docs/deploy.md`](deploy.md). O código e o banco são os
  mesmos; muda só a forma de rodar os containers.

## Atualizando depois de uma mudança no código

```bash
cd ~/cube_track && git pull
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod --profile migrate run --rm migrate
```

## Limitações conhecidas deste caminho (vs. `docs/deploy.md`/Kubernetes)

- Uma única máquina: sem redundância/alta disponibilidade — se a VM cair, a plataforma cai junto.
- Sem deploy zero-downtime: `up -d --build` reinicia os containers (alguns segundos de
  indisponibilidade a cada atualização).
- Backup: configure separadamente (ex.: snapshot de disco do Google Cloud agendado, ou adapte
  `infra/docker/backup` deste repositório) — não incluído neste guia.
