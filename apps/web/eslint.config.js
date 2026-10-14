import { createReactConfig } from '@cube-track/config/eslint/react';

export default [...createReactConfig(import.meta.dirname), { ignores: ['scripts/**'] }];
