import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Chart } from './chart';

describe('Chart', () => {
  it('renderiza um container acessível com o rótulo informado', () => {
    const { getByRole } = render(
      <Chart
        ariaLabel="Demandas por status"
        option={{ series: [{ type: 'pie', data: [{ name: 'Feito', value: 3 }] }] }}
      />,
    );
    const container = getByRole('img', { name: 'Demandas por status' });
    expect(container).toBeInTheDocument();
  });

  it('desmonta sem lançar erro', () => {
    const { unmount } = render(
      <Chart
        ariaLabel="Gráfico"
        option={{
          xAxis: { type: 'category', data: ['a', 'b', 'c'] },
          yAxis: { type: 'value' },
          series: [{ type: 'bar', data: [1, 2, 3] }],
        }}
      />,
    );
    expect(() => {
      unmount();
    }).not.toThrow();
  });
});
