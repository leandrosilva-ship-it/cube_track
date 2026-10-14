import { notFound } from 'next/navigation';

/** Qualquer rota desconhecida dentro do idioma cai no not-found localizado. */
export default function CatchAll() {
  notFound();
}
