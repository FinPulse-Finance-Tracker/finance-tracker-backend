import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
    parseExpenseFromEmail,
    getExchangeRates,
    convertToLKR,
} from '../common/expense-parser.util';
import * as crypto from 'crypto';
import { GmailService } from '../gmail/gmail.service';

export interface IngestPayload {
    forwardingShortId: string; // first 10 chars (no dashes) of user UUID, from the "To" address
    subject: string;
    from: string;
    fromName?: string;
    text?: string;
    html?: string;
    date?: string;
}

@Injectable()
export class EmailIngestService {
    private readonly logger = new Logger(EmailIngestService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly gmailService: GmailService
    ) {}

    /**
     * Resolve a user from their forwarding address shortId.
     * The shortId is the first 10 chars (no dashes) of their DB UUID.
     * We store the full forwardingAddress, so we query by LIKE pattern.
     */
    private async resolveUserByShortId(shortId: string) {
        const domain = process.env.FORWARDING_DOMAIN ?? 'receipts.yourapp.com';
        const fullAddress = `receipts-${shortId}@${domain}`;
        return this.prisma.user.findUnique({
            where: { forwardingAddress: fullAddress },
            select: { id: true, forwardingActive: true },
        });
    }

    /**
     * Final step: Cloudflare worker notifies us that the forward address is verified.
     * We look up the user and trigger GmailService to create the forwarding rule.
     */
    async verifyAndCreateFilter(shortId: string) {
        const user = await this.resolveUserByShortId(shortId);
        if (!user) {
            this.logger.warn(`⚠️ Cannot verify forwarding for unknown shortId=${shortId}`);
            return false;
        }

        this.logger.log(`🔗 Webhook triggered: Verifying forwarding and creating filter for user ${user.id}`);
        await this.gmailService.finalizeForwardingVerification(user.id);
        return true;
    }

    async processEmail(payload: IngestPayload) {
        const { forwardingShortId, subject, from, text, html, date } = payload;

        // Resolve user from their forwarding address
        const user = await this.resolveUserByShortId(forwardingShortId);

        if (!user) {
            this.logger.warn(`⚠️ Email received for unknown shortId=${forwardingShortId}`);
            return null;
        }

        // Dedup key: stable hash of subject+from+date
        const dedupKey = crypto
            .createHash('sha256')
            .update(`${subject}|${from}|${date ?? ''}`)
            .digest('hex')
            .substring(0, 32);

        const existing = await this.prisma.expense.findFirst({
            where: { userId: user.id, source: 'email_forwarding', emailId: dedupKey },
        });

        if (existing) {
            this.logger.log(`⏭ Duplicate skipped (dedupKey=${dedupKey})`);
            return null;
        }

        // Build body text
        const bodyText = text ?? (html ? html.replace(/<[^>]*>/g, ' ') : '');

        // Parse expense
        const extracted = parseExpenseFromEmail(subject, from, date ?? '', bodyText, dedupKey);

        if (!extracted) {
            this.logger.log(`📭 No parseable expense in email: "${subject}"`);
            return null;
        }

        // Currency conversion to LKR
        let finalAmount = extracted.amount;
        let finalDescription = extracted.description;

        if (extracted.currency !== 'LKR') {
            const rates = await getExchangeRates();
            const originalAmount = extracted.amount;
            finalAmount = convertToLKR(extracted.amount, extracted.currency, rates);
            finalDescription += ` (converted from ${originalAmount} ${extracted.currency})`;
        }

        // Auto-save expense
        const expense = await this.prisma.expense.create({
            data: {
                userId: user.id,
                amount: finalAmount,
                description: finalDescription,
                merchant: extracted.merchant,
                date: new Date(extracted.date),
                source: 'email_forwarding',
                emailId: dedupKey,
                categoryId: null,
            },
        });

        this.logger.log(`💾 Auto-saved: ${extracted.merchant} — ${finalAmount} LKR for user ${user.id}`);
        return expense;
    }
}
