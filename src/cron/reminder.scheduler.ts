import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class ReminderScheduler {
    private readonly logger = new Logger(ReminderScheduler.name);

    constructor(
        private prisma: PrismaService,
        private mailService: MailService,
    ) { }

    // Run at 9 PM (21:00) every day in Asia/Colombo time
    @Cron('00 21 * * *', { timeZone: 'Asia/Colombo' })
    async handleDailyExpenseReminder() {
        this.logger.log('Starting daily expense reminder job (9:00 PM)...');

        try {
            const users = await this.prisma.user.findMany({
                where: { email: { not: '' } }
            });

            this.logger.log(`Found ${users.length} users. Sending reminders...`);

            for (const user of users) {
                if (user.email) {
                    await this.mailService.sendDailyReminder(user.email, user.name || 'User');
                }
            }

            this.logger.log('Finished sending daily reminders.');
        } catch (error) {
            this.logger.error(`Error in daily reminder job: ${error.message}`);
        }
    }
}
