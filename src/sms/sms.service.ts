import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ParsedSmsExpense {
    id: string;
    bank: string;
    merchant: string;
    amount: number;
    currency: string;
    date: string; // YYYY-MM-DD
    description: string;
    rawSms: string;
}

@Injectable()
export class SmsService {
    constructor(private prisma: PrismaService) { }

    /**
     * Parse one or more raw SMS texts and extract expense info.
     * Splits on blank lines so the user can paste multiple messages at once.
     */
    parseSms(rawText: string): ParsedSmsExpense[] {
        // Split into individual messages by one or more blank lines
        const messages = rawText
            .split(/\n{2,}/)
            .map(m => m.trim())
            .filter(m => m.length > 10);

        const results: ParsedSmsExpense[] = [];
        for (const msg of messages) {
            const parsed = this.parseOne(msg);
            if (parsed) results.push(parsed);
        }
        return results;
    }

    /**
     * Save selected parsed expenses into the database.
     */
    async importExpenses(
        userId: string,
        expenses: Array<{
            merchant: string;
            amount: number;
            date: string;
            description: string;
            categoryId?: string;
        }>,
    ) {
        const created = await Promise.all(
            expenses.map(exp =>
                this.prisma.expense.create({
                    data: {
                        userId,
                        amount: exp.amount,
                        description: exp.description,
                        merchant: exp.merchant,
                        date: new Date(exp.date),
                        source: 'sms',
                        categoryId: exp.categoryId || null,
                    },
                    include: { category: true },
                }),
            ),
        );
        return { imported: created.length, expenses: created };
    }

    // ---- Private helpers ----

    private parseOne(msg: string): ParsedSmsExpense | null {
        const upper = msg.toUpperCase();

        // ----------------------------------------------------------------
        // 1. Detect bank
        // ----------------------------------------------------------------
        let bank = 'Unknown Bank';
        if (/COMMERCIAL BANK|COMBANK/.test(upper)) bank = 'Commercial Bank';
        else if (/HNB/.test(upper)) bank = 'HNB';
        else if (/SAMPATH/.test(upper)) bank = 'Sampath Bank';
        else if (/BOC|BANK OF CEYLON/.test(upper)) bank = 'BOC';
        else if (/NATIONS TRUST|NTB/.test(upper)) bank = 'Nations Trust Bank';
        else if (/AMEX|AMERICAN EXPRESS/.test(upper)) bank = 'Amex';
        else if (/DIALOG/.test(upper)) bank = 'Dialog';
        else if (/SEYLAN/.test(upper)) bank = 'Seylan Bank';
        else if (/NSB|NATIONAL SAVINGS/.test(upper)) bank = 'NSB';
        else if (/CARGILLS|CARGILL/.test(upper)) bank = 'Cargills Bank';
        else if (/DFCC/.test(upper)) bank = 'DFCC Bank';
        else if (/UNION BANK/.test(upper)) bank = 'Union Bank';
        else if (/PAN ASIA|PABC/.test(upper)) bank = 'Pan Asia Bank';

        // ----------------------------------------------------------------
        // 2. Extract amount  (LKR / Rs. / debited / credited patterns)
        // ----------------------------------------------------------------
        const amountPatterns = [
            // "debited with LKR 1,500.00" / "debited with Rs. 1500"
            /(?:debited|charged|paid|payment of|amount of|txn of)\s+(?:with\s+)?(?:LKR|Rs\.?|lkr)\s*([\d,]+(?:\.\d{1,2})?)/i,
            // "LKR 1,500.00" / "Rs. 1500"
            /(?:LKR|Rs\.?)\s*([\d,]+(?:\.\d{1,2})?)/i,
            // "1,500.00 LKR"
            /([\d,]+(?:\.\d{2}))\s*(?:LKR|Rs\.?)/i,
            // plain number at end: "... 1500.00"
            /(?:amount|total|value)[^0-9]*([\d,]+(?:\.\d{1,2})?)/i,
        ];

        let amount: number | null = null;
        for (const pattern of amountPatterns) {
            const m = pattern.exec(msg);
            if (m) {
                const raw = m[1].replace(/,/g, '');
                const val = parseFloat(raw);
                if (!isNaN(val) && val > 0 && val < 50_000_000) {
                    amount = val;
                    break;
                }
            }
        }

        if (amount === null) return null;

        // ----------------------------------------------------------------
        // 3. Extract merchant
        // ----------------------------------------------------------------
        let merchant = 'Unknown Merchant';

        // "at MERCHANT NAME" — most bank SMS use this phrasing
        const atPatterns = [
            /\bat\s+([A-Z0-9][A-Z0-9 &'\-\.\/]{2,40}?)(?:\s+on|\s+for|\s+dated|\.|,|$)/i,
            /(?:to|for)\s+([A-Z0-9][A-Z0-9 &'\-\.\/]{2,40}?)(?:\s+on|\s+dated|\.|,|$)/i,
        ];
        for (const p of atPatterns) {
            const m = p.exec(msg);
            if (m && m[1].trim().length > 1) {
                merchant = m[1].trim().substring(0, 80);
                break;
            }
        }

        // ----------------------------------------------------------------
        // 4. Extract date
        // ----------------------------------------------------------------
        let dateStr = new Date().toISOString().split('T')[0];
        const datePatterns = [
            // DD/MM/YYYY or DD-MM-YYYY
            { re: /(\d{2})[\/\-](\d{2})[\/\-](\d{4})/, fmt: (m: RegExpExecArray) => `${m[3]}-${m[2]}-${m[1]}` },
            // YYYY-MM-DD
            { re: /(\d{4})-(\d{2})-(\d{2})/, fmt: (m: RegExpExecArray) => `${m[1]}-${m[2]}-${m[3]}` },
            // DD Mon YYYY  e.g. "16 Mar 2026"
            {
                re: /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i,
                fmt: (m: RegExpExecArray) => {
                    const months: Record<string, string> = {
                        jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
                        jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
                    };
                    const dd = m[1].padStart(2, '0');
                    const mm = months[m[2].toLowerCase().substring(0, 3)];
                    return `${m[3]}-${mm}-${dd}`;
                },
            },
        ];

        for (const { re, fmt } of datePatterns) {
            const m = re.exec(msg);
            if (m) {
                const candidate = fmt(m);
                if (!isNaN(new Date(candidate).getTime())) {
                    dateStr = candidate;
                    break;
                }
            }
        }

        // ----------------------------------------------------------------
        // 5. Build result
        // ----------------------------------------------------------------
        const id = `sms_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const description = `${bank} SMS – ${merchant}`.substring(0, 200);

        return {
            id,
            bank,
            merchant,
            amount,
            currency: 'LKR',
            date: dateStr,
            description,
            rawSms: msg.substring(0, 500),
        };
    }
}
