import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { google } from 'googleapis';

export interface ExtractedExpense {
    id: string; // unique id for this email (gmailId)
    merchant: string;
    amount: number;
    currency: string;
    date: string; // YYYY-MM-DD
    description: string;
    emailSubject: string;
    emailFrom: string;
}

@Injectable()
export class GmailService {
    private readonly SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

    constructor(
        private prisma: PrismaService,
        private config: ConfigService,
    ) { }

    private getOAuth2Client() {
        const clientId = this.config.get('GOOGLE_CLIENT_ID');
        const clientSecret = this.config.get('GOOGLE_CLIENT_SECRET');
        const redirectUri = this.config.get('GOOGLE_REDIRECT_URI');

        if (!clientId || !clientSecret || !redirectUri) {
            console.error('❌ Missing Google OAuth configuration:', {
                clientId: !!clientId,
                clientSecret: !!clientSecret,
                redirectUri: !!redirectUri,
            });
            throw new Error('Google OAuth configuration is incomplete');
        }

        return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    }

    /**
     * Generate the Google OAuth authorization URL
     */
    getAuthUrl(state: string): string {
        try {
            console.log('🏗️ Generating Google Auth URL for state:', state);
            const oauth2Client = this.getOAuth2Client();
            const url = oauth2Client.generateAuthUrl({
                access_type: 'offline',
                scope: this.SCOPES,
                state,
                prompt: 'consent',
            });
            console.log('🌐 Generated Google Auth URL:', url);
            return url;
        } catch (error) {
            console.error('❌ Error in getAuthUrl:', error.message);
            throw error;
        }
    }

    /**
     * Handle OAuth callback — exchange code for tokens and store
     */
    async handleCallback(userId: string, code: string): Promise<void> {
        const oauth2Client = this.getOAuth2Client();
        const { tokens } = await oauth2Client.getToken(code);

        if (!tokens.access_token) {
            throw new Error('Failed to get access token');
        }

        // Get the user's Gmail address
        oauth2Client.setCredentials(tokens);
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        const profile = await gmail.users.getProfile({ userId: 'me' });
        const emailAddress = profile.data.emailAddress || '';

        // Upsert connection
        await this.prisma.emailConnection.upsert({
            where: {
                // Find by userId + emailAddress combination via a raw approach
                id: (await this.prisma.emailConnection.findFirst({
                    where: { userId, emailAddress },
                    select: { id: true },
                }))?.id || 'new',
            },
            update: {
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token || undefined,
                isActive: true,
                lastSynced: null,
            },
            create: {
                userId,
                emailAddress,
                provider: 'gmail',
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token || '',
                isActive: true,
            },
        });
    }

    /**
     * Get current Gmail connection status for a user
     */
    async getStatus(userId: string) {
        const connection = await this.prisma.emailConnection.findFirst({
            where: { userId, provider: 'gmail', isActive: true },
        });

        return {
            connected: !!connection,
            emailAddress: connection?.emailAddress || null,
            lastSynced: connection?.lastSynced || null,
        };
    }

    /**
     * Disconnect Gmail for a user
     */
    async disconnect(userId: string) {
        await this.prisma.emailConnection.updateMany({
            where: { userId, provider: 'gmail' },
            data: { isActive: false },
        });
    }

