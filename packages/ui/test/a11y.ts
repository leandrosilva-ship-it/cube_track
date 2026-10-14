import axe from 'axe-core';

/** Executa o axe (regras WCAG 2.1 A/AA) e falha listando as violações. */
export async function expectNoA11yViolations(container: Element = document.body): Promise<void> {
  const result = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    // O jsdom não calcula estilos/layout: contraste é validado pelos testes de tokens e Lighthouse.
    rules: { 'color-contrast': { enabled: false } },
  });
  const details = result.violations.map(
    (violation) =>
      `${violation.id}: ${violation.help} → ${violation.nodes.map((node) => node.html).join(' | ')}`,
  );
  if (details.length > 0) throw new Error(`Violações de acessibilidade:\n${details.join('\n')}`);
}
