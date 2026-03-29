import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
    private transporter: nodemailer.Transporter | undefined;
    private readonly logger = new Logger(MailService.name);

    constructor(private configService: ConfigService) {
        const host = this.configService.get<string>('SMTP_HOST');
        const port = this.configService.get<number>('SMTP_PORT') || 587;
        const user = this.configService.get<string>('SMTP_USER');
        const pass = this.configService.get<string>('SMTP_PASS');

        if (host && user && pass) {
            this.transporter = nodemailer.createTransport({
                host,
                port,
                secure: port === 465,
                auth: { user, pass },
            });
            this.logger.log('Mail transporter initialized successfully.');
        } else {
            this.logger.warn('SMTP credentials missing (.env). Emails will not be sent.');
        }
    }

    async sendDailyReminder(to: string, name: string) {
        if (!this.transporter) {
            return;
        }

        const subject = 'Finance Tracker - Daily Expense Reminder';
        const calendarLink = this.getGoogleCalendarLink();

        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                <h2 style="color: #6a1b9a;">Hello ${name},</h2>
                <p>Just a quick reminder to log your daily expenses in the Finance Tracker app!</p>
                <p>Tracking expenses daily helps you stay on top of your financial goals and gives you better insights into your spending habits.</p>
                <br />
                <div style="text-align: center; margin: 30px 0;">
                    <a href="https://finpulse.nethmihapuarachchi.com/expenses" style="background-color: #8b5cf6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Log Expenses Now</a>
                </div>
                <br />
                <p>Want a push notification from Google Calendar directly? <a href="${calendarLink}" target="_blank">Add this reminder to your Google Calendar</a>.</p>
                <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;" />
                <p style="font-size: 12px; color: #888;">You are receiving this because you are registered on Finance Tracker. We send this daily at 9 PM.</p>
            </div>
        `;

        try {
            await this.transporter.sendMail({
                from: `"Finance Tracker" <${this.configService.get<string>('SMTP_USER')}>`,
                to,
                subject,
                html,
            });
            this.logger.log(`Daily reminder sent to ${to}`);
        } catch (error: any) {
            this.logger.error(`Error sending email to ${to}: ${error.message}`);
        }
    }

    private getGoogleCalendarLink(): string {
        const text = encodeURIComponent('Log Daily Expenses - Finance Tracker');
        const details = encodeURIComponent('Friendly reminder to add your daily expenses in the Finance Tracker. Log them here: https://finpulse.nethmihapuarachchi.com/');
        const recur = encodeURIComponent('RRULE:FREQ=DAILY');
            
        return `https://calendar.google.com/calendar/r/eventedit?text=${text}&details=${details}&recur=${recur}`;
    }
}
