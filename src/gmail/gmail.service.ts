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
    async syncEmails(userId: string, targetStartDate?: Date, targetEndDate?: Date): Promise<ExtractedExpense[]> {
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

            // Search for bill/receipt style emails from the target date onwards
            // By default, only pull current month
            let checkDateStart = targetStartDate;
            let checkDateEnd = targetEndDate;
            
            if (!checkDateStart) {
                const now = new Date();
                checkDateStart = new Date(now.getFullYear(), now.getMonth(), 1);
            }
            if (!checkDateEnd) {
                const now = new Date();
                checkDateEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
            }
            
            const queryAfterSeconds = Math.floor(checkDateStart.getTime() / 1000);
            const queryBeforeSeconds = Math.floor(checkDateEnd.getTime() / 1000);
            const query = `after:${queryAfterSeconds} before:${queryBeforeSeconds} (subject:(bill OR receipt OR invoice OR order OR payment OR transaction OR "order confirmation" OR "payment confirmation" OR "payment received"))`;

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

            // Fetch exchange rates once for the batch
            const exchangeRates = await this.getExchangeRates();

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
                        // Apply currency conversion
                        if (extracted.currency !== 'LKR') {
                            const originalAmount = extracted.amount;
                            extracted.amount = this.convertToLKR(extracted.amount, extracted.currency, exchangeRates);
                            extracted.description += ` (Converted from ${originalAmount} ${extracted.currency})`;
                            extracted.currency = 'LKR';
                        }
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

    private async getExchangeRates(): Promise<Record<string, number>> {
        try {
            // Using open.er-api.com for free exchange rates (base USD)
            const res = await fetch('https://open.er-api.com/v6/latest/USD');
            if (res.ok) {
                const data = await res.json();
                return data.rates || {};
            }
        } catch (error) {
            console.error('Failed to fetch exchange rates:', error);
        }
        return {};
    }

    private normalizeCurrency(symbol: string): string {
        if (!symbol) return 'LKR';
        const s = symbol.toUpperCase().trim();
        if (s.includes('$') || s.includes('USD')) return 'USD';
        if (s.includes('€') || s.includes('EUR')) return 'EUR';
        if (s.includes('£') || s.includes('GBP')) return 'GBP';
        if (s.includes('A$') || s.includes('AUD')) return 'AUD';
        return 'LKR'; // Default fallback
    }

    private convertToLKR(amount: number, currency: string, rates: Record<string, number>): number {
        if (currency === 'LKR') return amount;
        
        // If we don't have rates, use hardcoded fallbacks
        const fallbackRates: Record<string, number> = {
            'USD': 305,
            'EUR': 330,
            'GBP': 385,
            'AUD': 200,
        };
        
        if (rates[currency] && rates['LKR']) {
            // Convert foreign currency to base (USD), then to LKR
            const amountInUSD = amount / rates[currency];
            const converted = amountInUSD * rates['LKR'];
            return Math.round(converted * 100) / 100;
        }
        
        const fallbackRate = fallbackRates[currency];
        if (fallbackRate) {
            const converted = amount * fallbackRate;
            return Math.round(converted * 100) / 100;
        }
        
        return amount; // Cannot convert, return original
    }

    private parseExpenseFromEmail(
        subject: string,
        from: string,
        dateHeader: string,
        body: string,
        messageId: string,
    ): ExtractedExpense | null {
        const text = `${subject} ${body}`.replace(/<[^>]*>/g, ' ');

        // Try to find an amount with symbols
        const amountPatterns = [
            { regex: /(USD|\$|€|£|A\$|AUD|Rs\.?|LKR|lkr)\s*:?\s*([\d,]+(?:\.\d{1,2})?)/gi, currIdx: 1, amtIdx: 2 },
            { regex: /(?:Total|Amount|Paid)\s*:?\s*(USD|\$|€|£|A\$|AUD|Rs\.?|LKR|lkr)?\s*([\d,]+(?:\.\d{1,2})?)/gi, currIdx: 1, amtIdx: 2 },
            { regex: /([\d,]+(?:\.\d{2}))\s*(USD|\$|€|£|A\$|AUD|Rs\.?|LKR|lkr)/gi, currIdx: 2, amtIdx: 1 },
        ];

        let amount: number | null = null;
        let currency: string = 'LKR';

        for (const pattern of amountPatterns) {
            // Reset regex state since we use 'g'
            pattern.regex.lastIndex = 0;
            const match = pattern.regex.exec(text);
            if (match) {
                const rawAmt = match[pattern.amtIdx].replace(/,/g, '');
                const currSymbol = match[pattern.currIdx];
                const parsed = parseFloat(rawAmt);
                if (!isNaN(parsed) && parsed > 0 && parsed < 10000000) {
                    amount = parsed;
                    if (currSymbol) {
                        currency = this.normalizeCurrency(currSymbol);
                    }
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
            currency,
            date: formattedDate,
            description: subject.substring(0, 200),
            emailSubject: subject,
            emailFrom: from,
        };
    }
}
