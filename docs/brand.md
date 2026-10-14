# CUBE TRACK — Identidade visual

> Fonte da verdade dos valores: `packages/ui/src/tokens.ts`, espelhado em `packages/ui/src/styles/tokens.css` (um teste garante que os dois coincidem). Os componentes podem ser vistos no Storybook: `pnpm --filter @cube-track/ui storybook`.

## 1. Conceito

O nome junta duas ideias:

- **cubo**: estrutura, várias faces do mesmo dado (Tabela, Kanban, Gantt, Dashboards);
- **track**: acompanhar o andamento do operacional ao estratégico.

A marca é um **cubo isométrico** com três faces. Uma trilha clara atravessa as faces laterais, como uma linha de progresso que sobe.

## 2. Logo

| Elemento             | Uso                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `LogoMark`           | Marca isolada (32×32, `viewBox 0 0 32 32`): barra lateral, favicon, ícone do PWA                                           |
| `Logo`               | Marca + nome "CUBE **TRACK**" (peso 800, espaçamento 0,08 em; "TRACK" na cor primária): cabeçalhos e telas de autenticação |
| `Logo compact`       | Só a marca, quando o espaço é reduzido                                                                                     |
| `app/icon.svg`       | Favicon vetorial                                                                                                           |
| `apple-icon.png`     | Ícone iOS (180 px)                                                                                                         |
| `public/icons/*.png` | Ícones do manifesto (192/512, incluindo `maskable`)                                                                        |

Faces do cubo:

- **topo**: Lavanda `#a9b3ff`;
- **esquerda**: Azul Cubo `#4252d9`;
- **direita**: Turquesa `#00a9a5`;
- **trilha**: branco, traço de 1,8 px com pontas arredondadas.

Regras de uso:

- Área de proteção mínima: metade da altura da marca em volta.
- Tamanho mínimo: 16 px (favicon); 24 px em interfaces.
- Não rotacionar, não trocar as cores das faces e não aplicar sombra.
- Sobre fundos escuros, usar o mesmo símbolo: as faces mantêm contraste com `#12141c`.
- Acessibilidade: com texto visível ao lado, a marca é decorativa (`aria-hidden`). Isolada, tem `role="img"` e `aria-label="CUBE TRACK"`.

## 3. Cores da marca

| Token       | Hex       | Papel                                                           |
| ----------- | --------- | --------------------------------------------------------------- |
| `primary`   | `#4252d9` | Azul Cubo: ações principais, links, foco, item ativo            |
| `accent`    | `#00a9a5` | Turquesa: destaques secundários, gráficos, face lateral do cubo |
| `highlight` | `#a9b3ff` | Lavanda: face superior do cubo, ilustrações                     |
| `ink`       | `#1b1f2e` | Texto principal no tema claro                                   |

## 4. Temas

Os dois temas definem as mesmas chaves, aplicadas via `data-theme` em `<html>`. A preferência "sistema" segue `prefers-color-scheme`.

| Papel                  | Claro                 | Escuro                |
| ---------------------- | --------------------- | --------------------- |
| Fundo da página        | `#f6f7fb`             | `#12141c`             |
| Superfície (cards)     | `#ffffff`             | `#1a1d28`             |
| Superfície rebaixada   | `#eef0f6`             | `#0e1017`             |
| Superfície elevada     | `#ffffff`             | `#222634`             |
| Borda                  | `#d9dce6`             | `#2e3344`             |
| Borda forte (controle) | `#8a91a8`             | `#6b7391`             |
| Texto                  | `#1b1f2e`             | `#eceef5`             |
| Texto secundário       | `#4a5068`             | `#b4b9cc`             |
| Texto sutil            | `#5f6680`             | `#9298ae`             |
| Primária               | `#4252d9`             | `#7b87ff`             |
| Texto sobre primária   | `#ffffff`             | `#0b0d14`             |
| Primária suave (ativo) | `#e8eaff`             | `#1e2244`             |
| Perigo / suave         | `#c62a3c` / `#fde8ea` | `#ff7a86` / `#3d1f26` |
| Sucesso / suave        | `#127c58` / `#e3f6ee` | `#4fd6a0` / `#173528` |
| Atenção / suave        | `#9a5300` / `#fff1dc` | `#ffb547` / `#3a2b14` |
| Informação / suave     | `#1d6aaf` / `#e3f0fc` | `#6cb4ff` / `#16304a` |

### Contraste (WCAG 2.1 AA, verificado em `tokens.test.ts`)

