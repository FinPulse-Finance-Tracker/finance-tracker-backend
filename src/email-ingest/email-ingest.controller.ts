import {
    Controller,
    Post,
    Body,
    Headers,
    UnauthorizedException,
    Logger,
    BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailIngestService } from './email-ingest.service';

export class IngestPayload {
    forwardingShortId: string;
    subject: string;
    from: string;
    fromName?: string;
    text?: string;
    html?: string;
    date?: string;
}

@Controller('email-ingest')
export class EmailIngestController {
    private readonly logger = new Logger(EmailIngestController.name);

    constructor(
        private readonly emailIngestService: EmailIngestService,
        private readonly config: ConfigService,
    ) {}

    /**
     * POST /email-ingest/receive
     * Called by the Cloudflare Email Worker when a forwarded email arrives.
     * Protected by shared secret in x-ingest-secret header.
     */
    @Post('receive')
    async receive(
        @Headers('x-ingest-secret') secret: string,
        @Body() payload: IngestPayload,
    ) {
        const expected = this.config.get<string>('EMAIL_INGEST_SECRET');
        if (!expected || secret !== expected) {
            this.logger.warn(`❌ Invalid ingest secret`);
            throw new UnauthorizedException('Invalid ingest secret');
        }

        if (!payload.forwardingShortId || !payload.subject || !payload.from) {
            throw new BadRequestException('Missing required fields: forwardingShortId, subject, from');
        }

        this.logger.log(`📨 Ingest for shortId=${payload.forwardingShortId} — "${payload.subject}"`);

        const result = await this.emailIngestService.processEmail(payload);

        if (result) {
            return { success: true, expenseId: result.id };
        }
        return { success: false, reason: 'No parseable expense found in email' };
    }

    /**
     * POST /email-ingest/verify-forwarding
     * Called by the Cloudflare Worker after it auto-clicks the Gmail verification link.
     * Signals the backend that the forwarding address verification is complete.
     */
    @Post('verify-forwarding')
    async verifyForwarding(
        @Headers('x-ingest-secret') secret: string,
        @Body() body: { verificationClicked: boolean; forwardingShortId?: string },
    ) {
        const expected = this.config.get<string>('EMAIL_INGEST_SECRET');
        if (!expected || secret !== expected) {
            throw new UnauthorizedException('Invalid ingest secret');
        }

        if (body.forwardingShortId) {
            await this.emailIngestService.verifyAndCreateFilter(body.forwardingShortId);
        }

        this.logger.log(`✅ Gmail forwarding verification confirmed by worker`);
        return { success: true };
    }
}
