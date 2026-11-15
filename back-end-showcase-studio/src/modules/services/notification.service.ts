import { env } from '../../config/env';

export class NotificationService {
  async sendCommunityAccessLink(input: { recipient: string; token: string }) {
    const accessUrl = `${env.FRONTEND_URL}/comunidade/confirmar?token=${encodeURIComponent(input.token)}`;
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
      throw new Error('O envio de e-mails da comunidade não está configurado.');
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [input.recipient],
        subject: 'Acesse sua conta no Criative Lab',
        html: `<p>Use o link abaixo para acessar sua área na comunidade do Criative Lab.</p><p><a href="${accessUrl}">Acessar comunidade</a></p><p>Este link expira em 15 minutos e só pode ser usado uma vez.</p><p>Se você não solicitou este acesso, ignore esta mensagem.</p>`,
      }),
    });

    if (!response.ok) throw new Error('Não foi possível enviar o e-mail de acesso.');
    return { sent: true };
  }

  async sendChangesRequested(input: { projectId: string; recipient: string; reason: string; token: string }) {
    const editUrl = `${env.FRONTEND_URL}/revisar?projectId=${encodeURIComponent(input.projectId)}&token=${encodeURIComponent(input.token)}`;

    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
      console.warn(`[NotificationService] Configure RESEND_API_KEY e EMAIL_FROM para enviar: ${editUrl}`);
      return { editUrl, sent: false };
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [input.recipient],
        subject: 'Seu projeto precisa de alterações',
        html: `<p>O professor solicitou alterações no seu projeto.</p><p><strong>Motivo:</strong> ${escapeHtml(input.reason)}</p><p><a href="${editUrl}">Acessar e corrigir projeto</a></p><p>Este link expira em 72 horas.</p>`,
      }),
    });

    if (!response.ok) throw new Error('Não foi possível enviar o e-mail de correção.');
    return { editUrl, sent: true };
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char] ?? char);
}