| Par                                        | Claro  | Escuro |
| ------------------------------------------ | ------ | ------ |
| Texto sobre superfície                     | 16,4:1 | 14,5:1 |
| Texto secundário sobre superfície          | 8,0:1  | 8,6:1  |
| Texto sutil sobre superfície rebaixada     | 5,0:1  | 5,3:1  |
| Primária sobre superfície                  | 6,1:1  | 5,4:1  |
| Texto sobre botão primário                 | 6,1:1  | 6,2:1  |
| Primária sobre primária suave (item ativo) | 5,1:1  | 4,9:1  |
| Borda forte sobre superfície (≥ 3:1)       | 3,1:1  | 3,6:1  |

O teste falha se qualquer texto ficar abaixo de 4,5:1 sobre qualquer superfície, ou se bordas de controles e o anel de foco ficarem abaixo de 3:1.

## 5. Paleta de status

São 20 cores vivas para rótulos de colunas Status, prioridade e etiquetas. A cor de texto (`on`) de cada uma foi escolhida para contraste ≥ 4,5:1.

| Nome       | Fundo     | Texto     | Nome        | Fundo     | Texto     |
| ---------- | --------- | --------- | ----------- | --------- | --------- |
| green      | `#00c875` | `#1b1f2e` | purple      | `#9149d0` | `#ffffff` |
| dark-green | `#037f4c` | `#ffffff` | dark-purple | `#784bd1` | `#ffffff` |
| lime       | `#9cd326` | `#1b1f2e` | indigo      | `#5559df` | `#ffffff` |
| yellow     | `#ffcb00` | `#1b1f2e` | blue        | `#579bfc` | `#1b1f2e` |
| orange     | `#fdab3d` | `#1b1f2e` | dark-blue   | `#0060b9` | `#ffffff` |
| red        | `#df2f4a` | `#ffffff` | sky         | `#66ccff` | `#1b1f2e` |
| berry      | `#cf3350` | `#ffffff` | teal        | `#00a9a5` | `#1b1f2e` |
| dark-red   | `#bb3354` | `#ffffff` | aqua        | `#4eccc6` | `#1b1f2e` |
| pink       | `#ff5ac4` | `#1b1f2e` | brown       | `#7f5347` | `#ffffff` |
| grey       | `#c4c4c4` | `#1b1f2e` | dark-grey   | `#757575` | `#ffffff` |

Cores livres definidas pelo usuário passam por `accessiblePair(cor)`, que escurece ou clareia o fundo até o texto atingir 4,5:1. O `StatusPill` faz isso automaticamente. A cor nunca é o único sinal: o pill sempre mostra o rótulo em texto.

## 6. Tipografia

- **Fonte:** pilha do sistema (`ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, …`). Não há download de fontes, o que dá LCP mais rápido, e a renderização é nativa em cada plataforma.
- **Escala:** `text-xs` 12 px (metadados), `text-sm` 14 px (corpo de interface), `text-base` 16 px (corpo de leitura e títulos de seção), `text-xl` 20 px e `text-2xl` 24 px (títulos de página).
- **Pesos:** 400 (texto), 500 (rótulos e itens de menu), 600 (títulos), 800 (só no logotipo).
- Números tabulares (`tabular-nums`) em colunas numéricas, datas e UST.

## 7. Forma, densidade e movimento

- **Raios:** `sm` 4 px, `md` 6 px (controles), `lg` 10 px (cards e menus), `xl` 14 px (diálogos), `full` (avatares e pills).
- **Densidade** (`data-density`):

  | Densidade            | Controle | Linha | Espaçamento |
  | -------------------- | -------- | ----- | ----------- |
  | Confortável (padrão) | 36 px    | 40 px | 12 px       |
  | Compacta             | 30 px    | 32 px | 8 px        |

- **Foco:** anel de 2 px na cor de foco, com 2 px de afastamento, sempre visível ao navegar por teclado (`:focus-visible`).
- **Movimento:** transições curtas (150–200 ms) em overlays e hover. Com `prefers-reduced-motion`, animações e transições são desativadas.

## 8. Voz

- pt-BR por padrão, direto e cordial ("Novo item", "Minha semana", "Sem itens nesta semana").
- Verbos no infinitivo nos botões ("Criar board", "Convidar").
- Mensagens de erro dizem o que aconteceu e o que fazer ("Sessão encerrada por segurança. Entre novamente.").
- Datas no formato brasileiro (14/10/2026), moeda em R$ com vírgula decimal e semana começando na segunda-feira.
