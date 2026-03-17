import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as tesseract from 'tesseract.js';
// NOTE: pdf-parse is NOT imported at the top level.
// It is dynamically imported inside processFile() to avoid crashing
// Vercel serverless functions which don't support DOMMatrix at startup.
import * as fs from 'fs';
import * as path from 'path';

export interface ParsedReceiptExpense {
    merchant: string;
    amount: number;
    date: string; // YYYY-MM-DD
    description: string;
    rawText: string;
}

@Injectable()
export class ReceiptService {
    constructor(private prisma: PrismaService) { }

    /**
     * Process an uploaded image or PDF file to extract expense info.
     */
    async processFile(file: Express.Multer.File): Promise<ParsedReceiptExpense> {
        if (!file) {
            throw new BadRequestException('No file uploaded');
        }

        let rawText = '';
        const mimeType = file.mimetype;

        try {
            if (mimeType.includes('pdf')) {
                // Use pdf-parse v1.1.1 which is compatible with serverless environments.
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const pdfParse = require('pdf-parse');
                const data = await pdfParse(file.buffer);
                rawText = data.text;
            } else if (mimeType.includes('image')) {
                // Parse Image via OCR (Tesseract)
                const { data: { text } } = await tesseract.recognize(
                    file.buffer,
                    'eng',
                    // tesseract.js automatically handles standard logger configurations in v5+
                );
                rawText = text;
            } else {
                throw new BadRequestException('Unsupported file format. Please upload an image or PDF.');
            }
        } catch (error) {
            throw new BadRequestException(`Failed to extract text from file: ${error.message}`);
        }

        if (!rawText || rawText.trim().length === 0) {
            throw new BadRequestException('Could not detect any text in the uploaded file');
        }

        // Parse extracted text into an expense
        const parsed = this.parseReceiptText(rawText);

        return {
            ...parsed,
            rawText: rawText.substring(0, 500) // Keep snippet of raw text
        };
    }

    /**
     * Parse the OCR/extracted text to find merchant, amount, and date.
     */
    private parseReceiptText(text: string): Omit<ParsedReceiptExpense, 'rawText'> {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        let merchant = 'Unknown Merchant';
        let amount = 0;
        let dateStr = new Date().toISOString().split('T')[0];

        // ----------------------------------------------------------------
        // 1. Merchant (usually the first couple lines of a receipt)
        // ----------------------------------------------------------------
        for (let i = 0; i < Math.min(3, lines.length); i++) {
            const line = lines[i];
            // Skip common non-merchant header lines
            if (
                line.length > 2 &&
                !/welcom|receipt|tax|invoice|cashier|date|time/i.test(line) &&
                !/^[\d\W]+$/.test(line) // not purely numbers/symbols
            ) {
                merchant = line.replace(/[^a-zA-Z0-9\s&*_-]/g, '').trim();
                if (merchant.length > 2) break;
            }
        }

        // ----------------------------------------------------------------
        // 2. Amount (look for Total, Balance, Amount, etc)
        // ----------------------------------------------------------------
        const amountPatterns = [
            /(?:TOTAL|TL|NET|AMOUNT|BAL DUE|BALANCE|DUE)\s*[:\-\=]?\s*(?:(?:RS|LKR|\$|£|€)\.?\s*)?([\d,]+(?:\.\d{2}))/i,
            /(?:(?:RS|LKR|\$|£|€)\.?\s*)?([\d,]+(?:\.\d{2}))/i // Fallback: find any currency looking numbers
        ];

        // Search from bottom up, as total is usually at the bottom
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];

            // Look for explicit "Total" keywords first
            if (/TOTAL|NET|BAL|DUE/i.test(line)) {
                const match = line.match(/([\d,]+(?:\.\d{2}))/);
                if (match) {
                    const val = parseFloat(match[1].replace(/,/g, ''));
                    if (!isNaN(val) && val > 0 && val < 1000000) {
                        amount = val;
                        break;
                    }
                }
            }
        }

        // If no explicit total found, try general regex over the whole text
        if (amount === 0) {
            for (const pattern of amountPatterns) {
                const match = pattern.exec(text);
                if (match) {
                    const val = parseFloat(match[1].replace(/,/g, ''));
                    if (!isNaN(val) && val > 0 && val < 1000000) {
                        amount = val;
                        break;
                    }
                }
            }
        }

        // ----------------------------------------------------------------
        // 3. Date
        // ----------------------------------------------------------------
        const datePatterns = [
            // YYYY-MM-DD or YYYY/MM/DD
            { re: /(\d{4})[\/\-](\d{2})[\/\-](\d{2})/, fmt: (m: RegExpExecArray) => `${m[1]}-${m[2]}-${m[3]}` },
            // DD/MM/YYYY or DD-MM-YYYY
            { re: /(\d{2})[\/\-](\d{2})[\/\-](\d{4})/, fmt: (m: RegExpExecArray) => `${m[3]}-${m[2]}-${m[1]}` },
            // DD/MM/YY
            { re: /(\d{2})[\/\-](\d{2})[\/\-](\d{2})/, fmt: (m: RegExpExecArray) => `20${m[3]}-${m[2]}-${m[1]}` },
            // Month DD, YYYY
            {
                re: /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+(\d{1,2})[th|st|nd|rd,]*\s+(\d{4})/i,
                fmt: (m: RegExpExecArray) => {
                    const months: Record<string, string> = {
                        jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
                        jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
                    };
                    const dd = m[2].padStart(2, '0');
                    const mm = months[m[1].toLowerCase()];
                    return `${m[3]}-${mm}-${dd}`;
                }
            }
        ];

        for (const { re, fmt } of datePatterns) {
            const match = re.exec(text);
            if (match) {
                const candidate = fmt(match);
                if (!isNaN(new Date(candidate).getTime())) {
                    dateStr = candidate;
                    break;
                }
            }
        }

        return {
            merchant: merchant.substring(0, 80),
            amount,
            date: dateStr,
            description: `Receipt – ${merchant}`.substring(0, 100),
        };
    }

    /**
     * Import the scanned expense to the DB
     */
    async importExpense(
        userId: string,
        expense: {
            merchant: string;
            amount: number;
            date: string;
            description: string;
            categoryId?: string;
        }
    ) {
        const created = await this.prisma.expense.create({
            data: {
                userId,
                amount: expense.amount,
                description: expense.description,
                merchant: expense.merchant,
                date: new Date(expense.date),
                source: 'receipt',
                categoryId: expense.categoryId || null,
            },
            include: { category: true }
        });

        return { imported: 1, expense: created };
    }
}
