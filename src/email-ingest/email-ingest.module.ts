import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailIngestController } from './email-ingest.controller';
import { EmailIngestService } from './email-ingest.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [PrismaModule, ConfigModule],
    controllers: [EmailIngestController],
    providers: [EmailIngestService],
})
export class EmailIngestModule {}

