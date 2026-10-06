// Sending email: account verification and password reset links.
// SMTP_URL picks a real mail server; without it messages are printed to the log.

import nodemailer from "nodemailer";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** Development: the message (and its link) goes to the server log. */
export const logMailer: Mailer = {
  async send(m) {
    console.log(`[mail] to ${m.to}: ${m.subject}\n${m.text}\n`);
  },
};

/** Any SMTP provider, e.g. smtps://user:pass@smtp.example.com:465. */
export function smtpMailer(url: string, from: string): Mailer {
  const transport = nodemailer.createTransport(url);
  return {
    async send(m) {
      await transport.sendMail({ from, to: m.to, subject: m.subject, text: m.text });
    },
  };
}

export const verifyMail = (to: string, nickname: string, link: string): Mail => ({
  to,
  subject: "5 секунд: имэйлээ баталгаажуулна уу",
  text: [
    `Сайн байна уу, ${nickname}!`,
    "",
    "5 секунд тэмцээнд бүртгүүлсэнд баярлалаа. Имэйлээ баталгаажуулахын тулд доорх холбоосыг нээнэ үү:",
    link,
    "",
    "Холбоос 24 цагийн дараа хүчингүй болно. Та бүртгүүлээгүй бол энэ имэйлийг үл тоомсорлоно уу.",
  ].join("\n"),
});

export const resetMail = (to: string, nickname: string, link: string): Mail => ({
  to,
  subject: "5 секунд: нууц үг сэргээх",
  text: [
    `Сайн байна уу, ${nickname}!`,
    "",
    "Нууц үгээ шинэчлэхийн тулд доорх холбоосыг нээнэ үү:",
    link,
    "",
    "Холбоос 1 цагийн дараа хүчингүй болно. Та хүсээгүй бол энэ имэйлийг үл тоомсорлоно уу, нууц үг тань өөрчлөгдөхгүй.",
  ].join("\n"),
});