    /**
     * Scan Gmail for bill/receipt emails and extract expense data
     */
    async syncEmails(userId: string): Promise<ExtractedExpense[]> {
        const connection = await this.prisma.emailConnection.findFirst({
            where: { userId, provider: 'gmail', isActive: true },
        });

        if (!connection) {
            throw new UnauthorizedException('Gmail not connected');
        }

        // Set up authenticated OAuth client
        const oauth2Client = this.getOAuth2Client();
        oauth2Client.setCredentials({
            access_token: connection.accessToken,
            refresh_token: connection.refreshToken,
        });

        // Refresh token if needed
        oauth2Client.on('tokens', async (tokens) => {
            console.log('🔄 Received new tokens from Google');
            if (tokens.access_token) {
                console.log('✅ Updating Access Token in database');
                await this.prisma.emailConnection.update({
                    where: { id: connection.id },
                    data: { accessToken: tokens.access_token },
                });
            }
        });

        try {
            // Explicitly refresh the token to check if it's still valid
            console.log('🔑 Checking/Refreshing Access Token...');
            const { token } = await oauth2Client.getAccessToken();
            if (!token) {
                console.error('❌ Failed to get access token - refresh token might be invalid or revoked');
                throw new Error('Unauthorized: Refresh token invalid or revoked');
            }

            const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

            // Search for bill/receipt style emails from the last 60 days
            const sixtyDaysAgo = Math.floor((Date.now() - 60 * 24 * 60 * 60 * 1000) / 1000);
            const query = `after:${sixtyDaysAgo} (subject:(bill OR receipt OR invoice OR order OR payment OR transaction OR "order confirmation" OR "payment confirmation" OR "payment received"))`;

            console.log('🔍 Searching Gmail messages with query:', query);
            const listRes = await gmail.users.messages.list({
                userId: 'me',
                q: query,
                maxResults: 50,
            });

            const messages = listRes.data.messages || [];
            console.log(`📨 Found ${messages.length} potential email matches`);

            // Fetch full details for each message and extract expenses
            const extractedExpenses: ExtractedExpense[] = [];
            const alreadyImportedIds = new Set(
                (await this.prisma.expense.findMany({
                    where: { userId, source: 'email', emailId: { not: null } },
                    select: { emailId: true },
                })).map(e => e.emailId)
            );

            for (const msg of messages) {
                if (!msg.id || alreadyImportedIds.has(msg.id)) continue;

                try {
                    const full = await gmail.users.messages.get({
                        userId: 'me',
                        id: msg.id,
                        format: 'full',
                    });

                    const headers = full.data.payload?.headers || [];
                    const subject = headers.find(h => h.name === 'Subject')?.value || '';
                    const from = headers.find(h => h.name === 'From')?.value || '';
                    const dateHeader = headers.find(h => h.name === 'Date')?.value || '';

                    // Get email body text
                    const body = this.extractBody(full.data.payload);

                    // Extract expense info
                    const extracted = this.parseExpenseFromEmail(subject, from, dateHeader, body, msg.id);
                    if (extracted) {
                        extractedExpenses.push(extracted);
                    }
                } catch {
                    // Skip emails that fail to parse
                }
            }

            // Update last synced time
            await this.prisma.emailConnection.update({
                where: { id: connection.id },
                data: { lastSynced: new Date() },
            });

            console.log(`✅ Sync completed: Extracted ${extractedExpenses.length} expenses`);
            return extractedExpenses;
        } catch (error) {
            console.error('❌ Gmail sync failed:', error.message);
            if (error.response) {
                console.error('API Error details:', JSON.stringify(error.response.data, null, 2));
            }
            throw error;
        }
    }

    /**
     * Import selected expenses into the database
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
                        source: 'email',
                        emailId: exp.emailId,
                        categoryId: exp.categoryId || null,
                    },
                    include: { category: true },
                })
            )
        );
        return created;
    }

    // ---- Private Helpers ----

    private extractBody(payload: any): string {
        if (!payload) return '';

        if (payload.body?.data) {
            return Buffer.from(payload.body.data, 'base64').toString('utf-8');
        }

        if (payload.parts) {
            for (const part of payload.parts) {
                if (part.mimeType === 'text/plain' || part.mimeType === 'text/html') {
                    const result = this.extractBody(part);
                    if (result) return result;
                }
            }
            // Try any part
            for (const part of payload.parts) {
                const result = this.extractBody(part);
                if (result) return result;
            }
        }
        return '';
    }

    private parseExpenseFromEmail(
        subject: string,
        from: string,
        dateHeader: string,
        body: string,
        messageId: string,
    ): ExtractedExpense | null {
        const text = `${subject} ${body}`.replace(/<[^>]*>/g, ' ');

        // Try to find an amount
        const amountPatterns = [
            /(?:Rs\.?|LKR|lkr|Total|Amount|Paid|USD|\$|€|£)\s*:?\s*([\d,]+(?:\.\d{1,2})?)/gi,
            /([\d,]+(?:\.\d{2}))\s*(?:Rs\.?|LKR|lkr)/gi,
            /Total[:\s]+(?:Rs\.?|LKR)?\s*([\d,]+(?:\.\d{1,2})?)/gi,
        ];

        let amount: number | null = null;
        for (const pattern of amountPatterns) {
            const match = pattern.exec(text);
            if (match) {
                const raw = match[1].replace(/,/g, '');
                const parsed = parseFloat(raw);
                if (!isNaN(parsed) && parsed > 0 && parsed < 10000000) {
                    amount = parsed;
                    break;
                }
            }
        }

        if (amount === null) return null;

        // Extract merchant from "From" header
        const merchantMatch = from.match(/^"?([^"<@]+)"?\s*</);
        const merchant = (merchantMatch?.[1] || from.split('@')[0] || from)
            .trim()
            .replace(/^(no-?reply[-_]?)*/i, '')
            .trim() || 'Unknown';

        // Parse date
        let date = new Date();
        if (dateHeader) {
            const parsed = new Date(dateHeader);
            if (!isNaN(parsed.getTime())) date = parsed;
        }

        const formattedDate = date.toISOString().split('T')[0];

        return {
            id: messageId,
            merchant: merchant.substring(0, 100),
            amount,
            currency: 'LKR',
            date: formattedDate,
            description: subject.substring(0, 200),
            emailSubject: subject,
            emailFrom: from,
        };
    }
}
