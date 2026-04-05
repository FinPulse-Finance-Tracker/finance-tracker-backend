import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailIngestController } from './email-ingest.controller';
import { EmailIngestService } from './email-ingest.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { GmailModule } from '../gmail/gmail.module';

@Module({
    imports: [PrismaModule, ConfigModule, AuthModule, GmailModule],
    controllers: [EmailIngestController],
    providers: [EmailIngestService],
})
export class EmailIngestModule {}

