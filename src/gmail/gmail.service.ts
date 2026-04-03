import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { google } from 'googleapis';
import {
    ExtractedExpense,
    extractBody,
    getExchangeRates,
    convertToLKR,
    parseExpenseFromEmail,
} from '../common/expense-parser.util';

export type { ExtractedExpense };

@Injectable()
export class GmailService {
    private readonly logger = new Logger(GmailService.name);

    /**
     * OAuth scope changed from gmail.readonly → gmail.settings.basic
     * This allows only filter/settings management — cannot read inbox content.
     * Far less invasive, users see "Manage Gmail settings" on consent screen.
     */
    private readonly SCOPES = ['https://www.googleapis.com/auth/gmail.settings.basic'];

    constructor(
        private prisma: PrismaService,
        private config: ConfigService,
    ) { }

    private getOAuth2Client() {
        const clientId = this.config.get('GOOGLE_CLIENT_ID');
        const clientSecret = this.config.get('GOOGLE_CLIENT_SECRET');
        const redirectUri = this.config.get('GOOGLE_REDIRECT_URI');

        if (!clientId || !clientSecret || !redirectUri) {
            throw new Error('Google OAuth configuration is incomplete');
        }
        return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    }

    getAuthUrl(state: string): string {
        const oauth2Client = this.getOAuth2Client();
        return oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: this.SCOPES,
            state,
            prompt: 'consent',
        });
    }

    /**
     * Handle OAuth callback — exchange code for tokens, then:
     * 1. Store tokens
     * 2. Add forwarding address to user's Gmail (triggers verification email to forwarding address)
     * 3. Create Gmail filter: purchases → forward to user's receipts address
     * 4. Mark user's forwardingActive = true once filter is in place
     */
    async handleCallback(userId: string, code: string): Promise<void> {
        const oauth2Client = this.getOAuth2Client();
        const { tokens } = await oauth2Client.getToken(code);

        if (!tokens.access_token) {
            throw new Error('Failed to get access token');
        }

        oauth2Client.setCredentials(tokens);

        // Get user's Gmail address for the EmailConnection record
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        const profile = await gmail.users.getProfile({ userId: 'me' });
        const emailAddress = profile.data.emailAddress || '';

        // Upsert EmailConnection (provider = 'gmail_forwarding')
        const existingConn = await this.prisma.emailConnection.findFirst({
            where: { userId, emailAddress, provider: 'gmail_forwarding' },
            select: { id: true },
        });

        await this.prisma.emailConnection.upsert({
            where: { id: existingConn?.id || 'new' },
            update: {
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token || undefined,
                isActive: true,
                lastSynced: null,
            },
            create: {
                userId,
                emailAddress,
                provider: 'gmail_forwarding',
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token || '',
                isActive: true,
            },
        });

        // Get or create the user's forwarding address
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { forwardingAddress: true },
        });

        let forwardingAddress = user?.forwardingAddress;
        if (!forwardingAddress) {
            const shortId = userId.replace(/-/g, '').substring(0, 10).toLowerCase();
            const domain = this.config.get<string>('FORWARDING_DOMAIN') ?? 'receipts.yourapp.com';
            forwardingAddress = `receipts-${shortId}@${domain}`;
            await this.prisma.user.update({
                where: { id: userId },
                data: { forwardingAddress },
            });
        }

        // Set up Gmail forwarding filter
        await this.setupGmailForwarding(oauth2Client, forwardingAddress, userId);
    }

    /**
     * Add forwarding address to Gmail and create automatic filter.
     * Gmail API flow:
     *  1. Create forwarding address → Gmail sends verification email to that address
     *  2. The Cloudflare Worker will auto-detect and click the verification link
     *  3. Create filter: category:purchases OR (subject:receipt OR subject:order confirmation) → forward
     */
    private async setupGmailForwarding(oauth2Client: any, forwardingAddress: string, userId: string): Promise<void> {
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        try {
            // Step 1: Add the forwarding address (gmail sends verification email to it)
            this.logger.log(`📤 Adding forwarding address: ${forwardingAddress}`);
            await gmail.users.settings.forwardingAddresses.create({
                userId: 'me',
                requestBody: { forwardingEmail: forwardingAddress },
            });
            this.logger.log(`✅ Forwarding address added — awaiting auto-verification`);
        } catch (err: any) {
            // If address already exists (code 409), continue
            if (err?.code !== 409) {
                this.logger.error(`❌ Failed to add forwarding address: ${err.message}`);
                throw err;
            }
            this.logger.log(`ℹ️ Forwarding address already exists`);
        }

        try {
            // Step 2: Create filter for purchase/receipt emails
            this.logger.log(`🔧 Creating Gmail filter to forward purchase emails`);
            await gmail.users.settings.filters.create({
                userId: 'me',
                requestBody: {
                    criteria: {
                        // Match ONLY emails in Gmail's built-in Purchases category as requested by user
                        query: 'category:purchases',
                    },
                    action: {
                        forward: forwardingAddress,
                    },
                },
            });
            this.logger.log(`✅ Gmail filter created — purchases will auto-forward`);

            // Mark user's forwarding as active
            await this.prisma.user.update({
                where: { id: userId },
                data: { forwardingActive: true },
            });
        } catch (err: any) {
            this.logger.error(`❌ Failed to create Gmail filter: ${err.message}`);
            throw err;
        }
    }

    /**
     * Get current forwarding connection status for a user
     */
    async getStatus(userId: string) {
        const connection = await this.prisma.emailConnection.findFirst({
            where: { userId, provider: 'gmail_forwarding', isActive: true },
        });

        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { forwardingAddress: true, forwardingActive: true },
        });

        return {
            connected: !!connection,
            emailAddress: connection?.emailAddress || null,
            lastSynced: connection?.lastSynced || null,
            forwardingAddress: user?.forwardingAddress || null,
            forwardingActive: user?.forwardingActive || false,
        };
    }

    /**
     * Disconnect — deactivate the connection and remove the Gmail filter
     */
    async disconnect(userId: string) {
        const connection = await this.prisma.emailConnection.findFirst({
            where: { userId, provider: 'gmail_forwarding', isActive: true },
        });

        await this.prisma.emailConnection.updateMany({
            where: { userId, provider: 'gmail_forwarding' },
            data: { isActive: false },
        });

        await this.prisma.user.update({
            where: { id: userId },
            data: { forwardingActive: false },
        });

        // Attempt to remove the Gmail filter (need stored token)
        if (connection) {
            try {
                const oauth2Client = this.getOAuth2Client();
                oauth2Client.setCredentials({
                    access_token: connection.accessToken,
                    refresh_token: connection.refreshToken,
                });
                const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

                // List all filters and remove matching ones
                const filters = await gmail.users.settings.filters.list({ userId: 'me' });
                const user = await this.prisma.user.findUnique({
                    where: { id: userId },
                    select: { forwardingAddress: true },
                });

                for (const filter of (filters.data.filter || [])) {
                    if (filter.action?.forward === user?.forwardingAddress) {
                        await gmail.users.settings.filters.delete({
                            userId: 'me',
                            id: filter.id!,
                        });
                        this.logger.log(`🗑️ Removed Gmail forwarding filter`);
                    }
                }
            } catch (err) {
                this.logger.warn(`⚠️ Could not remove Gmail filter (non-fatal): ${err.message}`);
            }
        }
    }

    /**
     * Scan Gmail for bill/receipt emails (kept for backward compatibility with manual sync)
     * @deprecated Use the forwarding system instead
     */
    async syncEmails(userId: string, targetStartDate?: Date, targetEndDate?: Date): Promise<ExtractedExpense[]> {
        const connection = await this.prisma.emailConnection.findFirst({
            where: { userId, provider: 'gmail_forwarding', isActive: true },
        });

        if (!connection) {
            throw new UnauthorizedException('Gmail forwarding not connected');
        }

        // Note: gmail.settings.basic does NOT allow reading emails.
        // The syncEmails method is retained for structure but returns empty with a log.
        this.logger.warn('⚠️ syncEmails called but gmail.settings.basic scope cannot read emails. Use forwarding flow.');
        return [];
    }

    /**
     * Import selected expenses into the database (kept for import modal compatibility)
     */
    async importExpenses(userId: string, expenses: Array<{
        merchant: string;
        amount: number;
        date: string;
        description: string;
        emailId: string;
        categoryId?: string;
    }>) {
        const created = await Promise.all(
            expenses.map(exp =>
                this.prisma.expense.create({
                    data: {
                        userId,
                        amount: exp.amount,
                        description: exp.description,
                        merchant: exp.merchant,
                        date: new Date(exp.date),
                        source: 'email_forwarding',
                        emailId: exp.emailId,
                        categoryId: exp.categoryId || null,
                    },
                    include: { category: true },
                })
            )
        );
        return created;
    }
}
