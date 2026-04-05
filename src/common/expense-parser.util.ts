/**
 * Shared expense parsing utilities — used by both GmailService (OAuth) and
 * EmailIngestService (forwarding). Extracted to avoid code duplication.
 */

export interface ExtractedExpense {
    id: string;
    merchant: string;
    amount: number;
    currency: string;
    date: string; // YYYY-MM-DD
    description: string;
    emailSubject: string;
    emailFrom: string;
}

export function extractBody(payload: any): string {
    if (!payload) return '';
    if (payload.body?.data) {
        return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }
    if (payload.parts) {
        for (const part of payload.parts) {
            if (part.mimeType === 'text/plain' || part.mimeType === 'text/html') {
                const result = extractBody(part);
                if (result) return result;
            }
        }
        for (const part of payload.parts) {
            const result = extractBody(part);
            if (result) return result;
        }
    }
    return '';
}

export async function getExchangeRates(): Promise<Record<string, number>> {
    try {
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

export function normalizeCurrency(symbol: string): string {
    if (!symbol) return 'LKR';
    const s = symbol.toUpperCase().trim();
    if (s.includes('$') || s.includes('USD')) return 'USD';
    if (s.includes('€') || s.includes('EUR')) return 'EUR';
    if (s.includes('£') || s.includes('GBP')) return 'GBP';
    if (s.includes('A$') || s.includes('AUD')) return 'AUD';
    return 'LKR';
}

export function convertToLKR(amount: number, currency: string, rates: Record<string, number>): number {
    if (currency === 'LKR') return amount;

    const fallbackRates: Record<string, number> = {
        'USD': 305,
        'EUR': 330,
        'GBP': 385,
        'AUD': 200,
    };

    if (rates[currency] && rates['LKR']) {
        const amountInUSD = amount / rates[currency];
        const converted = amountInUSD * rates['LKR'];
        return Math.round(converted * 100) / 100;
    }

    const fallbackRate = fallbackRates[currency];
    if (fallbackRate) {
        return Math.round(amount * fallbackRate * 100) / 100;
    }

    return amount;
}

export function parseExpenseFromEmail(
    subject: string,
    from: string,
    dateHeader: string,
    body: string,
    messageId: string,
): ExtractedExpense | null {
    let finalFrom = from;
    let finalDateHeader = dateHeader;
    let finalSubject = subject;

    // Handle manually forwarded emails (Gmail format)
    if (body.includes('Forwarded message')) {
        const fwBlockMatch = body.match(/Forwarded message[\s\S]*?From:\s*([^\n]+)[\s\S]*?Date:\s*([^\n]+)[\s\S]*?Subject:\s*([^\n]+)/i);
        if (fwBlockMatch) {
            finalFrom = fwBlockMatch[1].trim();
            finalDateHeader = fwBlockMatch[2].trim();
            finalSubject = fwBlockMatch[3].trim();
        }
    }

    const text = `${finalSubject} ${body}`.replace(/<[^>]*>/g, ' ');

    const amountPatterns = [
        { regex: /(USD|\$|€|£|A\$|AUD|Rs\.?|LKR|lkr)\s*:?\s*([\d,]+(?:\.\d{1,2})?)/gi, currIdx: 1, amtIdx: 2 },
        { regex: /(?:Total|Amount|Paid)\s*:?\s*(USD|\$|€|£|A\$|AUD|Rs\.?|LKR|lkr)?\s*([\d,]+(?:\.\d{1,2})?)/gi, currIdx: 1, amtIdx: 2 },
        { regex: /([\d,]+(?:\.\d{2}))\s*(USD|\$|€|£|A\$|AUD|Rs\.?|LKR|lkr)/gi, currIdx: 2, amtIdx: 1 },
    ];

    let amount: number | null = null;
    let currency: string = 'LKR';

    for (const pattern of amountPatterns) {
        pattern.regex.lastIndex = 0;
        const match = pattern.regex.exec(text);
        if (match) {
            const rawAmt = match[pattern.amtIdx].replace(/,/g, '');
            const currSymbol = match[pattern.currIdx];
            const parsed = parseFloat(rawAmt);
            if (!isNaN(parsed) && parsed > 0 && parsed < 10000000) {
                amount = parsed;
                if (currSymbol) {
                    currency = normalizeCurrency(currSymbol);
                }
                break;
            }
        }
    }

    if (amount === null) return null;

    const merchantMatch = finalFrom.match(/^"?([^"<@]+)"?\s*</);
    const merchant = (merchantMatch?.[1] || finalFrom.split('@')[0] || finalFrom)
        .trim()
        .replace(/^(no-?reply[-_]?)*/i, '')
        .trim() || 'Unknown';

    let date = new Date();
    if (finalDateHeader) {
        const parsed = new Date(finalDateHeader);
        if (!isNaN(parsed.getTime())) date = parsed;
    }

    return {
        id: messageId,
        merchant: merchant.substring(0, 100),
        amount,
        currency,
        date: date.toISOString().split('T')[0],
        description: subject.substring(0, 200),
        emailSubject: subject,
        emailFrom: from,
    };
}
