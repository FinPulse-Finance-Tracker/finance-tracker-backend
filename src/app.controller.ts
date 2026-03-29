import { Controller, Get, HttpCode, Query } from '@nestjs/common';
import { AppService } from './app.service';
import { MailService } from './mail/mail.service';

@Controller()
export class AppController {
  constructor(
      private readonly appService: AppService,
      private readonly mailService: MailService
  ) {}

  @Get('test-email')
  async testEmail(@Query('email') email: string) {
    if (!email) return { error: 'Please provide an ?email= parameter' };
    await this.mailService.sendDailyReminder(email, 'Test User');
    return { success: true, message: `Test email sent to ${email}` };
  }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('favicon.ico')
  @HttpCode(204)
  getFavicon() {
    return;
  }
}
