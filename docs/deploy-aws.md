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
   apertado.
5. **Par de chaves**: pode deixar **"Continuar sem um par de chaves"** — vamos conectar pelo
   navegador (EC2 Instance Connect), sem precisar baixar/gerenciar nenhum arquivo de chave.
6. **Configurações de rede**: clique em "Editar" e configure as regras de entrada (Security Group):
   - SSH (porta 22) — origem `0.0.0.0/0` (necessário para o Instance Connect pelo navegador)
   - HTTP (porta 80) — origem `0.0.0.0/0`
   - **Regra customizada TCP**, porta `3001` — origem `0.0.0.0/0` (necessária para o tempo real)
7. **Armazenamento**: 30 GB (gp3) já é suficiente.
8. **Executar instância**.
9. Na lista de instâncias, clique na instância criada e anote o **Endereço IPv4 público**.

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

Preencha (use o **IPv4 público** anotado no passo 1):
- `PUBLIC_WEB_URL=http://SEU_IP_PUBLICO`
- `PUBLIC_API_URL=http://SEU_IP_PUBLICO:3001`
- `BASE_DOMAIN=SEU_IP_PUBLICO`
- Cada segredo (`JWT_SECRET`, `ENCRYPTION_KEY` etc.) — gere com o comando sugerido ao lado de cada
  variável (ex.: `openssl rand -base64 48`), direto neste mesmo terminal, e cole o resultado.

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

Abra `http://SEU_IP_PUBLICO` no navegador. O banco começa **vazio** — use a tela de **Cadastro**
para criar sua própria conta e workspace.

## 9. Próximo passo recomendado: domínio + HTTPS

Em HTTP puro (só IP), o navegador mostra "não seguro". Quando tiver um domínio (pode usar o
**Route 53** da própria AWS, ou qualquer registrador):

1. Aponte dois registros DNS tipo A para o IP público da instância: `app.seudominio.com.br` e
   `api.seudominio.com.br`. Melhor ainda: reserve um **Elastic IP** (EC2 → Elastic IPs → Alocar, e
   associe à instância) para o endereço nunca mudar se a máquina reiniciar.
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

## Limitações conhecidas deste caminho

- Uma única instância: sem redundância/alta disponibilidade — se ela cair, a plataforma cai junto.
- Sem deploy zero-downtime: `up -d --build` reinicia os containers (alguns segundos de
  indisponibilidade a cada atualização).
- Backup: configure separadamente (ex.: snapshot de EBS agendado via **AWS Backup**, ou adapte
  `infra/docker/backup` deste repositório) — não incluído neste guia.
- Custo: `t3.large` ligado 24/7 tem custo mensal (verifique a calculadora de preços da AWS para sua
  região) — pare a instância quando não for usar, se quiser economizar enquanto só está testando.
