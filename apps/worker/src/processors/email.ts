import { EmailJobSchema, type EmailJob, type EmailTemplate } from '@cube-track/shared';
import type { Job } from 'bullmq';
import nodemailer, { type Transporter } from 'nodemailer';

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );

interface Rendered {
  subject: string;
  text: string;
  html: string;
}

type Data = Record<string, string>;

const TEMPLATES: Record<
  EmailTemplate,
  (data: Data) => { subject: string; lines: string[]; action?: { label: string; url: string } }
> = {
  magic_link: (data) => ({
    subject: 'Seu link de acesso ao CUBE TRACK',
    lines: [
      `Olá, ${data.name ?? ''}!`,
      `Use o botão abaixo para entrar em ${data.organization ?? 'sua organização'}. O link expira em ${data.expiresInMinutes ?? '15'} minutos e só pode ser usado uma vez.`,
      'Se você não solicitou este acesso, ignore este e-mail.',
    ],
    action: { label: 'Entrar no CUBE TRACK', url: data.link ?? '' },
  }),
  password_reset: (data) => ({
    subject: 'Redefinição de senha — CUBE TRACK',
    lines: [
      `Olá, ${data.name ?? ''}!`,
      `Recebemos um pedido para redefinir sua senha. O link expira em ${data.expiresInMinutes ?? '60'} minutos.`,
      'Se não foi você, ignore este e-mail: sua senha continua a mesma.',
    ],
    action: { label: 'Redefinir senha', url: data.link ?? '' },
  }),
  email_verification: (data) => ({
    subject: 'Confirme seu e-mail — CUBE TRACK',
    lines: [
      `Olá, ${data.name ?? ''}!`,
      'Confirme seu endereço de e-mail para concluir o cadastro.',
    ],
    action: { label: 'Confirmar e-mail', url: data.link ?? '' },
  }),
  invitation: (data) => ({
    subject: `${data.inviter ?? 'Alguém'} convidou você para ${data.organization ?? 'uma organização'} no CUBE TRACK`,
    lines: [
      `${data.inviter ?? 'Alguém'} convidou você para colaborar em ${data.organization ?? 'uma organização'}.`,
      ...(data.message === undefined || data.message === '' ? [] : [`Mensagem: “${data.message}”`]),
      'O convite expira em 7 dias.',
    ],
    action: { label: 'Aceitar convite', url: data.link ?? '' },
  }),
  mention: (data) => ({
    subject: `${data.actor ?? 'Alguém'} mencionou você em "${data.item ?? ''}"`,
    lines: [`${data.actor ?? 'Alguém'} mencionou você:`, `“${data.excerpt ?? ''}”`],
    action: { label: 'Ver atualização', url: data.link ?? '' },
  }),
  approval_requested: (data) => ({
    subject: `${data.requester ?? 'Alguém'} pediu sua aprovação em "${data.item ?? ''}"`,
    lines: [
      `${data.requester ?? 'Alguém'} pediu sua aprovação para "${data.item ?? ''}".`,
      ...(data.note === undefined || data.note === '' ? [] : [`Observação: “${data.note}”`]),
    ],
    action: { label: 'Ver pedido de aprovação', url: data.link ?? '' },
  }),
  notification_digest: (data) => ({
    subject: `${data.count ?? '0'} novidade(s) no CUBE TRACK`,
    lines: [
      'Resumo de notificações pendentes:',
      ...(data.items ?? '').split('\n').filter((line) => line !== ''),
    ],
    action: { label: 'Ver tudo no CUBE TRACK', url: data.link ?? '' },
  }),
  absence_requested: (data) => ({
    subject: `${data.requester ?? 'Alguém'} solicitou ausência`,
    lines: [
      `${data.requester ?? 'Alguém'} solicitou ausência (${data.type ?? ''}) de ${data.startDate ?? ''} a ${data.endDate ?? ''}.`,
    ],
    action: { label: 'Ver solicitação', url: data.link ?? '' },
  }),
  absence_decided: (data) => ({
    subject: `Sua ausência foi ${data.status ?? ''}`,
    lines: [`Sua solicitação de ausência de ${data.startDate ?? ''} a ${data.endDate ?? ''} foi ${data.status ?? ''}.`],
    action: { label: 'Ver ausências', url: data.link ?? '' },
  }),
  resource_request_created: (data) => ({
    subject: `Nova solicitação de recurso: "${data.roleTitle ?? ''}"`,
    lines: [`${data.requester ?? 'Alguém'} solicitou um recurso: "${data.roleTitle ?? ''}".`],
    action: { label: 'Ver solicitação', url: data.link ?? '' },
  }),
  resource_request_fulfilled: (data) => ({
    subject: `Solicitação de recurso "${data.roleTitle ?? ''}" foi atendida`,
    lines: [`Sua solicitação de recurso "${data.roleTitle ?? ''}" foi atendida.`],
    action: { label: 'Ver solicitação', url: data.link ?? '' },
  }),
  timesheet_submitted: (data) => ({
    subject: `${data.person ?? 'Alguém'} enviou o timesheet da semana`,
    lines: [`${data.person ?? 'Alguém'} enviou o timesheet da semana de ${data.periodStart ?? ''} para aprovação.`],
    action: { label: 'Ver timesheet', url: data.link ?? '' },
  }),
  timesheet_decided: (data) => ({
    subject: `Seu timesheet foi ${data.status ?? ''}`,
    lines: [`Seu timesheet da semana de ${data.periodStart ?? ''} foi ${data.status ?? ''}.`],
    action: { label: 'Ver timesheet', url: data.link ?? '' },
  }),
};

/** Renderiza o e-mail (texto e HTML com escape de todo conteúdo dinâmico). */
export function renderEmail(template: EmailTemplate, data: Data): Rendered {
  const spec = TEMPLATES[template](data);
  const action = spec.action;
  const text = [
    ...spec.lines,
    ...(action === undefined ? [] : ['', `${action.label}: ${action.url}`]),
    '',
    '— CUBE TRACK',
  ].join('\n');
  const html = `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5">
${spec.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('\n')}
${action === undefined ? '' : `<p><a href="${escapeHtml(action.url)}" style="background:#0073ea;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${escapeHtml(action.label)}</a></p>`}
<p style="color:#6b7280;font-size:12px">— CUBE TRACK</p></body></html>`;
  return { subject: spec.subject, text, html };
}

export function createMailer(smtpUrl: string): Transporter {
  return smtpUrl === 'json://'
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport(smtpUrl);
}

export function emailProcessor(mailer: Transporter, from: string) {
  return async (job: Job<EmailJob>) => {
    const email = EmailJobSchema.parse(job.data);
    const rendered = renderEmail(email.template, email.data);
    const info = (await mailer.sendMail({
      from,
      to: email.to,
      ...(email.replyTo === undefined ? {} : { replyTo: email.replyTo }),
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    })) as { messageId: string };
    return { messageId: info.messageId };
  };
}
