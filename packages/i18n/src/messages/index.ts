import type { Locale } from '../locales.js';
import { en } from './en.js';
import { es } from './es.js';
import { ptBR, type Messages } from './pt-BR.js';

export type { Messages };

export const MESSAGES: Record<Locale, Messages> = { 'pt-BR': ptBR, en, es };
