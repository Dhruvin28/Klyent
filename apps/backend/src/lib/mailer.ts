import nodemailer from 'nodemailer'
import { config } from '../config'

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass,
  },
})

export async function sendOtpEmail(to: string, otp: string): Promise<void> {
  await transporter.sendMail({
    from: `"Klyent" <${config.smtp.user}>`,
    to,
    subject: 'Your Klyent password reset code',
    text: `Your one-time password (OTP) is ${otp}. It expires in 10 minutes. If you did not request this, you can ignore this email.`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #111;">Reset your password</h2>
        <p>Use the one-time password below to reset your Klyent account password. It expires in 10 minutes.</p>
        <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px; margin: 24px 0;">${otp}</p>
        <p style="color: #666; font-size: 13px;">If you did not request this, you can safely ignore this email.</p>
      </div>
    `,
  })
}
