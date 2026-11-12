# Deploy em uma única VM (Google Cloud, sem Kubernetes)

Caminho mais simples para colocar a CUBE TRACK no ar para a própria equipe, numa única máquina
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
5. Em "Firewall", marque **Permitir tráfego HTTP** e **Permitir tráfego HTTPS**.
6. Criar. Anote o **IP externo** que aparece na lista de instâncias.

## 2. Abrir a porta da API (tempo real)

O navegador conecta direto na API para tempo real (Socket.IO), então a porta 3001 também precisa
estar aberta:

1. **VPC de rede → Firewall → Criar regra de firewall**.
2. Nome: `allow-cube-track-api`. Destinos: todas as instâncias da rede (ou use uma tag e aplique
   na VM). Intervalos de IP de origem: `0.0.0.0/0`. Protocolos/portas: **tcp**, porta `3001`.
3. Criar.

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

Preencha:
- `PUBLIC_WEB_URL=http://SEU_IP_EXTERNO`
- `PUBLIC_API_URL=http://SEU_IP_EXTERNO:3001`
- `BASE_DOMAIN=SEU_IP_EXTERNO`
- Cada segredo (`JWT_SECRET`, `ENCRYPTION_KEY` etc.) — gere um valor com o comando sugerido no
  próprio comentário ao lado de cada variável (ex.: `openssl rand -base64 48`), direto no
  terminal SSH, e cole o resultado.

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

Abra `http://SEU_IP_EXTERNO` no navegador. **Diferente da sessão de demonstração**, este banco
começa vazio — use a tela de **Cadastro** para criar sua própria conta e workspace (não existe o
tenant "Empresa Demo" aqui, a menos que você rode `db:seed` deliberadamente, o que não é
recomendado para uso real).

## 10. Próximo passo recomendado: domínio + HTTPS

Em HTTP puro (só IP), o navegador mostra "não seguro" e alguns recursos (login em dispositivos
móveis, PWA) ficam limitados. Quando tiver um domínio:

1. Aponte dois registros DNS tipo A para o IP da VM: `app.seudominio.com.br` e
   `api.seudominio.com.br`.
2. Troque `PUBLIC_WEB_URL`/`PUBLIC_API_URL`/`BASE_DOMAIN` em `.env.prod` pelos domínios (com
   `https://`), `COOKIE_SECURE=true` e `COOKIE_DOMAIN=seudominio.com.br`.
3. Reconstrua (`up -d --build`) e coloque um proxy com HTTPS automático (ex.
   [Caddy](https://caddyserver.com)) na frente das portas 80/3001 — posso te ajudar a montar isso
   quando chegar nessa etapa.

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
