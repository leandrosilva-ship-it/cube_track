import type { Decorator, Preview } from '@storybook/react-vite';
import { useEffect, type ReactNode } from 'react';

import { TooltipProvider } from '../src/components/tooltip';
import '../src/styles/globals.css';

function ThemeFrame({
  theme,
  density,
  children,
}: {
  theme: string;
  density: string;
  children: ReactNode;
}) {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-density', density);
    root.lang = 'pt-BR';
  }, [theme, density]);
  return (
    <TooltipProvider delayDuration={200}>
      <div className="bg-background p-6 text-fg">{children}</div>
    </TooltipProvider>
  );
}

const withTheme: Decorator = (Story, context) => (
  <ThemeFrame theme={String(context.globals.theme)} density={String(context.globals.density)}>
    <Story />
  </ThemeFrame>
);

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      description: 'Tema',
      toolbar: {
        title: 'Tema',
        icon: 'mirror',
        items: [
          { value: 'light', title: 'Claro' },
          { value: 'dark', title: 'Escuro' },
        ],
        dynamicTitle: true,
      },
    },
    density: {
      description: 'Densidade',
      toolbar: {
        title: 'Densidade',
        icon: 'component',
        items: [
          { value: 'comfortable', title: 'Confortável' },
          { value: 'compact', title: 'Compacta' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'light', density: 'comfortable' },
  parameters: {
    layout: 'fullscreen',
    controls: { expanded: true },
    a11y: { test: 'error' },
  },
};

export default preview;
