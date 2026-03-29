import { Module } from '@nestjs/common';
import { ReminderScheduler } from './reminder.scheduler';

@Module({
    providers: [ReminderScheduler],
})
export class CronModule { }
